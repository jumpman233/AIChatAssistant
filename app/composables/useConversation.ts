import type { ConversationDTO, ConversationRuntimeState, MessageDTO } from '~/types/chat'

const createRuntimeState = (conversationId: string): ConversationRuntimeState => ({
  abortController: null,
  conversationId,
  error: null,
  isStreaming: false,
  messages: [],
  streamingMessageId: null,
})

export const useConversation = () => {
  const activeConversationId = useState<string | null>('activeConversationId', () => null)
  const conversations = useState<ConversationDTO[]>('conversations', () => [])
  const conversationStates = useState<Record<string, ConversationRuntimeState>>(
    'conversationStates',
    () => ({}),
  )

  const ensureConversationState = (conversationId: string) => {
    conversationStates.value[conversationId] ??= createRuntimeState(conversationId)
    return conversationStates.value[conversationId]
  }

  const createLocalConversation = (profileId: string) => {
    const now = new Date().toISOString()
    const conversation: ConversationDTO = {
      activeAssistantMessageId: null,
      createdAt: now,
      id: `local-${crypto.randomUUID()}`,
      isStreaming: false,
      mode: 'chat',
      profileId,
      status: 'active',
      title: null,
      updatedAt: now,
    }

    conversations.value = [conversation, ...conversations.value]
    activeConversationId.value = conversation.id
    ensureConversationState(conversation.id)

    return conversation
  }

  const addLocalMessage = (conversationId: string, message: MessageDTO) => {
    const state = ensureConversationState(conversationId)
    state.messages = [...state.messages, message]
  }

  const activeState = computed(() => {
    return activeConversationId.value ? ensureConversationState(activeConversationId.value) : null
  })

  return {
    activeConversationId,
    activeState,
    addLocalMessage,
    conversations,
    conversationStates,
    createLocalConversation,
    ensureConversationState,
  }
}
