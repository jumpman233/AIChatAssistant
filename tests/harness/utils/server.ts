import { execa, type ExecaChildProcess } from 'execa'
import { createHarnessLogger } from './harness-log'

export type TestServer = {
  baseUrl: string
  stop: () => Promise<void>
}

const harnessServerLog = createHarnessLogger('harness-server')

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const forwardChatLogs = (data: Buffer | string) => {
  for (const line of String(data).split(/\r?\n/)) {
    const cleanLine = line.replace(/\u001B\[[0-9;]*m/g, '')
    const chatLogIndex = cleanLine.indexOf('[chat]')

    if (chatLogIndex >= 0) {
      console.log(cleanLine.slice(chatLogIndex))
    }
  }
}

const killProcessTree = async (pid: number | undefined) => {
  if (!pid || process.platform !== 'win32') {
    return
  }

  await execa('taskkill', ['/PID', String(pid), '/T', '/F'], {
    reject: false,
  })
}

const killProcessOnPort = async (port: number) => {
  if (process.platform !== 'win32') {
    return
  }

  const command = [
    '$connections = Get-NetTCPConnection -LocalPort',
    String(port),
    '-ErrorAction SilentlyContinue;',
    '$connections | Select-Object -ExpandProperty OwningProcess -Unique |',
    'ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }',
  ].join(' ')

  await execa('powershell', ['-NoProfile', '-Command', command], {
    reject: false,
  })
}

const waitForServer = async (baseUrl: string, getOutput: () => string) => {
  const startedAt = Date.now()
  let lastError: unknown

  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(baseUrl)

      if (response.status < 500) {
        return
      }
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `Timed out waiting for Nuxt dev server. Last error: ${String(lastError)}\n${getOutput()}`,
  )
}

export const startTestServer = async (env: NodeJS.ProcessEnv): Promise<TestServer> => {
  const port = Number(process.env.HARNESS_PORT ?? 3111)
  const baseUrl = `http://127.0.0.1:${port}`

  harnessServerLog.step('start test server', {
    baseUrl,
    port,
  })

  const child = execa('pnpm', ['exec', 'nuxt', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
    env: {
      ...env,
      NUXT_IGNORE_LOCK: '1',
    },
    stderr: 'pipe',
    stdout: 'pipe',
  }) as ExecaChildProcess
  let output = ''

  child.stdout?.on('data', (data) => {
    output += String(data)
    forwardChatLogs(data)
  })

  child.stderr?.on('data', (data) => {
    output += String(data)
    forwardChatLogs(data)
  })

  child.catch(() => {
    // The scenario reports server startup and request failures explicitly.
  })

  await waitForServer(baseUrl, () => output)
  harnessServerLog.info('test server ready', {
    baseUrl,
    port,
  })

  return {
    baseUrl,
    stop: async () => {
      harnessServerLog.debug('stop test server', {
        port,
      })
      child.kill('SIGTERM')

      const stopped = await Promise.race([
        child
          .then(() => true)
          .catch(() => true),
        delay(2_000).then(() => false),
      ])

      if (!stopped) {
        child.kill('SIGKILL')
      }

      await killProcessTree(child.pid)
      await killProcessOnPort(port)
    },
  }
}
