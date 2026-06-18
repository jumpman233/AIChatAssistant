import { readBody, setResponseHeader } from 'h3'
import { chatService } from '../services/chat/chatService'
import { defineApiHandler } from '../utils/apiHandler'
import { parseCreateChatInput } from '../validators/chat'

export default defineApiHandler(async (event) => {
  const body = await readBody(event)
  const input = parseCreateChatInput(body)
  const stream = await chatService.createChatStream(input)

  setResponseHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')
  setResponseHeader(event, 'X-Accel-Buffering', 'no')

  return stream
})
