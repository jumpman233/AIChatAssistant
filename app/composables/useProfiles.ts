import type { AssistantProfileDTO } from '~/types/profile'

type ListProfilesResponse = {
  items: AssistantProfileDTO[]
}

export const useProfiles = () => {
  const profiles = useState<AssistantProfileDTO[]>('profiles', () => [])
  const currentProfileId = useState<string>('currentProfileId', () => 'general')
  const pending = useState<boolean>('profilesPending', () => false)
  const error = useState<string | null>('profilesError', () => null)

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

  const currentProfile = computed(() => {
    return profiles.value.find((profile) => profile.id === currentProfileId.value) ?? null
  })

  return {
    currentProfile,
    currentProfileId,
    error,
    loadProfiles,
    pending,
    profiles,
  }
}
