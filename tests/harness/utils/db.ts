import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { execa } from 'execa'
import { createHarnessProcessEnv, loadHarnessEnv } from './env'

export const prepareTestDatabase = async () => {
  const harnessEnv = loadHarnessEnv()
  const processEnv = createHarnessProcessEnv(harnessEnv)

  await execa('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: processEnv,
    stdio: 'inherit',
  })

  process.env.DATABASE_URL = harnessEnv.testDatabaseUrl

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: harnessEnv.testDatabaseUrl }),
  })

  await prisma.toolCall.deleteMany()
  await prisma.message.deleteMany()
  await prisma.conversation.deleteMany()

  return {
    env: harnessEnv,
    prisma,
    processEnv,
  }
}
