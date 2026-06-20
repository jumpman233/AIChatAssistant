# docs/api-contract.md

# AIChatAssistant API 契约

## 1. 文档目的

本文档定义 `AIChatAssistant` 第一阶段前后端 API 契约。

本文档回答：

- 前端可以调用哪些接口
- 每个接口的请求参数是什么
- 每个接口的响应结构是什么
- 错误结构是什么
- 流式接口使用什么协议
- SSE 事件类型和字段是什么
- 历史消息如何分页拉取
- 多会话 streaming 状态如何暴露给前端

如果本文档与其他文档冲突，优先级建议如下：

```text
1. docs/api-contract.md
2. docs/architecture/streaming-protocol.md
3. docs/rules/chat-flow.md
4. docs/architecture/chat-flow-diagrams.md
5. docs/ui/ui-implements.md
```

---

## 2. 通用约定

### 2.1 数据格式

普通 API：

```http
Content-Type: application/json
Accept: application/json
```

流式 API：

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
```

时间字段统一使用 ISO 8601 字符串。

示例：

```text
2026-06-18T10:00:00.000Z
```

---

### 2.2 通用错误响应

普通 JSON API 或 SSE stream 开始前的错误，统一使用 JSON 返回：

```ts
type ApiErrorResponse = {
  message: string
  code?: string
  details?: unknown
}
```

示例：

```json
{
  "message": "Current conversation already has an active streaming message",
  "code": "CONVERSATION_STREAMING"
}
```

常见错误码：

```text
BAD_REQUEST
NOT_FOUND
CONVERSATION_DELETED
CONVERSATION_STREAMING
MESSAGE_NOT_RETRYABLE
MESSAGE_NOT_ABORTABLE
INTERNAL_ERROR
```

常见 HTTP 状态码：

| 状态码 | 使用场景 |
|---|---|
| `400` | 请求参数错误 |
| `404` | conversation / message 不存在 |
| `409` | 状态冲突，例如同一 Conversation 已有 active streaming |
| `500` | 服务端内部错误 |

---

### 2.3 stream 开始前错误与 stream 开始后错误

流式接口有两个错误边界。

#### stream 开始前错误

在 SSE stream 尚未开始前发生的错误，使用普通 JSON error + HTTP status 返回。

例子：

- `conversationId` 不存在
- conversation 已 `deleted`
- `content` 为空
- `profileId` 无效
- 同一 Conversation 已有 active streaming

示例：

```http
HTTP/1.1 409 Conflict
Content-Type: application/json
```

```json
{
  "message": "Current conversation already has an active streaming message",
  "code": "CONVERSATION_STREAMING"
}
```

#### stream 开始后错误

一旦 SSE stream 已经开始，就不能再通过 HTTP status 表达业务错误。

此时必须发送 SSE event：

```text
event: message_failed
data: {...}
```

然后关闭 stream。

---

## 3. 核心 DTO

### 3.1 ConversationDTO

```ts
type ConversationStatus = 'active' | 'archived' | 'deleted'

type ConversationDTO = {
  id: string
  title: string | null
  profileId: string
  mode: string
  status: ConversationStatus

  /**
   * 当前 Conversation 是否存在 active assistant message。
   *
   * active assistant message 定义：
   * role = assistant
   * status in ['pending', 'streaming']
   */
  isStreaming: boolean

  /**
   * 当前 active assistant message id。
   * 如果 isStreaming = false，则为 null。
   */
  activeAssistantMessageId: string | null

  createdAt: string
  updatedAt: string
}
```

说明：

- `isStreaming` 和 `activeAssistantMessageId` 用于让非发起生成的页面知道某个会话正在生成。
- MVP 阶段不做跨页面实时 delta 同步。
- 发起生成的页面通过 SSE 实时接收 delta。
- 其他页面只能看到该 Conversation 正在 streaming；生成完成后通过重新拉取 messages 获得最终内容。

---

### 3.2 MessageDTO

```ts
type MessageRole = 'user' | 'assistant' | 'tool' | 'system'
type MessageStatus = 'pending' | 'streaming' | 'done' | 'failed' | 'aborted'

type MessageDTO = {
  id: string
  conversationId: string
  parentMessageId: string | null

  role: MessageRole
  content: string
  profileId: string
  mode: string
  status: MessageStatus

  seq: number

  model: string | null
  errorMessage: string | null
  metadata: unknown | null

  toolCalls: ToolCallDTO[]

  createdAt: string
  updatedAt: string
}
```

说明：

- 消息列表默认按 `seq ASC` 返回。
- `parentMessageId` 第一阶段主要用于表达 assistant message 对应的 user message。
- 重试时新 assistant message 不覆盖旧 message，而是创建新 message。
- 新 retry assistant message 的 `parentMessageId` 指向同一条 user message。

---

### 3.3 ToolCallDTO

```ts
type ToolCallStatus = 'pending' | 'running' | 'success' | 'failed'
type ToolSource = 'local' | 'mcp'

type ToolCallDTO = {
  id: string
  messageId: string

  toolName: string
  source: ToolSource

  arguments: unknown | null
  result: unknown | null

  status: ToolCallStatus
  errorMessage: string | null

  startedAt: string | null
  finishedAt: string | null

  createdAt: string
  updatedAt: string
}
```

说明：

- DTO 使用 `arguments` / `result`。
- 数据库字段可以是 `argumentsJson` / `resultJson`，但前端不直接感知数据库字段名。
- ToolCall 必须关联到 assistant message。
- `messageId` 保留为 ToolCallDTO 字段，用于表达数据库关联到哪条 assistant message。
- V5 不新增重复含义字段；SSE 事件里的 `assistantMessageId` 是事件语义字段，不替代 ToolCallDTO 里的 `messageId`。

---

### 3.4 AssistantProfileDTO

```ts
type AssistantProfileDTO = {
  id: string
  name: string
  description: string
  enabledTools: string[]
  conversationModes: string[]
}
```

说明：

- 第一阶段 `AssistantProfile` 不入库。
- Profile 由服务端代码配置。
- `GET /api/profiles` 默认不返回完整 `systemPrompt`，避免前端依赖 prompt 细节。

---

### 3.5 ToolDTO

```ts
type ToolDTO = {
  name: string
  description: string
  source: ToolSource
}
```

---

## 4. 普通 JSON API

普通 JSON API 返回 `application/json`。

---

## 4.1 POST /api/conversations

### 用途

创建一个新的 Conversation。

典型场景：

- 用户点击“新建会话”
- 用户首次进入页面且没有 active conversation
- 用户点击“清空当前会话”时采用“创建新会话”策略

### Request Body

```ts
type CreateConversationRequest = {
  profileId?: string
  mode?: string
  title?: string | null
}
```

默认值：

```ts
profileId = 'general'
mode = 'chat'
title = null
```

### Response

```ts
type CreateConversationResponse = ConversationDTO
```

---

## 4.2 GET /api/conversations

### 用途

获取 Conversation 列表，用于左侧会话列表。

典型场景：

- 页面初始化
- 刷新页面恢复会话列表
- 创建新会话后刷新列表
- 删除会话后刷新列表
- 查看哪些会话正在 streaming

### Query

```ts
type ListConversationsQuery = {
  status?: 'active' | 'archived' | 'deleted'
  profileId?: string
  limit?: number
  cursor?: string
}
```

默认规则：

- 默认不返回 `deleted`
- 默认按 `updatedAt DESC`
- `limit` 默认 `50`

### Response

```ts
type ListConversationsResponse = {
  items: ConversationDTO[]
  nextCursor: string | null
}
```

---

## 4.3 GET /api/conversations/:id

### 用途

获取单个 Conversation 详情。

典型场景：

- 用户点击某个会话
- URL 直接打开指定 conversation
- 刷新页面恢复当前会话
- 发送消息前校验当前 conversation 是否有效

### Response

```ts
type GetConversationResponse = ConversationDTO
```

### deleted 会话规则

第一阶段建议：

- `deleted` conversation 默认视为不可访问。
- `GET /api/conversations/:id` 对 deleted conversation 返回 `404`。
- `POST /api/chat` 不允许对 deleted conversation 发送消息。

---

## 4.4 DELETE /api/conversations/:id

### 用途

软删除 Conversation。

### 行为

不是物理删除数据库记录，而是：

```text
Conversation.status = deleted
```

### Response

```ts
type DeleteConversationResponse = {
  id: string
  status: 'deleted'
}
```

### 规则

- deleted 会话不出现在 `GET /api/conversations` 默认列表中。
- deleted 会话不能继续发送消息。
- deleted 会话的 messages 保留在数据库中。
- 第一阶段不提供物理删除接口。

---

## 4.5 GET /api/conversations/:id/messages

### 用途

拉取某个 Conversation 的历史消息。

典型场景：

- 用户点击会话
- 刷新页面恢复聊天记录
- 发送完成后重新校准本地消息
- 另一个页面手动刷新消息列表
- 生成完成后，非发起生成页面重新拉取最终消息

### Query

```ts
type ListMessagesQuery = {
  /**
   * 返回数量。
   * 默认 50。
   * 建议最大值 100。
   */
  limit?: number

  /**
   * 拉取 seq 小于 beforeSeq 的消息。
   * 用于向更早历史翻页。
   */
  beforeSeq?: number

  /**
   * 拉取 seq 大于 afterSeq 的消息。
   * 用于获取某个 seq 之后的新消息。
   */
  afterSeq?: number
}
```

### 默认规则

- `limit` 默认 `50`
- 按 `seq ASC` 返回
- `beforeSeq` 和 `afterSeq` 第一阶段不建议同时使用
- 如果未传 `beforeSeq` / `afterSeq`，返回最近 `limit` 条消息，并按 `seq ASC` 输出
- 如果传 `beforeSeq`，返回 `seq < beforeSeq` 的最近 `limit` 条消息，并按 `seq ASC` 输出
- 如果传 `afterSeq`，返回 `seq > afterSeq` 的最多 `limit` 条消息，并按 `seq ASC` 输出

### Response

```ts
type ListMessagesResponse = {
  items: MessageDTO[]

  pageInfo: {
    limit: number
    hasMoreBefore: boolean
    hasMoreAfter: boolean
    beforeSeq: number | null
    afterSeq: number | null
  }
}
```

### 示例：首次加载

```http
GET /api/conversations/conv_a/messages?limit=50
```

返回最近 50 条消息，按 `seq ASC` 输出。

### 示例：向上加载更早消息

```http
GET /api/conversations/conv_a/messages?limit=50&beforeSeq=101
```

返回 `seq < 101` 的最近 50 条消息，按 `seq ASC` 输出。

### 示例：拉取某个 seq 之后的新消息

```http
GET /api/conversations/conv_a/messages?limit=50&afterSeq=120
```

返回 `seq > 120` 的最多 50 条消息，按 `seq ASC` 输出。

### 多页面行为

MVP 阶段不做跨页面实时 delta 同步。

如果页面 A 正在通过 SSE 接收 Conversation X 的实时 delta，页面 B 打开同一个 Conversation X 时：

- 页面 B 可以通过 `GET /api/conversations/:id` 知道该 Conversation 正在 streaming。
- 页面 B 通过 `GET /api/conversations/:id/messages` 只能拿到数据库中已落库的消息。
- 因为第一阶段不每个 token 写库，页面 B 不一定能看到 partial content。
- 生成完成后，页面 B 需要重新调用 `GET /api/conversations/:id/messages` 获得最终消息。

---

## 4.6 GET /api/profiles

### 用途

获取可用 Assistant Profile 列表。

典型场景：

- 页面初始化
- ProfileSwitcher 展示选项
- 创建会话时选择 profileId

### Response

```ts
type ListProfilesResponse = {
  items: AssistantProfileDTO[]
}
```

---

## 4.7 GET /api/tools 可选

### 用途

获取可用工具列表。

典型场景：

- 调试页面
- Tool Registry 展示
- Profile 说明
- README demo

### Response

```ts
type ListToolsResponse = {
  items: ToolDTO[]
}
```

说明：该接口第一阶段可选。即使不提供 `GET /api/tools`，后端仍然需要有 Tool Registry。

---

## 4.8 POST /api/messages/:id/abort

### 用途

显式停止并标记某条 assistant message 为 `aborted`。

### Request Body

```ts
type AbortMessageRequest = {
  /**
   * 停止时前端已经从 SSE 收到并拼接的 rawContent。
   * 允许为空字符串。
   */
  content: string
}
```

### Response

```ts
type AbortMessageResponse = MessageDTO
```

### 规则

- 只能作用于 assistant message。
- 只允许当前状态为 `pending` / `streaming` 时变成 `aborted`。
- 对已经 `aborted` 的 assistant message 重复调用时幂等成功，返回当前 MessageDTO。
- 对 `done` / `failed` / 非 assistant message 调用时返回 `409 MESSAGE_NOT_ABORTABLE`。
- message 不存在时按现有 not found 规范返回 `404 NOT_FOUND`。
- abort 请求体中的 `content` 是前端收到的 `rawContent`，不是 `displayContent`。
- abort 只影响目标 `messageId`，不影响其他 Conversation。
- abort 成功后返回最终 `MessageDTO`，状态为 `aborted`。

---

## 5. 流式 API：SSE

流式 API 返回 `text/event-stream`。

第一阶段有两个流式接口：

```text
POST /api/chat
POST /api/messages/:id/retry
```

二者使用同一套 SSE event 格式。

---

## 5.1 SSE Frame 格式

每个事件使用标准 SSE frame：

```text
id: <eventId>
event: <eventType>
data: <json>
```

事件之间使用空行分隔。

示例：

```text
id: evt_001
event: text_delta
data: {"type":"text_delta","streamId":"stream_xxx","conversationId":"conv_xxx","messageId":"msg_xxx","delta":"你好"}

```

要求：

- `event` 字段必须等于 `data.type`
- `data` 必须是 JSON 字符串
- 每个事件必须有 `streamId`
- 每个事件必须有 `conversationId`
- 涉及具体 message 的事件必须有 `messageId` 或完整 `message`
- 前端必须按 SSE frame 解析，不要当纯文本 chunk 处理

---

## 5.2 ChatStreamEvent

```ts
type ChatStreamEvent =
  | {
      type: 'message_created'
      streamId: string
      conversationId: string
      userMessage: MessageDTO
      assistantMessage: MessageDTO
    }
  | {
      type: 'retry_created'
      streamId: string
      conversationId: string
      sourceAssistantMessageId: string
      assistantMessage: MessageDTO
    }
  | {
      type: 'text_delta'
      streamId: string
      conversationId: string
      messageId: string
      delta: string
    }
  | {
      type: 'tool_call_created'
      streamId: string
      conversationId: string
      assistantMessageId: string
      toolCall: ToolCallDTO
    }
  | {
      type: 'tool_call_updated'
      streamId: string
      conversationId: string
      assistantMessageId: string
      toolCall: ToolCallDTO
    }
  | {
      type: 'message_done'
      streamId: string
      conversationId: string
      message: MessageDTO
    }
  | {
      type: 'message_failed'
      streamId: string
      conversationId: string
      message: MessageDTO
      error: {
        message: string
        code?: string
      }
    }
```

---

## 5.3 POST /api/chat

### 用途

发送一条新的用户消息，并创建新的 assistant 流式回复。

### Request Body

```ts
type CreateChatRequest = {
  conversationId: string
  profileId?: string
  mode?: string
  content: string

  /**
   * 第一阶段用于控制 mock stream 行为。
   * 真实模型接入后可以移除或改为内部测试参数。
   */
  mock?: {
    delayMs?: number
    /**
     * 仅用于 Mock Provider / Harness。
     * 表示在指定 chunk 位置制造 Provider failure。
     */
    failAtChunk?: number
    triggerTools?: boolean
  }
}
```

默认值：

```ts
profileId = conversation.profileId
mode = conversation.mode
```

### Response

成功时：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
```

返回 SSE event stream。

### 后端流程

1. 校验 request body。
2. 校验 conversation 存在且未 deleted。
3. 校验 profileId 有效。
4. 校验 content 非空。
5. 检查目标 conversation 是否已有 active assistant message。
6. 如果已有，返回 `409 CONVERSATION_STREAMING`，不打开 SSE stream。
7. 生成 `streamId`。
8. 在数据库事务中创建 user message 和 assistant message。
9. 发送 `message_created` SSE event。
10. 开始 mock/model stream。
11. 持续发送 `text_delta`。
12. 如有工具调用，发送：
    - `tool_call_created(pending)`
    - `tool_call_updated(running)`
    - `tool_call_updated(success | failed)`
13. 正常完成后更新 assistant message 为 `done`，发送 `message_done`。
14. stream 开始后失败时，更新 assistant message 为 `failed`，发送 `message_failed`。
15. 关闭 stream。

### active streaming 冲突

如果目标 conversation 已有 active assistant message：

```text
role = assistant
status in ['pending', 'streaming']
```

返回：

```http
HTTP/1.1 409 Conflict
Content-Type: application/json
```

```json
{
  "message": "Current conversation already has an active streaming message",
  "code": "CONVERSATION_STREAMING"
}
```

---

## 5.4 POST /api/messages/:id/retry

### 用途

对 failed / aborted assistant message 发起重试，创建新的 assistant message，并返回新的 SSE stream。

### Request Body

```ts
type RetryMessageRequest = {
  mock?: {
    delayMs?: number
    failAtChunk?: number
    triggerTools?: boolean
  }
}
```

### Response

成功时返回：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
```

并返回 retry 专用 SSE event sequence：

```text
retry_created
-> tool_call_created(pending)
-> tool_call_updated(running)
-> tool_call_updated(success | failed)
-> text_delta*
-> message_done | message_failed
```

### 规则

- 只允许 retry `failed` / `aborted` assistant message。
- 对 `done` / `pending` / `streaming` / 非 assistant message 返回 `409 MESSAGE_NOT_RETRYABLE`。
- 不覆盖旧 message。
- 创建新的 assistant message。
- 新 assistant message 的 `parentMessageId` 指向同一条 user message。
- 不重新创建 user message。
- retry 请求体默认不需要重新传 `conversationId`、`profileId`、`mode` 或 `content`；这些信息从原 assistant message 和其 parent user message 获取。
- retry 前必须检查目标 conversation 是否已有 active assistant message。
- 如果已有，返回 `409 CONVERSATION_STREAMING`。
- message 不存在时按现有 not found 规范返回 `404 NOT_FOUND`。
- retry 使用与 `POST /api/chat` 相同的 SSE frame、parser、Provider Adapter、delta 标准化和 done / failed 终态更新。
- retry 首事件必须是 `retry_created`，不得复用普通发送的 `message_created`。

### retry_created

```text
event: retry_created
```

data：

```ts
type RetryCreatedEvent = {
  type: 'retry_created'
  streamId: string
  conversationId: string
  sourceAssistantMessageId: string
  assistantMessage: MessageDTO
}
```

语义：

- `sourceAssistantMessageId` 是被 retry 的 failed / aborted assistant。
- `assistantMessage` 是新创建的 streaming assistant。
- 新 assistant 的 `parentMessageId` 指向原 user message。
- 旧 failed / aborted assistant 保留。
- `event` 必须等于 `data.type`。

### Mock 失败配置

`mock.failAtChunk` 只适用于 Mock Provider / Harness：

- 表示在指定 chunk 位置制造 Provider failure。
- 允许先输出 partial `text_delta`，再失败并发送 `message_failed`。
- 非法值按现有请求校验规范处理。
- Ark Provider 不接收、不透传该配置。

### ToolCall SSE 规则

命中工具调用时，普通发送应返回：

```text
message_created
-> tool_call_created(pending)
-> tool_call_updated(running)
-> tool_call_updated(success | failed)
-> text_delta*
-> message_done
```

关键约束：

1. `tool_call_created` 中的 `toolCall.status` 必须为 `pending`。
2. 同一个 ToolCall id 先收到一次 `running`，再收到一次 terminal update。
3. `streamId`、`conversationId`、`assistantMessageId` 和 `toolCall.id` 在同一轮 ToolCall 中必须保持一致。
4. ToolCall 失败不等于 assistant message 失败；V5 工具失败仍应由 assistant 输出安全说明，并以 `message_done` 收尾。
5. `tool_call_created` / `tool_call_updated` 的 `event` 必须等于 `data.type`。
6. `assistantMessageId === toolCall.messageId`。
7. `assistantMessageId` 是事件字段名，用于前端快速定位 assistant message；数据库外键名继续保持 `messageId`。

---

## 6. 多页面 / 多 Tab 行为边界

MVP 阶段不做跨页面实时 delta 同步。

明确边界：

```text
发起生成的页面：实时接 SSE delta。
其他页面：能看到该 conversation 正在 streaming，但不实时同步 delta。
生成完成后：其他页面通过刷新或重新拉取 messages 获得最终内容。
```

实现方式：

- `GET /api/conversations` 返回 `isStreaming` / `activeAssistantMessageId`，用于左侧会话列表展示生成中状态。
- `GET /api/conversations/:id` 返回 `isStreaming` / `activeAssistantMessageId`，用于进入会话时判断状态。
- `GET /api/conversations/:id/messages` 返回数据库中已落库的消息，不保证包含 streaming 中的 partial content。
- 不提供独立 `GET /api/conversations/:id/status` 接口。
- 不提供 `GET /api/conversations/:id/events` 订阅接口。
- 不做 BroadcastChannel / WebSocket / 多端实时同步。

---

## 7. 前端处理要求

### 7.1 Store 分工

```text
conversationStore:
- conversations
- activeConversationId
- messagesByConversationId
- appendMessage
- appendMessageDelta
- replaceMessage
- markMessageDone
- markMessageFailed
- markMessageAborted

chatRuntimeStore:
- conversationStates
- streamId
- isStreaming
- streamingMessageId
- abortController
- runtime error

profileStore:
- currentProfileId
- profiles
```

### 7.2 SSE Event 处理

前端 `useChatStream` 收到 SSE event 后：

| event | 前端动作 |
|---|---|
| `message_created` | 插入 userMessage 和 assistantMessage；记录 streamId / streamingMessageId |
| `retry_created` | 保留 source assistant，插入新的 assistantMessage；记录 streamId / streamingMessageId |
| `text_delta` | 按 conversationId + messageId 追加 delta |
| `tool_call_created` | 在 `assistantMessageId` 对应的 assistant message 上插入 pending ToolCall |
| `tool_call_updated` | 在 `assistantMessageId` 对应的 assistant message 上更新同一个 ToolCall |
| `message_done` | 用后端最终 message 覆盖本地 message；清理 runtime |
| `message_failed` | 用 failed message 覆盖本地 message；保存错误；清理 runtime |

### 7.3 防止事件写错 Conversation

前端处理 SSE event 时必须使用 event 中的：

- `streamId`
- `conversationId`
- `messageId`

不要默认写入当前 active conversation。

原因：

- 用户可能在 stream 过程中切换 conversation。
- 不同 conversation 可以同时 streaming。
- 多个 stream event 可能交错到达。

---

## 8. Harness 复用要求

Harness 需要复用同一套 SSE parser。

建议封装：

```ts
readSseStream(response): Promise<ChatStreamEvent[]>
```

要求：

- 按标准 SSE frame 解析
- 校验 `event` 和 `data.type` 一致
- 收集所有 ChatStreamEvent
- 支持超时
- 支持中断
- 失败时输出原始 SSE 片段，便于定位

V2、V3、V4、V5、V9 Harness 都必须复用该 parser。

---

## 9. 第一阶段不提供的接口

第一阶段不提供：

- 登录注册
- 用户权限
- Organization
- 文件上传
- RAG 检索接口
- 真实 MCP 接入接口
- WebSocket
- 跨页面实时 delta 同步接口
- `GET /api/conversations/:id/status`
- `GET /api/conversations/:id/events`
- 任意工具执行接口
- 高风险工具接口
- 物理删除 Conversation 接口

