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
    const normalizedContent = input.content.trim()

    if (!normalizedContent || runtimeStore.isConversationStreaming(input.conversationId)) {
      return
    }

    const abortController = new AbortController()
    runtimeStore.startStream(input.conversationId, abortController)
    conversationStore.setConversationStreaming(input.conversationId, true, null)

    const requestBody: CreateChatRequest = {
      content: normalizedContent,
      conversationId: input.conversationId,
      mode: input.mode,
      profileId: input.profileId,
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
        runtimeStore.failBeforeStream(input.conversationId, error.message)
        conversationStore.setConversationStreaming(input.conversationId, false, null)
        return
      }

      const contentType = response.headers.get('content-type') ?? ''

      if (!contentType.includes('text/event-stream')) {
        runtimeStore.failBeforeStream(
          input.conversationId,
          'Server did not return a text/event-stream response',
        )
        conversationStore.setConversationStreaming(input.conversationId, false, null)
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
        input.conversationId,
        error instanceof Error ? error.message : 'Stream request failed',
      )
      conversationStore.setConversationStreaming(input.conversationId, false, null)
    }
  }

  return {
    sendMessage,
  }
}
