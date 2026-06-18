import { badRequest } from '../utils/apiError'

export type ConversationStatusInput = 'active' | 'archived' | 'deleted'

export type CreateConversationInput = {
  profileId: string
  mode: string
  title: string | null
}

export type ListConversationsInput = {
  status?: ConversationStatusInput
  profileId?: string
  limit: number
  cursor?: string
}

export type ListMessagesInput = {
  limit: number
  beforeSeq?: number
  afterSeq?: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

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

const readSingleQueryValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

const readPositiveInt = (value: unknown, fieldName: string) => {
  const rawValue = readSingleQueryValue(value)

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined
  }

  const parsed = Number(rawValue)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badRequest(`${fieldName} must be a positive integer`)
  }

  return parsed
}

const readLimit = (value: unknown) => {
  const parsed = readPositiveInt(value, 'limit') ?? DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

export const parseCreateConversationInput = (body: unknown): CreateConversationInput => {
  const input = isRecord(body) ? body : {}
  const title = input.title

  if (title !== undefined && title !== null && typeof title !== 'string') {
    throw badRequest('title must be a string or null')
  }

  return {
    mode: readString(input.mode) ?? 'chat',
    profileId: readString(input.profileId) ?? 'general',
    title: title === undefined ? null : title,
  }
}

export const parseListConversationsInput = (query: Record<string, unknown>) => {
  const status = readSingleQueryValue(query.status)
  const normalizedStatus = readString(status)

  if (
    normalizedStatus !== undefined &&
    normalizedStatus !== 'active' &&
    normalizedStatus !== 'archived' &&
    normalizedStatus !== 'deleted'
  ) {
    throw badRequest('status must be active, archived, or deleted')
  }

  return {
    cursor: readString(readSingleQueryValue(query.cursor)),
    limit: readLimit(query.limit),
    profileId: readString(readSingleQueryValue(query.profileId)),
    status: normalizedStatus,
  } satisfies ListConversationsInput
}

export const parseConversationId = (value: unknown) => {
  const conversationId = readString(readSingleQueryValue(value))

  if (!conversationId) {
    throw badRequest('conversation id is required')
  }

  return conversationId
}

export const parseListMessagesInput = (query: Record<string, unknown>) => {
  return {
    afterSeq: readPositiveInt(query.afterSeq, 'afterSeq'),
    beforeSeq: readPositiveInt(query.beforeSeq, 'beforeSeq'),
    limit: readLimit(query.limit),
  } satisfies ListMessagesInput
}
