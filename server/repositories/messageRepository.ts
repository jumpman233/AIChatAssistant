import type { ConversationStatus, Prisma } from '@prisma/client'
import { prisma } from '../utils/prisma'

export type ListMessagesParams = {
  conversationId: string
  limit: number
  beforeSeq?: number
  afterSeq?: number
}

export type CreateChatMessagesParams = {
  conversationId: string
  content: string
  profileId: string
  mode: string
}

export type CompleteAssistantMessageParams = {
  content: string
  messageId: string
}

export type FailAssistantMessageParams = {
  content: string
  errorMessage: string
  messageId: string
}

export type AbortAssistantMessageParams = {
  content: string
  messageId: string
}

export type RetryAssistantMessageParams = {
  sourceAssistantMessageId: string
}

type TerminalTransitionStatus = 'aborted' | 'done' | 'failed'

export type AssistantTerminalTransitionResult =
  | {
      outcome: 'updated'
      message: Prisma.MessageGetPayload<{ include: typeof includeToolCalls }>
    }
  | {
      existingStatus?: TerminalTransitionStatus
      message?: Prisma.MessageGetPayload<{ include: typeof includeToolCalls }>
      outcome: 'already_terminal' | 'not_assistant' | 'not_found'
    }

export type RetryAssistantResult = {
  assistantMessage: Prisma.MessageGetPayload<{ include: typeof includeToolCalls }>
  parentUserMessage: Prisma.MessageGetPayload<{ include: typeof includeToolCalls }>
  sourceAssistantMessage: Prisma.MessageGetPayload<{ include: typeof includeToolCalls }>
}

type LockedConversationRow = {
  id: string
  status: ConversationStatus
}

export class ChatMessagesConversationNotFoundError extends Error {
  constructor() {
    super('Conversation not found')
    this.name = 'ChatMessagesConversationNotFoundError'
  }
}

export class ChatMessagesConversationDeletedError extends Error {
  constructor() {
    super('Conversation is deleted')
    this.name = 'ChatMessagesConversationDeletedError'
  }
}

export class ActiveChatStreamError extends Error {
  activeAssistantMessageId: string

  constructor(activeAssistantMessageId: string) {
    super('Current conversation already has an active streaming message')
    this.name = 'ActiveChatStreamError'
    this.activeAssistantMessageId = activeAssistantMessageId
  }
}

export class RetrySourceMessageNotFoundError extends Error {
  constructor() {
    super('Message not found')
    this.name = 'RetrySourceMessageNotFoundError'
  }
}

export class MessageNotRetryableError extends Error {
  constructor() {
    super('Message is not retryable')
    this.name = 'MessageNotRetryableError'
  }
}

export class RetryParentUserMessageNotFoundError extends Error {
  constructor() {
    super('Parent user message not found')
    this.name = 'RetryParentUserMessageNotFoundError'
  }
}

const includeToolCalls = {
  toolCalls: {
    orderBy: {
      createdAt: 'asc',
    },
  },
} satisfies Prisma.MessageInclude

const hasMessage = (where: Prisma.MessageWhereInput) => {
  return prisma.message.findFirst({
    select: {
      id: true,
    },
    where,
  })
}

const toTerminalTransitionResult = async (
  messageId: string,
  updatedCount: number,
): Promise<AssistantTerminalTransitionResult> => {
  if (updatedCount > 0) {
    const message = await prisma.message.findUniqueOrThrow({
      include: includeToolCalls,
      where: {
        id: messageId,
      },
    })

    return {
      message,
      outcome: 'updated',
    }
  }

  const message = await prisma.message.findUnique({
    include: includeToolCalls,
    where: {
      id: messageId,
    },
  })

  if (!message) {
    return {
      outcome: 'not_found',
    }
  }

  if (message.role !== 'assistant') {
    return {
      message,
      outcome: 'not_assistant',
    }
  }

  return {
    existingStatus: ['aborted', 'done', 'failed'].includes(message.status)
      ? (message.status as TerminalTransitionStatus)
      : undefined,
    message,
    outcome: 'already_terminal',
  }
}

export const messageRepository = {
  async createChatMessagesWithActiveGuard(params: CreateChatMessagesParams) {
    return prisma.$transaction(async (tx) => {
      const lockedConversations = await tx.$queryRaw<LockedConversationRow[]>`
        SELECT "id", "status"
        FROM "Conversation"
        WHERE "id" = ${params.conversationId}
        FOR UPDATE
      `
      const lockedConversation = lockedConversations[0]

      if (!lockedConversation) {
        throw new ChatMessagesConversationNotFoundError()
      }

      if (lockedConversation.status === 'deleted') {
        throw new ChatMessagesConversationDeletedError()
      }

      const activeAssistantMessage = await tx.message.findFirst({
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
        },
        where: {
          conversationId: params.conversationId,
          role: 'assistant',
          status: {
            in: ['pending', 'streaming'],
          },
        },
      })

      if (activeAssistantMessage) {
        throw new ActiveChatStreamError(activeAssistantMessage.id)
      }

      const lastMessage = await tx.message.findFirst({
        orderBy: {
          seq: 'desc',
        },
        select: {
          seq: true,
        },
        where: {
          conversationId: params.conversationId,
        },
      })
      const userSeq = (lastMessage?.seq ?? 0) + 1
      const assistantSeq = userSeq + 1

      const userMessage = await tx.message.create({
        data: {
          content: params.content,
          conversationId: params.conversationId,
          mode: params.mode,
          profileId: params.profileId,
          role: 'user',
          seq: userSeq,
          status: 'done',
        },
        include: includeToolCalls,
      })
      const assistantMessage = await tx.message.create({
        data: {
          content: '',
          conversationId: params.conversationId,
          mode: params.mode,
          parentMessageId: userMessage.id,
          profileId: params.profileId,
          role: 'assistant',
          seq: assistantSeq,
          status: 'streaming',
        },
        include: includeToolCalls,
      })

      await tx.conversation.update({
        data: {
          updatedAt: new Date(),
        },
        where: {
          id: params.conversationId,
        },
      })

      return {
        assistantMessage,
        userMessage,
      }
    })
  },

  async listByConversation(params: ListMessagesParams) {
    const where: Prisma.MessageWhereInput = {
      conversationId: params.conversationId,
      seq: params.beforeSeq
        ? {
            lt: params.beforeSeq,
          }
        : params.afterSeq
          ? {
              gt: params.afterSeq,
            }
          : undefined,
    }

    const shouldReadNewestFirst = params.beforeSeq !== undefined || params.afterSeq === undefined

    const orderBy: Prisma.MessageOrderByWithRelationInput[] = shouldReadNewestFirst
      ? [
          {
            seq: 'desc',
          },
        ]
      : [
          {
            seq: 'asc',
          },
        ]

    const rawItems = await prisma.message.findMany({
      include: includeToolCalls,
      orderBy,
      take: params.limit + 1,
      where,
    })

    const limitedItems = rawItems.slice(0, params.limit)
    const items = shouldReadNewestFirst ? limitedItems.toReversed() : limitedItems
    const firstSeq = items[0]?.seq ?? null
    const lastSeq = items.at(-1)?.seq ?? null

    const [hasMoreBeforeResult, hasMoreAfterResult] = await Promise.all([
      firstSeq === null
        ? null
        : hasMessage({
            conversationId: params.conversationId,
            seq: {
              lt: firstSeq,
            },
          }),
      lastSeq === null
        ? null
        : hasMessage({
            conversationId: params.conversationId,
            seq: {
              gt: lastSeq,
            },
          }),
    ])

    return {
      hasMoreAfter: hasMoreAfterResult !== null,
      hasMoreBefore: rawItems.length > params.limit || hasMoreBeforeResult !== null,
      items,
    }
  },

  listForConversationHistory(conversationId: string) {
    return prisma.message.findMany({
      orderBy: {
        seq: 'asc',
      },
      select: {
        content: true,
        role: true,
        seq: true,
        status: true,
      },
      where: {
        conversationId,
        role: {
          in: ['user', 'assistant'],
        },
      },
    })
  },

  async completeAssistantIfActive(params: CompleteAssistantMessageParams) {
    const result = await prisma.message.updateMany({
      data: {
        content: params.content,
        errorMessage: null,
        status: 'done',
      },
      where: {
        id: params.messageId,
        role: 'assistant',
        status: {
          in: ['pending', 'streaming'],
        },
      },
    })

    return toTerminalTransitionResult(params.messageId, result.count)
  },

  async failAssistantIfActive(params: FailAssistantMessageParams) {
    const result = await prisma.message.updateMany({
      data: {
        content: params.content,
        errorMessage: params.errorMessage,
        status: 'failed',
      },
      where: {
        id: params.messageId,
        role: 'assistant',
        status: {
          in: ['pending', 'streaming'],
        },
      },
    })

    return toTerminalTransitionResult(params.messageId, result.count)
  },

  async abortAssistantIfActive(params: AbortAssistantMessageParams) {
    const result = await prisma.message.updateMany({
      data: {
        content: params.content,
        status: 'aborted',
      },
      where: {
        id: params.messageId,
        role: 'assistant',
        status: {
          in: ['pending', 'streaming'],
        },
      },
    })

    return toTerminalTransitionResult(params.messageId, result.count)
  },

  findById(messageId: string) {
    return prisma.message.findUnique({
      include: includeToolCalls,
      where: {
        id: messageId,
      },
    })
  },

  findActiveAssistantById(messageId: string) {
    return prisma.message.findFirst({
      include: includeToolCalls,
      where: {
        id: messageId,
        role: 'assistant',
        status: {
          in: ['pending', 'streaming'],
        },
      },
    })
  },

  async createRetryAssistantWithActiveGuard(
    params: RetryAssistantMessageParams,
  ): Promise<RetryAssistantResult> {
    return prisma.$transaction(async (tx) => {
      const sourceAssistantMessage = await tx.message.findUnique({
        include: includeToolCalls,
        where: {
          id: params.sourceAssistantMessageId,
        },
      })

      if (!sourceAssistantMessage) {
        throw new RetrySourceMessageNotFoundError()
      }

      const lockedConversations = await tx.$queryRaw<LockedConversationRow[]>`
        SELECT "id", "status"
        FROM "Conversation"
        WHERE "id" = ${sourceAssistantMessage.conversationId}
        FOR UPDATE
      `
      const lockedConversation = lockedConversations[0]

      if (!lockedConversation) {
        throw new ChatMessagesConversationNotFoundError()
      }

      if (lockedConversation.status === 'deleted') {
        throw new ChatMessagesConversationDeletedError()
      }

      if (
        sourceAssistantMessage.role !== 'assistant' ||
        !['aborted', 'failed'].includes(sourceAssistantMessage.status)
      ) {
        throw new MessageNotRetryableError()
      }

      if (!sourceAssistantMessage.parentMessageId) {
        throw new MessageNotRetryableError()
      }

      const parentUserMessage = await tx.message.findFirst({
        include: includeToolCalls,
        where: {
          conversationId: sourceAssistantMessage.conversationId,
          id: sourceAssistantMessage.parentMessageId,
          role: 'user',
          status: 'done',
        },
      })

      if (!parentUserMessage) {
        throw new RetryParentUserMessageNotFoundError()
      }

      const activeAssistantMessage = await tx.message.findFirst({
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
        },
        where: {
          conversationId: sourceAssistantMessage.conversationId,
          role: 'assistant',
          status: {
            in: ['pending', 'streaming'],
          },
        },
      })

      if (activeAssistantMessage) {
        throw new ActiveChatStreamError(activeAssistantMessage.id)
      }

      const lastMessage = await tx.message.findFirst({
        orderBy: {
          seq: 'desc',
        },
        select: {
          seq: true,
        },
        where: {
          conversationId: sourceAssistantMessage.conversationId,
        },
      })
      const assistantSeq = (lastMessage?.seq ?? 0) + 1

      const assistantMessage = await tx.message.create({
        data: {
          content: '',
          conversationId: sourceAssistantMessage.conversationId,
          mode: sourceAssistantMessage.mode,
          parentMessageId: parentUserMessage.id,
          profileId: sourceAssistantMessage.profileId,
          role: 'assistant',
          seq: assistantSeq,
          status: 'streaming',
        },
        include: includeToolCalls,
      })

      await tx.conversation.update({
        data: {
          updatedAt: new Date(),
        },
        where: {
          id: sourceAssistantMessage.conversationId,
        },
      })

      return {
        assistantMessage,
        parentUserMessage,
        sourceAssistantMessage,
      }
    })
  },
}
