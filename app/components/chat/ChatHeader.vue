<script setup lang="ts">
import type { ConversationDTO } from '~/types/chat'
import type { AssistantProfileDTO } from '~/types/profile'

const props = defineProps<{
  activeConversation: ConversationDTO | null
  currentProfile: AssistantProfileDTO | null
  pending?: boolean
}>()

const emit = defineEmits<{
  deleteActive: []
}>()

const modeLabel = computed(() => props.activeConversation?.mode ?? 'chat')
const profileDescription = computed(() => {
  return props.currentProfile?.description ?? '选择一个 Profile 后创建新会话'
})
</script>

<template>
  <header class="chat-header">
    <ProfileSwitcher />

    <div class="chat-header__meta">
      <span class="chat-header__pill">mode: {{ modeLabel }}</span>
      <span class="chat-header__pill chat-header__pill--muted">V1 Storage</span>
    </div>

    <p class="chat-header__description">
      {{ profileDescription }}
    </p>

    <button
      class="chat-header__delete"
      type="button"
      :disabled="!activeConversation || pending"
      @click="emit('deleteActive')"
    >
      删除当前会话
    </button>
  </header>
</template>

<style scoped>
.chat-header {
  display: grid;
  grid-template-columns: minmax(220px, 300px) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 76px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
  padding: 10px 28px;
}

.chat-header__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-header__pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-panel);
  color: var(--color-text);
  padding: 0 12px;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.chat-header__pill--muted {
  border-color: rgb(37 99 235 / 24%);
  background: rgb(37 99 235 / 8%);
  color: var(--color-primary);
}

.chat-header__description {
  overflow: hidden;
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__delete {
  min-height: 36px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-panel);
  color: var(--color-muted);
  padding: 0 14px;
  font-weight: 700;
}

.chat-header__delete:hover:not(:disabled) {
  border-color: rgb(180 35 24 / 30%);
  background: rgb(180 35 24 / 7%);
  color: var(--color-danger);
}

@media (max-width: 980px) {
  .chat-header {
    grid-template-columns: 1fr auto;
  }

  .chat-header__description {
    grid-column: 1 / -1;
  }
}

@media (max-width: 640px) {
  .chat-header {
    grid-template-columns: 1fr;
    padding: 14px;
  }

  .chat-header__meta {
    flex-wrap: wrap;
  }

  .chat-header__delete {
    width: 100%;
  }
}
</style>
