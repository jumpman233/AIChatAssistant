<script setup lang="ts">
const { currentProfile, loadProfiles } = useProfiles()
const { activeState, conversations, createLocalConversation } = useConversation()
const { sendLocalMessage } = useChatStream()

onMounted(async () => {
  await loadProfiles()

  if (conversations.value.length === 0) {
    createLocalConversation(currentProfile.value?.id ?? 'general')
  }
})
</script>

<template>
  <main class="chat-page">
    <ChatHeader>
      <ProfileSwitcher />
    </ChatHeader>

    <section class="chat-shell" aria-label="聊天工作区">
      <aside class="conversation-list" aria-label="会话列表">
        <div class="conversation-list__title">会话</div>
        <button
          v-for="conversation in conversations"
          :key="conversation.id"
          class="conversation-item"
          type="button"
        >
          <span>{{ conversation.title ?? '新的会话' }}</span>
          <small>{{ conversation.profileId }}</small>
        </button>
      </aside>

      <div class="chat-main">
        <MessageList :messages="activeState?.messages ?? []" />
        <MessageInput
          :disabled="activeState?.isStreaming ?? false"
          @send="sendLocalMessage"
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

.conversation-list__title {
  margin-bottom: 10px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.conversation-item {
  display: grid;
  width: 100%;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  text-align: left;
}

.conversation-item:hover {
  border-color: var(--color-border);
  background: var(--color-panel);
}

.conversation-item small {
  color: var(--color-muted);
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
