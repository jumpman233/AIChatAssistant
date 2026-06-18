export type ConversationStatus = 'active' | 'archived' | 'deleted'

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system'

export type MessageStatus = 'pending' | 'streaming' | 'done' | 'failed' | 'aborted'

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'failed'

export type ToolSource = 'local' | 'mcp'

export type ToolCallDTO = {
  id: string
  messageId: string
  toolName: string
  source: ToolSource
  arguments: unknown | null
  result: unknown | null
  status: ToolCallStatus
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type MessageDTO = {
  id: string
  conversationId: string
  parentMessageId: string | null
  role: MessageRole
  content: string
  profileId: string
  mode: string
  status: MessageStatus
  seq: number
  model: string | null
  errorMessage: string | null
  metadata: unknown | null
  toolCalls: ToolCallDTO[]
  createdAt: string
  updatedAt: string
}

export type ConversationDTO = {
  id: string
  title: string | null
  profileId: string
  mode: string
  status: ConversationStatus
  isStreaming: boolean
  activeAssistantMessageId: string | null
  createdAt: string
  updatedAt: string
}

export type ConversationRuntimeState = {
  conversationId: string
  streamId: string | null
  isStreaming: boolean
  streamingMessageId: string | null
  abortController: AbortController | null
  error: string | null
  typewriters: Record<string, TypewriterRuntimeState>
}

export type ChatRuntimeState = {
  conversationStates: Record<string, ConversationRuntimeState>
}

export type TypewriterRuntimeState = {
  messageId: string
  rawContent: string
  displayContent: string
  pendingText: string
  isTyping: boolean
  timerId: ReturnType<typeof setTimeout> | null
}

export type CreateChatRequest = {
  conversationId: string
  profileId?: string
  mode?: string
  content: string
  mock?: {
    delayMs?: number
    failAtChunk?: number
    triggerTools?: boolean
  }
}

export type ApiErrorResponse = {
  message: string
  code?: string
  details?: unknown
}

export type MessageCreatedStreamEvent = {
  type: 'message_created'
  streamId: string
  conversationId: string
  userMessage: MessageDTO
  assistantMessage: MessageDTO
}

export type TextDeltaStreamEvent = {
  type: 'text_delta'
  streamId: string
  conversationId: string
  messageId: string
  delta: string
}

export type ToolCallCreatedStreamEvent = {
  type: 'tool_call_created'
  streamId: string
  conversationId: string
  messageId: string
  toolCall: ToolCallDTO
}

export type ToolCallUpdatedStreamEvent = {
  type: 'tool_call_updated'
  streamId: string
  conversationId: string
  messageId: string
  toolCall: ToolCallDTO
}

export type MessageDoneStreamEvent = {
  type: 'message_done'
  streamId: string
  conversationId: string
  message: MessageDTO
}

export type MessageFailedStreamEvent = {
  type: 'message_failed'
  streamId: string
  conversationId: string
  message: MessageDTO
  error: {
    message: string
    code?: string
  }
}

export type ChatStreamEvent =
  | MessageCreatedStreamEvent
  | TextDeltaStreamEvent
  | ToolCallCreatedStreamEvent
  | ToolCallUpdatedStreamEvent
  | MessageDoneStreamEvent
  | MessageFailedStreamEvent
