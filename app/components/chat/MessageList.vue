<script setup lang="ts">
import type { MessageDTO } from '~/types/chat'

const props = defineProps<{
  messages: MessageDTO[]
  hasActiveConversation: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  createConversation: []
}>()

const listEl = ref<HTMLElement | null>(null)
const chatRuntimeStore = useChatRuntimeStore()

const sortedMessages = computed(() => {
  return [...props.messages].sort((a, b) => a.seq - b.seq)
})

const isNearBottom = () => {
  if (!listEl.value) {
    return true
  }

  const threshold = 96
  return (
    listEl.value.scrollHeight - listEl.value.scrollTop - listEl.value.clientHeight < threshold
  )
}

const scrollToBottom = async (force = false) => {
  if (!force && !isNearBottom()) {
    return
  }

  await nextTick()

  if (listEl.value) {
    listEl.value.scrollTop = listEl.value.scrollHeight
  }
}

watch(
  () => [props.hasActiveConversation, sortedMessages.value.length, chatRuntimeStore.renderTick],
  () => {
    void scrollToBottom()
  },
  {
    flush: 'post',
  },
)

watch(
  () => props.hasActiveConversation,
  () => {
    void scrollToBottom(true)
  },
  {
    flush: 'post',
  },
)
</script>

<template>
  <div ref="listEl" class="message-list">
    <div v-if="loading" class="message-list__state">
      <span class="message-list__icon" aria-hidden="true">...</span>
      <h2>正在加载消息</h2>
      <p>正在读取当前会话最近 50 条消息。</p>
    </div>

    <div v-else-if="!hasActiveConversation" class="message-list__state">
      <span class="message-list__icon" aria-hidden="true">+</span>
      <h2>开始一次 AI 对话</h2>
      <p>先创建一个会话，然后在底部输入区发送消息。</p>
      <button type="button" @click="emit('createConversation')">
        新建会话
      </button>
    </div>

    <div v-else-if="sortedMessages.length === 0" class="message-list__state">
      <span class="message-list__icon" aria-hidden="true">›_</span>
      <h2>当前会话还没有消息</h2>
      <p>会话已经创建，可以在底部输入区发送第一条消息。</p>
    </div>

    <div v-else class="message-list__items">
      <MessageItem
        v-for="message in sortedMessages"
        :key="message.id"
        :display-content="chatRuntimeStore.getTypewriter(message.id)?.displayContent"
        :is-streaming="chatRuntimeStore.isMessageStreaming(message.conversationId, message.id)"
        :is-typing="chatRuntimeStore.isMessageTyping(message.id)"
        :message="message"
      />
    </div>
  </div>
</template>

<style scoped>
.message-list {
  min-height: 0;
  overflow: auto;
  background: #f8fafc;
  padding: 32px;
}

.message-list__items {
  display: grid;
  align-content: end;
  gap: 20px;
  min-height: 100%;
}

.message-list__state {
  display: grid;
  align-content: center;
  justify-items: center;
  min-height: 100%;
  max-width: 680px;
  margin: 0 auto;
  color: var(--color-muted);
  text-align: center;
}

.message-list__icon {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border: 1px solid rgb(37 99 235 / 26%);
  border-radius: 8px;
  background: rgb(37 99 235 / 8%);
  color: var(--color-primary);
  font-size: 26px;
  font-weight: 800;
}

h2 {
  margin: 22px 0 8px;
  color: var(--color-text);
  font-size: 30px;
  line-height: 1.2;
}

p {
  max-width: 560px;
  margin: 0;
  line-height: 1.7;
}

button {
  min-height: 40px;
  margin-top: 24px;
  border: 0;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  padding: 0 18px;
  font-weight: 800;
}

@media (max-width: 640px) {
  .message-list {
    padding: 20px;
  }

  h2 {
    font-size: 24px;
  }
}
</style>
