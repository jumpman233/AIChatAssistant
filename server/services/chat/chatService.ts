import { randomUUID } from 'node:crypto'
import { getProfileById } from '../../profiles'
import { toMessageDTO } from '../../mappers/chatMappers'
import { conversationRepository } from '../../repositories/conversationRepository'
import { messageRepository } from '../../repositories/messageRepository'
import { badRequest, conflict, createApiError, notFound } from '../../utils/apiError'
import { logger } from '../../utils/logger'
import { createSseFrame } from '../../utils/sse'
import type { CreateChatInput } from '../../validators/chat'
import { createMockStream } from './mockStreamService'

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

const encoder = new TextEncoder()

const toStreamId = () => `stream_${randomUUID()}`

const getSafeStreamErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.startsWith('Mock stream failed')) {
    return error.message
  }

  return 'Mock stream failed'
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

    if (conversation.messages?.[0]) {
      logger.warn('active guard blocked', {
        activeAssistantMessageId: conversation.messages[0].id,
        conversationId: conversation.id,
      })
      throw conflict(
        'Current conversation already has an active streaming message',
        'CONVERSATION_STREAMING',
      )
    }

    logger.info('active guard passed', {
      conversationId: conversation.id,
    })

    assertProfileMode(profileId, mode)

    const streamId = toStreamId()
    const { assistantMessage, userMessage } = await messageRepository.createChatMessages({
      content: input.content,
      conversationId: conversation.id,
      mode,
      profileId,
    })
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

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const writeEvent = createStreamWriter(controller)
        let fullContent = ''

        try {
          writeEvent({
            assistantMessage: initialAssistantMessageDTO,
            conversationId: conversation.id,
            streamId,
            type: 'message_created',
            userMessage: userMessageDTO,
          })

          for await (const chunk of createMockStream(input.mock)) {
            fullContent += chunk.delta
            logger.info('delta', {
              assistantMessageId: assistantMessage.id,
              deltaIndex: chunk.index,
              deltaLength: chunk.delta.length,
              fullContentLength: fullContent.length,
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
          const errorMessage = getSafeStreamErrorMessage(error)
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
