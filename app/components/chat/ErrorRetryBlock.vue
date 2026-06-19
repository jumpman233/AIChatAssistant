<script setup lang="ts">
defineProps<{
  message?: string | null
  retryable?: boolean
}>()

defineEmits<{
  retry: []
}>()
</script>

<template>
  <div class="error-retry-block">
    <span>{{ message ?? '生成失败' }}</span>
    <button v-if="retryable" type="button" @click="$emit('retry')">重试</button>
  </div>
</template>

<style scoped>
.error-retry-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  gap: 12px;
  border: 1px solid rgb(180 35 24 / 30%);
  border-radius: 6px;
  background: rgb(180 35 24 / 7%);
  padding: 10px 12px;
  color: var(--color-danger);
}

button {
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  padding: 6px 10px;
}
</style>
