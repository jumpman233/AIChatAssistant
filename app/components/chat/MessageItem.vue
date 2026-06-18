<script setup lang="ts">
import type { MessageDTO } from '~/types/chat'

const props = defineProps<{
  message: MessageDTO
  displayContent?: string | null
  isStreaming?: boolean
  isTyping?: boolean
}>()

const roleLabel = computed(() => {
  if (props.message.role === 'user') {
    return 'You'
  }

  if (props.message.role === 'assistant') {
    return 'Assistant'
  }

  return props.message.role
})

const visibleContent = computed(() => {
  return props.displayContent ?? props.message.content
})

const shouldRenderAsStreaming = computed(() => {
  return Boolean(props.isStreaming || props.isTyping || props.message.status === 'streaming')
})
</script>

<template>
  <article class="message" :class="`message--${message.role}`">
    <div class="message__meta">
      <strong>{{ roleLabel }}</strong>
      <span>{{ message.status }}</span>
    </div>

    <MarkdownRenderer
      :content="visibleContent || '（空消息）'"
      :is-streaming="shouldRenderAsStreaming"
    />

    <div v-if="message.status === 'streaming' || isStreaming || isTyping" class="message__status">
      <StreamingIndicator />
      <span>生成中</span>
    </div>

    <ErrorRetryBlock
      v-if="message.status === 'failed'"
      :message="message.errorMessage"
    />

    <div v-if="message.status === 'aborted'" class="message__aborted">
      已停止生成
    </div>

    <ToolCallCard
      v-for="toolCall in message.toolCalls"
      :key="toolCall.id"
      :tool-call="toolCall"
    />
  </article>
</template>

<style scoped>
.message {
  width: min(100%, 760px);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  padding: 18px 20px;
  box-shadow: 0 8px 20px rgb(17 24 39 / 5%);
}

.message--user {
  justify-self: end;
  border-color: transparent;
  background: #111827;
  color: #fff;
}

.message--assistant {
  justify-self: start;
}

.message__meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 12px;
  color: var(--color-muted);
  font-size: 13px;
}

.message--user .message__meta {
  color: rgb(255 255 255 / 72%);
}

strong {
  color: var(--color-text);
}

.message--user strong {
  color: #fff;
}

.message__status,
.message__aborted {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  border-radius: 999px;
  background: rgb(37 99 235 / 8%);
  color: var(--color-primary);
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 700;
}

.message__aborted {
  background: rgb(161 98 7 / 10%);
  color: var(--color-warning);
}
</style>
