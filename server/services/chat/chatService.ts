import { randomUUID } from 'node:crypto'
import { getChatProviderConfig } from '../../config/chatProviderConfig'
import { getProfileById } from '../../profiles'
import { toMessageDTO } from '../../mappers/chatMappers'
import { conversationRepository } from '../../repositories/conversationRepository'
import {
  ActiveChatStreamError,
  ChatMessagesConversationDeletedError,
  ChatMessagesConversationNotFoundError,
  MessageNotRetryableError,
  RetryParentUserMessageNotFoundError,
  RetrySourceMessageNotFoundError,
  messageRepository,
} from '../../repositories/messageRepository'
import { badRequest, conflict, createApiError, notFound } from '../../utils/apiError'
import { logger } from '../../utils/logger'
import { createSseFrame } from '../../utils/sse'
import type { CreateChatInput, RetryChatInput } from '../../validators/chat'
import { activeStreamRegistry } from './activeStreamRegistry'
import { buildConversationHistory } from './conversationHistory'
import { createChatProvider } from './providers/providerFactory'
import { ChatProviderError, type ChatModelProvider } from './providers/types'

type MessageDTO = ReturnType<typeof toMessageDTO>

type ChatStreamEvent =
  | {
      type: 'message_created'
      streamId: string
      conversationId: string
      userMessage: MessageDTO
      assistantMessage: MessageDTO
    }
  | {
      type: 'retry_created'
      streamId: string
      conversationId: string
      sourceAssistantMessageId: string
      assistantMessage: MessageDTO
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
      message: MessageDTO
    }
  | {
      type: 'message_failed'
      streamId: string
      conversationId: string
      message: MessageDTO
      error: {
        message: string
        code?: string
      }
    }

type CreatedChatMessages = Awaited<
  ReturnType<typeof messageRepository.createChatMessagesWithActiveGuard>
>

type CreatedRetryAssistant = Awaited<
  ReturnType<typeof messageRepository.createRetryAssistantWithActiveGuard>
>

type RunAssistantStreamInput = {
  assistantMessage: CreatedChatMessages['assistantMessage']
  conversationId: string
  initialEvent: ChatStreamEvent
  mock: CreateChatInput['mock']
  mode: string
  profileId: string
  provider: ChatModelProvider
  providerMessages: Parameters<ChatModelProvider['stream']>[0]['messages']
  streamId: string
}

const encoder = new TextEncoder()

const toStreamId = () => `stream_${randomUUID()}`

const isProviderAbortError = (error: unknown) => {
  if (error instanceof ChatProviderError && error.category === 'aborted') {
    return true
  }

  return error instanceof Error && error.name === 'AbortError'
}

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

const toProvider = () => {
  const providerConfig = getChatProviderConfig()
  const provider = createChatProvider(providerConfig)

  logger.info('provider selected', {
    provider: provider.name,
  })

  return provider
}

const getProviderMessages = async (input: {
  conversationId: string
  profile: ReturnType<typeof assertProfileMode>
}) => {
  const historyMessages = await messageRepository.listForConversationHistory(input.conversationId)

  return buildConversationHistory({
    messages: historyMessages,
    systemPrompt: input.profile.systemPrompt,
  })
}

const mapCreateMessagesError = (
  error: unknown,
  conversationId: string,
  options: { notFoundMessage: string },
): never => {
  if (error instanceof ActiveChatStreamError) {
    logger.warn('active guard blocked', {
      activeAssistantMessageId: error.activeAssistantMessageId,
      conversationId,
    })
    throw conflict(
      'Current conversation already has an active streaming message',
      'CONVERSATION_STREAMING',
    )
  }

  if (error instanceof ChatMessagesConversationNotFoundError) {
    throw notFound(options.notFoundMessage)
  }

  if (error instanceof RetrySourceMessageNotFoundError) {
    throw notFound('Message not found')
  }

  if (error instanceof ChatMessagesConversationDeletedError) {
    throw createApiError({
      code: 'CONVERSATION_DELETED',
      message: 'Conversation is deleted',
      statusCode: 404,
    })
  }

  if (
    error instanceof MessageNotRetryableError ||
    error instanceof RetryParentUserMessageNotFoundError
  ) {
    throw conflict('Message is not retryable', 'MESSAGE_NOT_RETRYABLE')
  }

  throw error
}

const closeController = (controller: ReadableStreamDefaultController<Uint8Array>) => {
  try {
    controller.close()
  } catch {
    // The client may have already cancelled the reader.
  }
}

const logSkippedTerminalTransition = (input: {
  assistantMessageId: string
  outcome: string
  existingStatus?: string
  streamId: string
  targetStatus: string
}) => {
  logger.warn('terminal transition skipped', {
    assistantMessageId: input.assistantMessageId,
    existingStatus: input.existingStatus,
    outcome: input.outcome,
    status: input.targetStatus,
    streamId: input.streamId,
  })
}

const runAssistantStream = (input: RunAssistantStreamInput) => {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeEvent = createStreamWriter(controller)
      const providerAbortController = new AbortController()
      let fullContent = ''
      let deltaIndex = 0

      activeStreamRegistry.register(input.assistantMessage.id, providerAbortController)

      try {
        const activeAssistant = await messageRepository.findActiveAssistantById(
          input.assistantMessage.id,
        )

        if (!activeAssistant) {
          logger.warn('provider start skipped inactive assistant', {
            assistantMessageId: input.assistantMessage.id,
            streamId: input.streamId,
          })
          closeController(controller)
          return
        }

        writeEvent(input.initialEvent)

        for await (const chunk of input.provider.stream({
          messages: input.providerMessages,
          mock: input.mock,
          mode: input.mode,
          profileId: input.profileId,
          signal: providerAbortController.signal,
        })) {
          deltaIndex += 1
          fullContent += chunk.delta
          logger.info('delta', {
            assistantMessageId: input.assistantMessage.id,
            deltaIndex,
            deltaLength: chunk.delta.length,
            fullContentLength: fullContent.length,
            provider: input.provider.name,
            streamId: input.streamId,
          })
          writeEvent({
            conversationId: input.conversationId,
            delta: chunk.delta,
            messageId: input.assistantMessage.id,
            streamId: input.streamId,
            type: 'text_delta',
          })
        }

        const doneResult = await messageRepository.completeAssistantIfActive({
          content: fullContent,
          messageId: input.assistantMessage.id,
        })

        if (doneResult.outcome !== 'updated') {
          logSkippedTerminalTransition({
            assistantMessageId: input.assistantMessage.id,
            existingStatus: doneResult.existingStatus,
            outcome: doneResult.outcome,
            streamId: input.streamId,
            targetStatus: 'done',
          })
          closeController(controller)
          return
        }

        logger.info('terminal transition won', {
          contentLength: fullContent.length,
          messageId: input.assistantMessage.id,
          provider: input.provider.name,
          status: 'done',
          streamId: input.streamId,
        })

        writeEvent({
          conversationId: input.conversationId,
          message: toMessageDTO(doneResult.message),
          streamId: input.streamId,
          type: 'message_done',
        })
        closeController(controller)
      } catch (error) {
        if (isProviderAbortError(error)) {
          logger.info('provider stream aborted', {
            assistantMessageId: input.assistantMessage.id,
            contentLength: fullContent.length,
            provider: input.provider.name,
            streamId: input.streamId,
          })
          closeController(controller)
          return
        }

        const errorMessage = getSafeStreamErrorMessage(error, input.provider.name)
        const failedResult = await messageRepository.failAssistantIfActive({
          content: fullContent,
          errorMessage,
          messageId: input.assistantMessage.id,
        })

        if (failedResult.outcome !== 'updated') {
          logSkippedTerminalTransition({
            assistantMessageId: input.assistantMessage.id,
            existingStatus: failedResult.existingStatus,
            outcome: failedResult.outcome,
            streamId: input.streamId,
            targetStatus: 'failed',
          })
          closeController(controller)
          return
        }

        logger.error('failed', {
          assistantMessageId: input.assistantMessage.id,
          contentLength: fullContent.length,
          errorMessage,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          provider: input.provider.name,
          streamId: input.streamId,
        })

        writeEvent({
          conversationId: input.conversationId,
          error: {
            code: 'INTERNAL_ERROR',
            message: errorMessage,
          },
          message: toMessageDTO(failedResult.message),
          streamId: input.streamId,
          type: 'message_failed',
        })
        closeController(controller)
      } finally {
        activeStreamRegistry.remove(input.assistantMessage.id, providerAbortController)
      }
    },
  })
}

const createInitialChatEvent = (input: {
  assistantMessage: CreatedChatMessages['assistantMessage']
  conversationId: string
  streamId: string
  userMessage: CreatedChatMessages['userMessage']
}): ChatStreamEvent => ({
  assistantMessage: toMessageDTO(input.assistantMessage),
  conversationId: input.conversationId,
  streamId: input.streamId,
  type: 'message_created',
  userMessage: toMessageDTO(input.userMessage),
})

const createRetryCreatedEvent = (input: {
  assistantMessage: CreatedRetryAssistant['assistantMessage']
  conversationId: string
  sourceAssistantMessageId: string
  streamId: string
}): ChatStreamEvent => ({
  assistantMessage: toMessageDTO(input.assistantMessage),
  conversationId: input.conversationId,
  sourceAssistantMessageId: input.sourceAssistantMessageId,
  streamId: input.streamId,
  type: 'retry_created',
})

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
    const provider = toProvider()

    const createdMessages = await messageRepository
      .createChatMessagesWithActiveGuard({
        content: input.content,
        conversationId: conversation.id,
        mode,
        profileId,
      })
      .catch((error: unknown) =>
        mapCreateMessagesError(error, conversation.id, {
          notFoundMessage: 'Conversation not found',
        }),
      )

    logger.info('active guard passed', {
      conversationId: conversation.id,
    })

    const streamId = toStreamId()
    const { assistantMessage, userMessage } = createdMessages

    logger.info('messages created', {
      assistantMessageId: assistantMessage.id,
      assistantSeq: assistantMessage.seq,
      conversationId: conversation.id,
      streamId,
      userMessageId: userMessage.id,
      userSeq: userMessage.seq,
    })

    const providerMessages = await getProviderMessages({
      conversationId: conversation.id,
      profile,
    })

    return runAssistantStream({
      assistantMessage,
      conversationId: conversation.id,
      initialEvent: createInitialChatEvent({
        assistantMessage,
        conversationId: conversation.id,
        streamId,
        userMessage,
      }),
      mock: input.mock,
      mode,
      profileId,
      provider,
      providerMessages,
      streamId,
    })
  },

  async abortAssistantMessage(input: { content: string; messageId: string }) {
    const result = await messageRepository.abortAssistantIfActive({
      content: input.content,
      messageId: input.messageId,
    })

    if (result.outcome === 'updated') {
      logger.info('terminal transition won', {
        messageId: input.messageId,
        partialContentLength: input.content.length,
        status: 'aborted',
      })
      activeStreamRegistry.abort(input.messageId)
      return toMessageDTO(result.message)
    }

    if (result.outcome === 'not_found') {
      throw notFound('Message not found')
    }

    if (result.outcome === 'already_terminal' && result.existingStatus === 'aborted') {
      logger.info('terminal transition already aborted', {
        messageId: input.messageId,
      })
      activeStreamRegistry.abort(input.messageId)
      return toMessageDTO(result.message!)
    }

    throw conflict('Message is not abortable', 'MESSAGE_NOT_ABORTABLE')
  },

  async createRetryStream(input: RetryChatInput) {
    const provider = toProvider()
    const createdRetry = await messageRepository
      .createRetryAssistantWithActiveGuard({
        sourceAssistantMessageId: input.messageId,
      })
      .catch((error: unknown) =>
        mapCreateMessagesError(error, input.messageId, {
          notFoundMessage: 'Message not found',
        }),
      )

    const { assistantMessage, sourceAssistantMessage } = createdRetry
    const profile = assertProfileMode(assistantMessage.profileId, assistantMessage.mode)
    const streamId = toStreamId()

    logger.info('retry assistant created', {
      assistantMessageId: assistantMessage.id,
      assistantSeq: assistantMessage.seq,
      conversationId: assistantMessage.conversationId,
      sourceAssistantMessageId: sourceAssistantMessage.id,
      streamId,
    })

    const providerMessages = await getProviderMessages({
      conversationId: assistantMessage.conversationId,
      profile,
    })

    return runAssistantStream({
      assistantMessage,
      conversationId: assistantMessage.conversationId,
      initialEvent: createRetryCreatedEvent({
        assistantMessage,
        conversationId: assistantMessage.conversationId,
        sourceAssistantMessageId: sourceAssistantMessage.id,
        streamId,
      }),
      mock: input.mock,
      mode: assistantMessage.mode,
      profileId: assistantMessage.profileId,
      provider,
      providerMessages,
      streamId,
    })
  },
}
