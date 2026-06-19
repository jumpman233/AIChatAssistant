import { createMockStream } from '../mockStreamService'
import type { ChatModelProvider, ChatProviderDelta, ChatProviderInput } from './types'

export class MockChatProvider implements ChatModelProvider {
  readonly name = 'mock' as const

  constructor(private readonly options: { streamDelayMs?: number } = {}) {}

  async *stream(input: ChatProviderInput): AsyncIterable<ChatProviderDelta> {
    const mockOptions = {
      ...input.mock,
      delayMs: input.mock?.delayMs ?? this.options.streamDelayMs,
      signal: input.signal,
    }

    for await (const chunk of createMockStream(mockOptions)) {
      yield {
        delta: chunk.delta,
        type: 'text_delta',
      }
    }
  }
}
