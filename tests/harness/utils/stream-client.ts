import type { ChatStreamEventData } from '../types/api'

export type HarnessSseEvent<TData = ChatStreamEventData> = {
  id: string | null
  event: string
  data: TData
  raw: string
}

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

export const readSseStream = async (response: Response) => {
  if (!response.body) {
    throw new SseParseError('SSE response body is empty', {
      rawBuffer: '',
    })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events: HarnessSseEvent[] = []
  let buffer = ''

  while (true) {
    const result = await reader.read()

    if (result.done) {
      break
    }

    const chunk = decoder.decode(result.value, {
      stream: true,
    })
    buffer = parseSseChunk({
      buffer,
      chunk,
      events,
    })
  }

  const tail = decoder.decode()

  if (tail) {
    buffer = parseSseChunk({
      buffer,
      chunk: tail,
      events,
    })
  }

  if (buffer.trim()) {
    const frame = parseFrame(buffer)

    if (!frame) {
      throw new SseParseError('SSE stream ended with an incomplete frame', {
        rawBuffer: buffer,
      })
    }

    events.push(parseEvent(frame, buffer))
  }

  return events
}
