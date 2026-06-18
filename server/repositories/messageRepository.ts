import type { Prisma } from '@prisma/client'
import { prisma } from '../utils/prisma'

export type ListMessagesParams = {
  conversationId: string
  limit: number
  beforeSeq?: number
  afterSeq?: number
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

    const orderBy: Prisma.MessageOrderByWithRelationInput[] = params.beforeSeq
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
    const items = params.beforeSeq ? limitedItems.toReversed() : limitedItems
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
}
