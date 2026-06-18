import { getRouterParam } from 'h3'
import { conversationService } from '../../services/conversationService'
import { defineApiHandler } from '../../utils/apiHandler'
import { parseConversationId } from '../../validators/conversation'

export default defineApiHandler((event) => {
  const conversationId = parseConversationId(getRouterParam(event, 'id'))

  return conversationService.getConversation(conversationId)
})
