import type { PrismaClient } from '@prisma/client'
import { assert, assertEqual } from './assert'

export const assertConversationSoftDeleted = async (prisma: PrismaClient, conversationId: string) => {
  const conversation = await prisma.conversation.findUnique({
    where: {
      id: conversationId,
    },
  })

  assert(conversation, 'Expected deleted conversation to remain in database')
  assertEqual(conversation.status, 'deleted', 'Expected conversation status to be deleted')
}
