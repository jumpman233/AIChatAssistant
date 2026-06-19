import { logger } from '../../utils/logger'

type ActiveStreamEntry = {
  controller: AbortController
  registeredAt: number
}

const activeStreams = new Map<string, ActiveStreamEntry>()

export const activeStreamRegistry = {
  register(assistantMessageId: string, controller: AbortController) {
    activeStreams.set(assistantMessageId, {
      controller,
      registeredAt: Date.now(),
    })
    logger.info('provider stream registered', {
      assistantMessageId,
    })
  },

  get(assistantMessageId: string) {
    return activeStreams.get(assistantMessageId)?.controller ?? null
  },

  abort(assistantMessageId: string) {
    const entry = activeStreams.get(assistantMessageId)

    if (!entry) {
      logger.warn('provider abort missing controller', {
        assistantMessageId,
      })
      return false
    }

    logger.info('provider abort requested', {
      assistantMessageId,
    })
    entry.controller.abort()
    logger.info('provider abort completed', {
      assistantMessageId,
    })

    return true
  },

  remove(assistantMessageId: string, controller: AbortController) {
    const entry = activeStreams.get(assistantMessageId)

    if (!entry || entry.controller !== controller) {
      return false
    }

    activeStreams.delete(assistantMessageId)
    logger.debug('provider stream removed', {
      assistantMessageId,
      durationMs: Date.now() - entry.registeredAt,
    })

    return true
  },
}
