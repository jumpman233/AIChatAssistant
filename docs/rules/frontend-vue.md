# docs/rules/frontend-vue.md

## 前端技术约束

本项目使用：

* Nuxt
* Vue 3
* TypeScript
* Vite
* Tailwind CSS
* Nuxt UI
* Pinia

统一使用 Vue 3 Composition API 和 `<script setup lang="ts">`。

---

## Vue 3 编码规范

组件代码应保持类型清晰、职责单一、模板可读，默认遵循以下约定：

* 统一使用 `<script setup lang="ts">`，不要使用 Options API。
* `defineProps`、`defineEmits`、`defineModel` 必须写出明确 TypeScript 类型。
* props 类型优先定义为 `type`，复杂类型放到 `app/types/`，避免在组件内重复声明大型结构。
* emits 使用命名事件表达用户意图，例如 `send`、`stop`、`retry`、`selectConversation`，不要用含糊的 `change` 承载多种行为。
* 组件内部只维护展示所需的局部状态，例如输入框草稿、展开/收起状态、hover 辅助状态。
* 会话、消息、streaming、Profile、请求错误等跨组件业务状态必须放到 Pinia stores 中管理；composables 负责请求调用、流式读取、流程编排以及多个 store 之间的协作。
* 不要在模板中写复杂表达式；复杂判断提取为 `computed` 或小函数。
* 不要在组件中直接发起跨模块业务请求，除非该组件本身就是页面级组合组件；请求逻辑优先放到 composable 或 store action。
* 使用 `computed` 表达派生状态，避免用 `watch` 同步可由已有状态推导出的值。
* `watch` 只用于副作用，例如滚动、请求触发、持久化、DOM 交互；必须明确 watch 来源，避免深度监听大型对象。
* `onMounted` 中只做组件挂载后必须发生的动作，例如首次加载、DOM 测量、事件监听注册。
* 事件监听、定时器、外部实例和 AbortController 需要在 `onBeforeUnmount` 或对应流程结束时清理。
* 列表渲染必须使用稳定 `:key`，优先使用后端返回的 `id`，不要使用数组下标作为 key。
* `v-if` 和 `v-for` 不要写在同一个元素上；先用 `computed` 过滤列表，或拆一层 `<template>`。
* 双向绑定只用于表单输入等局部状态；跨组件状态变更通过 props + emits、store action 或 composable 方法完成。
* 组件名、文件名使用 PascalCase，例如 `MessageInput.vue`、`ToolCallCard.vue`。
* 类型、工具函数、常量要按职责放入 `app/types/`、`app/utils/`、store 或对应 composable，不要堆在页面组件里。

推荐的组件结构顺序：

```vue
<script setup lang="ts">
import type { MessageDTO } from '~/types/chat'

const props = defineProps<{
  message: MessageDTO
}>()

const emit = defineEmits<{
  retry: [messageId: string]
}>()

const canRetry = computed(() => {
  return props.message.status === 'failed' || props.message.status === 'aborted'
})
</script>

<template>
  <article>
    <!-- template -->
  </article>
</template>
```

生成或修改组件时，优先让组件输入输出清楚：props 负责数据输入，emits 负责用户动作输出，stores/composables 负责业务状态和请求流程。

---

## Pinia 状态管理规范

项目使用 Pinia 管理跨组件、跨页面共享的前端业务状态。Pinia 用于承载稳定的应用状态和动作，组件仍然只负责展示和用户交互。

目录约定：

```text
app/
  stores/
    conversation.ts
    chatRuntime.ts
    profile.ts
    tool.ts
```

Store 拆分建议：

* `conversation.ts`：会话列表、当前会话、会话增删改查、按 `conversationId` 隔离的消息列表缓存。
* `chatRuntime.ts`：按 `conversationId` 隔离的 streaming 状态、`AbortController`、运行中 messageId、临时错误。不要存放 messages。
* `profile.ts`：可用 Assistant Profile、当前 Profile、Profile 切换。
* `tool.ts`：可用工具列表、工具调用展示所需的前端状态。

使用规则：

* Store 文件统一使用 `defineStore`，命名为 `useXxxStore`，例如 `useConversationStore`。
* Store id 使用稳定小写短名称，例如 `conversation`、`chatRuntime`、`profile`。
* 优先使用 setup store 写法，便于复用 Vue Composition API 和 TypeScript 类型。
* state 必须有明确初始值，数组、对象、nullable 字段都要显式声明类型。
* getters 使用 `computed` 表达派生状态，不要在组件里重复写同一份派生逻辑。
* actions 是修改 store state 的唯一入口；组件不要直接改复杂 store 对象的深层字段。
* 异步请求可以放在 store action 或 composable 中；如果流程需要同时操作多个 store，优先放在 composable/service-style action 中协调。
* `AbortController`、stream reader、临时请求错误等运行时对象可以放在 `chatRuntime` store，但不要持久化。
* `chatRuntimeStore` 中的 `AbortController`、stream reader 等对象只在客户端运行时使用，不参与 SSR 数据序列化，不写入 localStorage/sessionStorage，不通过服务端初始化。
* 不要把服务端 DTO 直接改造成仅适合 UI 的形状；需要展示派生字段时用 getter 或组件 computed。
* 不要在 store 顶层调用另一个 store 并长期保存实例；需要组合 store 时，在 action 或 getter 内部调用。
* 不要把纯展示状态全部放进 Pinia，例如单个弹窗是否展开、输入框 draft、局部 hover 状态仍放在组件内。
* 不要为每个小组件创建 store；只有跨组件共享、跨路由共享或需要统一业务动作的状态才进入 Pinia。

推荐写法：

```ts
import { defineStore } from 'pinia'
import type { ConversationDTO } from '~/types/chat'

export const useConversationStore = defineStore('conversation', () => {
  const activeConversationId = ref<string | null>(null)
  const conversations = ref<ConversationDTO[]>([])

  const activeConversation = computed(() => {
    return conversations.value.find((item) => item.id === activeConversationId.value) ?? null
  })

  const setActiveConversation = (conversationId: string | null) => {
    activeConversationId.value = conversationId
  }

  const setConversations = (items: ConversationDTO[]) => {
    conversations.value = items
  }

  return {
    activeConversation,
    activeConversationId,
    conversations,
    setActiveConversation,
    setConversations,
  }
})
```

迁移规则：

* 后续从 composable 迁移到 Pinia 时，小步迁移，一个 store 一次只承接一类状态。
* 先迁移稳定状态，例如 conversations、profiles、tools；再迁移 stream runtime。
* 迁移过程中保持组件调用语义稳定，优先让组件调用 action，不直接依赖内部 state 结构。
* 迁移后如果 composable 仍有价值，可以让 composable 负责流程编排，store 负责状态读写。

---

## 样式规范

后续前端开发默认使用 Tailwind CSS 完成布局、间距、颜色、字体、边框、响应式和交互状态样式。

要求：

* 默认使用 Nuxt UI 作为基础组件库，优先使用 `UButton`、`UInput`、`UTextarea`、`USelectMenu`、`UModal`、`UTabs`、`UTooltip` 等组件承载常见交互。
* `ProfileSwitcher` 优先使用 `USelectMenu`；简单普通选择场景可以使用 `USelect`。
* 优先使用 Tailwind utility class 表达组件样式。
* 不新增独立 CSS 文件，除非是全局基础样式、设计 token、第三方库样式或 Tailwind 难以表达的少量复杂样式。
* 组件内 `<style scoped>` 只用于确有必要的复杂选择器、动画或浏览器兼容处理。
* 不再引入 Nuxt UI 之外的额外 UI 组件库，除非用户明确要求。
* Tailwind class 需要保持可读，不要为了极端复用提前抽象。
* 公共视觉规则优先沉淀为设计 token 或小组件，不要复制大段无关样式。
* 响应式优先使用 Tailwind 的断点工具，确保移动端和桌面端都可用。
* 状态样式需要覆盖 hover、disabled、loading、streaming、failed、aborted 等关键状态。
* Nuxt UI 组件的 `ui` prop 只用于局部样式调整；跨页面通用样式优先沉淀到主题配置或封装组件。

---

## 推荐目录结构

```text
app/
  pages/
    index.vue

  components/
    chat/
      ChatPage.vue
      ChatHeader.vue
      ConversationSidebar.vue
      ConversationItem.vue
      ProfileSwitcher.vue
      MessageList.vue
      MessageItem.vue
      MessageInput.vue
      ToolCallCard.vue
      MarkdownRenderer.vue
      CodeBlock.vue
      StreamingIndicator.vue
      ErrorRetryBlock.vue

  stores/
    conversation.ts
    chatRuntime.ts
    profile.ts
    tool.ts

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

---

## 组件职责

组件保持小而清晰。

建议职责：

* `ChatPage.vue`：聊天页整体组合。
* `ChatHeader.vue`：顶部区域，展示当前 Profile、mode、模型状态和页面级操作。
* `ConversationSidebar.vue`：左侧会话区，展示应用信息、新建会话按钮、会话列表和本地模式状态。
* `ConversationItem.vue`：单个会话项，展示标题、更新时间、选中态和 streaming 状态。
* `ProfileSwitcher.vue`：助手 Profile 切换。
* `MessageList.vue`：消息列表。
* `MessageItem.vue`：单条消息展示，按 role/status 渲染用户消息、assistant 消息、失败状态和停止状态。
* `MessageInput.vue`：输入框、发送、停止。
* `ToolCallCard.vue`：工具调用状态展示。
* `MarkdownRenderer.vue`：Markdown 渲染。
* `CodeBlock.vue`：代码块展示、语言标识和复制按钮。
* `StreamingIndicator.vue`：生成中状态。
* `ErrorRetryBlock.vue`：失败/停止提示和重试入口。

不要把流式读取逻辑写进 `MessageItem.vue` 或 `MessageList.vue`。

---

## 打字机输出与 Streaming Markdown 实现规范

`MarkdownRenderer` 组件建议使用 `markdown-it` 作为第一阶段 Markdown 渲染方案。

`MarkdownRenderer` 只负责渲染传入的 `content`，不直接读取 SSE，不直接管理 stream，不直接感知 `AbortController`、retry、ToolCall 或 conversation runtime。

打字机状态不应放在 `MessageItem` 内部。`MessageItem` 只根据 message 和 runtime 派生出来的可见内容展示 UI，不创建、不持有、不清理 typewriter timer。

推荐职责：

* `useChatStream`：读取 SSE、接收 `text_delta`、驱动 typewriter buffer。
* `chatRuntimeStore`：保存 streaming runtime / typewriter buffer。
* `conversationStore`：保存会话和消息数据。
* `MessageItem`：根据 message + runtime `displayContent` 展示内容。
* `MarkdownRenderer`：渲染 `renderContent`。

建议 typewriter runtime state 至少包含：

```ts
type TypewriterRuntimeState = {
  messageId: string
  rawContent: string
  displayContent: string
  pendingText: string
  isTyping: boolean
  timerId: ReturnType<typeof setTimeout> | null
}
```

推荐渲染链路：

```ts
const visibleContent = runtime.displayContent ?? message.content
const renderContent = normalizeStreamingMarkdown(visibleContent, isStreaming)
```

然后将 `renderContent` 传给 `MarkdownRenderer`。

`normalizeStreamingMarkdown` 只用于渲染，不得写回 store 中的 message content，不得写入数据库，不得改变 SSE event data。

V2 先实现基础 Markdown + 临时代码块闭合；V7 再优化代码高亮、复制按钮、表格等完整阅读体验。

---

## Store 与 Composable 职责

跨组件共享状态优先放到 Pinia stores；流程编排、流式读取、组合多个 store 的业务动作可以放到 composables。

建议：

```text
stores/conversation.ts
stores/chatRuntime.ts
stores/profile.ts
stores/tool.ts

useConversation.ts
useChatStream.ts
useProfiles.ts
```

`useConversationStore()` 负责：

* 创建 conversation。
* 加载 conversation。
* 加载会话列表。
* 加载指定 conversation 的 messages。
* 管理 `activeConversationId`。
* 管理 `messagesByConversationId`。
* `setMessages`。
* `appendMessage`。
* `appendMessageDelta`。
* `replaceMessage`。
* `markMessageDone`。
* `markMessageFailed`。
* `markMessageAborted`。
* 清空当前会话。
* 刷新指定 conversation 状态。

`useChatRuntimeStore()` 负责：

* 管理每个 conversation 独立的 `ConversationRuntimeState`。
* 管理每个 conversation 独立的 `AbortController`。
* 记录 `streamingMessageId`、运行时错误和临时状态。
* 提供 `ensureRuntimeState`、`setStreaming`、`setStreamingMessageId`、`setAbortController`、`clearAbortController`、`setRuntimeError`、`clearRuntimeError`、`clearRuntimeState` 等 action。
* 不保存 messages。

`useChatStream()` 负责：

* 按 `conversationId` 发送用户输入。
* 按 `conversationId` 读取流式响应。
* 根据 stream event 更新目标 conversation 下的 message 内容。
* 管理每个 conversation 独立的 `AbortController`。
* 停止指定 conversation / message 的生成。
* 失败重试。
* 协调 `useConversationStore()` 和 `useChatRuntimeStore()`，但不自己持有一份全局 streaming 状态。

`useProfileStore()` 负责：

* 读取可用 Assistant Profiles。
* 当前 Profile 状态。
* Profile 切换。

---

## 多会话状态规则

第一阶段允许不同 Conversation 同时 streaming，但同一个 Conversation 同一时间只允许一个 active streaming。

前端状态必须按 `conversationId` 隔离。推荐结构：

```ts
type ConversationRuntimeState = {
  conversationId: string
  isStreaming: boolean
  streamingMessageId: string | null
  abortController: AbortController | null
  error: string | null
}

type ChatRuntimeState = {
  conversationStates: Record<string, ConversationRuntimeState>
}

type ConversationState = {
  activeConversationId: string | null
  conversations: ConversationDTO[]
  messagesByConversationId: Record<string, ChatMessage[]>
}

type ProfileState = {
  currentProfileId: string
  profiles: AssistantProfileDTO[]
}
```

规则：

* 切换 Conversation 时，只切换 `activeConversationId`，不要清空其他 Conversation 的状态。
* 不同 Conversation 的 messages 缓存由 `conversationStore` 按 `conversationId` 隔离。
* 不同 Conversation 的 `isStreaming`、`streamingMessageId`、`abortController` 和 `error` 由 `chatRuntimeStore` 按 `conversationId` 隔离。
* 不同 Conversation 可以同时存在 `isStreaming = true`。
* 同一个 Conversation 内如果 `isStreaming = true`，输入框应禁止再次发送，或展示“当前会话正在生成中”的提示。
* 停止按钮默认只停止当前 active Conversation 的 `streamingMessageId`。
* 如果非当前 Conversation 正在 streaming，可以在会话列表中展示生成中状态。
* 前端收到 stream event 时，必须根据 `messageId` 或请求上下文更新对应 Conversation，不要写入当前 active Conversation 之外的错误位置。

---

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

type AssistantProfileDTO = {
  id: string
  name: string
  description: string
  enabledTools: string[]
  conversationModes?: string[]
}
```

前端类型需要尽量和后端响应保持一致。

---

## 必须覆盖的 UI 状态

第一阶段至少处理：

* 空会话。
* 用户消息已发送。
* assistant streaming。
* assistant done。
* assistant failed。
* assistant aborted。
* 可重试。
* 当前 Conversation 正在生成中。
* 非当前 Conversation 正在生成中。
* 同一 Conversation 重复发送被禁止或提示。
* tool call running。
* tool call success。
* tool call failed。

不要只实现 happy path。

---

## Streaming UI 规则

生成中：

* 展示目标 Conversation 下 assistant 的部分内容。
* 展示停止按钮。
* 同一个 Conversation 生成中时，禁止该 Conversation 再次发送消息。
* 不同 Conversation 的生成状态互不影响。
* 保持输入行为可预期。
* 避免过度重渲染。
* 只有用户接近底部时才自动滚动到底部。
* 如果用户切换到其他 Conversation，原 Conversation 的 stream 仍可继续更新自己的 runtime state。

停止后：

* 保留已生成内容。
* 标记为 `aborted`。
* 允许重试。

失败后：

* 展示错误提示。
* 允许重试。
* 不要自动删除旧内容。

---

## Figma 实现规则

从 Figma 实现页面时，优先映射到已有组件结构，不要按设计稿随意创建一次性组件。

如果任务涉及聊天 UI 还原或组件视觉实现，必须先参考：

* `docs/ui/ui-implements.md`：设计稿到项目组件、Nuxt UI 组件的映射关系。
* `docs/ui/photos/`：当前 UI 需求截图。

`docs/ui/photos/` 当前至少覆盖以下状态：

* 空会话状态。
* 正常对话状态。
* Streaming 状态。
* Tool Call 状态。
* Failed 状态。
* Aborted 状态。
* 多会话同时 Streaming 状态。

实现时优先使用截图理解视觉层级、布局、状态和响应式表现；不要为了还原 Figma 导出结果而直接接入独立 React/Vite 工程，也不要复制与当前 Vue/Nuxt 架构无关的大段导出代码。

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

---

## 当前 UI 组件映射

聊天 UI 需求默认按以下关系落到现有或待补齐的 Vue 组件中：

```text
左侧栏              -> ConversationSidebar.vue
会话项              -> ConversationItem.vue
顶部 Profile 区      -> ChatHeader.vue + ProfileSwitcher.vue
中间消息区域         -> MessageList.vue
用户消息             -> MessageItem.vue
Assistant 消息       -> MessageItem.vue + MarkdownRenderer.vue
CodeBlock            -> CodeBlock.vue
ToolCall 卡片        -> ToolCallCard.vue
底部输入区           -> MessageInput.vue
Failed/Aborted 区块  -> ErrorRetryBlock.vue
```

如果现有组件尚不存在，只有在确实对应稳定职责时才新增；不要为了单张截图拆出一次性组件。

---

## Nuxt UI 组件映射

常见交互优先使用 Nuxt UI：

```text
按钮          -> UButton
输入框        -> UTextarea
状态标签      -> UBadge
卡片          -> UCard
Profile 下拉  -> USelectMenu
错误提示      -> UAlert
Toast        -> UToast
确认弹窗      -> UModal
Tooltip      -> UTooltip
```

如 Nuxt UI 组件与流式聊天状态、无障碍语义或响应式行为冲突，可以使用原生 Vue/HTML 结构加 Tailwind 实现，但需要保持组件职责清晰。
