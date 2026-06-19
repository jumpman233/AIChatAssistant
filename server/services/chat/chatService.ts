import { randomUUID } from 'node:crypto'
import { getChatProviderConfig } from '../../config/chatProviderConfig'
import { getProfileById } from '../../profiles'
import { toMessageDTO } from '../../mappers/chatMappers'
import { conversationRepository } from '../../repositories/conversationRepository'
import {
  ActiveChatStreamError,
  ChatMessagesConversationDeletedError,
  ChatMessagesConversationNotFoundError,
  messageRepository,
} from '../../repositories/messageRepository'
import { badRequest, conflict, createApiError, notFound } from '../../utils/apiError'
import { logger } from '../../utils/logger'
import { createSseFrame } from '../../utils/sse'
import type { CreateChatInput } from '../../validators/chat'
import { buildConversationHistory } from './conversationHistory'
import { createChatProvider } from './providers/providerFactory'
import { ChatProviderError } from './providers/types'

type ChatStreamEvent =
  | {
      type: 'message_created'
      streamId: string
      conversationId: string
      userMessage: ReturnType<typeof toMessageDTO>
      assistantMessage: ReturnType<typeof toMessageDTO>
    }
  | {
      type: 'text_delta'
      streamId: string
      conversationId: string
      messageId: string
      delta: string
    }
  | {
      type: 'message_done'
      streamId: string
      conversationId: string
      message: ReturnType<typeof toMessageDTO>
    }
  | {
      type: 'message_failed'
      streamId: string
      conversationId: string
      message: ReturnType<typeof toMessageDTO>
      error: {
        message: string
        code?: string
      }
    }

type CreatedChatMessages = Awaited<
  ReturnType<typeof messageRepository.createChatMessagesWithActiveGuard>
>

const encoder = new TextEncoder()

const toStreamId = () => `stream_${randomUUID()}`

const getSafeStreamErrorMessage = (error: unknown, providerName: string) => {
  if (error instanceof ChatProviderError) {
    return error.message
  }

  if (error instanceof Error && error.message.startsWith('Mock stream failed')) {
    return error.message
  }

  return `${providerName} provider stream failed`
}

const createStreamWriter = (controller: ReadableStreamDefaultController<Uint8Array>) => {
  let eventSeq = 0

  return (event: ChatStreamEvent) => {
    eventSeq += 1
    const frame = createSseFrame({
      data: event,
      event: event.type,
      id: eventSeq,
    })

    controller.enqueue(encoder.encode(frame))

    const eventMeta = {
      event: event.type,
      eventSeq,
      streamId: event.streamId,
    }

    if (event.type === 'message_failed') {
      logger.warn('sse sent', eventMeta)
      return
    }

    if (event.type === 'text_delta') {
      logger.debug('sse sent', {
        ...eventMeta,
        deltaLength: event.delta.length,
      })
      return
    }

    logger.info('sse sent', eventMeta)
  }
}

const assertProfileMode = (profileId: string, mode: string) => {
  const profile = getProfileById(profileId)

  if (!profile) {
    throw badRequest('Invalid profileId')
  }

  if (profile.conversationModes && !profile.conversationModes.includes(mode)) {
    throw badRequest('Invalid mode')
  }

  return profile
}

export const chatService = {
  async createChatStream(input: CreateChatInput) {
    const conversation = await conversationRepository.findById(input.conversationId)

    if (!conversation) {
      throw notFound('Conversation not found')
    }

    if (conversation.status === 'deleted') {
      throw createApiError({
        code: 'CONVERSATION_DELETED',
        message: 'Conversation is deleted',
        statusCode: 404,
      })
    }

    const profileId = input.profileId ?? conversation.profileId
    const mode = input.mode ?? conversation.mode

    logger.info('start', {
      conversationId: conversation.id,
      mode,
      profileId,
    })

    const profile = assertProfileMode(profileId, mode)
    const providerConfig = getChatProviderConfig()
    const provider = createChatProvider(providerConfig)

    logger.info('provider selected', {
      provider: provider.name,
    })

    let createdMessages: CreatedChatMessages

    try {
      createdMessages = await messageRepository.createChatMessagesWithActiveGuard({
        content: input.content,
        conversationId: conversation.id,
        mode,
        profileId,
      })
    } catch (error) {
      if (error instanceof ActiveChatStreamError) {
        logger.warn('active guard blocked', {
          activeAssistantMessageId: error.activeAssistantMessageId,
          conversationId: conversation.id,
        })
        throw conflict(
          'Current conversation already has an active streaming message',
          'CONVERSATION_STREAMING',
        )
      }

      if (error instanceof ChatMessagesConversationNotFoundError) {
        throw notFound('Conversation not found')
      }

      if (error instanceof ChatMessagesConversationDeletedError) {
        throw createApiError({
          code: 'CONVERSATION_DELETED',
          message: 'Conversation is deleted',
          statusCode: 404,
        })
      }

      throw error
    }

    logger.info('active guard passed', {
      conversationId: conversation.id,
    })

    const streamId = toStreamId()
    const { assistantMessage, userMessage } = createdMessages
    const userMessageDTO = toMessageDTO(userMessage)
    const initialAssistantMessageDTO = toMessageDTO(assistantMessage)

    logger.info('messages created', {
      assistantMessageId: assistantMessage.id,
      assistantSeq: assistantMessage.seq,
      conversationId: conversation.id,
      streamId,
      userMessageId: userMessage.id,
      userSeq: userMessage.seq,
    })

    const historyMessages = await messageRepository.listForConversationHistory(conversation.id)
    const providerMessages = buildConversationHistory({
      messages: historyMessages,
      systemPrompt: profile.systemPrompt,
    })

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const writeEvent = createStreamWriter(controller)
        let fullContent = ''
        let deltaIndex = 0

        try {
          writeEvent({
            assistantMessage: initialAssistantMessageDTO,
            conversationId: conversation.id,
            streamId,
            type: 'message_created',
            userMessage: userMessageDTO,
          })

          for await (const chunk of provider.stream({
            messages: providerMessages,
            mock: input.mock,
            mode,
            profileId,
          })) {
            deltaIndex += 1
            fullContent += chunk.delta
            logger.info('delta', {
              assistantMessageId: assistantMessage.id,
              deltaIndex,
              deltaLength: chunk.delta.length,
              fullContentLength: fullContent.length,
              provider: provider.name,
              streamId,
            })
            writeEvent({
              conversationId: conversation.id,
              delta: chunk.delta,
              messageId: assistantMessage.id,
              streamId,
              type: 'text_delta',
            })
          }

          const doneMessage = await messageRepository.updateAssistantMessageDone({
            content: fullContent,
            messageId: assistantMessage.id,
          })

          logger.info('assistant done', {
            contentLength: fullContent.length,
            messageId: assistantMessage.id,
            provider: provider.name,
            streamId,
          })

          writeEvent({
            conversationId: conversation.id,
            message: toMessageDTO(doneMessage),
            streamId,
            type: 'message_done',
          })
          controller.close()
        } catch (error) {
          const errorMessage = getSafeStreamErrorMessage(error, provider.name)
          const failedMessage = await messageRepository.updateAssistantMessageFailed({
            content: fullContent,
            errorMessage,
            messageId: assistantMessage.id,
          })

          logger.error('failed', {
            assistantMessageId: assistantMessage.id,
            contentLength: fullContent.length,
            errorMessage,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            provider: provider.name,
            streamId,
          })

          writeEvent({
            conversationId: conversation.id,
            error: {
              code: 'INTERNAL_ERROR',
              message: errorMessage,
            },
            message: toMessageDTO(failedMessage),
            streamId,
            type: 'message_failed',
          })
          controller.close()
        }
      },
    })
  },
}
