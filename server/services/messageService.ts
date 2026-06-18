import { toMessageDTO } from '../mappers/chatMappers'
import { conversationRepository } from '../repositories/conversationRepository'
import {
  messageRepository,
  type ListMessagesParams,
} from '../repositories/messageRepository'
import { notFound } from '../utils/apiError'

export const messageService = {
  async listConversationMessages(input: ListMessagesParams) {
    const conversation = await conversationRepository.findById(input.conversationId)

    if (!conversation || conversation.status === 'deleted') {
      throw notFound('Conversation not found')
    }

    const result = await messageRepository.listByConversation(input)
    const items = result.items.map(toMessageDTO)

    return {
      items,
      pageInfo: {
        afterSeq: items.at(-1)?.seq ?? null,
        beforeSeq: items[0]?.seq ?? null,
        hasMoreAfter: result.hasMoreAfter,
        hasMoreBefore: result.hasMoreBefore,
        limit: input.limit,
      },
    }
  },
}
