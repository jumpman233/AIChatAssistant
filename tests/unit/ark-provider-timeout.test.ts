import assert from 'node:assert/strict'
import { ArkChatProvider } from '../../server/services/chat/providers/arkChatProvider'
import { ChatProviderError } from '../../server/services/chat/providers/types'

type ScheduledChunk = {
  delayMs: number
  text: string
}

type TestCase = {
  name: string
  run: () => Promise<void> | void
}

const encoder = new TextEncoder()

const createAbortError = () => new DOMException('Aborted', 'AbortError')

const createScheduledStream = (signal: AbortSignal, chunks: ScheduledChunk[]) => {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const timers = new Set<ReturnType<typeof setTimeout>>()

      const cleanup = () => {
        for (const timer of timers) {
          clearTimeout(timer)
        }

        timers.clear()
        signal.removeEventListener('abort', abort)
      }

      const abort = () => {
        if (closed) {
          return
        }

        closed = true
        cleanup()
        controller.error(createAbortError())
      }

      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            timers.delete(timer)
            resolve()
          }, ms)
          timers.add(timer)
        })

      signal.addEventListener('abort', abort, {
        once: true,
      })

      void (async () => {
        for (const chunk of chunks) {
          await wait(chunk.delayMs)

          if (closed) {
            return
          }

          controller.enqueue(encoder.encode(chunk.text))
        }

        if (!closed) {
          closed = true
          cleanup()
          controller.close()
        }
      })()
    },
  })
}

const installFetchMock = (chunks: ScheduledChunk[]) => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal
    assert.ok(signal instanceof AbortSignal)

    return new Response(createScheduledStream(signal, chunks), {
      headers: {
        'Content-Type': 'text/event-stream',
      },
      status: 200,
    })
  }) as typeof globalThis.fetch

  return () => {
    globalThis.fetch = originalFetch
  }
}

const createProvider = (idleTimeoutMs: number) => {
  return new ArkChatProvider({
    apiKey: 'test-api-key',
    baseUrl: 'https://ark.example.test/api/v3',
    idleTimeoutMs,
    model: 'test-model',
    provider: 'ark',
  })
}

const collectText = async (provider: ArkChatProvider) => {
  const deltas: string[] = []

  for await (const delta of provider.stream({
    messages: [
      {
        content: 'hello',
        role: 'user',
      },
    ],
    mode: 'chat',
    profileId: 'general',
  })) {
    deltas.push(delta.delta)
  }

  return deltas.join('')
}

const tests: TestCase[] = [
  {
    name: 'active network chunks renew Ark idle timeout',
    run: async () => {
      const restoreFetch = installFetchMock([
        {
          delayMs: 30,
          text: 'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
        },
        {
          delayMs: 30,
          text: 'data: {"choices":[{"delta":{"content":"B"}}]}\n\n',
        },
        {
          delayMs: 30,
          text: 'data: [DONE]\n\n',
        },
      ])

      try {
        const content = await collectText(createProvider(60))
        assert.equal(content, 'AB')
      } finally {
        restoreFetch()
      }
    },
  },
  {
    name: 'idle gap in Ark stream becomes timeout provider error',
    run: async () => {
      const restoreFetch = installFetchMock([
        {
          delayMs: 10,
          text: 'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
        },
        {
          delayMs: 90,
          text: 'data: [DONE]\n\n',
        },
      ])

      try {
        await assert.rejects(
          async () => {
            await collectText(createProvider(50))
          },
          (error) => {
            assert.ok(error instanceof ChatProviderError)
            assert.equal(error.category, 'timeout')
            return true
          },
        )
      } finally {
        restoreFetch()
      }
    },
  },
]

for (const test of tests) {
  try {
    await test.run()
    console.log(`ok - ${test.name}`)
  } catch (error) {
    console.error(`not ok - ${test.name}`)
    throw error
  }
}
