import { prisma } from '../utils/prisma'

export const toolCallRepository = {
  listByMessageId(messageId: string) {
    return prisma.toolCall.findMany({
      orderBy: {
        createdAt: 'asc',
      },
      where: {
        messageId,
      },
    })
  },
}
