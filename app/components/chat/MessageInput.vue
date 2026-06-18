<script setup lang="ts">
defineProps<{
  disabled?: boolean
  reason?: string
}>()

const draft = ref('')
</script>

<template>
  <section class="message-input" aria-label="消息输入区">
    <textarea
      v-model="draft"
      :disabled="disabled"
      placeholder="输入消息，V2 将支持发送"
      rows="4"
    />
    <div class="message-input__footer">
      <span>{{ reason ?? 'V1 仅支持会话与历史消息读取，不发送消息。' }}</span>
      <button disabled type="button">
        V2 支持发送
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
