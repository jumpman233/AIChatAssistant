import type { ApiErrorResponse, ChatStreamEvent, CreateChatRequest } from '~/types/chat'
import { readChatSseStream } from '~/utils/stream'

export type SendMessageInput = {
  conversationId: string
  profileId?: string
  mode?: string
  content: string
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

  const handleStreamEvent = (event: ChatStreamEvent) => {
    switch (event.type) {
      case 'message_created': {
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

      if (!response.ok) {
        const error = await readJsonError(response)

        if (error.code === 'CONVERSATION_STREAMING') {
          const activeAssistantMessageId =
            runtimeStore.getRuntimeState(requestConversationId)?.streamingMessageId ??
            conversationStore.getConversation(requestConversationId)?.activeAssistantMessageId ??
            null

          runtimeStore.markStreamingConflict(requestConversationId, error.message)
          conversationStore.setConversationStreaming(
            requestConversationId,
            true,
            activeAssistantMessageId,
          )
          return
        }

        runtimeStore.failBeforeStream(requestConversationId, error.message)
        conversationStore.setConversationStreaming(requestConversationId, false, null)
        return
      }

      const contentType = response.headers.get('content-type') ?? ''

      if (!contentType.includes('text/event-stream')) {
        runtimeStore.failBeforeStream(
          requestConversationId,
          'Server did not return a text/event-stream response',
        )
        conversationStore.setConversationStreaming(requestConversationId, false, null)
        return
      }

      await readChatSseStream(response, ({ data }) => {
        handleStreamEvent(data)
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

  return {
    sendMessage,
  }
}
