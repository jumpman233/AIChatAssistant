import type { PrismaClient } from '@prisma/client'
import type {
  ApiErrorResponse,
  ConversationDTO,
  ListMessagesResponse,
  MessageCreatedStreamEventData,
  MessageDoneStreamEventData,
  MessageDTO,
  MessageFailedStreamEventData,
  RetryCreatedStreamEventData,
  TextDeltaStreamEventData,
} from '../types/api'
import { ApiClient } from '../utils/api-client'
import { assert, assertArray, assertEqual } from '../utils/assert'
import { prepareTestDatabase } from '../utils/db'
import { createHarnessLogger } from '../utils/harness-log'
import { startTestServer, type TestServer } from '../utils/server'
import {
  createSseSession,
  readSseStream,
  type HarnessSseEvent,
  type HarnessSseSession,
} from '../utils/stream-client'
import {
  testMode,
  testProfileId,
  v4AbortPrompt,
  v4FailedPrompt,
  v4IsolationPrompt,
} from '../utils/test-data'

type MessageCreatedEvent = HarnessSseEvent<MessageCreatedStreamEventData>
type RetryCreatedEvent = HarnessSseEvent<RetryCreatedStreamEventData>
type TextDeltaEvent = HarnessSseEvent<TextDeltaStreamEventData>
type MessageDoneEvent = HarnessSseEvent<MessageDoneStreamEventData>
type MessageFailedEvent = HarnessSseEvent<MessageFailedStreamEventData>

const harnessLog = createHarnessLogger('verify:v4')
const mockDelayMs = 120

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isMessageCreatedEvent = (event: HarnessSseEvent): event is MessageCreatedEvent =>
  event.data.type === 'message_created'

const isRetryCreatedEvent = (event: HarnessSseEvent): event is RetryCreatedEvent =>
  event.data.type === 'retry_created'

const isTextDeltaEvent = (event: HarnessSseEvent): event is TextDeltaEvent =>
  event.data.type === 'text_delta'

const isMessageDoneEvent = (event: HarnessSseEvent): event is MessageDoneEvent =>
  event.data.type === 'message_done'

const isMessageFailedEvent = (event: HarnessSseEvent): event is MessageFailedEvent =>
  event.data.type === 'message_failed'

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

const assertMessageDTO = (message: MessageDTO, context: string) => {
  assert(message.id, `${context}: expected id`)
  assert(message.conversationId, `${context}: expected conversationId`)
  assert(typeof message.seq === 'number', `${context}: expected numeric seq`)
  assertArray(message.toolCalls, `${context}: expected toolCalls array`)
}

const assertSseResponse = (response: Response, context: string) => {
  assertEqual(response.status, 200, `${context}: expected HTTP 200`)
  assert(
    response.headers.get('content-type')?.includes('text/event-stream'),
    `${context}: expected text/event-stream response`,
  )
}

const assertJsonError = async (response: Response, status: number, code: string, context: string) => {
  assertEqual(response.status, status, `${context}: expected HTTP ${status}`)
  assert(
    response.headers.get('content-type')?.includes('application/json'),
    `${context}: expected JSON error response`,
  )
  const error = (await response.json()) as ApiErrorResponse
  assertEqual(error.code, code, `${context}: expected error code ${code}`)
  return error
}

const createConversation = (api: ApiClient, title: string) =>
  api.post<ConversationDTO>('/api/conversations', {
    mode: testMode,
    profileId: testProfileId,
    title,
  })

const concatenateDeltas = (events: HarnessSseEvent[]) =>
  events.filter(isTextDeltaEvent).map((event) => event.data.delta).join('')

const waitForDeltaCount = async (session: HarnessSseSession, count: number) => {
  await session.waitFor(
    (event) => isTextDeltaEvent(event) && session.events.filter(isTextDeltaEvent).length >= count,
    {
      timeoutMs: 10_000,
    },
  )
}

const getMessages = (api: ApiClient, conversationId: string) =>
  api.get<ListMessagesResponse>(`/api/conversations/${conversationId}/messages?limit=50`)

const getDbMessages = (prisma: PrismaClient, conversationId: string) =>
  prisma.message.findMany({
    orderBy: {
      seq: 'asc',
    },
    where: {
      conversationId,
    },
  })

const assertNoDuplicateSeq = (messages: Array<{ seq: number }>, context: string) => {
  const seqs = messages.map((message) => message.seq)
  assertEqual(new Set(seqs).size, seqs.length, `${context}: expected unique seq values`)
}

const assertApiAndDbMessageState = async (input: {
  api: ApiClient
  content: string
  conversationId: string
  messageId: string
  prisma: PrismaClient
  status: MessageDTO['status']
}) => {
  const apiMessages = await getMessages(input.api, input.conversationId)
  const apiMessage = apiMessages.items.find((message) => message.id === input.messageId)
  assert(apiMessage, 'Expected API message to exist')
  assertEqual(apiMessage.status, input.status, 'Expected API message status')
  assertEqual(apiMessage.content, input.content, 'Expected API message content')

  const dbMessage = await input.prisma.message.findUnique({
    where: {
      id: input.messageId,
    },
  })
  assert(dbMessage, 'Expected DB message to exist')
  assertEqual(dbMessage.status, input.status, 'Expected DB message status')
  assertEqual(dbMessage.content, input.content, 'Expected DB message content')
}

const assertRetryCreatedEvent = (input: {
  event: HarnessSseEvent
  conversationId: string
  sourceAssistantMessageId: string
}) => {
  assert(isRetryCreatedEvent(input.event), 'Expected first retry event to be retry_created')
  assertEqual(
    input.event.data.conversationId,
    input.conversationId,
    'Expected retry_created conversationId',
  )
  assertEqual(
    input.event.data.sourceAssistantMessageId,
    input.sourceAssistantMessageId,
    'Expected retry_created sourceAssistantMessageId',
  )
  assertMessageDTO(input.event.data.assistantMessage, 'retry_created assistantMessage')
  assertEqual(
    input.event.data.assistantMessage.status,
    'streaming',
    'Expected retry assistant status streaming',
  )
  assert(
    input.event.data.assistantMessage.id !== input.sourceAssistantMessageId,
    'Expected retry assistant id to differ from source assistant',
  )
  return input.event.data.assistantMessage
}

const assertDoneRetryStream = (events: HarnessSseEvent[], input: {
  conversationId: string
  expectedParentMessageId: string
  expectedSeq: number
  sourceAssistantMessageId: string
}) => {
  const eventTypes = events.map((event) => event.event)
  assertEqual(eventTypes[0], 'retry_created', 'Expected retry_created first')
  assertEqual(eventTypes.at(-1), 'message_done', 'Expected message_done final')

  for (const event of events) {
    assertEqual(event.event, event.data.type, `Expected ${event.event} to match data.type`)
    assertEqual(event.data.conversationId, input.conversationId, `Expected ${event.event} conversationId`)
  }

  const retryCreated = events.find(isRetryCreatedEvent)
  assert(retryCreated, 'Expected retry_created event')
  const retryAssistant = assertRetryCreatedEvent({
    conversationId: input.conversationId,
    event: retryCreated,
    sourceAssistantMessageId: input.sourceAssistantMessageId,
  })
  assertEqual(retryAssistant.seq, input.expectedSeq, 'Expected retry assistant seq')
  assertEqual(
    retryAssistant.parentMessageId,
    input.expectedParentMessageId,
    'Expected retry assistant parentMessageId',
  )

  const textDeltas = events.filter(isTextDeltaEvent)
  assert(textDeltas.length > 0, 'Expected retry text_delta events')
  for (const event of textDeltas) {
    assertEqual(event.data.messageId, retryAssistant.id, 'Expected retry delta messageId')
  }

  const messageDone = events.find(isMessageDoneEvent)
  assert(messageDone, 'Expected retry message_done event')
  const content = textDeltas.map((event) => event.data.delta).join('')
  assertEqual(messageDone.data.message.id, retryAssistant.id, 'Expected done message id')
  assertEqual(messageDone.data.message.status, 'done', 'Expected retry done status')
  assertEqual(messageDone.data.message.content, content, 'Expected retry done content')

  return {
    content,
    deltaCount: textDeltas.length,
    message: messageDone.data.message,
    summary: summarizeEventTypes(eventTypes),
  }
}

const runAbortRetryScenario = async (api: ApiClient, prisma: PrismaClient) => {
  const conversation = await createConversation(api, 'V4 Abort Retry')
  let session: HarnessSseSession | null = null

  try {
    const response = await api.postRaw('/api/chat', {
      content: v4AbortPrompt,
      conversationId: conversation.id,
      mock: {
        delayMs: mockDelayMs,
      },
      mode: testMode,
      profileId: testProfileId,
    })
    assertSseResponse(response, 'abort scenario POST /api/chat')
    session = createSseSession(response)

    const messageCreated = (await session.waitFor(isMessageCreatedEvent)) as MessageCreatedEvent
    await waitForDeltaCount(session, 2)

    const rawContent = concatenateDeltas(session.events)
    assert(rawContent.length > 0, 'Expected abort rawContent to be non-empty')

    const abortedMessage = await api.post<MessageDTO>(
      `/api/messages/${messageCreated.data.assistantMessage.id}/abort`,
      {
        content: rawContent,
      },
    )

    assertEqual(abortedMessage.id, messageCreated.data.assistantMessage.id, 'Expected aborted id')
    assertEqual(abortedMessage.status, 'aborted', 'Expected aborted status')
    assertEqual(abortedMessage.content, rawContent, 'Expected aborted content')
    harnessLog.step('abort terminal state checked', {
      partialContentLength: rawContent.length,
    })

    await session.cancel().catch(() => undefined)
    await session.done.catch(() => undefined)
    session = null

    await sleep(mockDelayMs * 2)

    await assertApiAndDbMessageState({
      api,
      content: rawContent,
      conversationId: conversation.id,
      messageId: abortedMessage.id,
      prisma,
      status: 'aborted',
    })

    const duplicateAbort = await api.post<MessageDTO>(`/api/messages/${abortedMessage.id}/abort`, {
      content: rawContent,
    })
    assertEqual(duplicateAbort.id, abortedMessage.id, 'Expected duplicate abort same id')
    assertEqual(duplicateAbort.status, 'aborted', 'Expected duplicate abort aborted status')
    harnessLog.step('duplicate abort idempotent checked')

    const retryResponse = await api.postRaw(`/api/messages/${abortedMessage.id}/retry`, {
      mock: {
        delayMs: 0,
      },
    })
    assertSseResponse(retryResponse, 'aborted retry')
    const retryEvents = await readSseStream(retryResponse)
    const retrySummary = assertDoneRetryStream(retryEvents, {
      conversationId: conversation.id,
      expectedParentMessageId: messageCreated.data.userMessage.id,
      expectedSeq: 3,
      sourceAssistantMessageId: abortedMessage.id,
    })
    harnessLog.step('aborted retry completed', {
      deltaCount: retrySummary.deltaCount,
      eventSummary: retrySummary.summary,
    })

    const messages = await getMessages(api, conversation.id)
    assertEqual(messages.items.length, 3, 'Expected abort scenario to have three messages')
    assertNoDuplicateSeq(messages.items, 'Abort scenario API messages')
    assertEqual(messages.items[0]?.seq, 1, 'Expected user seq=1')
    assertEqual(messages.items[1]?.seq, 2, 'Expected old aborted seq=2')
    assertEqual(messages.items[1]?.status, 'aborted', 'Expected old assistant remains aborted')
    assertEqual(messages.items[2]?.seq, 3, 'Expected retry assistant seq=3')
    assertEqual(messages.items[2]?.status, 'done', 'Expected retry assistant done')

    const dbMessages = await getDbMessages(prisma, conversation.id)
    assertEqual(dbMessages.length, 3, 'Expected abort scenario DB three messages')
    assertNoDuplicateSeq(dbMessages, 'Abort scenario DB messages')

    return {
      abortedMessage,
      conversation,
      doneMessage: retrySummary.message,
      parentUserMessage: messageCreated.data.userMessage,
      rawContent,
    }
  } finally {
    if (session && !session.isDone) {
      await session.cancel().catch(() => undefined)
      await session.done.catch(() => undefined)
    }
  }
}

const runFailedRetryScenario = async (api: ApiClient, prisma: PrismaClient) => {
  const conversation = await createConversation(api, 'V4 Failed Retry')
  const response = await api.postRaw('/api/chat', {
    content: v4FailedPrompt,
    conversationId: conversation.id,
    mock: {
      delayMs: 0,
      failAtChunk: 3,
    },
    mode: testMode,
    profileId: testProfileId,
  })
  assertSseResponse(response, 'failed scenario POST /api/chat')
  const events = await readSseStream(response)
  const eventTypes = events.map((event) => event.event)
  assertEqual(eventTypes[0], 'message_created', 'Expected failed stream message_created first')
  assertEqual(eventTypes.at(-1), 'message_failed', 'Expected failed stream message_failed final')
  assertEqual(events.filter(isTextDeltaEvent).length, 2, 'Expected two deltas before failAtChunk=3')

  const messageCreated = events.find(isMessageCreatedEvent)
  const messageFailed = events.find(isMessageFailedEvent)
  assert(messageCreated, 'Expected failed stream message_created')
  assert(messageFailed, 'Expected failed stream message_failed')

  const partialContent = concatenateDeltas(events)
  assertEqual(
    messageFailed.data.message.content,
    partialContent,
    'Expected failed message content to equal partial deltas',
  )
  await assertApiAndDbMessageState({
    api,
    content: partialContent,
    conversationId: conversation.id,
    messageId: messageFailed.data.message.id,
    prisma,
    status: 'failed',
  })
  harnessLog.step('failed partial content checked', {
    partialContentLength: partialContent.length,
  })

  const retryResponse = await api.postRaw(`/api/messages/${messageFailed.data.message.id}/retry`, {
    mock: {
      delayMs: mockDelayMs,
    },
  })
  assertSseResponse(retryResponse, 'failed retry')
  const retrySession = createSseSession(retryResponse)
  const retryCreated = (await retrySession.waitFor(isRetryCreatedEvent)) as RetryCreatedEvent

  const activeRetryConflict = await api.postRaw(`/api/messages/${messageFailed.data.message.id}/retry`, {
    mock: {
      delayMs: 0,
    },
  })
  await assertJsonError(activeRetryConflict, 409, 'CONVERSATION_STREAMING', 'retry active assistant')

  const retryEvents = await retrySession.done
  const retrySummary = assertDoneRetryStream(retryEvents, {
    conversationId: conversation.id,
    expectedParentMessageId: messageCreated.data.userMessage.id,
    expectedSeq: 3,
    sourceAssistantMessageId: messageFailed.data.message.id,
  })
  assertEqual(
    retrySummary.message.id,
    retryCreated.data.assistantMessage.id,
    'Expected retry done id to match retry_created assistant',
  )
  harnessLog.step('failed retry completed', {
    deltaCount: retrySummary.deltaCount,
    eventSummary: retrySummary.summary,
  })

  const messages = await getMessages(api, conversation.id)
  assertEqual(messages.items.length, 3, 'Expected failed scenario to have three messages')
  assertEqual(messages.items[1]?.status, 'failed', 'Expected old failed assistant remains failed')
  assertEqual(messages.items[2]?.status, 'done', 'Expected failed retry assistant done')
  assertNoDuplicateSeq(messages.items, 'Failed scenario API messages')

  return {
    conversation,
    doneMessage: retrySummary.message,
    failedMessage: messageFailed.data.message,
    parentUserMessage: messageCreated.data.userMessage,
  }
}

const runErrorRulesScenario = async (api: ApiClient, input: {
  abortedMessage: MessageDTO
  doneMessage: MessageDTO
}) => {
  const abortDoneResponse = await api.postRaw(`/api/messages/${input.doneMessage.id}/abort`, {
    content: '',
  })
  await assertJsonError(abortDoneResponse, 409, 'MESSAGE_NOT_ABORTABLE', 'abort done assistant')

  const retryDoneResponse = await api.postRaw(`/api/messages/${input.doneMessage.id}/retry`, {
    mock: {
      delayMs: 0,
    },
  })
  await assertJsonError(retryDoneResponse, 409, 'MESSAGE_NOT_RETRYABLE', 'retry done assistant')

  const duplicateAbortResponse = await api.post<MessageDTO>(
    `/api/messages/${input.abortedMessage.id}/abort`,
    {
      content: input.abortedMessage.content,
    },
  )
  assertEqual(duplicateAbortResponse.status, 'aborted', 'Expected duplicate abort to be idempotent')
  harnessLog.step('error rules checked')
}

const runIsolationScenario = async (api: ApiClient, input: {
  abortedMessage: MessageDTO
}) => {
  const conversationC = await createConversation(api, 'V4 Isolation C')
  let sessionC: HarnessSseSession | null = null

  try {
    const responseC = await api.postRaw('/api/chat', {
      content: v4IsolationPrompt,
      conversationId: conversationC.id,
      mock: {
        delayMs: mockDelayMs,
      },
      mode: testMode,
      profileId: testProfileId,
    })
    assertSseResponse(responseC, 'isolation C stream')
    sessionC = createSseSession(responseC)

    await sessionC.waitFor(isMessageCreatedEvent)
    await waitForDeltaCount(sessionC, 1)

    const retryAResponse = await api.postRaw(`/api/messages/${input.abortedMessage.id}/retry`, {
      mock: {
        delayMs: 0,
      },
    })
    assertSseResponse(retryAResponse, 'isolation A retry')
    const retryAEvents = await readSseStream(retryAResponse)
    assertEqual(retryAEvents[0]?.event, 'retry_created', 'Expected isolation retry_created')
    assertEqual(retryAEvents.at(-1)?.event, 'message_done', 'Expected isolation retry done')

    assert(
      !sessionC.events.some(isMessageDoneEvent),
      'Expected C to still be streaming while A retry finishes',
    )

    const eventsC = await sessionC.done
    assertEqual(eventsC[0]?.event, 'message_created', 'Expected C message_created first')
    assertEqual(eventsC.at(-1)?.event, 'message_done', 'Expected C message_done final')
    assert(eventsC.filter(isTextDeltaEvent).length > 0, 'Expected C text deltas')
    harnessLog.step('multi-conversation isolation checked')
  } finally {
    if (sessionC && !sessionC.isDone) {
      await sessionC.cancel().catch(() => undefined)
      await sessionC.done.catch(() => undefined)
    }
  }
}

const runScenario = async (api: ApiClient, prisma: PrismaClient) => {
  harnessLog.step('database prepared')
  harnessLog.step('server started', {
    provider: 'mock',
  })

  const abortScenario = await runAbortRetryScenario(api, prisma)
  const failedScenario = await runFailedRetryScenario(api, prisma)

  await runErrorRulesScenario(api, {
    abortedMessage: abortScenario.abortedMessage,
    doneMessage: failedScenario.doneMessage,
  })
  await runIsolationScenario(api, {
    abortedMessage: abortScenario.abortedMessage,
  })

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
    console.log('verify:v4 passed')
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
