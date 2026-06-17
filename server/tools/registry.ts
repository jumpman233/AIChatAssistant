export type ToolSource = 'local' | 'mcp'

export type ToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  source: ToolSource
  execute?: (args: unknown) => Promise<unknown>
}

const toolDefinitions: ToolDefinition[] = [
  {
    description: '执行基础四则运算表达式。完整执行逻辑将在聊天主链路阶段接入。',
    inputSchema: {
      additionalProperties: false,
      properties: {
        expression: {
          maxLength: 120,
          type: 'string',
        },
      },
      required: ['expression'],
      type: 'object',
    },
    name: 'calculator',
    source: 'local',
  },
  {
    description: '返回指定时区或系统默认时区的当前时间。',
    inputSchema: {
      additionalProperties: false,
      properties: {
        timeZone: {
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'currentTime',
    source: 'local',
  },
  {
    description: '返回 mock 天气信息，用于验证工具调用展示闭环。',
    inputSchema: {
      additionalProperties: false,
      properties: {
        city: {
          maxLength: 80,
          type: 'string',
        },
      },
      required: ['city'],
      type: 'object',
    },
    name: 'mockWeather',
    source: 'local',
  },
]

export const toolRegistry = new Map(toolDefinitions.map((tool) => [tool.name, tool]))

export const listToolDTOs = () => {
  return toolDefinitions.map(({ description, name, source }) => ({
    description,
    name,
    source,
  }))
}
