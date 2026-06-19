export type MockStreamChunk = {
  index: number
  delta: string
}

export type MockStreamOptions = {
  text?: string
  chunkCount?: number
  delayMs?: number
  failAtChunk?: number
  signal?: AbortSignal
}

const DEFAULT_MOCK_TEXT = [
  '这是 V2 mock stream 的基础回复。\n\n',
  '它会通过标准 SSE text_delta 分段返回，',
  '前端负责用打字机节奏平滑展示。\n\n',
  '```ts\n',
  'const mode = "mock-stream"\n',
  '```',
].join('')

export const createAbortError = (message = 'Provider stream aborted') =>
  new DOMException(message, 'AbortError')

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }

    signal?.addEventListener('abort', onAbort, {
      once: true,
    })
  })

export const splitMockText = (text: string, chunkCount = 6) => {
  const normalizedChunkCount = Math.max(1, Math.floor(chunkCount))
  const chunkSize = Math.max(1, Math.ceil(text.length / normalizedChunkCount))
  const chunks: string[] = []

  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize))
  }

  return chunks.length > 0 ? chunks : ['']
}

export async function* createMockStream(options: MockStreamOptions = {}) {
  const chunks = splitMockText(options.text ?? DEFAULT_MOCK_TEXT, options.chunkCount)

  for (const [index, delta] of chunks.entries()) {
    const chunkIndex = index + 1

    throwIfAborted(options.signal)

    if (options.failAtChunk === chunkIndex) {
      throw new Error(`Mock stream failed at chunk ${chunkIndex}`)
    }

    if (options.delayMs && options.delayMs > 0) {
      await delay(options.delayMs, options.signal)
    }

    throwIfAborted(options.signal)

    yield {
      delta,
      index: chunkIndex,
    } satisfies MockStreamChunk
  }
}
