<script setup lang="ts">
const props = defineProps<{
  disabled?: boolean
  pending?: boolean
  reason?: string | null
  streaming?: boolean
}>()

const emit = defineEmits<{
  send: [content: string]
}>()

const draft = ref('')

const canSend = computed(() => {
  return !props.disabled && !props.pending && !props.streaming && draft.value.trim().length > 0
})

const helperText = computed(() => {
  if (props.reason) {
    return props.reason
  }

  if (props.streaming) {
    return '当前会话正在生成中，可以继续编辑草稿，完成后再发送。'
  }

  return 'Enter 发送，Shift + Enter 换行。'
})

const submit = () => {
  if (!canSend.value) {
    return
  }

  const content = draft.value.trim()
  draft.value = ''
  emit('send', content)
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || event.shiftKey) {
    return
  }

  event.preventDefault()
  submit()
}
</script>

<template>
  <section class="message-input" aria-label="消息输入区">
    <textarea
      v-model="draft"
      :disabled="disabled"
      placeholder="输入消息，Enter 发送"
      rows="4"
      @keydown="handleKeydown"
    />
    <div class="message-input__footer">
      <span>{{ helperText }}</span>
      <button
        :disabled="!canSend"
        type="button"
        @click="submit"
      >
        {{ streaming ? '生成中' : '发送' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.message-input {
  border-top: 1px solid var(--color-border);
  background: var(--color-panel);
  padding: 20px 28px;
}

textarea {
  display: block;
  width: min(100%, 980px);
  min-height: 112px;
  margin: 0 auto;
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #f8fafc;
  color: var(--color-text);
  padding: 16px;
  line-height: 1.6;
}

textarea:disabled {
  color: var(--color-muted);
}

.message-input__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(100%, 980px);
  margin: 12px auto 0;
  gap: 14px;
  color: var(--color-muted);
  font-size: 13px;
}

button {
  min-height: 38px;
  border: 0;
  border-radius: 999px;
  background: #111827;
  color: #fff;
  padding: 0 18px;
  font-weight: 800;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

button:hover:not(:disabled) {
  background: #1f2937;
}

@media (max-width: 640px) {
  .message-input {
    padding: 16px;
  }

  .message-input__footer {
    align-items: stretch;
    flex-direction: column;
  }

  button {
    width: 100%;
  }
}
</style>
