import { defineStore } from 'pinia'
import type { AssistantProfileDTO } from '~/types/profile'

type ListProfilesResponse = {
  items: AssistantProfileDTO[]
}

export const useProfileStore = defineStore('profile', () => {
  const currentProfileId = ref('general')
  const error = ref<string | null>(null)
  const pending = ref(false)
  const profiles = ref<AssistantProfileDTO[]>([])

  const currentProfile = computed(() => {
    return profiles.value.find((profile) => profile.id === currentProfileId.value) ?? null
  })

  const loadProfiles = async () => {
    pending.value = true
    error.value = null

    try {
      const response = await $fetch<ListProfilesResponse>('/api/profiles')
      profiles.value = response.items

      if (!profiles.value.some((profile) => profile.id === currentProfileId.value)) {
        currentProfileId.value = profiles.value[0]?.id ?? 'general'
      }
    } catch {
      error.value = 'Profile 加载失败'
    } finally {
      pending.value = false
    }
  }

  return {
    currentProfile,
    currentProfileId,
    error,
    loadProfiles,
    pending,
    profiles,
  }
})
