import type { ArkProviderConfig } from '../../../config/chatProviderConfig'
import { createLogger } from '../../../utils/logger'
import type { ChatModelProvider, ChatProviderDelta, ChatProviderInput } from './types'
import { ChatProviderError } from './types'

type ArkChoice = {
  delta?: {
    content?: unknown
  }
  finish_reason?: unknown
}

const arkLogger = createLogger('provider:ark')

const chatCompletionsPath = '/chat/completions'

const joinUrl = (baseUrl: string, path: string) => {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isArkChoice = (value: unknown): value is ArkChoice => {
  return isRecord(value)
}

const extractProviderCode = (value: unknown) => {
  if (!isRecord(value)) {
    return undefined
  }

  const error = value.error

  if (isRecord(error)) {
    if (typeof error.code === 'string') {
      return error.code
    }

    if (typeof error.type === 'string') {
      return error.type
    }
  }

  if (typeof value.code === 'string') {
    return value.code
  }

  return undefined
}

const extractTextDeltas = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return []
  }

  const deltas: string[] = []

  for (const choice of value.choices) {
    if (!isArkChoice(choice)) {
      continue
    }

    const content = isRecord(choice.delta) ? choice.delta.content : undefined

    if (typeof content === 'string' && content.length > 0) {
      deltas.push(content)
    }
  }

  return deltas
}

const parseProviderCodeFromText = (text: string) => {
  if (!text.trim()) {
    return undefined
  }

  try {
    return extractProviderCode(JSON.parse(text))
  } catch {
    return undefined
  }
}

const isAbortError = (error: unknown) => {
  return error instanceof Error && error.name === 'AbortError'
}

export class ArkChatProvider implements ChatModelProvider {
  readonly name = 'ark' as const

  constructor(private readonly config: ArkProviderConfig) {}

  async *stream(input: ChatProviderInput): AsyncIterable<ChatProviderDelta> {
    const startedAt = Date.now()
    const controller = new AbortController()
    let timedOut = false
    let deltaCount = 0
    let contentLength = 0

    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.config.timeoutMs)

    const abortFromInput = () => controller.abort()
    input.signal?.addEventListener('abort', abortFromInput, {
      once: true,
    })

    try {
      arkLogger.info('request started', {
        messageCount: input.messages.length,
        modelConfigured: true,
      })

      const response = await fetch(joinUrl(this.config.baseUrl, chatCompletionsPath), {
        body: JSON.stringify({
          messages: input.messages,
          model: this.config.model,
          stream: true,
        }),
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      })

      if (!response.ok) {
        const safeBody = await response.text()
        throw new ChatProviderError({
          category: 'upstream_http_error',
          durationMs: Date.now() - startedAt,
          message: 'Ark provider request failed',
          provider: this.name,
          providerCode: parseProviderCodeFromText(safeBody),
          status: response.status,
        })
      }

      if (!response.body) {
        throw new ChatProviderError({
          category: 'empty_response_body',
          durationMs: Date.now() - startedAt,
          message: 'Ark provider response body is empty',
          provider: this.name,
          status: response.status,
        })
      }

      arkLogger.info('stream connected', {
        status: response.status,
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let isDone = false

      while (!isDone) {
        const result = await reader.read()

        if (result.done) {
          break
        }

        buffer += decoder.decode(result.value, {
          stream: true,
        })
        const parsed = this.readFrames(buffer)
        buffer = parsed.remainingBuffer

        for (const frame of parsed.frames) {
          const frameResult = this.parseFrame(frame)

          if (frameResult.done) {
            isDone = true
            break
          }

          for (const delta of frameResult.deltas) {
            deltaCount += 1
            contentLength += delta.length
            yield {
              delta,
              type: 'text_delta',
            }
          }
        }
      }

      const tail = decoder.decode()

      if (tail) {
        buffer += tail
      }

      if (!isDone && buffer.trim()) {
        const frameResult = this.parseFrame(buffer)

        if (frameResult.done) {
          isDone = true
        } else {
          for (const delta of frameResult.deltas) {
            deltaCount += 1
            contentLength += delta.length
            yield {
              delta,
              type: 'text_delta',
            }
          }
        }
      }

      if (!isDone) {
        throw new ChatProviderError({
          category: 'stream_incomplete',
          durationMs: Date.now() - startedAt,
          hasPartialContent: contentLength > 0,
          message: 'Ark provider stream ended before completion',
          provider: this.name,
          status: response.status,
        })
      }

      if (deltaCount === 0) {
        throw new ChatProviderError({
          category: 'empty_text_output',
          durationMs: Date.now() - startedAt,
          message: 'Ark provider returned no text output',
          provider: this.name,
          status: response.status,
        })
      }

      arkLogger.info('stream completed', {
        contentLength,
        deltaCount,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      const providerError =
        error instanceof ChatProviderError
          ? error
          : new ChatProviderError({
              category: timedOut ? 'timeout' : isAbortError(error) ? 'aborted' : 'network_error',
              durationMs: Date.now() - startedAt,
              hasPartialContent: contentLength > 0,
              message: timedOut ? 'Ark provider request timed out' : 'Ark provider request failed',
              provider: this.name,
            })

      arkLogger.error('failed', {
        category: providerError.category,
        durationMs: providerError.durationMs ?? Date.now() - startedAt,
        providerCode: providerError.providerCode,
        status: providerError.status,
      })

      throw providerError
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abortFromInput)
    }
  }

  private readFrames(buffer: string) {
    const normalizedBuffer = buffer.replace(/\r\n/g, '\n')
    const frames = normalizedBuffer.split('\n\n')
    const remainingBuffer = frames.pop() ?? ''

    return {
      frames,
      remainingBuffer,
    }
  }

  private parseFrame(rawFrame: string) {
    const dataLines: string[] = []

    for (const line of rawFrame.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) {
        continue
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }

    if (dataLines.length === 0) {
      return {
        deltas: [],
        done: false,
      }
    }

    const data = dataLines.join('\n').trim()

    if (data === '[DONE]') {
      return {
        deltas: [],
        done: true,
      }
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(data)
    } catch {
      throw new ChatProviderError({
        category: 'invalid_json_chunk',
        message: 'Ark provider stream contained invalid JSON',
        provider: this.name,
      })
    }

    return {
      deltas: extractTextDeltas(parsed),
      done: false,
    }
  }
}
