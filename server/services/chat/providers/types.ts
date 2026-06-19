import type { ChatProviderConfig, ChatProviderName } from '../../../config/chatProviderConfig'
import type { MockStreamOptions } from '../mockStreamService'

export type ChatProviderMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatProviderInput = {
  messages: ChatProviderMessage[]
  profileId: string
  mode: string
  mock?: MockStreamOptions
  signal?: AbortSignal
}

export type ChatProviderDelta = {
  type: 'text_delta'
  delta: string
}

export interface ChatModelProvider {
  readonly name: ChatProviderName

  stream(input: ChatProviderInput): AsyncIterable<ChatProviderDelta>
}

export type ChatProviderErrorInput = {
  provider: ChatProviderConfig['provider']
  category: string
  message: string
  status?: number
  providerCode?: string
  durationMs?: number
  hasPartialContent?: boolean
}

export class ChatProviderError extends Error {
  category: string
  durationMs?: number
  hasPartialContent?: boolean
  provider: ChatProviderConfig['provider']
  providerCode?: string
  status?: number

  constructor(input: ChatProviderErrorInput) {
    super(input.message)
    this.name = 'ChatProviderError'
    this.category = input.category
    this.durationMs = input.durationMs
    this.hasPartialContent = input.hasPartialContent
    this.provider = input.provider
    this.providerCode = input.providerCode
    this.status = input.status
  }
}
