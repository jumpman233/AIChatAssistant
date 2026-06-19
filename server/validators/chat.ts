import { badRequest } from '../utils/apiError'

export type CreateChatInput = {
  conversationId: string
  profileId?: string
  mode?: string
  content: string
  mock?: {
    delayMs?: number
    failAtChunk?: number
  }
}

export type AbortChatInput = {
  content: string
  messageId: string
}

export type RetryChatInput = {
  messageId: string
  mock?: CreateChatInput['mock']
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const readString = (value: unknown) => {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const readNonNegativeInt = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest(`${fieldName} must be a non-negative integer`)
  }

  return parsed
}

const readPositiveInt = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badRequest(`${fieldName} must be a positive integer`)
  }

  return parsed
}

const parseMockOptions = (value: unknown): CreateChatInput['mock'] => {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!isRecord(value)) {
    throw badRequest('mock must be an object')
  }

  return {
    delayMs: readNonNegativeInt(value.delayMs, 'mock.delayMs'),
    failAtChunk: readPositiveInt(value.failAtChunk, 'mock.failAtChunk'),
  }
}

export const parseMessageId = (value: unknown) => {
  const messageId = readString(value)

  if (!messageId) {
    throw badRequest('message id is required')
  }

  return messageId
}

export const parseCreateChatInput = (body: unknown): CreateChatInput => {
  if (!isRecord(body)) {
    throw badRequest('request body must be an object')
  }

  const conversationId = readString(body.conversationId)
  const content = readString(body.content)

  if (!conversationId) {
    throw badRequest('conversationId is required')
  }

  if (!content) {
    throw badRequest('content is required')
  }

  return {
    content,
    conversationId,
    mock: parseMockOptions(body.mock),
    mode: readString(body.mode),
    profileId: readString(body.profileId),
  }
}

export const parseAbortChatInput = (messageIdValue: unknown, body: unknown): AbortChatInput => {
  if (!isRecord(body)) {
    throw badRequest('request body must be an object')
  }

  if (typeof body.content !== 'string') {
    throw badRequest('content is required')
  }

  return {
    content: body.content,
    messageId: parseMessageId(messageIdValue),
  }
}

export const parseRetryChatInput = (messageIdValue: unknown, body: unknown): RetryChatInput => {
  if (body !== undefined && body !== null && !isRecord(body)) {
    throw badRequest('request body must be an object')
  }

  return {
    messageId: parseMessageId(messageIdValue),
    mock: parseMockOptions(isRecord(body) ? body.mock : undefined),
  }
}
