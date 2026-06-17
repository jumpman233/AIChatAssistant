<script setup lang="ts">
import type { MessageDTO } from '~/types/chat'

defineProps<{
  message: MessageDTO
}>()
</script>

<template>
  <article class="message" :class="`message--${message.role}`">
    <div class="message__meta">
      <strong>{{ message.role === 'user' ? '你' : 'Assistant' }}</strong>
      <span>{{ message.status }}</span>
    </div>
    <MarkdownRenderer :content="message.content" />
    <ToolCallCard
      v-for="toolCall in message.toolCalls ?? []"
      :key="toolCall.id"
      :tool-call="toolCall"
    />
  </article>
</template>

<style scoped>
.message {
  max-width: 760px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.message--user {
  margin-left: auto;
  border-color: rgb(37 99 235 / 30%);
  background: rgb(37 99 235 / 7%);
}

.message__meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 12px;
  color: var(--color-muted);
  font-size: 13px;
}

strong {
  color: var(--color-text);
}
</style>
