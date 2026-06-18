import { getQuery } from 'h3'
import { conversationService } from '../../services/conversationService'
import { defineApiHandler } from '../../utils/apiHandler'
import { parseListConversationsInput } from '../../validators/conversation'

export default defineApiHandler((event) => {
  const input = parseListConversationsInput(getQuery(event))

  return conversationService.listConversations(input)
})
