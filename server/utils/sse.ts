type SseEventData = {
  type: string
  [key: string]: unknown
}

export type SseFrameInput<TData extends SseEventData = SseEventData> = {
  id: string | number
  event: TData['type']
  data: TData
}

export const createSseFrame = <TData extends SseEventData>(input: SseFrameInput<TData>) => {
  if (input.event !== input.data.type) {
    throw new Error(`SSE event "${input.event}" does not match data.type "${input.data.type}"`)
  }

  return [
    `id: ${input.id}`,
    `event: ${input.event}`,
    `data: ${JSON.stringify(input.data)}`,
    '',
    '',
  ].join('\n')
}
