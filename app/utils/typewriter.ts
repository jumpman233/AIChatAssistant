import type { TypewriterRuntimeState } from '~/types/chat'

export type DrainTypewriterOptions = {
  done?: boolean
  maxChars?: number
}

export const createTypewriterState = (
  messageId: string,
  initialContent = '',
): TypewriterRuntimeState => ({
  displayContent: initialContent,
  isTyping: false,
  messageId,
  pendingText: '',
  rawContent: initialContent,
  timerId: null,
})

export const appendTypewriterDelta = (
  state: TypewriterRuntimeState,
  delta: string,
): TypewriterRuntimeState => ({
  ...state,
  isTyping: true,
  pendingText: state.pendingText + delta,
  rawContent: state.rawContent + delta,
})

export const getTypewriterDrainSize = (pendingLength: number, done = false) => {
  if (pendingLength <= 0) {
    return 0
  }

  if (done) {
    return Math.min(pendingLength, Math.max(8, Math.ceil(pendingLength / 2)))
  }

  if (pendingLength > 120) {
    return 12
  }

  if (pendingLength > 40) {
    return 6
  }

  return Math.min(pendingLength, 2)
}

export const drainTypewriter = (
  state: TypewriterRuntimeState,
  options: DrainTypewriterOptions = {},
): TypewriterRuntimeState => {
  const take = Math.min(
    state.pendingText.length,
    options.maxChars ?? getTypewriterDrainSize(state.pendingText.length, options.done),
  )

  if (take <= 0) {
    return {
      ...state,
      isTyping: false,
    }
  }

  const drainedText = state.pendingText.slice(0, take)
  const pendingText = state.pendingText.slice(take)

  return {
    ...state,
    displayContent: state.displayContent + drainedText,
    isTyping: pendingText.length > 0,
    pendingText,
  }
}

export const flushTypewriter = (state: TypewriterRuntimeState): TypewriterRuntimeState => ({
  ...state,
  displayContent: state.rawContent,
  isTyping: false,
  pendingText: '',
})
