# docs/rules/frontend-vue.md

## 前端技术约束

本项目使用：

* Nuxt
* Vue 3
* TypeScript
* Vite

统一使用 Vue 3 Composition API 和 `<script setup lang="ts">`。

## 推荐目录结构

```text
app/
  pages/
    index.vue

  components/
    chat/
      ChatPage.vue
      ChatHeader.vue
      ProfileSwitcher.vue
      MessageList.vue
      MessageItem.vue
      MessageInput.vue
      ToolCallCard.vue
      MarkdownRenderer.vue
      StreamingIndicator.vue
      ErrorRetryBlock.vue

  composables/
    useConversation.ts
    useChatStream.ts
    useProfiles.ts

  types/
    chat.ts
    profile.ts
    tool.ts

  utils/
    markdown.ts
    stream.ts
```

## 组件职责

组件保持小而清晰。

建议职责：

* `ChatPage.vue`：聊天页整体组合
* `ChatHeader.vue`：顶部区域，展示当前 Profile 和页面级操作
* `ProfileSwitcher.vue`：助手 Profile 切换
* `MessageList.vue`：消息列表
* `MessageItem.vue`：单条消息展示
* `MessageInput.vue`：输入框、发送、停止
* `ToolCallCard.vue`：工具调用状态展示
* `MarkdownRenderer.vue`：Markdown 和代码块渲染
* `StreamingIndicator.vue`：生成中状态
* `ErrorRetryBlock.vue`：失败提示和重试入口

不要把流式读取逻辑写进 `MessageItem.vue` 或 `MessageList.vue`。

## Composable 职责

状态和请求逻辑放到 composables。

建议：

```text
useConversation.ts
useChatStream.ts
useProfiles.ts
```

`useConversation()` 负责：

* 创建 conversation
* 加载 conversation
* 加载会话列表
* 加载指定 conversation 的 messages
* 管理 `activeConversationId`
* 清空当前会话
* 刷新指定 conversation 状态

`useChatStream()` 负责：

* 按 `conversationId` 发送用户输入
* 按 `conversationId` 读取流式响应
* 更新目标 conversation 下的 assistant message 内容
* 管理每个 conversation 独立的 `AbortController`
* 停止指定 conversation / message 的生成
* 失败重试
* 更新目标 conversation 下的 message status

`useChatStream()` 不应只维护一份全局 streaming 状态。不同 Conversation 的 streaming 状态必须相互隔离。

`useProfiles()` 负责：

* 读取可用 Assistant Profiles
* 当前 Profile 状态
* Profile 切换

## 多会话状态规则

第一阶段允许不同 Conversation 同时 streaming，但同一个 Conversation 同一时间只允许一个 active streaming。

前端状态必须按 `conversationId` 隔离。推荐结构：

```ts
type ConversationRuntimeState = {
  conversationId: string
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  abortController: AbortController | null
  error: string | null
}

type ChatRuntimeState = {
  activeConversationId: string | null
  currentProfileId: string
  conversations: ConversationDTO[]
  conversationStates: Record<string, ConversationRuntimeState>
}
```

规则：

* 切换 Conversation 时，只切换 `activeConversationId`，不要清空其他 Conversation 的状态。
* 不同 Conversation 的 `messages`、`isStreaming`、`streamingMessageId`、`abortController` 和 `error` 不得混用。
* 不同 Conversation 可以同时存在 `isStreaming = true`。
* 同一个 Conversation 内如果 `isStreaming = true`，输入框应禁止再次发送，或展示“当前会话正在生成中”的提示。
* 停止按钮默认只停止当前 active Conversation 的 `streamingMessageId`。
* 如果非当前 Conversation 正在 streaming，可以在会话列表中展示生成中状态。
* 前端收到 stream event 时，必须根据 `messageId` 或请求上下文更新对应 Conversation，不要写入当前 active Conversation 之外的错误位置。


## 核心类型

前端核心类型放在：

```text
app/types/
```

至少包含：

```ts
type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  profileId?: string
  mode?: string
  status?: 'pending' | 'streaming' | 'done' | 'failed' | 'aborted'
  toolCalls?: ToolCall[]
  createdAt: string
}

type ToolCall = {
  id: string
  toolName: string
  arguments?: unknown
  result?: unknown
  status: 'pending' | 'running' | 'success' | 'failed'
}

type ConversationDTO = {
  id: string
  title: string | null
  profileId: string
  mode: string
  status: 'active' | 'archived' | 'deleted'
  createdAt: string
  updatedAt: string
}
```

前端类型需要尽量和后端响应保持一致。

## 必须覆盖的 UI 状态

第一阶段至少处理：

* 空会话
* 用户消息已发送
* assistant streaming
* assistant done
* assistant failed
* assistant aborted
* 可重试
* 当前 Conversation 正在生成中
* 非当前 Conversation 正在生成中
* 同一 Conversation 重复发送被禁止或提示
* tool call running
* tool call success
* tool call failed

不要只实现 happy path。

## Streaming UI 规则

生成中：

* 展示目标 Conversation 下 assistant 的部分内容
* 展示停止按钮
* 同一个 Conversation 生成中时，禁止该 Conversation 再次发送消息
* 不同 Conversation 的生成状态互不影响
* 保持输入行为可预期
* 避免过度重渲染
* 只有用户接近底部时才自动滚动到底部
* 如果用户切换到其他 Conversation，原 Conversation 的 stream 仍可继续更新自己的 runtime state

停止后：

* 保留已生成内容
* 标记为 `aborted`
* 允许重试

失败后：

* 展示错误提示
* 允许重试
* 不要自动删除旧内容

## Figma 实现规则

从 Figma 实现页面时，优先映射到已有组件结构，不要按设计稿随意创建一次性组件。

示例：

```text
Figma Chat Shell      -> ChatPage
Figma Profile Select  -> ProfileSwitcher
Figma Message Bubble  -> MessageItem
Figma Tool Card       -> ToolCallCard
Figma Composer        -> MessageInput
```

优先级：

1. 状态正确
2. 流式稳定
3. 组件清晰
4. 视觉还原
