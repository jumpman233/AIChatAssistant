<script setup lang="ts">
import type { MessageDTO } from '~/types/chat'

defineProps<{
  messages: MessageDTO[]
}>()
</script>

<template>
  <div class="message-list">
    <div v-if="messages.length === 0" class="message-list__empty">
      <h2>开始一个新会话</h2>
      <p>项目骨架已生成，当前页面用于验证 Nuxt、组件和 Profile 接口是否能跑起来。</p>
    </div>
    <MessageItem
      v-for="message in messages"
      v-else
      :key="message.id"
      :message="message"
    />
  </div>
</template>

<style scoped>
.message-list {
  min-height: 0;
  overflow: auto;
  padding: 24px;
}

.message-list__empty {
  display: grid;
  align-content: center;
  min-height: 100%;
  max-width: 560px;
  margin: 0 auto;
  color: var(--color-muted);
  text-align: center;
}

h2 {
  margin: 0 0 8px;
  color: var(--color-text);
  font-size: 24px;
}

p {
  margin: 0;
  line-height: 1.7;
}
</style>
