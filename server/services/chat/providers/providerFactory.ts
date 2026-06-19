import type { ChatProviderConfig } from '../../../config/chatProviderConfig'
import { ArkChatProvider } from './arkChatProvider'
import { MockChatProvider } from './mockChatProvider'
import type { ChatModelProvider } from './types'

export const createChatProvider = (config: ChatProviderConfig): ChatModelProvider => {
  if (config.provider === 'mock') {
    return new MockChatProvider({
      streamDelayMs: config.streamDelayMs,
    })
  }

  return new ArkChatProvider(config)
}
