import { getQuery, getRouterParam } from 'h3'
import { messageService } from '../../../services/messageService'
import { defineApiHandler } from '../../../utils/apiHandler'
import { parseConversationId, parseListMessagesInput } from '../../../validators/conversation'

export default defineApiHandler((event) => {
  const conversationId = parseConversationId(getRouterParam(event, 'id'))
  const input = parseListMessagesInput(getQuery(event))

  return messageService.listConversationMessages({
    ...input,
    conversationId,
  })
})
