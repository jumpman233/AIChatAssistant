import type { PrismaClient } from '@prisma/client'
import type {
  ApiErrorResponse,
  ConversationDTO,
  ListConversationsResponse,
  ListMessagesResponse,
  MessageCreatedStreamEventData,
  MessageDoneStreamEventData,
  MessageDTO,
  TextDeltaStreamEventData,
} from '../types/api'
import { ApiClient } from '../utils/api-client'
import { assert, assertArray, assertEqual } from '../utils/assert'
import { prepareTestDatabase } from '../utils/db'
import { createHarnessLogger } from '../utils/harness-log'
import {
  createSseSession,
  type HarnessSseEvent,
  type HarnessSseSession,
} from '../utils/stream-client'
import { startTestServer, type TestServer } from '../utils/server'
import {
  testMode,
  testProfileId,
  v3DuplicatePromptA,
  v3MultiStreamPromptA,
  v3MultiStreamPromptB,
} from '../utils/test-data'

type MessageCreatedEvent = HarnessSseEvent<MessageCreatedStreamEventData>

type TextDeltaEvent = HarnessSseEvent<TextDeltaStreamEventData>

type MessageDoneEvent = HarnessSseEvent<MessageDoneStreamEventData>

type StreamSummary = {
  assistantMessage: MessageDTO
  content: string
  deltaCount: number
  eventSummary: string
  streamId: string
  userMessage: MessageDTO
}

const harnessLog = createHarnessLogger('verify:v3')
const mockDelayMs = 150

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

const assertNoDuplicateSeq = (messages: Array<{ seq: number }>, context: string) => {
  const seqs = messages.map((message) => message.seq)
  const uniqueSeqs = new Set(seqs)
  assertEqual(uniqueSeqs.size, seqs.length, `${context}: expected seq values to be unique`)
}

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

const assertSseResponse = (response: Response, context: string) => {
  assertEqual(response.status, 200, `${context}: expected HTTP 200`)
  assert(
    response.headers.get('content-type')?.includes('text/event-stream'),
    `${context}: expected text/event-stream response`,
  )
}

const getListConversation = (
  list: ListConversationsResponse,
  conversationId: string,
  context: string,
) => {
  const conversation = list.items.find((item) => item.id === conversationId)
  assert(conversation, `${context}: expected conversation in list`)
  return conversation
}

const assertConversationStreamingState = (
  conversation: ConversationDTO,
  expected: {
    activeAssistantMessageId: string | null
    isStreaming: boolean
  },
  context: string,
) => {
  assertEqual(conversation.isStreaming, expected.isStreaming, `${context}: isStreaming`)
  assertEqual(
    conversation.activeAssistantMessageId,
    expected.activeAssistantMessageId,
    `${context}: activeAssistantMessageId`,
  )
}

const assertStreamingDtos = async (api: ApiClient, input: {
  assistantMessageAId: string
  assistantMessageBId: string
  conversationAId: string
  conversationBId: string
}) => {
  const list = await api.get<ListConversationsResponse>('/api/conversations')
  const listA = getListConversation(list, input.conversationAId, 'streaming list A')
  const listB = getListConversation(list, input.conversationBId, 'streaming list B')
  const detailA = await api.get<ConversationDTO>(`/api/conversations/${input.conversationAId}`)
  const detailB = await api.get<ConversationDTO>(`/api/conversations/${input.conversationBId}`)

  assertConversationStreamingState(
    listA,
    {
      activeAssistantMessageId: input.assistantMessageAId,
      isStreaming: true,
    },
    'streaming list A',
  )
  assertConversationStreamingState(
    listB,
    {
      activeAssistantMessageId: input.assistantMessageBId,
      isStreaming: true,
    },
    'streaming list B',
  )
  assertConversationStreamingState(
    detailA,
    {
      activeAssistantMessageId: input.assistantMessageAId,
      isStreaming: true,
    },
    'streaming detail A',
  )
  assertConversationStreamingState(
    detailB,
    {
      activeAssistantMessageId: input.assistantMessageBId,
      isStreaming: true,
    },
    'streaming detail B',
  )
  assert(
    input.assistantMessageAId !== input.assistantMessageBId,
    'Expected A/B activeAssistantMessageId to differ',
  )
}

const assertFinalDtos = async (api: ApiClient, conversationAId: string, conversationBId: string) => {
  const list = await api.get<ListConversationsResponse>('/api/conversations')
  const listA = getListConversation(list, conversationAId, 'final list A')
  const listB = getListConversation(list, conversationBId, 'final list B')
  const detailA = await api.get<ConversationDTO>(`/api/conversations/${conversationAId}`)
  const detailB = await api.get<ConversationDTO>(`/api/conversations/${conversationBId}`)

  for (const [conversation, context] of [
    [listA, 'final list A'],
    [listB, 'final list B'],
    [detailA, 'final detail A'],
    [detailB, 'final detail B'],
  ] as const) {
    assertConversationStreamingState(
      conversation,
      {
        activeAssistantMessageId: null,
        isStreaming: false,
      },
      context,
    )
  }
}

const assertStreamEvents = (events: HarnessSseEvent[], conversationId: string): StreamSummary => {
  const eventTypes = events.map((event) => event.event)
  const eventSummary = summarizeEventTypes(eventTypes)

  assertEqual(eventTypes[0], 'message_created', 'Expected message_created to be first event')
  assertEqual(eventTypes.at(-1), 'message_done', 'Expected message_done to be final event')
  assert(!eventTypes.includes('message_failed'), 'Expected stream not to include message_failed')

  for (const event of events) {
    assertStreamEventBasics(event, conversationId)
  }

  const messageCreated = events.find(isMessageCreatedEvent)
  assert(messageCreated, 'Expected message_created event')
  const textDeltas = events.filter(isTextDeltaEvent)
  const messageDone = events.find(isMessageDoneEvent)
  assert(messageDone, 'Expected message_done event')
  assert(textDeltas.length > 0, 'Expected at least one text_delta event')

  const streamId = messageCreated.data.streamId

  for (const event of events) {
    assertEqual(event.data.streamId, streamId, 'Expected streamId to remain stable')
  }

  assertMessageDTO(messageCreated.data.userMessage, 'message_created userMessage')
  assertMessageDTO(messageCreated.data.assistantMessage, 'message_created assistantMessage')
  assertEqual(messageCreated.data.userMessage.role, 'user', 'Expected user message role')
  assertEqual(messageCreated.data.userMessage.status, 'done', 'Expected user message done status')
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

  for (const event of textDeltas) {
    assertEqual(
      event.data.messageId,
      messageCreated.data.assistantMessage.id,
      'Expected text_delta messageId to match assistant message',
    )
  }

  assertEqual(
    messageDone.data.message.id,
    messageCreated.data.assistantMessage.id,
    'Expected message_done message id to match assistant message',
  )
  assertEqual(messageDone.data.message.status, 'done', 'Expected message_done status done')

  const content = textDeltas.map((event) => event.data.delta).join('')

  assert(content.length > 0, 'Expected stream content to be non-empty')
  assertEqual(
    messageDone.data.message.content,
    content,
    'Expected message_done content to equal concatenated deltas',
  )

  return {
    assistantMessage: messageCreated.data.assistantMessage,
    content,
    deltaCount: textDeltas.length,
    eventSummary,
    streamId,
    userMessage: messageCreated.data.userMessage,
  }
}

const assertApiAndDatabaseMessages = async (input: {
  content: string
  conversationId: string
  expectedPrompt: string
  prisma: PrismaClient
  api: ApiClient
}) => {
  const messages = await input.api.get<ListMessagesResponse>(
    `/api/conversations/${input.conversationId}/messages?limit=50`,
  )

  assertArray(messages.items, 'Expected messages response items array')
  assertEqual(messages.items.length, 2, 'Expected exactly one user and one assistant message')
  assertNoDuplicateSeq(messages.items, 'API messages')

  const userMessage = messages.items.find((message) => message.role === 'user')
  const assistantMessage = messages.items.find((message) => message.role === 'assistant')

  assert(userMessage, 'Expected API user message')
  assert(assistantMessage, 'Expected API assistant message')
  assertMessageDTO(userMessage, 'API user message')
  assertMessageDTO(assistantMessage, 'API assistant message')
  assertEqual(userMessage.status, 'done', 'Expected API user message done status')
  assertEqual(assistantMessage.status, 'done', 'Expected API assistant message done status')
  assertEqual(userMessage.seq, 1, 'Expected API user seq=1')
  assertEqual(assistantMessage.seq, 2, 'Expected API assistant seq=2')
  assertEqual(userMessage.content, input.expectedPrompt, 'Expected API user prompt content')
  assertEqual(assistantMessage.content, input.content, 'Expected API assistant content')
  assertEqual(
    assistantMessage.parentMessageId,
    userMessage.id,
    'Expected API assistant parentMessageId to point to user',
  )

  const dbMessages = await input.prisma.message.findMany({
    orderBy: {
      seq: 'asc',
    },
    where: {
      conversationId: input.conversationId,
    },
  })

  assertEqual(dbMessages.length, 2, 'Expected exactly two DB messages')
  assertNoDuplicateSeq(dbMessages, 'DB messages')

  const dbUserMessage = dbMessages.find((message) => message.role === 'user')
  const dbAssistantMessage = dbMessages.find((message) => message.role === 'assistant')

  assert(dbUserMessage, 'Expected DB user message')
  assert(dbAssistantMessage, 'Expected DB assistant message')
  assertEqual(dbUserMessage.status, 'done', 'Expected DB user message done status')
  assertEqual(dbAssistantMessage.status, 'done', 'Expected DB assistant message done status')
  assertEqual(dbUserMessage.seq, 1, 'Expected DB user seq=1')
  assertEqual(dbAssistantMessage.seq, 2, 'Expected DB assistant seq=2')
  assertEqual(dbUserMessage.content, input.expectedPrompt, 'Expected DB user prompt content')
  assertEqual(dbAssistantMessage.content, input.content, 'Expected DB assistant content')
  assertEqual(
    dbAssistantMessage.parentMessageId,
    dbUserMessage.id,
    'Expected DB assistant parentMessageId to point to user',
  )

  const toolCallCount = await input.prisma.toolCall.count({
    where: {
      messageId: {
        in: dbMessages.map((message) => message.id),
      },
    },
  })

  assertEqual(toolCallCount, 0, 'Expected no DB tool calls in V3 scenario')

  return {
    assistantMessage,
    dbAssistantMessage,
    dbUserMessage,
    userMessage,
  }
}

const assertDuplicateConflict = async (response: Response) => {
  assertEqual(response.status, 409, 'Expected duplicate A request to return HTTP 409')
  assert(
    response.headers.get('content-type')?.includes('application/json'),
    'Expected duplicate A response to be JSON',
  )

  const error = (await response.json()) as ApiErrorResponse

  assertEqual(
    error.code,
    'CONVERSATION_STREAMING',
    'Expected duplicate A error code CONVERSATION_STREAMING',
  )
  return error
}

const runScenario = async (api: ApiClient, prisma: PrismaClient) => {
  harnessLog.step('database prepared')
  harnessLog.step('server started', {
    provider: 'mock',
  })

  const conversationA = await api.post<ConversationDTO>('/api/conversations', {
    mode: testMode,
    profileId: testProfileId,
    title: 'V3 Harness Stream A',
  })
  const conversationB = await api.post<ConversationDTO>('/api/conversations', {
    mode: testMode,
    profileId: testProfileId,
    title: 'V3 Harness Stream B',
  })

  harnessLog.step('conversations created', {
    A: conversationA.id,
    B: conversationB.id,
  })

  let sessionA: HarnessSseSession | null = null
  let sessionB: HarnessSseSession | null = null

  try {
    const responseA = await api.postRaw('/api/chat', {
      content: v3MultiStreamPromptA,
      conversationId: conversationA.id,
      mock: {
        delayMs: mockDelayMs,
      },
      mode: testMode,
      profileId: testProfileId,
    })
    assertSseResponse(responseA, 'A POST /api/chat')
    sessionA = createSseSession(responseA)

    const responseB = await api.postRaw('/api/chat', {
      content: v3MultiStreamPromptB,
      conversationId: conversationB.id,
      mock: {
        delayMs: mockDelayMs,
      },
      mode: testMode,
      profileId: testProfileId,
    })
    assertSseResponse(responseB, 'B POST /api/chat')
    sessionB = createSseSession(responseB)

    const [messageCreatedA, messageCreatedB] = (await Promise.all([
      sessionA.waitFor(isMessageCreatedEvent),
      sessionB.waitFor(isMessageCreatedEvent),
    ])) as [MessageCreatedEvent, MessageCreatedEvent]

    harnessLog.step('A message_created', {
      assistant: messageCreatedA.data.assistantMessage.id,
    })
    harnessLog.step('B message_created', {
      assistant: messageCreatedB.data.assistantMessage.id,
    })

    assert(
      !sessionA.events.some(isMessageDoneEvent),
      'Expected A not to be done when overlap is checked',
    )
    assert(
      !sessionB.events.some(isMessageDoneEvent),
      'Expected B not to be done when overlap is checked',
    )
    harnessLog.step('streams overlapped')

    await assertStreamingDtos(api, {
      assistantMessageAId: messageCreatedA.data.assistantMessage.id,
      assistantMessageBId: messageCreatedB.data.assistantMessage.id,
      conversationAId: conversationA.id,
      conversationBId: conversationB.id,
    })
    harnessLog.step('streaming DTO checked')

    const duplicateResponse = await api.postRaw('/api/chat', {
      content: v3DuplicatePromptA,
      conversationId: conversationA.id,
      mock: {
        delayMs: mockDelayMs,
      },
      mode: testMode,
      profileId: testProfileId,
    })
    const duplicateError = await assertDuplicateConflict(duplicateResponse)
    harnessLog.step('duplicate A rejected', {
      code: duplicateError.code,
    })

    const [eventsA, eventsB] = await Promise.all([sessionA.done, sessionB.done])
    const streamA = assertStreamEvents(eventsA, conversationA.id)
    const streamB = assertStreamEvents(eventsB, conversationB.id)

    harnessLog.step(`A events: ${streamA.eventSummary}`, {
      contentLength: streamA.content.length,
      deltaCount: streamA.deltaCount,
    })
    harnessLog.step(`B events: ${streamB.eventSummary}`, {
      contentLength: streamB.content.length,
      deltaCount: streamB.deltaCount,
    })

    assert(streamA.streamId !== streamB.streamId, 'Expected A/B streamId values to differ')
    assert(
      streamA.assistantMessage.id !== streamB.assistantMessage.id,
      'Expected A/B assistant message ids to differ',
    )
    assert(
      streamA.userMessage.id !== streamB.userMessage.id,
      'Expected A/B user message ids to differ',
    )

    await assertFinalDtos(api, conversationA.id, conversationB.id)
    harnessLog.step('final DTO checked')

    const apiDbA = await assertApiAndDatabaseMessages({
      api,
      content: streamA.content,
      conversationId: conversationA.id,
      expectedPrompt: v3MultiStreamPromptA,
      prisma,
    })
    const apiDbB = await assertApiAndDatabaseMessages({
      api,
      content: streamB.content,
      conversationId: conversationB.id,
      expectedPrompt: v3MultiStreamPromptB,
      prisma,
    })

    assert(
      apiDbA.assistantMessage.parentMessageId !== apiDbB.userMessage.id,
      'Expected A assistant parentMessageId not to point to B user',
    )
    assert(
      apiDbB.assistantMessage.parentMessageId !== apiDbA.userMessage.id,
      'Expected B assistant parentMessageId not to point to A user',
    )
    harnessLog.step('API/DB isolation checked')
    harnessLog.step('passed')
  } finally {
    await Promise.all(
      [sessionA, sessionB]
        .filter((session): session is HarnessSseSession => Boolean(session && !session.isDone))
        .map((session) => session.cancel().catch(() => undefined)),
    )
  }
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
    console.log('verify:v3 passed')
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
