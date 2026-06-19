import 'dotenv/config'

export type HarnessEnv = {
  databaseUrl: string
  testDatabaseUrl: string
}

export const loadHarnessEnv = (): HarnessEnv => {
  const databaseUrl = process.env.DATABASE_URL
  const testDatabaseUrl = process.env.TEST_DATABASE_URL

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for Harness')
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required so Harness can verify it differs from TEST_DATABASE_URL')
  }

  if (databaseUrl === testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL')
  }

  return {
    databaseUrl,
    testDatabaseUrl,
  }
}

export const createHarnessProcessEnv = (env: HarnessEnv) => ({
  ...process.env,
  AI_CHAT_LOG_LEVEL: process.env.AI_CHAT_LOG_LEVEL ?? 'info',
  AI_CHAT_PROVIDER: 'mock',
  DATABASE_URL: env.testDatabaseUrl,
  MOCK_STREAM_DELAY_MS: '',
  TEST_DATABASE_URL: env.testDatabaseUrl,
})

export const createAiProviderSmokeProcessEnv = (env: HarnessEnv) => ({
  ...process.env,
  AI_CHAT_LOG_LEVEL: process.env.AI_CHAT_LOG_LEVEL ?? 'info',
  AI_CHAT_PROVIDER: 'ark',
  DATABASE_URL: env.testDatabaseUrl,
  TEST_DATABASE_URL: env.testDatabaseUrl,
})
