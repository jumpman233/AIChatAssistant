<script setup lang="ts">
import { storeToRefs } from 'pinia'

const conversationStore = useConversationStore()
const profileStore = useProfileStore()

const { currentProfileId } = storeToRefs(profileStore)
const { activeConversationId, activeMessages, conversations, error, pending } =
  storeToRefs(conversationStore)

const createConversation = async () => {
  await conversationStore.createConversation(currentProfileId.value)
}

const deleteConversation = async (conversationId: string) => {
  await conversationStore.deleteConversation(conversationId)
}

const selectConversation = async (conversationId: string) => {
  await conversationStore.selectConversation(conversationId)
}

onMounted(async () => {
  await profileStore.loadProfiles()
  await conversationStore.initializeConversations()
})
</script>

<template>
  <main class="chat-page">
    <ChatHeader>
      <ProfileSwitcher />
    </ChatHeader>

    <section class="chat-shell" aria-label="聊天工作区">
      <aside class="conversation-list" aria-label="会话列表">
        <div class="conversation-list__header">
          <div class="conversation-list__title">会话</div>
          <button :disabled="pending" class="new-conversation" type="button" @click="createConversation">
            新建
          </button>
        </div>

        <p v-if="error" class="conversation-list__error">{{ error }}</p>
        <p v-if="conversations.length === 0 && !pending" class="conversation-list__empty">
          暂无会话
        </p>

        <div
          v-for="conversation in conversations"
          :key="conversation.id"
          class="conversation-item"
          :class="{ 'conversation-item--active': conversation.id === activeConversationId }"
        >
          <button class="conversation-item__main" type="button" @click="selectConversation(conversation.id)">
            <span>{{ conversation.title ?? '新的会话' }}</span>
            <small>{{ conversation.profileId }}</small>
          </button>
          <button
            :disabled="pending"
            class="conversation-item__delete"
            type="button"
            aria-label="删除会话"
            @click="deleteConversation(conversation.id)"
          >
            删除
          </button>
        </div>
      </aside>

      <div class="chat-main">
        <MessageList :messages="activeMessages" />
        <MessageInput
          disabled
        />
      </div>
    </section>
  </main>
</template>

<style scoped>
.chat-page {
  min-height: 100vh;
  padding: 24px;
}

.chat-shell {
  display: grid;
  grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
  max-width: 1180px;
  min-height: calc(100vh - 120px);
  margin: 18px auto 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  box-shadow: var(--shadow-panel);
}

.conversation-list {
  border-right: 1px solid var(--color-border);
  background: var(--color-panel-subtle);
  padding: 14px;
}

.conversation-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.conversation-list__title {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.new-conversation {
  min-height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-text);
  padding: 0 10px;
  font-weight: 700;
}

.conversation-list__empty,
.conversation-list__error {
  margin: 10px 0;
  color: var(--color-muted);
  font-size: 13px;
}

.conversation-list__error {
  color: var(--color-danger);
}

.conversation-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
}

.conversation-item--active,
.conversation-item:hover {
  border-color: var(--color-border);
  background: var(--color-panel);
}

.conversation-item__main {
  display: grid;
  min-width: 0;
  gap: 4px;
  border: 0;
  background: transparent;
  color: var(--color-text);
  padding: 10px 12px;
  text-align: left;
}

.conversation-item__main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-item small {
  color: var(--color-muted);
}

.conversation-item__delete {
  min-height: 30px;
  border: 0;
  background: transparent;
  color: var(--color-muted);
  padding: 0 10px;
  font-size: 12px;
}

.conversation-item__delete:hover:not(:disabled) {
  color: var(--color-danger);
}

.chat-main {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-width: 0;
}

@media (max-width: 760px) {
  .chat-page {
    padding: 12px;
  }

  .chat-shell {
    grid-template-columns: 1fr;
  }

  .conversation-list {
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }
}
</style>
