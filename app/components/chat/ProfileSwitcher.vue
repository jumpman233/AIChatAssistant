<script setup lang="ts">
const { currentProfileId, error, pending, profiles } = useProfiles()
</script>

<template>
  <label class="profile-switcher">
    <span>Profile</span>
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
  gap: 6px;
  min-width: 220px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

select {
  min-height: 40px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-text);
  padding: 0 10px;
}

small {
  color: var(--color-danger);
  font-weight: 500;
}
</style>
