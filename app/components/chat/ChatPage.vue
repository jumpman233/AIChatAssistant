<script setup lang="ts">
import { storeToRefs } from 'pinia'

const conversationStore = useConversationStore()
const profileStore = useProfileStore()
const chatRuntimeStore = useChatRuntimeStore()
const { sendMessage } = useChatStream()

const { currentProfile, currentProfileId } = storeToRefs(profileStore)
const {
  activeConversation,
  activeConversationId,
  activeMessages,
  conversations,
  error,
  messagesPending,
  pending,
} = storeToRefs(conversationStore)

const activeRuntime = computed(() => {
  return activeConversationId.value ? chatRuntimeStore.getRuntimeState(activeConversationId.value) : null
})

const isConversationGenerating = (conversationId: string) => {
  return (
    chatRuntimeStore.isConversationStreaming(conversationId) ||
    conversationStore.isConversationStreaming(conversationId)
  )
}

const generatingConversationIds = computed(() => {
  return conversations.value
    .filter((conversation) => isConversationGenerating(conversation.id))
    .map((conversation) => conversation.id)
})

const isActiveConversationStreaming = computed(() => {
  if (!activeConversationId.value) {
    return false
  }

  return isConversationGenerating(activeConversationId.value)
})

const createConversation = async () => {
  await conversationStore.createConversation(currentProfileId.value)
}

const confirmAndDeleteConversation = async (conversationId: string) => {
  if (!window.confirm('确认删除这个会话吗？消息会保留在数据库中，会话将从列表隐藏。')) {
    return
  }

  await conversationStore.deleteConversation(conversationId)
}

const deleteActiveConversation = async () => {
  if (!activeConversationId.value) {
    return
  }

  await confirmAndDeleteConversation(activeConversationId.value)
}

const selectConversation = async (conversationId: string) => {
  if (conversationId === activeConversationId.value) {
    return
  }

  await conversationStore.selectConversation(conversationId)
}

const inputReason = computed(() => {
  if (!activeConversation.value) {
    return '请先新建或选择一个会话。'
  }

  if (activeRuntime.value?.error) {
    return activeRuntime.value.error
  }

  if (isActiveConversationStreaming.value) {
    return '当前会话正在生成中，完成后可继续发送。'
  }

  return null
})

const handleSendMessage = async (content: string) => {
  if (!activeConversation.value) {
    return
  }

  await sendMessage({
    content,
    conversationId: activeConversation.value.id,
    mode: activeConversation.value.mode,
    profileId: activeConversation.value.profileId,
  })
}

onMounted(async () => {
  await profileStore.loadProfiles()
  await conversationStore.initializeConversations()
})

onBeforeUnmount(() => {
  chatRuntimeStore.clearAllRuntimeStates()
})
</script>

<template>
  <main class="chat-page">
    <ConversationSidebar
      :active-conversation-id="activeConversationId"
      :conversations="conversations"
      :error="error"
      :generating-conversation-ids="generatingConversationIds"
      :pending="pending"
      @create="createConversation"
      @delete="confirmAndDeleteConversation"
      @select="selectConversation"
    />

    <section class="chat-workspace" aria-label="聊天工作区">
      <ChatHeader
        :active-conversation="activeConversation"
        :current-profile="currentProfile"
        :pending="pending"
        @delete-active="deleteActiveConversation"
      />

      <MessageList
        :has-active-conversation="Boolean(activeConversation)"
        :loading="messagesPending"
        :messages="activeMessages"
        @create-conversation="createConversation"
      />

      <MessageInput
        :disabled="!activeConversation"
        :pending="pending"
        :reason="inputReason"
        :streaming="isActiveConversationStreaming"
        @send="handleSendMessage"
      />
    </section>
  </main>
</template>

<style scoped>
.chat-page {
  display: grid;
  grid-template-columns: minmax(260px, 312px) minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg);
}

.chat-workspace {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
}

@media (max-width: 860px) {
  .chat-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
}
</style>
