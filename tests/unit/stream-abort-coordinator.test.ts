import assert from 'node:assert/strict'
import { createStreamAbortCoordinator } from '../../server/services/chat/providers/streamAbortCoordinator'

type TestCase = {
  name: string
  run: () => Promise<void> | void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const tests: TestCase[] = [
  {
    name: 'continuous activity does not timeout',
    run: async () => {
      const coordinator = createStreamAbortCoordinator({
        idleTimeoutMs: 80,
      })

      try {
        for (let index = 0; index < 5; index += 1) {
          await sleep(30)
          coordinator.markActivity()
        }

        assert.equal(coordinator.signal.aborted, false)
        assert.equal(coordinator.getAbortSource(), 'none')
      } finally {
        coordinator.cleanup()
      }
    },
  },
  {
    name: 'idle timeout aborts with timeout source',
    run: async () => {
      const coordinator = createStreamAbortCoordinator({
        idleTimeoutMs: 30,
      })

      try {
        await sleep(60)

        assert.equal(coordinator.signal.aborted, true)
        assert.equal(coordinator.getAbortSource(), 'timeout')
      } finally {
        coordinator.cleanup()
      }
    },
  },
  {
    name: 'external abort uses user source',
    run: async () => {
      const externalController = new AbortController()
      const coordinator = createStreamAbortCoordinator({
        externalSignal: externalController.signal,
        idleTimeoutMs: 80,
      })

      try {
        externalController.abort()
        await sleep(0)

        assert.equal(coordinator.signal.aborted, true)
        assert.equal(coordinator.getAbortSource(), 'user')
      } finally {
        coordinator.cleanup()
      }
    },
  },
  {
    name: 'pre-aborted external signal aborts immediately',
    run: async () => {
      const externalController = new AbortController()
      externalController.abort()

      const coordinator = createStreamAbortCoordinator({
        externalSignal: externalController.signal,
        idleTimeoutMs: 30,
      })

      try {
        assert.equal(coordinator.signal.aborted, true)
        assert.equal(coordinator.getAbortSource(), 'user')

        await sleep(60)
        assert.equal(coordinator.getAbortSource(), 'user')
      } finally {
        coordinator.cleanup()
      }
    },
  },
  {
    name: 'first abort source wins when user happens before timeout',
    run: async () => {
      const externalController = new AbortController()
      const coordinator = createStreamAbortCoordinator({
        externalSignal: externalController.signal,
        idleTimeoutMs: 30,
      })

      try {
        externalController.abort()
        await sleep(60)

        assert.equal(coordinator.signal.aborted, true)
        assert.equal(coordinator.getAbortSource(), 'user')
      } finally {
        coordinator.cleanup()
      }
    },
  },
  {
    name: 'first abort source wins when timeout happens before user',
    run: async () => {
      const externalController = new AbortController()
      const coordinator = createStreamAbortCoordinator({
        externalSignal: externalController.signal,
        idleTimeoutMs: 30,
      })

      try {
        await sleep(60)
        externalController.abort()

        assert.equal(coordinator.signal.aborted, true)
        assert.equal(coordinator.getAbortSource(), 'timeout')
      } finally {
        coordinator.cleanup()
      }
    },
  },
  {
    name: 'markActivity renews idle timeout',
    run: async () => {
      const coordinator = createStreamAbortCoordinator({
        idleTimeoutMs: 80,
      })

      try {
        await sleep(50)
        coordinator.markActivity()
        await sleep(50)

        assert.equal(coordinator.signal.aborted, false)

        await sleep(45)
        assert.equal(coordinator.signal.aborted, true)
        assert.equal(coordinator.getAbortSource(), 'timeout')
      } finally {
        coordinator.cleanup()
      }
    },
  },
  {
    name: 'cleanup clears timer and prevents future activity timers',
    run: async () => {
      const coordinator = createStreamAbortCoordinator({
        idleTimeoutMs: 30,
      })

      coordinator.cleanup()
      coordinator.cleanup()
      await sleep(60)
      coordinator.markActivity()
      await sleep(60)

      assert.equal(coordinator.signal.aborted, false)
      assert.equal(coordinator.getAbortSource(), 'none')
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
