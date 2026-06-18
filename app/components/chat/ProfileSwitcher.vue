<script setup lang="ts">
import { storeToRefs } from 'pinia'

const profileStore = useProfileStore()
const { currentProfileId, error, pending, profiles } = storeToRefs(profileStore)
</script>

<template>
  <label class="profile-switcher">
    <span class="profile-switcher__eyebrow">Profile</span>
    <select v-model="currentProfileId" :disabled="pending || profiles.length === 0">
      <option
        v-for="profile in profiles"
        :key="profile.id"
        :value="profile.id"
      >
        {{ profile.name }}
      </option>
    </select>
    <small v-if="error">{{ error }}</small>
  </label>
</template>

<style scoped>
.profile-switcher {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.profile-switcher__eyebrow {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

select {
  width: 100%;
  min-height: 38px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  padding: 0 12px;
  font-weight: 800;
}

small {
  color: var(--color-danger);
  font-size: 12px;
}
</style>
