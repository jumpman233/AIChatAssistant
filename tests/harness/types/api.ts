export type ConversationStatus = 'active' | 'archived' | 'deleted'

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system'

export type MessageStatus = 'pending' | 'streaming' | 'done' | 'failed' | 'aborted'

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'failed'

export type ToolSource = 'local' | 'mcp'

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

export type AssistantProfileDTO = {
  id: string
  name: string
  description: string
  enabledTools: string[]
  conversationModes: string[]
}

export type CreateConversationResponse = ConversationDTO

export type GetConversationResponse = ConversationDTO

export type ListConversationsResponse = {
  items: ConversationDTO[]
  nextCursor: string | null
}

export type DeleteConversationResponse = {
  id: string
  status: 'deleted'
}

export type ListMessagesResponse = {
  items: MessageDTO[]
  pageInfo: {
    limit: number
    hasMoreBefore: boolean
    hasMoreAfter: boolean
    beforeSeq: number | null
    afterSeq: number | null
  }
}

export type ListProfilesResponse = {
  items: AssistantProfileDTO[]
}

export type ApiErrorResponse = {
  message: string
  code?: string
  details?: unknown
}

export type MessageCreatedStreamEventData = {
  type: 'message_created'
  streamId: string
  conversationId: string
  userMessage: MessageDTO
  assistantMessage: MessageDTO
}

export type RetryCreatedStreamEventData = {
  type: 'retry_created'
  streamId: string
  conversationId: string
  sourceAssistantMessageId: string
  assistantMessage: MessageDTO
}

export type TextDeltaStreamEventData = {
  type: 'text_delta'
  streamId: string
  conversationId: string
  messageId: string
  delta: string
}

export type ToolCallCreatedStreamEventData = {
  type: 'tool_call_created'
  streamId: string
  conversationId: string
  messageId: string
  toolCall: ToolCallDTO
}

export type ToolCallUpdatedStreamEventData = {
  type: 'tool_call_updated'
  streamId: string
  conversationId: string
  messageId: string
  toolCall: ToolCallDTO
}

export type MessageDoneStreamEventData = {
  type: 'message_done'
  streamId: string
  conversationId: string
  message: MessageDTO
}

export type MessageFailedStreamEventData = {
  type: 'message_failed'
  streamId: string
  conversationId: string
  message: MessageDTO
  error: {
    message: string
    code?: string
  }
}

export type ChatStreamEventData =
  | MessageCreatedStreamEventData
  | RetryCreatedStreamEventData
  | TextDeltaStreamEventData
  | ToolCallCreatedStreamEventData
  | ToolCallUpdatedStreamEventData
  | MessageDoneStreamEventData
  | MessageFailedStreamEventData
