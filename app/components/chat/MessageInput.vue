<script setup lang="ts">
const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  send: [content: string]
}>()

const draft = ref('')

const send = () => {
  const content = draft.value.trim()

  if (!content || props.disabled) {
    return
  }

  emit('send', content)
  draft.value = ''
}
</script>

<template>
  <form class="message-input" @submit.prevent="send">
    <textarea
      v-model="draft"
      :disabled="disabled"
      placeholder="输入消息..."
      rows="3"
      @keydown.enter.exact.prevent="send"
    />
    <button :disabled="disabled || draft.trim().length === 0" type="submit">
      发送
    </button>
  </form>
</template>

<style scoped>
.message-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-panel);
}

textarea {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--color-text);
}

button {
  align-self: end;
  min-height: 42px;
  border: 0;
  border-radius: 6px;
  background: var(--color-primary);
  color: #fff;
  padding: 0 18px;
  font-weight: 700;
}

button:hover:not(:disabled) {
  background: var(--color-primary-strong);
}

@media (max-width: 560px) {
  .message-input {
    grid-template-columns: 1fr;
  }

  button {
    width: 100%;
  }
}
</style>
