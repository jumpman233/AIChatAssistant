import type { MessageDTO } from '~/types/chat'

export const useChatStream = () => {
  const { activeConversationId, activeState, addLocalMessage, createLocalConversation } =
    useConversation()
  const { currentProfileId } = useProfiles()

  const sendLocalMessage = (content: string) => {
    const normalizedContent = content.trim()

    if (!normalizedContent) {
      return
    }

    const conversation =
      activeConversationId.value === null
        ? createLocalConversation(currentProfileId.value)
        : null
    const conversationId = activeConversationId.value ?? conversation?.id

    if (!conversationId) {
      return
    }

    const state = activeState.value
    const now = new Date().toISOString()
    const nextSeq = (state?.messages.at(-1)?.seq ?? 0) + 1
    const userMessage: MessageDTO = {
      content: normalizedContent,
      conversationId,
      createdAt: now,
      errorMessage: null,
      id: `local-message-${crypto.randomUUID()}`,
      mode: 'chat',
      model: null,
      parentMessageId: null,
      profileId: currentProfileId.value,
      role: 'user',
      seq: nextSeq,
      status: 'done',
      updatedAt: now,
    }
    const assistantMessage: MessageDTO = {
      content: '基础项目骨架已经就绪。下一步可以接入 /api/chat 的 mock stream 主链路。',
      conversationId,
      createdAt: now,
      errorMessage: null,
      id: `local-message-${crypto.randomUUID()}`,
      mode: 'chat',
      model: 'local-placeholder',
      parentMessageId: userMessage.id,
      profileId: currentProfileId.value,
      role: 'assistant',
      seq: nextSeq + 1,
      status: 'done',
      updatedAt: now,
    }

    addLocalMessage(conversationId, userMessage)
    addLocalMessage(conversationId, assistantMessage)
  }

  return {
    sendLocalMessage,
  }
}
