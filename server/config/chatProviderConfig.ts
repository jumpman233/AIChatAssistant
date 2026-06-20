import { createApiError } from '../utils/apiError'

export type ChatProviderName = 'mock' | 'ark'

export type MockProviderConfig = {
  provider: 'mock'
  streamDelayMs?: number
}

export type ArkProviderConfig = {
  provider: 'ark'
  apiKey: string
  baseUrl: string
  model: string
  idleTimeoutMs: number
}

export type ChatProviderConfig = MockProviderConfig | ArkProviderConfig

const allowedProviders = new Set<ChatProviderName>(['mock', 'ark'])

const configError = (message: string) =>
  createApiError({
    code: 'INTERNAL_ERROR',
    message,
    statusCode: 500,
  })

const readRequiredString = (env: NodeJS.ProcessEnv, key: string) => {
  const value = env[key]?.trim()

  if (!value) {
    throw configError(`${key} is required when AI_CHAT_PROVIDER=ark`)
  }

  return value
}

const readPositiveInteger = (env: NodeJS.ProcessEnv, key: string, defaultValue: number) => {
  const rawValue = env[key]?.trim()

  if (!rawValue) {
    return defaultValue
  }

  const value = Number(rawValue)

  if (!Number.isInteger(value) || value <= 0) {
    throw configError(`${key} must be a positive integer`)
  }

  return value
}

const readOptionalNonNegativeInteger = (env: NodeJS.ProcessEnv, key: string) => {
  const rawValue = env[key]?.trim()

  if (!rawValue) {
    return undefined
  }

  const value = Number(rawValue)

  if (!Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
    throw configError(`${key} must be a non-negative integer`)
  }

  return value
}

export const getChatProviderConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ChatProviderConfig => {
  const provider = (env.AI_CHAT_PROVIDER?.trim() || 'mock') as ChatProviderName

  if (!allowedProviders.has(provider)) {
    throw configError('Invalid AI_CHAT_PROVIDER. Expected mock or ark.')
  }

  if (provider === 'mock') {
    return {
      provider: 'mock',
      streamDelayMs: readOptionalNonNegativeInteger(env, 'MOCK_STREAM_DELAY_MS'),
    }
  }

  return {
    apiKey: readRequiredString(env, 'ARK_API_KEY'),
    baseUrl: readRequiredString(env, 'ARK_BASE_URL'),
    idleTimeoutMs: readPositiveInteger(env, 'ARK_TIMEOUT_MS', 30_000),
    model: readRequiredString(env, 'ARK_MODEL'),
    provider: 'ark',
  }
}
