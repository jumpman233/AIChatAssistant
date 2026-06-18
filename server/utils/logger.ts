type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

type LogMeta = Record<string, unknown>

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
}

const consoleMethod: Record<Exclude<LogLevel, 'silent'>, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
}

const normalizeLogLevel = (value: string | undefined): LogLevel | null => {
  if (
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'silent'
  ) {
    return value
  }

  return null
}

const getCurrentLogLevel = (): LogLevel => {
  const configuredLevel = normalizeLogLevel(process.env.AI_CHAT_LOG_LEVEL)

  if (configuredLevel) {
    return configuredLevel
  }

  return process.env.NODE_ENV === 'development' ? 'info' : 'warn'
}

const shouldLog = (level: Exclude<LogLevel, 'silent'>) => {
  const currentLevel = getCurrentLogLevel()

  return levelWeight[level] >= levelWeight[currentLevel]
}

const isSensitiveTextKey = (key: string) => {
  return /(content|prompt|delta|databaseUrl|connectionString)/i.test(key) && !/length$/i.test(key)
}

const toLengthKey = (key: string) => {
  return `${key.replace(/Text$/i, '')}Length`
}

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

const formatMeta = (meta?: LogMeta) => {
  if (!meta) {
    return ''
  }

  const parts = Object.entries(meta).map(([key, value]) => {
    const [safeKey, safeValue] = sanitizeValue(key, value)

    return `${safeKey}=${formatValue(safeValue)}`
  })

  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

const writeLog = (level: Exclude<LogLevel, 'silent'>, eventName: string, meta?: LogMeta) => {
  if (!shouldLog(level)) {
    return
  }

  console[consoleMethod[level]](`[chat] ${eventName}${formatMeta(meta)}`)
}

export const logger = {
  debug(eventName: string, meta?: LogMeta) {
    writeLog('debug', eventName, meta)
  },

  info(eventName: string, meta?: LogMeta) {
    writeLog('info', eventName, meta)
  },

  warn(eventName: string, meta?: LogMeta) {
    writeLog('warn', eventName, meta)
  },

  error(eventName: string, meta?: LogMeta) {
    writeLog('error', eventName, meta)
  },
}
