import { readBody } from 'h3'
import { conversationService } from '../../services/conversationService'
import { defineApiHandler } from '../../utils/apiHandler'
import { parseCreateConversationInput } from '../../validators/conversation'

export default defineApiHandler(async (event) => {
  const body = await readBody(event)
  const input = parseCreateConversationInput(body)

  return conversationService.createConversation(input)
})
