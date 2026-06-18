import type { ConversationStatus, Prisma } from '@prisma/client'
import { prisma } from '../utils/prisma'

const activeAssistantMessageInclude = {
  messages: {
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
    },
    take: 1,
    where: {
      role: 'assistant',
      status: {
        in: ['pending', 'streaming'],
      },
    },
  },
} satisfies Prisma.ConversationInclude

export type CreateConversationData = {
  profileId: string
  mode: string
  title: string | null
}

export type ListConversationsParams = {
  status?: ConversationStatus
  profileId?: string
  limit: number
  cursor?: string
}

export const conversationRepository = {
  create(data: CreateConversationData) {
    return prisma.conversation.create({
      data,
      include: activeAssistantMessageInclude,
    })
  },

  findById(id: string) {
    return prisma.conversation.findUnique({
      include: activeAssistantMessageInclude,
      where: {
        id,
      },
    })
  },

  async list(params: ListConversationsParams) {
    const where: Prisma.ConversationWhereInput = {
      profileId: params.profileId,
      status: params.status ?? {
        not: 'deleted',
      },
    }

    const items = await prisma.conversation.findMany({
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: activeAssistantMessageInclude,
      orderBy: [
        {
          updatedAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      skip: params.cursor ? 1 : 0,
      take: params.limit + 1,
      where,
    })

    return {
      items: items.slice(0, params.limit),
      nextCursor: items.length > params.limit ? items[params.limit]?.id ?? null : null,
    }
  },

  softDelete(id: string) {
    return prisma.conversation.update({
      data: {
        status: 'deleted',
      },
      where: {
        id,
      },
    })
  },
}
