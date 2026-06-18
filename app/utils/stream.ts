import type { ChatStreamEvent } from '~/types/chat'

export type ParsedChatStreamEvent = {
  id: string | null
  event: string
  data: ChatStreamEvent
  raw: string
}

type ParsedFrame = {
  id: string | null
  event: string | null
  data: string
  raw: string
}

export class ChatStreamParseError extends Error {
  rawBuffer: string
  rawChunk?: string

  constructor(message: string, options: { rawBuffer: string; rawChunk?: string }) {
    super(message)
    this.name = 'ChatStreamParseError'
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

const parseEvent = (frame: ParsedFrame, rawBuffer: string): ParsedChatStreamEvent => {
  if (!frame.event) {
    throw new ChatStreamParseError('SSE frame is missing event field', {
      rawBuffer,
      rawChunk: frame.raw,
    })
  }

  if (!frame.data) {
    throw new ChatStreamParseError('SSE frame is missing data field', {
      rawBuffer,
      rawChunk: frame.raw,
    })
  }

  let data: unknown

  try {
    data = JSON.parse(frame.data)
  } catch (error) {
    throw new ChatStreamParseError(`SSE frame data is not valid JSON: ${String(error)}`, {
      rawBuffer,
      rawChunk: frame.raw,
    })
  }

  if (typeof data !== 'object' || data === null || !('type' in data)) {
    throw new ChatStreamParseError('SSE frame data must contain type', {
      rawBuffer,
      rawChunk: frame.raw,
    })
  }

  const eventData = data as { type: string }

  if (frame.event !== eventData.type) {
    throw new ChatStreamParseError(
      `SSE event "${frame.event}" does not match data.type "${eventData.type}"`,
      {
        rawBuffer,
        rawChunk: frame.raw,
      },
    )
  }

  return {
    data: data as ChatStreamEvent,
    event: frame.event,
    id: frame.id,
    raw: frame.raw,
  }
}

const parseSseChunk = (input: {
  buffer: string
  chunk: string
  onEvent: (event: ParsedChatStreamEvent) => void
}) => {
  const rawBuffer = input.buffer + input.chunk
  const normalizedBuffer = rawBuffer.replace(/\r\n/g, '\n')
  const frames = normalizedBuffer.split('\n\n')
  const remainingBuffer = frames.pop() ?? ''

  for (const rawFrame of frames) {
    const frame = parseFrame(rawFrame)

    if (frame) {
      input.onEvent(parseEvent(frame, rawBuffer))
    }
  }

  return remainingBuffer
}

export const readChatSseStream = async (
  response: Response,
  onEvent: (event: ParsedChatStreamEvent) => void,
) => {
  if (!response.body) {
    throw new ChatStreamParseError('SSE response body is empty', {
      rawBuffer: '',
    })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
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
      onEvent,
    })
  }

  const tail = decoder.decode()

  if (tail) {
    buffer = parseSseChunk({
      buffer,
      chunk: tail,
      onEvent,
    })
  }

  if (buffer.trim()) {
    const frame = parseFrame(buffer)

    if (!frame) {
      throw new ChatStreamParseError('SSE stream ended with an incomplete frame', {
        rawBuffer: buffer,
      })
    }

    onEvent(parseEvent(frame, buffer))
  }
}
