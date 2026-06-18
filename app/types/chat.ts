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
  messages: MessageDTO[]
  isStreaming: boolean
  streamingMessageId: string | null
  abortController: AbortController | null
  error: string | null
}

export type ChatRuntimeState = {
  activeConversationId: string | null
  currentProfileId: string
  conversations: ConversationDTO[]
  conversationStates: Record<string, ConversationRuntimeState>
}
