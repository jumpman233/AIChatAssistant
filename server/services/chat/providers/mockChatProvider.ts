import { createMockStream } from '../mockStreamService'
import type { ChatModelProvider, ChatProviderDelta, ChatProviderInput } from './types'

export class MockChatProvider implements ChatModelProvider {
  readonly name = 'mock' as const

  async *stream(input: ChatProviderInput): AsyncIterable<ChatProviderDelta> {
    for await (const chunk of createMockStream(input.mock)) {
      yield {
        delta: chunk.delta,
        type: 'text_delta',
      }
    }
  }
}
