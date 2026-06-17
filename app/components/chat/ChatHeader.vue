<template>
  <header class="chat-header">
    <div>
      <h1>AIChatAssistant</h1>
      <p>Nuxt + TypeScript 的 AI Chat 底座</p>
    </div>
    <div class="chat-header__actions">
      <slot />
    </div>
  </header>
</template>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1180px;
  margin: 0 auto;
  gap: 16px;
}

h1 {
  margin: 0;
  font-size: clamp(28px, 5vw, 44px);
  line-height: 1;
}

p {
  margin: 8px 0 0;
  color: var(--color-muted);
}

.chat-header__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

@media (max-width: 640px) {
  .chat-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
