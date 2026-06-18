import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { execa } from 'execa'
import { createHarnessProcessEnv, loadHarnessEnv } from './env'
import { harnessDbLog } from './harness-log'

export const prepareTestDatabase = async () => {
  const harnessEnv = loadHarnessEnv()
  const processEnv = createHarnessProcessEnv(harnessEnv)

  harnessDbLog.step('TEST_DATABASE_URL detected')
  harnessDbLog.step('DATABASE_URL and TEST_DATABASE_URL are different')
  harnessDbLog.info('apply migrations to test database')

  await execa('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: processEnv,
    stdio: 'inherit',
  })

  process.env.DATABASE_URL = harnessEnv.testDatabaseUrl

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: harnessEnv.testDatabaseUrl }),
  })

  harnessDbLog.step('reset test database')

  await prisma.toolCall.deleteMany()
  await prisma.message.deleteMany()
  await prisma.conversation.deleteMany()

  return {
    env: harnessEnv,
    prisma,
    processEnv,
  }
}
