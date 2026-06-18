type HarnessLogMeta = Record<string, unknown>

const isVerbose = () => process.env.AI_CHAT_HARNESS_VERBOSE === 'true'

const isSensitiveTextKey = (key: string) => {
  return (
    /(content|prompt|delta|rawBuffer|rawFrame|rawChunk|databaseUrl|connectionString)/i.test(key) &&
    !/length$/i.test(key)
  )
}

const toLengthKey = (key: string) => `${key}Length`

const sanitizeValue = (key: string, value: unknown): [string, unknown] => {
  if (typeof value === 'string' && isSensitiveTextKey(key)) {
    return [toLengthKey(key), value.length]
  }

  if (value instanceof Error) {
    return [
      key,
      {
        name: value.name,
        message: value.message,
      },
    ]
  }

  if (Array.isArray(value)) {
    return [key, value.map((item, index) => sanitizeNestedValue(`${key}${index}`, item))]
  }

  if (value && typeof value === 'object') {
    return [key, sanitizeNestedObject(value as Record<string, unknown>)]
  }

  return [key, value]
}

const sanitizeNestedValue = (key: string, value: unknown): unknown => {
  if (typeof value === 'string' && isSensitiveTextKey(key)) {
    return {
      length: value.length,
    }
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeNestedValue(`${key}${index}`, item))
  }

  if (value && typeof value === 'object') {
    return sanitizeNestedObject(value as Record<string, unknown>)
  }

  return value
}

const sanitizeNestedObject = (value: Record<string, unknown>) => {
  return Object.fromEntries(
    Object.entries(value).map(([nestedKey, nestedValue]) => {
      if (typeof nestedValue === 'string' && isSensitiveTextKey(nestedKey)) {
        return [toLengthKey(nestedKey), nestedValue.length]
      }

      return [nestedKey, sanitizeNestedValue(nestedKey, nestedValue)]
    }),
  )
}

const formatValue = (value: unknown) => {
  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}

const formatMeta = (meta?: HarnessLogMeta) => {
  if (!meta) {
    return ''
  }

  const parts = Object.entries(meta).map(([key, value]) => {
    const [safeKey, safeValue] = sanitizeValue(key, value)

    return `${safeKey}=${formatValue(safeValue)}`
  })

  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

const writeLog = (scope: string, level: 'step' | 'info' | 'debug' | 'error', message: string, meta?: HarnessLogMeta) => {
  if (level === 'debug' && !isVerbose()) {
    return
  }

  const line = `[${scope}] ${message}${formatMeta(meta)}`

  if (level === 'error') {
    console.error(line)
    return
  }

  console.log(line)
}

export const createHarnessLogger = (scope: string) => ({
  step(message: string, meta?: HarnessLogMeta) {
    writeLog(scope, 'step', message, meta)
  },

  info(message: string, meta?: HarnessLogMeta) {
    writeLog(scope, 'info', message, meta)
  },

  debug(message: string, meta?: HarnessLogMeta) {
    writeLog(scope, 'debug', message, meta)
  },

  error(message: string, meta?: HarnessLogMeta) {
    writeLog(scope, 'error', message, meta)
  },
})

export const harnessLog = createHarnessLogger('verify:v2')

export const harnessDbLog = createHarnessLogger('harness-db')
