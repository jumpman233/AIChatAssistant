export type AssistantProfile = {
  id: string
  name: string
  description: string
  systemPrompt: string
  enabledTools: string[]
  knowledgeSourceIds?: string[]
  conversationModes?: string[]
}

export const assistantProfiles: AssistantProfile[] = [
  {
    conversationModes: ['chat'],
    description: '适用于通用聊天、解释和轻量任务拆解。',
    enabledTools: ['calculator', 'currentTime'],
    id: 'general',
    name: '通用助手',
    systemPrompt: '你是 AIChatAssistant 的通用助手，回答清晰、可靠，并保持任务边界。',
  },
  {
    conversationModes: ['chat'],
    description: '用于展示未来垂直领域扩展口子的 Demo Profile。',
    enabledTools: ['calculator', 'currentTime', 'mockWeather'],
    id: 'domain-demo',
    name: '领域 Demo',
    systemPrompt:
      '你是 AIChatAssistant 的领域扩展示例助手。当前只展示扩展能力，不绑定任何具体业务领域。',
  },
]

export const getProfileById = (profileId: string) => {
  return assistantProfiles.find((profile) => profile.id === profileId) ?? null
}

export const listProfileDTOs = () => {
  return assistantProfiles.map(({ description, enabledTools, id, name, conversationModes }) => ({
    conversationModes,
    description,
    enabledTools,
    id,
    name,
  }))
}
