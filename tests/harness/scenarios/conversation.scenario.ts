import type { PrismaClient } from '@prisma/client'
import { ApiClient } from '../utils/api-client'
import { assert, assertArray, assertEqual } from '../utils/assert'
import { prepareTestDatabase } from '../utils/db'
import { assertConversationSoftDeleted } from '../utils/db-assert'
import { startTestServer, type TestServer } from '../utils/server'

type ConversationDTO = {
  id: string
  title: string | null
  profileId: string
  mode: string
  status: 'active' | 'archived' | 'deleted'
  isStreaming: boolean
  activeAssistantMessageId: string | null
  createdAt: string
  updatedAt: string
}

type ListConversationsResponse = {
  items: ConversationDTO[]
  nextCursor: string | null
}

type ListMessagesResponse = {
  items: MessageDTO[]
  pageInfo: {
    limit: number
    hasMoreBefore: boolean
    hasMoreAfter: boolean
    beforeSeq: number | null
    afterSeq: number | null
  }
}

type DeleteConversationResponse = {
  id: string
  status: 'deleted'
}

type ListProfilesResponse = {
  items: unknown[]
}

type MessageDTO = {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  status: 'pending' | 'streaming' | 'done' | 'failed' | 'aborted'
  seq: number
  toolCalls: unknown[]
}

const assertInitialConversation = (conversation: ConversationDTO) => {
  assert(conversation.id, 'Expected conversation id')
  assertEqual(conversation.status, 'active', 'Expected new conversation to be active')
  assertEqual(conversation.profileId, 'general', 'Expected default profileId')
  assertEqual(conversation.mode, 'chat', 'Expected default mode')
  assertEqual(conversation.isStreaming, false, 'Expected initial isStreaming=false')
  assertEqual(
    conversation.activeAssistantMessageId,
    null,
    'Expected initial activeAssistantMessageId=null',
  )
}

const assertMessagesHaveToolCalls = (messages: MessageDTO[], context: string) => {
  for (const message of messages) {
    assertArray(message.toolCalls, `${context}: expected message ${message.seq} toolCalls array`)
  }
}

const assertApiRequestFails = async (
  request: () => Promise<unknown>,
  expectedStatus: number,
  message: string,
) => {
  let failed = false

  try {
    await request()
  } catch (error) {
    failed = true
    assert(error instanceof Error, `${message}: expected Error instance`)
    assert(
      error.message.includes(` ${expectedStatus} `),
      `${message}: expected HTTP ${expectedStatus}, received ${error.message}`,
    )
  }

  assert(failed, `${message}: expected request to fail`)
}

const runScenario = async (api: ApiClient, prisma: PrismaClient) => {
  const profiles = await api.get<ListProfilesResponse>('/api/profiles')
  assertArray(profiles.items, 'Expected GET /api/profiles to return items array')
  assert(profiles.items.length >= 2, 'Expected at least two assistant profiles')

  const created = await api.post<ConversationDTO>('/api/conversations', {
    profileId: 'general',
    title: 'V1 Harness Conversation',
  })

  assertInitialConversation(created)
  assertEqual(created.title, 'V1 Harness Conversation', 'Expected created title')

  const list = await api.get<ListConversationsResponse>('/api/conversations')
  assert(
    list.items.some((conversation) => conversation.id === created.id),
    'Expected created conversation in default list',
  )

  const detail = await api.get<ConversationDTO>(`/api/conversations/${created.id}`)
  assertEqual(detail.id, created.id, 'Expected conversation detail to match created id')
  assertInitialConversation(detail)

  const messages = await api.get<ListMessagesResponse>(
    `/api/conversations/${created.id}/messages?limit=50`,
  )

  assertArray(messages.items, 'Expected messages items array')
  assertEqual(messages.items.length, 0, 'Expected initial messages to be empty')
  assertEqual(messages.pageInfo.limit, 50, 'Expected pageInfo.limit=50')
  assertEqual(messages.pageInfo.hasMoreBefore, false, 'Expected hasMoreBefore=false')
  assertEqual(messages.pageInfo.hasMoreAfter, false, 'Expected hasMoreAfter=false')
  assertEqual(messages.pageInfo.beforeSeq, null, 'Expected beforeSeq=null')
  assertEqual(messages.pageInfo.afterSeq, null, 'Expected afterSeq=null')

  await prisma.message.createMany({
    data: Array.from({ length: 55 }, (_, index) => {
      const seq = index + 1

      return {
        content: `seed message ${seq}`,
        conversationId: created.id,
        mode: created.mode,
        profileId: created.profileId,
        role: 'user',
        seq,
        status: 'done',
      } as const
    }),
  })

  const recentMessages = await api.get<ListMessagesResponse>(
    `/api/conversations/${created.id}/messages?limit=50`,
  )

  assertEqual(recentMessages.items.length, 50, 'Expected recent messages limit=50')
  assertEqual(recentMessages.items[0]?.seq, 6, 'Expected first recent message seq=6')
  assertEqual(recentMessages.items.at(-1)?.seq, 55, 'Expected last recent message seq=55')
  assertEqual(recentMessages.pageInfo.limit, 50, 'Expected recent pageInfo.limit=50')
  assertEqual(recentMessages.pageInfo.hasMoreBefore, true, 'Expected hasMoreBefore=true')
  assertEqual(recentMessages.pageInfo.hasMoreAfter, false, 'Expected hasMoreAfter=false')
  assertEqual(recentMessages.pageInfo.beforeSeq, 6, 'Expected beforeSeq=6')
  assertEqual(recentMessages.pageInfo.afterSeq, 55, 'Expected afterSeq=55')
  assertMessagesHaveToolCalls(recentMessages.items, 'Recent messages')

  const defaultLimitMessages = await api.get<ListMessagesResponse>(
    `/api/conversations/${created.id}/messages`,
  )

  assertEqual(defaultLimitMessages.items.length, 50, 'Expected default limit to return 50 items')
  assertEqual(defaultLimitMessages.items[0]?.seq, 6, 'Expected default first message seq=6')
  assertEqual(defaultLimitMessages.items.at(-1)?.seq, 55, 'Expected default last message seq=55')
  assertEqual(defaultLimitMessages.pageInfo.limit, 50, 'Expected default pageInfo.limit=50')
  assertEqual(defaultLimitMessages.pageInfo.hasMoreBefore, true, 'Expected default hasMoreBefore=true')
  assertEqual(defaultLimitMessages.pageInfo.hasMoreAfter, false, 'Expected default hasMoreAfter=false')
  assertEqual(defaultLimitMessages.pageInfo.beforeSeq, 6, 'Expected default beforeSeq=6')
  assertEqual(defaultLimitMessages.pageInfo.afterSeq, 55, 'Expected default afterSeq=55')
  assertMessagesHaveToolCalls(defaultLimitMessages.items, 'Default limit messages')

  const beforeSeqMessages = await api.get<ListMessagesResponse>(
    `/api/conversations/${created.id}/messages?limit=10&beforeSeq=21`,
  )

  assertEqual(beforeSeqMessages.items.length, 10, 'Expected beforeSeq page to return 10 items')
  assertEqual(beforeSeqMessages.items[0]?.seq, 11, 'Expected beforeSeq first message seq=11')
  assertEqual(beforeSeqMessages.items.at(-1)?.seq, 20, 'Expected beforeSeq last message seq=20')
  assertEqual(beforeSeqMessages.pageInfo.limit, 10, 'Expected beforeSeq pageInfo.limit=10')
  assertEqual(beforeSeqMessages.pageInfo.hasMoreBefore, true, 'Expected beforeSeq hasMoreBefore=true')
  assertEqual(beforeSeqMessages.pageInfo.hasMoreAfter, true, 'Expected beforeSeq hasMoreAfter=true')
  assertEqual(beforeSeqMessages.pageInfo.beforeSeq, 11, 'Expected beforeSeq page beforeSeq=11')
  assertEqual(beforeSeqMessages.pageInfo.afterSeq, 20, 'Expected beforeSeq page afterSeq=20')
  assertMessagesHaveToolCalls(beforeSeqMessages.items, 'BeforeSeq messages')

  const afterSeqMessages = await api.get<ListMessagesResponse>(
    `/api/conversations/${created.id}/messages?limit=10&afterSeq=45`,
  )

  assertEqual(afterSeqMessages.items.length, 10, 'Expected afterSeq page to return 10 items')
  assertEqual(afterSeqMessages.items[0]?.seq, 46, 'Expected afterSeq first message seq=46')
  assertEqual(afterSeqMessages.items.at(-1)?.seq, 55, 'Expected afterSeq last message seq=55')
  assertEqual(afterSeqMessages.pageInfo.limit, 10, 'Expected afterSeq pageInfo.limit=10')
  assertEqual(afterSeqMessages.pageInfo.hasMoreBefore, true, 'Expected afterSeq hasMoreBefore=true')
  assertEqual(afterSeqMessages.pageInfo.hasMoreAfter, false, 'Expected afterSeq hasMoreAfter=false')
  assertEqual(afterSeqMessages.pageInfo.beforeSeq, 46, 'Expected afterSeq page beforeSeq=46')
  assertEqual(afterSeqMessages.pageInfo.afterSeq, 55, 'Expected afterSeq page afterSeq=55')
  assertMessagesHaveToolCalls(afterSeqMessages.items, 'AfterSeq messages')

  const deleted = await api.delete<DeleteConversationResponse>(`/api/conversations/${created.id}`)
  assertEqual(deleted.id, created.id, 'Expected deleted response id to match')
  assertEqual(deleted.status, 'deleted', 'Expected deleted response status')

  const listAfterDelete = await api.get<ListConversationsResponse>('/api/conversations')
  assert(
    !listAfterDelete.items.some((conversation) => conversation.id === created.id),
    'Expected default list to omit deleted conversation',
  )

  await assertApiRequestFails(
    () => api.get<ConversationDTO>(`/api/conversations/${created.id}`),
    404,
    'Expected deleted conversation detail to be inaccessible',
  )
  await assertApiRequestFails(
    () => api.get<ListMessagesResponse>(`/api/conversations/${created.id}/messages`),
    404,
    'Expected deleted conversation messages to be inaccessible',
  )

  await assertConversationSoftDeleted(prisma, created.id)
}

const main = async () => {
  let prisma: PrismaClient | null = null
  let server: TestServer | null = null

  try {
    const prepared = await prepareTestDatabase()
    prisma = prepared.prisma
    server = await startTestServer(prepared.processEnv)

    const api = new ApiClient({
      baseUrl: server.baseUrl,
    })

    await runScenario(api, prisma)
    console.log('verify:v1 passed')
  } finally {
    if (server) {
      await server.stop()
    }

    if (prisma) {
      await prisma.$disconnect()
    }
  }
}

await main()
