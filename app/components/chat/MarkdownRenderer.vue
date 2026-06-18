<script setup lang="ts">
import { renderStreamingMarkdown } from '~/utils/markdown'

const props = defineProps<{
  content: string
  isStreaming?: boolean
}>()

const renderedContent = computed(() => {
  return renderStreamingMarkdown(props.content, Boolean(props.isStreaming))
})
</script>

<template>
  <div class="markdown-renderer" v-html="renderedContent" />
</template>

<style scoped>
.markdown-renderer {
  overflow-wrap: anywhere;
  line-height: 1.7;
}

.markdown-renderer :deep(*) {
  margin-top: 0;
}

.markdown-renderer :deep(*:last-child) {
  margin-bottom: 0;
}

.markdown-renderer :deep(p),
.markdown-renderer :deep(ul),
.markdown-renderer :deep(ol),
.markdown-renderer :deep(pre),
.markdown-renderer :deep(blockquote) {
  margin-bottom: 0.85em;
}

.markdown-renderer :deep(ul),
.markdown-renderer :deep(ol) {
  padding-left: 1.3em;
}

.markdown-renderer :deep(pre) {
  overflow-x: auto;
  border-radius: 8px;
  background: #111827;
  color: #e5e7eb;
  padding: 12px;
}

.markdown-renderer :deep(code) {
  border-radius: 4px;
  background: rgb(15 23 42 / 8%);
  padding: 0.12em 0.28em;
  font-size: 0.92em;
}

.markdown-renderer :deep(pre code) {
  background: transparent;
  padding: 0;
}
</style>
