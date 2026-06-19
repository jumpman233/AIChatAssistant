import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type {
  ConversationDTO,
  MessageCreatedStreamEventData,
  MessageDoneStreamEventData,
  TextDeltaStreamEventData,
} from '../harness/types/api'
import { ApiClient } from '../harness/utils/api-client'
import { assert, assertEqual } from '../harness/utils/assert'
import { prepareTestDatabase } from '../harness/utils/db'
import { createAiProviderSmokeProcessEnv } from '../harness/utils/env'
import { createHarnessLogger } from '../harness/utils/harness-log'
import { startTestServer, type TestServer } from '../harness/utils/server'
import { readSseStream, type HarnessSseEvent } from '../harness/utils/stream-client'
import { testMode, testProfileId } from '../harness/utils/test-data'

type MessageCreatedEvent = HarnessSseEvent<MessageCreatedStreamEventData>
type TextDeltaEvent = HarnessSseEvent<TextDeltaStreamEventData>
type MessageDoneEvent = HarnessSseEvent<MessageDoneStreamEventData>

type StreamSummary = {
  assistantMessageId: string
  content: string
  contentLength: number
  deltaCount: number
  durationMs: number
  eventOrder: string
}

const smokeLog = createHarnessLogger('smoke:ai-provider')

const isMessageCreatedEvent = (event: HarnessSseEvent): event is MessageCreatedEvent => {
  return event.data.type === 'message_created'
}

const isTextDeltaEvent = (event: HarnessSseEvent): event is TextDeltaEvent => {
  return event.data.type === 'text_delta'
}

const isMessageDoneEvent = (event: HarnessSseEvent): event is MessageDoneEvent => {
  return event.data.type === 'message_done'
}

const summarizeEventTypes = (eventTypes: string[]) => {
  const parts: string[] = []

  for (const eventType of eventTypes) {
    const lastPart = parts.at(-1)
    const match = lastPart?.match(/^(.+?) x(\d+)$/)
    const lastEventType = match?.[1] ?? lastPart
    const lastCount = match ? Number(match[2]) : 1

    if (lastEventType === eventType) {
      parts[parts.length - 1] = `${eventType} x${lastCount + 1}`
      continue
    }

    parts.push(eventType)
  }

  return parts.join(' -> ')
}

const readChatStream = async (api: ApiClient, conversationId: string, content: string) => {
  const startedAt = Date.now()
  const response = await api.postRaw('/api/chat', {
    content,
    conversationId,
    mode: testMode,
    profileId: testProfileId,
  })

  assertEqual(response.status, 200, 'Expected POST /api/chat status 200')
  assert(
    response.headers.get('content-type')?.includes('text/event-stream'),
    'Expected POST /api/chat to return text/event-stream',
  )

  const events = await readSseStream(response)
  const eventTypes = events.map((event) => event.event)
  const eventOrder = summarizeEventTypes(eventTypes)

  assertEqual(eventTypes[0], 'message_created', 'Expected message_created to be first event')
  assertEqual(eventTypes.at(-1), 'message_done', 'Expected message_done to be final event')

  const messageCreated = events.find(isMessageCreatedEvent)
  const messageDone = events.find(isMessageDoneEvent)
  const textDeltas = events.filter(isTextDeltaEvent)

  assert(messageCreated, 'Expected message_created event')
  assert(messageDone, 'Expected message_done event')
  assert(textDeltas.length > 0, 'Expected at least one text_delta event')

  const streamContent = textDeltas.map((event) => event.data.delta).join('')

  assert(streamContent.length > 0, 'Expected stream content to be non-empty')
  assertEqual(
    messageDone.data.message.id,
    messageCreated.data.assistantMessage.id,
    'Expected message_done id to match assistant message id',
  )
  assertEqual(messageDone.data.message.status, 'done', 'Expected assistant message done status')
  assertEqual(
    messageDone.data.message.content,
    streamContent,
    'Expected done message content to equal concatenated delta content',
  )

  return {
    assistantMessageId: messageDone.data.message.id,
    content: streamContent,
    contentLength: streamContent.length,
    deltaCount: textDeltas.length,
    durationMs: Date.now() - startedAt,
    eventOrder,
  } satisfies StreamSummary
}

const assertDbAssistantMessage = async (
  prisma: PrismaClient,
  input: {
    conversationId: string
    messageId: string
    expectedContent: string
  },
) => {
  const message = await prisma.message.findUnique({
    where: {
      id: input.messageId,
    },
  })

  assert(message, 'Expected assistant message in database')
  assertEqual(message.conversationId, input.conversationId, 'Expected DB conversationId to match')
  assertEqual(message.role, 'assistant', 'Expected DB assistant role')
  assertEqual(message.status, 'done', 'Expected DB assistant status done')
  assertEqual(
    message.content,
    input.expectedContent,
    'Expected DB content to equal concatenated delta content',
  )
}

const logSummary = (summary: StreamSummary, extra?: Record<string, unknown>) => {
  smokeLog.step('stream summary', {
    contentLength: summary.contentLength,
    deltaCount: summary.deltaCount,
    durationMs: summary.durationMs,
    eventOrder: summary.eventOrder,
    provider: 'ark',
    ...extra,
  })
}

const runSmoke = async (api: ApiClient, prisma: PrismaClient) => {
  const marker = `ARK-SMOKE-${randomUUID().slice(0, 8).toUpperCase()}`

  smokeLog.step('create conversation')
  const conversation = await api.post<ConversationDTO>('/api/conversations', {
    mode: testMode,
    profileId: testProfileId,
    title: 'Ark Provider Smoke',
  })

  smokeLog.step('POST /api/chat first turn')
  const firstSummary = await readChatStream(
    api,
    conversation.id,
    `Remember marker ${marker}. Reply only OK.`,
  )
  await assertDbAssistantMessage(prisma, {
    conversationId: conversation.id,
    expectedContent: firstSummary.content,
    messageId: firstSummary.assistantMessageId,
  })
  logSummary(firstSummary)

  smokeLog.step('POST /api/chat history turn')
  const secondSummary = await readChatStream(
    api,
    conversation.id,
    'Output only the marker from my previous user message. Do not explain.',
  )
  await assertDbAssistantMessage(prisma, {
    conversationId: conversation.id,
    expectedContent: secondSummary.content,
    messageId: secondSummary.assistantMessageId,
  })

  assert(secondSummary.content.includes(marker), 'Expected second turn to include remembered marker')
  logSummary(secondSummary, {
    historyCheck: 'passed',
  })

  smokeLog.step('passed', {
    historyCheck: 'passed',
    provider: 'ark',
  })
}

const main = async () => {
  let prisma: PrismaClient | null = null
  let server: TestServer | null = null

  try {
    smokeLog.step('prepare test database')
    const prepared = await prepareTestDatabase()
    prisma = prepared.prisma

    smokeLog.step('start test server')
    server = await startTestServer(createAiProviderSmokeProcessEnv(prepared.env))

    const api = new ApiClient({
      baseUrl: server.baseUrl,
    })

    await runSmoke(api, prisma)
    console.log('smoke:ai-provider passed')
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
