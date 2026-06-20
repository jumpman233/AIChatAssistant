export type StreamAbortSource = 'none' | 'user' | 'timeout'

export type StreamAbortCoordinator = {
  signal: AbortSignal
  markActivity: () => void
  getAbortSource: () => StreamAbortSource
  cleanup: () => void
}

type CreateStreamAbortCoordinatorInput = {
  externalSignal?: AbortSignal
  idleTimeoutMs: number
}

export const createStreamAbortCoordinator = ({
  externalSignal,
  idleTimeoutMs,
}: CreateStreamAbortCoordinatorInput): StreamAbortCoordinator => {
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0 || !Number.isFinite(idleTimeoutMs)) {
    throw new Error('idleTimeoutMs must be a positive finite integer')
  }

  const controller = new AbortController()
  let abortSource: StreamAbortSource = 'none'
  let timeout: ReturnType<typeof setTimeout> | undefined
  let cleanedUp = false
  let listenerRegistered = false

  const clearIdleTimer = () => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = undefined
    }
  }

  const abortOnce = (source: Exclude<StreamAbortSource, 'none'>) => {
    if (abortSource !== 'none') {
      return
    }

    abortSource = source
    clearIdleTimer()

    if (!controller.signal.aborted) {
      controller.abort()
    }
  }

  const startIdleTimer = () => {
    if (cleanedUp || abortSource !== 'none' || controller.signal.aborted) {
      return
    }

    clearIdleTimer()
    timeout = setTimeout(() => {
      abortOnce('timeout')
    }, idleTimeoutMs)
  }

  const abortFromExternalSignal = () => abortOnce('user')

  if (externalSignal?.aborted) {
    abortOnce('user')
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, {
      once: true,
    })
    listenerRegistered = Boolean(externalSignal)
    startIdleTimer()
  }

  return {
    signal: controller.signal,
    markActivity: () => {
      startIdleTimer()
    },
    getAbortSource: () => abortSource,
    cleanup: () => {
      if (cleanedUp) {
        return
      }

      cleanedUp = true
      clearIdleTimer()

      if (listenerRegistered) {
        externalSignal?.removeEventListener('abort', abortFromExternalSignal)
        listenerRegistered = false
      }
    },
  }
}
