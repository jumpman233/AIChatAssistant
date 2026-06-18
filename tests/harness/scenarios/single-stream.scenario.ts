import type { PrismaClient } from '@prisma/client'
import type {
  ConversationDTO,
  ListMessagesResponse,
  MessageCreatedStreamEventData,
  MessageDoneStreamEventData,
  MessageDTO,
  TextDeltaStreamEventData,
} from '../types/api'
import { ApiClient } from '../utils/api-client'
import { assert, assertArray, assertEqual } from '../utils/assert'
import { prepareTestDatabase } from '../utils/db'
import { harnessLog } from '../utils/harness-log'
import { readSseStream, type HarnessSseEvent } from '../utils/stream-client'
import { startTestServer, type TestServer } from '../utils/server'
import { testMode, testProfileId, v2SingleStreamPrompt } from '../utils/test-data'

type MessageCreatedEvent = HarnessSseEvent<MessageCreatedStreamEventData>

type TextDeltaEvent = HarnessSseEvent<TextDeltaStreamEventData>

type MessageDoneEvent = HarnessSseEvent<MessageDoneStreamEventData>

const assertMessageDTO = (message: MessageDTO, context: string) => {
  assert(message.id, `${context}: expected id`)
  assert(message.conversationId, `${context}: expected conversationId`)
  assert(typeof message.seq === 'number', `${context}: expected numeric seq`)
  assertArray(message.toolCalls, `${context}: expected toolCalls array`)
}

const assertStreamEventBasics = (event: HarnessSseEvent, conversationId: string) => {
  assert(event.id, `Expected ${event.event} event id`)
  assert(event.raw.includes('id:'), `Expected ${event.event} raw frame to include id line`)
  assert(event.raw.includes(`event: ${event.event}`), `Expected ${event.event} raw frame event line`)
  assert(event.raw.includes('data:'), `Expected ${event.event} raw frame to include data line`)
  assertEqual(event.event, event.data.type, `Expected ${event.event} to match data.type`)
  assert(event.data.streamId, `Expected ${event.event} streamId`)
  assertEqual(
    event.data.conversationId,
    conversationId,
    `Expected ${event.event} conversationId to match`,
  )
}

const isMessageCreatedEvent = (event: HarnessSseEvent): event is MessageCreatedEvent => {
  return event.data.type === 'message_created'
}

const isTextDeltaEvent = (event: HarnessSseEvent): event is TextDeltaEvent => {
  return event.data.type === 'text_delta'
}

const isMessageDoneEvent = (event: HarnessSseEvent): event is MessageDoneEvent => {
  return event.data.type === 'message_done'
}

const assertNoDuplicateSeq = (messages: Array<{ seq: number }>) => {
  const seqs = messages.map((message) => message.seq)
  const uniqueSeqs = new Set(seqs)
  assertEqual(uniqueSeqs.size, seqs.length, 'Expected message seq values to be unique')
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

const runScenario = async (api: ApiClient, prisma: PrismaClient) => {
  harnessLog.step('create conversation')
  const conversation = await api.post<ConversationDTO>('/api/conversations', {
    mode: testMode,
    profileId: testProfileId,
    title: 'V2 Harness Single Stream',
  })

  harnessLog.debug('conversation created', {
    conversationId: conversation.id,
    mode: conversation.mode,
    profileId: conversation.profileId,
  })

  harnessLog.step('POST /api/chat')
  const response = await api.postRaw('/api/chat', {
    content: v2SingleStreamPrompt,
    conversationId: conversation.id,
    mock: {
      delayMs: 0,
    },
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
  harnessLog.step(`stream events: ${summarizeEventTypes(eventTypes)}`)

  assert(eventTypes.includes('message_created'), 'Expected message_created event')
  assert(eventTypes.includes('text_delta'), 'Expected at least one text_delta event')
  assert(eventTypes.includes('message_done'), 'Expected message_done event')

  const firstTextDeltaIndex = eventTypes.indexOf('text_delta')
  const messageCreatedIndex = eventTypes.indexOf('message_created')
  const messageDoneIndex = eventTypes.lastIndexOf('message_done')

  assertEqual(messageCreatedIndex, 0, 'Expected message_created to be the first event')
  assert(firstTextDeltaIndex > messageCreatedIndex, 'Expected text_delta after message_created')
  assert(messageDoneIndex > firstTextDeltaIndex, 'Expected message_done after text_delta')
  assertEqual(messageDoneIndex, events.length - 1, 'Expected message_done to be the final event')

  for (const event of events) {
    assertStreamEventBasics(event, conversation.id)
  }

  const messageCreated = events.find(isMessageCreatedEvent)
  assert(messageCreated, 'Expected typed message_created event')
  assertMessageDTO(messageCreated.data.userMessage, 'message_created userMessage')
  assertMessageDTO(messageCreated.data.assistantMessage, 'message_created assistantMessage')
  assertEqual(messageCreated.data.userMessage.role, 'user', 'Expected user message role')
  assertEqual(messageCreated.data.userMessage.status, 'done', 'Expected user message done status')
  assertEqual(
    messageCreated.data.userMessage.content,
    v2SingleStreamPrompt,
    'Expected persisted user message content to match prompt',
  )
  assertEqual(
    messageCreated.data.assistantMessage.role,
    'assistant',
    'Expected assistant message role',
  )
  assertEqual(
    messageCreated.data.assistantMessage.status,
    'streaming',
    'Expected assistant initial status streaming',
  )
  assertEqual(
    messageCreated.data.assistantMessage.parentMessageId,
    messageCreated.data.userMessage.id,
    'Expected assistant parentMessageId to point to user message',
  )

  const textDeltaEvents = events.filter(isTextDeltaEvent)
  const streamContent = textDeltaEvents.map((event) => event.data.delta).join('')

  harnessLog.step('stream content', {
    length: streamContent.length,
  })

  assert(streamContent.length > 0, 'Expected concatenated text_delta content to be non-empty')

  for (const event of textDeltaEvents) {
    assertEqual(
      event.data.messageId,
      messageCreated.data.assistantMessage.id,
      'Expected text_delta messageId to match assistant message id',
    )
  }

  const messageDone = events.find(isMessageDoneEvent)
  assert(messageDone, 'Expected typed message_done event')
  assertMessageDTO(messageDone.data.message, 'message_done message')
  assertEqual(
    messageDone.data.message.id,
    messageCreated.data.assistantMessage.id,
    'Expected message_done id to match assistant message id',
  )
  assertEqual(messageDone.data.message.status, 'done', 'Expected message_done status done')
  assertEqual(
    messageDone.data.message.content,
    streamContent,
    'Expected message_done content to equal concatenated delta content',
  )

  const messages = await api.get<ListMessagesResponse>(
    `/api/conversations/${conversation.id}/messages?limit=50`,
  )

  assertArray(messages.items, 'Expected messages response items array')
  assertEqual(messages.items.length, 2, 'Expected one user message and one assistant message')
  assertEqual(messages.pageInfo.limit, 50, 'Expected messages pageInfo.limit=50')
  assertNoDuplicateSeq(messages.items)

  const userMessage = messages.items.find((message) => message.role === 'user')
  const assistantMessage = messages.items.find((message) => message.role === 'assistant')

  assert(userMessage, 'Expected API messages to include user message')
  assert(assistantMessage, 'Expected API messages to include assistant message')
  assertMessageDTO(userMessage, 'API user message')
  assertMessageDTO(assistantMessage, 'API assistant message')
  assertEqual(userMessage.status, 'done', 'Expected API user message status done')
  assertEqual(assistantMessage.status, 'done', 'Expected API assistant message status done')
  assertEqual(userMessage.seq, 1, 'Expected user message seq=1')
  assertEqual(assistantMessage.seq, 2, 'Expected assistant message seq=2')
  assertEqual(
    assistantMessage.content,
    streamContent,
    'Expected API assistant content to equal concatenated delta content',
  )
  assertEqual(
    assistantMessage.parentMessageId,
    userMessage.id,
    'Expected API assistant parentMessageId to point to user message',
  )
  harnessLog.step('API messages checked')

  const dbMessages = await prisma.message.findMany({
    orderBy: {
      seq: 'asc',
    },
    where: {
      conversationId: conversation.id,
    },
  })

  assertEqual(dbMessages.length, 2, 'Expected two database messages')
  assertNoDuplicateSeq(dbMessages)

  const dbUserMessage = dbMessages.find((message) => message.role === 'user')
  const dbAssistantMessage = dbMessages.find((message) => message.role === 'assistant')

  assert(dbUserMessage, 'Expected database user message')
  assert(dbAssistantMessage, 'Expected database assistant message')
  assertEqual(dbUserMessage.status, 'done', 'Expected database user message status done')
  assertEqual(
    dbUserMessage.content,
    v2SingleStreamPrompt,
    'Expected database user content to match prompt',
  )
  assertEqual(dbAssistantMessage.status, 'done', 'Expected database assistant status done')
  assertEqual(
    dbAssistantMessage.content,
    streamContent,
    'Expected database assistant content to equal concatenated delta content',
  )

  harnessLog.step('DB messages checked')
  harnessLog.step('passed')
}

const main = async () => {
  let prisma: PrismaClient | null = null
  let server: TestServer | null = null

  try {
    harnessLog.step('prepare test database')
    const prepared = await prepareTestDatabase()
    prisma = prepared.prisma
    harnessLog.step('start test server')
    server = await startTestServer(prepared.processEnv)

    const api = new ApiClient({
      baseUrl: server.baseUrl,
    })

    await runScenario(api, prisma)
    console.log('verify:v2 passed')
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
