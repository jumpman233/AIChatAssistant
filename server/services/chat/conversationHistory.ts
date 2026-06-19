import type { MessageRole, MessageStatus } from '@prisma/client'
import type { ChatProviderMessage } from './providers/types'

export type ConversationHistoryMessage = {
  role: MessageRole
  status: MessageStatus
  content: string
  seq: number
}

export type BuildConversationHistoryInput = {
  messages: ConversationHistoryMessage[]
  systemPrompt?: string
}

const isHistoryUserMessage = (message: ConversationHistoryMessage) => {
  return message.role === 'user' && message.status === 'done' && message.content.trim().length > 0
}

const isHistoryAssistantMessage = (message: ConversationHistoryMessage) => {
  return (
    message.role === 'assistant' &&
    message.status === 'done' &&
    message.content.trim().length > 0
  )
}

export const buildConversationHistory = (
  input: BuildConversationHistoryInput,
): ChatProviderMessage[] => {
  const providerMessages: ChatProviderMessage[] = []
  const systemPrompt = input.systemPrompt?.trim()

  if (systemPrompt) {
    providerMessages.push({
      content: systemPrompt,
      role: 'system',
    })
  }

  for (const message of input.messages.toSorted((first, second) => first.seq - second.seq)) {
    if (isHistoryUserMessage(message)) {
      providerMessages.push({
        content: message.content,
        role: 'user',
      })
      continue
    }

    if (isHistoryAssistantMessage(message)) {
      providerMessages.push({
        content: message.content,
        role: 'assistant',
      })
    }
  }

  return providerMessages
}
