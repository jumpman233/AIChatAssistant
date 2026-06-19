import type { ChatStreamEventData } from '../types/api'
import { createHarnessLogger } from './harness-log'

export type HarnessSseEvent<TData = ChatStreamEventData> = {
  id: string | null
  event: string
  data: TData
  raw: string
}

const harnessStreamLog = createHarnessLogger('stream-client')

type ParsedFrame = {
  id: string | null
  event: string | null
  data: string
  raw: string
}

export class SseParseError extends Error {
  rawBuffer: string
  rawChunk?: string

  constructor(message: string, options: { rawBuffer: string; rawChunk?: string }) {
    super(message)
    this.name = 'SseParseError'
    this.rawBuffer = options.rawBuffer
    this.rawChunk = options.rawChunk
  }
}

const summarizeRawText = (value: string) => ({
  containsDataLine: /^data:/m.test(value),
  containsEventLine: /^event:/m.test(value),
  containsIdLine: /^id:/m.test(value),
  frameSeparatorCount: value.match(/\n\n/g)?.length ?? 0,
  length: value.length,
  lineCount: value.length === 0 ? 0 : value.split(/\r?\n/).length,
})

const logParseFailure = (error: unknown) => {
  if (error instanceof SseParseError) {
    harnessStreamLog.error('SSE parse failed', {
      message: error.message,
      rawBufferSummary: summarizeRawText(error.rawBuffer),
      rawFrameSummary: error.rawChunk ? summarizeRawText(error.rawChunk) : null,
    })
    return
  }

  harnessStreamLog.error('SSE parse failed', {
    error,
  })
}

const parseFrame = (raw: string): ParsedFrame | null => {
  const normalizedRaw = raw.trimEnd()

  if (!normalizedRaw) {
    return null
  }

  let id: string | null = null
  let event: string | null = null
  const dataLines: string[] = []

  for (const line of normalizedRaw.split(/\r?\n/)) {
    if (line.startsWith('id:')) {
      id = line.slice(3).trimStart()
      continue
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trimStart()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  return {
    data: dataLines.join('\n'),
    event,
    id,
    raw,
  }
}

const parseEvent = (frame: ParsedFrame, rawBuffer: string): HarnessSseEvent => {
  if (!frame.event) {
    throw new SseParseError('SSE frame is missing event field', {
      rawBuffer,
      rawChunk: frame.raw,
    })
  }

  if (!frame.data) {
    throw new SseParseError('SSE frame is missing data field', {
      rawBuffer,
      rawChunk: frame.raw,
    })
  }

  let data: unknown

  try {
    data = JSON.parse(frame.data)
  } catch (error) {
    throw new SseParseError(`SSE frame data is not valid JSON: ${String(error)}`, {
      rawBuffer,
      rawChunk: frame.raw,
    })
  }

  if (typeof data !== 'object' || data === null || !('type' in data)) {
    throw new SseParseError('SSE frame data must contain type', {
      rawBuffer,
      rawChunk: frame.raw,
    })
  }

  const eventData = data as { type: string }

  if (frame.event !== eventData.type) {
    throw new SseParseError(
      `SSE event "${frame.event}" does not match data.type "${eventData.type}"`,
      {
        rawBuffer,
        rawChunk: frame.raw,
      },
    )
  }

  return {
    data: data as ChatStreamEventData,
    event: frame.event,
    id: frame.id,
    raw: frame.raw,
  }
}

export const parseSseChunk = (input: {
  buffer: string
  chunk: string
  events: HarnessSseEvent[]
}) => {
  const rawBuffer = input.buffer + input.chunk
  const normalizedBuffer = rawBuffer.replace(/\r\n/g, '\n')
  const frames = normalizedBuffer.split('\n\n')
  const remainingBuffer = frames.pop() ?? ''

  for (const rawFrame of frames) {
    const frame = parseFrame(rawFrame)

    if (!frame) {
      continue
    }

    input.events.push(parseEvent(frame, rawBuffer))
  }

  return remainingBuffer
}

const parseSseChunkWithLog = (input: {
  buffer: string
  chunk: string
  events: HarnessSseEvent[]
}) => {
  try {
    return parseSseChunk(input)
  } catch (error) {
    logParseFailure(error)
    throw error
  }
}

type SseWaiter = {
  predicate: (event: HarnessSseEvent) => boolean
  reject: (error: Error) => void
  resolve: (event: HarnessSseEvent) => void
  timer: ReturnType<typeof setTimeout>
}

export type SseSessionOptions = {
  waitTimeoutMs?: number
}

const DEFAULT_WAIT_TIMEOUT_MS = 15_000

const summarizeEventTypes = (events: HarnessSseEvent[]) =>
  events.map((event) => event.event).join(' -> ')

export class HarnessSseSession {
  readonly done: Promise<HarnessSseEvent[]>
  readonly events: HarnessSseEvent[] = []

  private buffer = ''
  private decoder = new TextDecoder()
  private finished = false
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private waiters: SseWaiter[] = []
  private waitTimeoutMs: number

  constructor(response: Response, options: SseSessionOptions = {}) {
    if (!response.body) {
      const error = new SseParseError('SSE response body is empty', {
        rawBuffer: '',
      })
      logParseFailure(error)
      throw error
    }

    this.reader = response.body.getReader()
    this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
    this.done = this.readToEnd()
  }

  get isDone() {
    return this.finished
  }

  waitFor(
    predicate: (event: HarnessSseEvent) => boolean,
    options: { timeoutMs?: number } = {},
  ) {
    const existingEvent = this.events.find(predicate)

    if (existingEvent) {
      return Promise.resolve(existingEvent)
    }

    if (this.finished) {
      return Promise.reject(
        new Error(`SSE stream already ended. Events: ${summarizeEventTypes(this.events)}`),
      )
    }

    return new Promise<HarnessSseEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer)
        reject(
          new Error(
            `Timed out waiting for SSE event. Events: ${summarizeEventTypes(this.events)}`,
          ),
        )
      }, options.timeoutMs ?? this.waitTimeoutMs)

      this.waiters.push({
        predicate,
        reject,
        resolve,
        timer,
      })
    })
  }

  async cancel() {
    this.rejectWaiters(new Error('SSE session cancelled'))
    await this.reader.cancel().catch(() => undefined)
  }

  private captureEvents(nextEvents: HarnessSseEvent[]) {
    for (const event of nextEvents) {
      this.events.push(event)
      this.resolveMatchingWaiters(event)
    }
  }

  private parseChunk(chunk: string) {
    const nextEvents: HarnessSseEvent[] = []
    this.buffer = parseSseChunkWithLog({
      buffer: this.buffer,
      chunk,
      events: nextEvents,
    })
    this.captureEvents(nextEvents)
  }

  private parseRemainingBuffer() {
    if (!this.buffer.trim()) {
      return
    }

    const frame = parseFrame(this.buffer)

    if (!frame) {
      const error = new SseParseError('SSE stream ended with an incomplete frame', {
        rawBuffer: this.buffer,
      })
      logParseFailure(error)
      throw error
    }

    try {
      this.captureEvents([parseEvent(frame, this.buffer)])
    } catch (error) {
      logParseFailure(error)
      throw error
    }
  }

  private async readToEnd() {
    try {
      while (true) {
        const result = await this.reader.read()

        if (result.done) {
          break
        }

        this.parseChunk(
          this.decoder.decode(result.value, {
            stream: true,
          }),
        )
      }

      const tail = this.decoder.decode()

      if (tail) {
        this.parseChunk(tail)
      }

      this.parseRemainingBuffer()
      this.finished = true
      this.rejectWaiters(
        new Error(`SSE stream ended before expected event. Events: ${summarizeEventTypes(this.events)}`),
      )

      harnessStreamLog.debug('SSE stream parsed', {
        eventCount: this.events.length,
        eventTypes: this.events.map((event) => event.event),
      })

      return this.events
    } catch (error) {
      this.finished = true
      this.rejectWaiters(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  private rejectWaiters(error: Error) {
    const waiters = this.waiters
    this.waiters = []

    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }

  private resolveMatchingWaiters(event: HarnessSseEvent) {
    const remainingWaiters: SseWaiter[] = []

    for (const waiter of this.waiters) {
      if (waiter.predicate(event)) {
        clearTimeout(waiter.timer)
        waiter.resolve(event)
        continue
      }

      remainingWaiters.push(waiter)
    }

    this.waiters = remainingWaiters
  }
}

export const createSseSession = (response: Response, options?: SseSessionOptions) => {
  return new HarnessSseSession(response, options)
}

export const readSseStream = async (response: Response) => {
  const session = createSseSession(response)
  return session.done
}
