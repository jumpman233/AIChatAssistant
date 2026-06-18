import { getProfileById } from '../profiles'
import { toConversationDTO } from '../mappers/chatMappers'
import {
  conversationRepository,
  type CreateConversationData,
  type ListConversationsParams,
} from '../repositories/conversationRepository'
import { badRequest, notFound } from '../utils/apiError'

const assertProfileExists = (profileId: string) => {
  if (!getProfileById(profileId)) {
    throw badRequest('Invalid profileId')
  }
}

export const conversationService = {
  async createConversation(input: CreateConversationData) {
    assertProfileExists(input.profileId)

    const conversation = await conversationRepository.create(input)
    return toConversationDTO(conversation)
  },

  async deleteConversation(conversationId: string) {
    const conversation = await conversationRepository.findById(conversationId)

    if (!conversation || conversation.status === 'deleted') {
      throw notFound('Conversation not found')
    }

    const deletedConversation = await conversationRepository.softDelete(conversationId)

    return {
      id: deletedConversation.id,
      status: deletedConversation.status,
    }
  },

  async getConversation(conversationId: string) {
    const conversation = await conversationRepository.findById(conversationId)

    if (!conversation || conversation.status === 'deleted') {
      throw notFound('Conversation not found')
    }

    return toConversationDTO(conversation)
  },

  async listConversations(input: ListConversationsParams) {
    const result = await conversationRepository.list(input)

    return {
      items: result.items.map(toConversationDTO),
      nextCursor: result.nextCursor,
    }
  },
}
