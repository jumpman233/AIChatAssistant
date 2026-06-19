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

  updateAssistantMessageDone(params: CompleteAssistantMessageParams) {
    return prisma.message.update({
      data: {
        content: params.content,
        errorMessage: null,
        status: 'done',
      },
      include: includeToolCalls,
      where: {
        id: params.messageId,
      },
    })
  },

  updateAssistantMessageFailed(params: FailAssistantMessageParams) {
    return prisma.message.update({
      data: {
        content: params.content,
        errorMessage: params.errorMessage,
        status: 'failed',
      },
      include: includeToolCalls,
      where: {
        id: params.messageId,
      },
    })
  },
}
