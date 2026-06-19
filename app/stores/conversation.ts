import { defineStore } from 'pinia'
import type { ConversationDTO, MessageDTO } from '~/types/chat'

type ListConversationsResponse = {
  items: ConversationDTO[]
  nextCursor: string | null
}

type ListMessagesResponse = {
  items: MessageDTO[]
  pageInfo: {
    limit: number
    hasMoreBefore: boolean
    hasMoreAfter: boolean
    beforeSeq: number | null
    afterSeq: number | null
  }
}

export const useConversationStore = defineStore('conversation', () => {
  const activeConversationId = ref<string | null>(null)
  const conversations = ref<ConversationDTO[]>([])
  const error = ref<string | null>(null)
  const messagesByConversationId = ref<Record<string, MessageDTO[]>>({})
  const messagesPending = ref(false)
  const pending = ref(false)

  const activeConversation = computed(() => {
    return (
      conversations.value.find((conversation) => conversation.id === activeConversationId.value) ??
      null
    )
  })

  const activeMessages = computed(() => {
    return activeConversationId.value
      ? (messagesByConversationId.value[activeConversationId.value] ?? [])
      : []
  })

  const getConversation = (conversationId: string) => {
    return conversations.value.find((conversation) => conversation.id === conversationId) ?? null
  }

  const isConversationStreaming = (conversationId: string) => {
    return Boolean(getConversation(conversationId)?.isStreaming)
  }

  const setMessages = (conversationId: string, messages: MessageDTO[]) => {
    messagesByConversationId.value = {
      ...messagesByConversationId.value,
      [conversationId]: [...messages].sort((a, b) => a.seq - b.seq),
    }
  }

  const appendMessage = (conversationId: string, message: MessageDTO) => {
    const currentMessages = messagesByConversationId.value[conversationId] ?? []
    const nextMessages = [
      ...currentMessages.filter((item) => item.id !== message.id),
      message,
    ].sort((a, b) => a.seq - b.seq)

    messagesByConversationId.value = {
      ...messagesByConversationId.value,
      [conversationId]: nextMessages,
    }
  }

  const replaceMessage = (conversationId: string, message: MessageDTO) => {
    const currentMessages = messagesByConversationId.value[conversationId] ?? []
    const exists = currentMessages.some((item) => item.id === message.id)
    const nextMessages = exists
      ? currentMessages.map((item) => (item.id === message.id ? message : item))
      : [...currentMessages, message]

    messagesByConversationId.value = {
      ...messagesByConversationId.value,
      [conversationId]: nextMessages.sort((a, b) => a.seq - b.seq),
    }
  }

  const appendMessageDelta = (conversationId: string, messageId: string, delta: string) => {
    const currentMessages = messagesByConversationId.value[conversationId] ?? []

    messagesByConversationId.value = {
      ...messagesByConversationId.value,
      [conversationId]: currentMessages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: message.content + delta,
            }
          : message,
      ),
    }
  }

  const setConversationStreaming = (
    conversationId: string,
    isStreaming: boolean,
    activeAssistantMessageId: string | null,
  ) => {
    conversations.value = conversations.value.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            activeAssistantMessageId,
            isStreaming,
          }
        : conversation,
    )
  }

  const loadConversations = async () => {
    pending.value = true
    error.value = null

    try {
      const response = await $fetch<ListConversationsResponse>('/api/conversations')
      conversations.value = response.items.filter(
        (conversation) => conversation.status !== 'deleted',
      )
      return conversations.value
    } catch {
      error.value = '会话列表加载失败'
      return []
    } finally {
      pending.value = false
    }
  }

  const loadMessages = async (conversationId: string) => {
    messagesPending.value = true
    error.value = null

    try {
      const response = await $fetch<ListMessagesResponse>(
        `/api/conversations/${conversationId}/messages`,
        {
          query: {
            limit: 50,
          },
        },
      )
      setMessages(conversationId, response.items)
      return messagesByConversationId.value[conversationId] ?? []
    } catch {
      error.value = '消息加载失败'
      return []
    } finally {
      messagesPending.value = false
    }
  }

  const selectConversation = async (conversationId: string) => {
    activeConversationId.value = conversationId
    await loadMessages(conversationId)
  }

  const createConversation = async (profileId: string) => {
    pending.value = true
    error.value = null

    try {
      const conversation = await $fetch<ConversationDTO>('/api/conversations', {
        body: {
          profileId,
        },
        method: 'POST',
      })

      conversations.value = [
        conversation,
        ...conversations.value.filter((item) => item.id !== conversation.id),
      ]
      await selectConversation(conversation.id)
      return conversation
    } catch {
      error.value = '会话创建失败'
      return null
    } finally {
      pending.value = false
    }
  }

  const deleteConversation = async (conversationId: string) => {
    pending.value = true
    error.value = null

    try {
      await $fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
      })

      conversations.value = conversations.value.filter(
        (conversation) => conversation.id !== conversationId,
      )
      const { [conversationId]: _deletedMessages, ...remainingMessages } =
        messagesByConversationId.value
      messagesByConversationId.value = remainingMessages

      if (activeConversationId.value === conversationId) {
        const nextConversation = conversations.value[0] ?? null
        activeConversationId.value = nextConversation?.id ?? null

        if (nextConversation) {
          await loadMessages(nextConversation.id)
        }
      }
    } catch {
      error.value = '会话删除失败'
    } finally {
      pending.value = false
    }
  }

  const initializeConversations = async () => {
    const items = await loadConversations()
    const initialConversation = activeConversation.value ?? items[0] ?? null

    if (initialConversation) {
      await selectConversation(initialConversation.id)
    }
  }

  return {
    activeConversation,
    activeConversationId,
    activeMessages,
    appendMessage,
    appendMessageDelta,
    conversations,
    createConversation,
    deleteConversation,
    error,
    getConversation,
    initializeConversations,
    isConversationStreaming,
    loadConversations,
    loadMessages,
    messagesByConversationId,
    messagesPending,
    pending,
    replaceMessage,
    selectConversation,
    setConversationStreaming,
    setMessages,
  }
})
