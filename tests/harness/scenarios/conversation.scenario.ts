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
  items: unknown[]
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

  const deleted = await api.delete<DeleteConversationResponse>(`/api/conversations/${created.id}`)
  assertEqual(deleted.id, created.id, 'Expected deleted response id to match')
  assertEqual(deleted.status, 'deleted', 'Expected deleted response status')

  const listAfterDelete = await api.get<ListConversationsResponse>('/api/conversations')
  assert(
    !listAfterDelete.items.some((conversation) => conversation.id === created.id),
    'Expected default list to omit deleted conversation',
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
