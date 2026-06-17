<script setup lang="ts">
import type { ToolCallDTO } from '~/types/chat'

defineProps<{
  toolCall: ToolCallDTO
}>()
</script>

<template>
  <div class="tool-call-card">
    <span>{{ toolCall.toolName }}</span>
    <strong>{{ toolCall.status }}</strong>
  </div>
</template>

<style scoped>
.tool-call-card {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  gap: 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel-subtle);
  padding: 10px 12px;
  color: var(--color-muted);
  font-size: 13px;
}

strong {
  color: var(--color-text);
}
</style>
