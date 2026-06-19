<script setup lang="ts">
import type { ConversationDTO } from '~/types/chat'

defineProps<{
  conversations: ConversationDTO[]
  activeConversationId: string | null
  generatingConversationIds?: string[]
  pending?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  create: []
  delete: [conversationId: string]
  select: [conversationId: string]
}>()
</script>

<template>
  <aside class="conversation-sidebar" aria-label="会话列表">
    <div class="conversation-sidebar__brand">
      <div class="conversation-sidebar__logo" aria-hidden="true">AI</div>
      <div>
        <div class="conversation-sidebar__name">AIChatAssistant</div>
        <div class="conversation-sidebar__sub">Vue Ready MVP</div>
      </div>
    </div>

    <button
      class="conversation-sidebar__create"
      type="button"
      :disabled="pending"
      @click="emit('create')"
    >
      新建会话
    </button>

    <div class="conversation-sidebar__section">Conversations</div>

    <p v-if="error" class="conversation-sidebar__error">
      {{ error }}
    </p>

    <div v-if="conversations.length > 0" class="conversation-sidebar__list">
      <ConversationItem
        v-for="conversation in conversations"
        :key="conversation.id"
        :active="conversation.id === activeConversationId"
        :conversation="conversation"
        :disabled="pending"
        :generating="generatingConversationIds?.includes(conversation.id)"
        @delete="emit('delete', $event)"
        @select="emit('select', $event)"
      />
    </div>

    <div v-else class="conversation-sidebar__empty">
      <strong>还没有会话</strong>
      <span>点击“新建会话”开始。</span>
    </div>

    <div class="conversation-sidebar__status">
      <span class="conversation-sidebar__status-dot" aria-hidden="true" />
      <div>
        <strong>Local MVP</strong>
        <span>V2 已启用 mock stream</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.conversation-sidebar {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  min-height: 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-panel-subtle);
  padding: 20px;
}

.conversation-sidebar__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.conversation-sidebar__logo {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: #111827;
  color: #fff;
  font-size: 13px;
  font-weight: 800;
}

.conversation-sidebar__name {
  font-size: 17px;
  font-weight: 800;
}

.conversation-sidebar__sub {
  margin-top: 2px;
  color: var(--color-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.conversation-sidebar__create {
  min-height: 46px;
  margin-top: 28px;
  border: 0;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  font-weight: 800;
}

.conversation-sidebar__create:hover:not(:disabled) {
  background: #1f2937;
}

.conversation-sidebar__section {
  margin: 26px 0 10px;
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.conversation-sidebar__list {
  display: grid;
  align-content: start;
  gap: 8px;
  min-height: 0;
  overflow: auto;
}

.conversation-sidebar__empty,
.conversation-sidebar__error {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  padding: 14px;
  color: var(--color-muted);
  font-size: 13px;
}

.conversation-sidebar__empty {
  display: grid;
  align-content: start;
  gap: 4px;
}

.conversation-sidebar__empty strong {
  color: var(--color-text);
}

.conversation-sidebar__error {
  color: var(--color-danger);
}

.conversation-sidebar__status {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  padding: 14px;
  color: var(--color-muted);
  font-size: 13px;
}

.conversation-sidebar__status strong,
.conversation-sidebar__status span {
  display: block;
}

.conversation-sidebar__status strong {
  color: var(--color-text);
  font-size: 13px;
}

.conversation-sidebar__status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  margin-top: 5px;
  border-radius: 50%;
  background: #10b981;
}

@media (max-width: 860px) {
  .conversation-sidebar {
    grid-template-rows: auto auto auto auto;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .conversation-sidebar__list {
    max-height: 260px;
  }

  .conversation-sidebar__status {
    display: none;
  }
}
</style>
