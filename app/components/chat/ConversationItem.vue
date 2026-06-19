<script setup lang="ts">
import type { ConversationDTO } from '~/types/chat'

const props = defineProps<{
  conversation: ConversationDTO
  active: boolean
  disabled?: boolean
  generating?: boolean
}>()

const emit = defineEmits<{
  delete: [conversationId: string]
  select: [conversationId: string]
}>()

const displayTitle = computed(() => {
  return props.conversation.title?.trim() || '新的会话'
})

const updatedLabel = computed(() => {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(props.conversation.updatedAt))
})
</script>

<template>
  <div
    class="conversation-item"
    :class="{
      'conversation-item--active': active,
      'conversation-item--generating': generating,
    }"
  >
    <button
      class="conversation-item__main"
      type="button"
      :disabled="disabled"
      @click="emit('select', conversation.id)"
    >
      <span class="conversation-item__title">{{ displayTitle }}</span>
      <span class="conversation-item__meta">
        {{ updatedLabel }}
        <span v-if="generating" class="conversation-item__streaming">
          生成中
        </span>
      </span>
    </button>

    <button
      class="conversation-item__delete"
      type="button"
      :disabled="disabled"
      aria-label="删除会话"
      title="删除会话"
      @click.stop="emit('delete', conversation.id)"
    >
      删除
    </button>
  </div>
</template>

<style scoped>
.conversation-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 4px;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.conversation-item:hover,
.conversation-item--active {
  border-color: var(--color-border);
  background: var(--color-panel);
}

.conversation-item--active {
  box-shadow: 0 10px 24px rgb(17 24 39 / 8%);
}

.conversation-item--generating {
  border-color: rgb(37 99 235 / 26%);
}

.conversation-item__main {
  display: grid;
  min-width: 0;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--color-text);
  padding: 10px 8px;
  text-align: left;
}

.conversation-item__title {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-item__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-muted);
  font-size: 12px;
}

.conversation-item__streaming {
  border-radius: 999px;
  background: rgb(37 99 235 / 10%);
  color: var(--color-primary);
  padding: 2px 8px;
  font-weight: 700;
}

.conversation-item__delete {
  align-self: center;
  min-height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  padding: 0 8px;
  font-size: 12px;
}

.conversation-item__delete:hover:not(:disabled) {
  background: rgb(180 35 24 / 8%);
  color: var(--color-danger);
}
</style>
