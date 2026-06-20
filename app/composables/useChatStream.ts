import type {
  AbortMessageRequest,
  ApiErrorResponse,
  ChatStreamEvent,
  CreateChatRequest,
  MessageDTO,
  RetryMessageRequest,
} from '~/types/chat'
import { readChatSseStream } from '~/utils/stream'

export type SendMessageInput = {
  conversationId: string
  profileId?: string
  mode?: string
  content: string
}

export type RetryMessageInput = {
  message: MessageDTO
}

type StreamRequestContext =
  | {
      kind: 'send'
      conversationId: string
    }
  | {
      kind: 'retry'
      conversationId: string
      sourceAssistantMessageId: string
    }

const readJsonError = async (response: Response): Promise<ApiErrorResponse> => {
  try {
    return (await response.json()) as ApiErrorResponse
  } catch {
    return {
      message: `Request failed with HTTP ${response.status}`,
    }
  }
}

export const useChatStream = () => {
  const conversationStore = useConversationStore()
  const runtimeStore = useChatRuntimeStore()

  const refreshConversationSnapshot = async (conversationId: string) => {
    await Promise.all([
      conversationStore.loadConversations(),
      conversationStore.loadMessages(conversationId),
    ])
  }

  const handlePreStreamError = (
    conversationId: string,
    error: ApiErrorResponse,
  ) => {
    if (error.code === 'CONVERSATION_STREAMING') {
      const activeAssistantMessageId =
        runtimeStore.getRuntimeState(conversationId)?.streamingMessageId ??
        conversationStore.getConversation(conversationId)?.activeAssistantMessageId ??
        null

      runtimeStore.markStreamingConflict(conversationId, error.message)
      conversationStore.setConversationStreaming(conversationId, true, activeAssistantMessageId)
      return
    }

    runtimeStore.failBeforeStream(conversationId, error.message)
    conversationStore.setConversationStreaming(conversationId, false, null)
  }

  const handleStreamEvent = (event: ChatStreamEvent, context: StreamRequestContext) => {
    if (event.conversationId !== context.conversationId) {
      runtimeStore.failBeforeStream(
        context.conversationId,
        'Received a stream event for a different conversation',
      )
      return
    }

    switch (event.type) {
      case 'message_created': {
        if (context.kind !== 'send') {
          runtimeStore.failBeforeStream(
            context.conversationId,
            'Retry stream returned message_created',
          )
          return
        }

        conversationStore.appendMessage(event.conversationId, event.userMessage)
        conversationStore.appendMessage(event.conversationId, event.assistantMessage)
        conversationStore.setConversationStreaming(
          event.conversationId,
          true,
          event.assistantMessage.id,
        )
        runtimeStore.attachStream({
          conversationId: event.conversationId,
          initialContent: event.assistantMessage.content,
          messageId: event.assistantMessage.id,
          streamId: event.streamId,
        })
        break
      }

      case 'retry_created': {
        if (
          context.kind !== 'retry' ||
          event.sourceAssistantMessageId !== context.sourceAssistantMessageId
        ) {
          runtimeStore.failBeforeStream(
            context.conversationId,
            'Retry stream source message mismatch',
          )
          return
        }

        conversationStore.appendMessage(event.conversationId, event.assistantMessage)
        conversationStore.setConversationStreaming(
          event.conversationId,
          true,
          event.assistantMessage.id,
        )
        runtimeStore.attachStream({
          conversationId: event.conversationId,
          initialContent: event.assistantMessage.content,
          messageId: event.assistantMessage.id,
          streamId: event.streamId,
        })
        break
      }

      case 'text_delta': {
        const runtime = runtimeStore.getRuntimeState(event.conversationId)

        if (runtime?.streamId && runtime.streamId !== event.streamId) {
          return
        }

        runtimeStore.appendDelta(event.conversationId, event.messageId, event.delta)
        break
      }

      case 'message_done': {
        conversationStore.replaceMessage(event.conversationId, event.message)
        conversationStore.setConversationStreaming(event.conversationId, false, null)
        runtimeStore.finishStream({
          conversationId: event.conversationId,
          finalContent: event.message.content,
          messageId: event.message.id,
        })
        break
      }

      case 'message_failed': {
        conversationStore.replaceMessage(event.conversationId, event.message)
        conversationStore.setConversationStreaming(event.conversationId, false, null)
        runtimeStore.finishStream({
          conversationId: event.conversationId,
          error: event.error.message,
          finalContent: event.message.content,
          messageId: event.message.id,
        })
        break
      }

      case 'tool_call_created':
      case 'tool_call_updated':
        break
    }
  }

  const consumeStreamResponse = async (response: Response, context: StreamRequestContext) => {
    if (!response.ok) {
      const error = await readJsonError(response)
      handlePreStreamError(context.conversationId, error)
      return
    }

    const contentType = response.headers.get('content-type') ?? ''

    if (!contentType.includes('text/event-stream')) {
      runtimeStore.failBeforeStream(
        context.conversationId,
        'Server did not return a text/event-stream response',
      )
      conversationStore.setConversationStreaming(context.conversationId, false, null)
      return
    }

    await readChatSseStream(response, ({ data }) => {
      handleStreamEvent(data, context)
    })
  }

  const sendMessage = async (input: SendMessageInput) => {
    const requestConversationId = input.conversationId
    const requestMode = input.mode
    const requestProfileId = input.profileId
    const normalizedContent = input.content.trim()

    if (
      !normalizedContent ||
      runtimeStore.isConversationStreaming(requestConversationId) ||
      conversationStore.isConversationStreaming(requestConversationId)
    ) {
      return
    }

    const abortController = new AbortController()
    runtimeStore.startStream(requestConversationId, abortController)
    conversationStore.setConversationStreaming(requestConversationId, true, null)

    const requestBody: CreateChatRequest = {
      content: normalizedContent,
      conversationId: requestConversationId,
      mode: requestMode,
      profileId: requestProfileId,
    }

    try {
      const response = await fetch('/api/chat', {
        body: JSON.stringify(requestBody),
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: abortController.signal,
      })

      await consumeStreamResponse(response, {
        conversationId: requestConversationId,
        kind: 'send',
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      runtimeStore.failBeforeStream(
        requestConversationId,
        error instanceof Error ? error.message : 'Stream request failed',
      )
      conversationStore.setConversationStreaming(requestConversationId, false, null)
    }
  }

  const stopGeneration = async (conversationId: string) => {
    const runtime = runtimeStore.getRuntimeState(conversationId)
    const assistantMessageId = runtime?.streamingMessageId ?? null
    const abortController = runtime?.abortController ?? null

    if (!assistantMessageId || !abortController || runtime?.isStopping) {
      return
    }

    const rawContent = runtimeStore.getTypewriter(assistantMessageId)?.rawContent ?? ''
    const requestBody: AbortMessageRequest = {
      content: rawContent,
    }

    runtimeStore.setStopping(conversationId, true)

    try {
      const response = await fetch(`/api/messages/${encodeURIComponent(assistantMessageId)}/abort`, {
        body: JSON.stringify(requestBody),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      if (!response.ok) {
        const error = await readJsonError(response)

        if (error.code === 'MESSAGE_NOT_ABORTABLE' || response.status === 404) {
          runtimeStore.setStopping(conversationId, false)
          abortController.abort()
          runtimeStore.clearRuntimeState(conversationId)
          await refreshConversationSnapshot(conversationId)
          return
        }

        runtimeStore.setStopping(conversationId, false)
        runtimeStore.setRuntimeError(conversationId, error.message)
        return
      }

      const abortedMessage = (await response.json()) as MessageDTO
      conversationStore.replaceMessage(conversationId, abortedMessage)
      conversationStore.setConversationStreaming(conversationId, false, null)
      abortController.abort()
      runtimeStore.finishAbortedStream({
        conversationId,
        finalContent: abortedMessage.content,
        messageId: abortedMessage.id,
      })
    } catch (error) {
      runtimeStore.setStopping(conversationId, false)
      runtimeStore.setRuntimeError(
        conversationId,
        error instanceof Error ? error.message : 'Stop request failed',
      )
    }
  }

  const retryMessage = async (input: RetryMessageInput) => {
    const sourceMessage = input.message
    const requestConversationId = sourceMessage.conversationId
    const sourceAssistantMessageId = sourceMessage.id

    if (
      sourceMessage.role !== 'assistant' ||
      !['failed', 'aborted'].includes(sourceMessage.status) ||
      runtimeStore.isConversationStreaming(requestConversationId) ||
      conversationStore.isConversationStreaming(requestConversationId) ||
      runtimeStore.isMessageRetrying(requestConversationId, sourceAssistantMessageId)
    ) {
      return
    }

    const abortController = new AbortController()
    const requestBody: RetryMessageRequest = {}

    runtimeStore.setMessageRetrying(requestConversationId, sourceAssistantMessageId, true)
    runtimeStore.startStream(requestConversationId, abortController)
    conversationStore.setConversationStreaming(requestConversationId, true, null)

    try {
      const response = await fetch(
        `/api/messages/${encodeURIComponent(sourceAssistantMessageId)}/retry`,
        {
          body: JSON.stringify(requestBody),
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal: abortController.signal,
        },
      )

      await consumeStreamResponse(response, {
        conversationId: requestConversationId,
        kind: 'retry',
        sourceAssistantMessageId,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      runtimeStore.failBeforeStream(
        requestConversationId,
        error instanceof Error ? error.message : 'Retry request failed',
      )
      conversationStore.setConversationStreaming(requestConversationId, false, null)
    } finally {
      runtimeStore.setMessageRetrying(requestConversationId, sourceAssistantMessageId, false)
    }
  }

  return {
    retryMessage,
    sendMessage,
    stopGeneration,
  }
}
