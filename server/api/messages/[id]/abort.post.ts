import { getRouterParam, readBody } from 'h3'
import { chatService } from '../../../services/chat/chatService'
import { defineApiHandler } from '../../../utils/apiHandler'
import { parseAbortChatInput } from '../../../validators/chat'

export default defineApiHandler(async (event) => {
  const body = await readBody(event)
  const input = parseAbortChatInput(getRouterParam(event, 'id'), body)

  return chatService.abortAssistantMessage(input)
})
