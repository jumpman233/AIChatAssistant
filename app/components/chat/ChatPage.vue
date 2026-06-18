<script setup lang="ts">
import { storeToRefs } from 'pinia'

const conversationStore = useConversationStore()
const profileStore = useProfileStore()

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

  return 'V1 仅支持会话创建、切换、删除和历史消息读取。发送将在 V2 支持。'
})

onMounted(async () => {
  await profileStore.loadProfiles()
  await conversationStore.initializeConversations()
})
</script>

<template>
  <main class="chat-page">
    <ConversationSidebar
      :active-conversation-id="activeConversationId"
      :conversations="conversations"
      :error="error"
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
        :reason="inputReason"
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
