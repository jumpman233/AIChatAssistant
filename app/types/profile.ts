export type AssistantProfileDTO = {
  id: string
  name: string
  description: string
  enabledTools: string[]
  conversationModes?: string[]
}
