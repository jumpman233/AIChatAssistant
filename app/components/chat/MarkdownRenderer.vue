<script setup lang="ts">
defineProps<{
  content: string
}>()
</script>

<template>
  <div class="markdown-renderer">
    {{ content }}
  </div>
</template>

<style scoped>
.markdown-renderer {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
</style>
