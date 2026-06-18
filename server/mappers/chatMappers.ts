import type { Conversation, Message, ToolCall } from '@prisma/client'

type ConversationWithActiveMessage = Conversation & {
  messages?: Pick<Message, 'id'>[]
}

type MessageWithToolCalls = Message & {
  toolCalls?: ToolCall[]
}

const toIsoString = (value: Date | null) => {
  return value ? value.toISOString() : null
}

export const toConversationDTO = (conversation: ConversationWithActiveMessage) => {
  const activeAssistantMessageId = conversation.messages?.[0]?.id ?? null

  return {
    activeAssistantMessageId,
    createdAt: conversation.createdAt.toISOString(),
    id: conversation.id,
    isStreaming: activeAssistantMessageId !== null,
    mode: conversation.mode,
    profileId: conversation.profileId,
    status: conversation.status,
    title: conversation.title,
    updatedAt: conversation.updatedAt.toISOString(),
  }
}

export const toToolCallDTO = (toolCall: ToolCall) => ({
  arguments: toolCall.argumentsJson,
  createdAt: toolCall.createdAt.toISOString(),
  errorMessage: toolCall.errorMessage,
  finishedAt: toIsoString(toolCall.finishedAt),
  id: toolCall.id,
  messageId: toolCall.messageId,
  result: toolCall.resultJson,
  source: toolCall.source,
  startedAt: toIsoString(toolCall.startedAt),
  status: toolCall.status,
  toolName: toolCall.toolName,
  updatedAt: toolCall.updatedAt.toISOString(),
})

export const toMessageDTO = (message: MessageWithToolCalls) => ({
  content: message.content,
  conversationId: message.conversationId,
  createdAt: message.createdAt.toISOString(),
  errorMessage: message.errorMessage,
  id: message.id,
  metadata: message.metadata,
  mode: message.mode,
  model: message.model,
  parentMessageId: message.parentMessageId,
  profileId: message.profileId,
  role: message.role,
  seq: message.seq,
  status: message.status,
  toolCalls: (message.toolCalls ?? []).map(toToolCallDTO),
  updatedAt: message.updatedAt.toISOString(),
})
