<script setup lang="ts">
const message = ref('Nuxt UI is ready.')
</script>

<template>
  <main class="min-h-screen bg-gray-50 p-8 text-gray-900">
    <div class="mx-auto flex max-w-xl flex-col gap-4">
      <UBadge color="primary" variant="soft">Nuxt UI</UBadge>
      <UTextarea v-model="message" :rows="4" />
      <UButton class="self-start">
        Ready
      </UButton>
    </div>
  </main>
</template>
