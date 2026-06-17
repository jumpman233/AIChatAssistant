# docs/api-contract.md

# AIChatAssistant API 契约

## 1. 文档目的

本文档定义 `AIChatAssistant` 第一阶段后端 API 契约。

后端第一阶段使用 Nuxt server routes / Nitro 实现。
API 文件建议位于：

```text id="b0hzqx"
server/api/
```

本文档用于约束：

* API 路径
* 请求参数
* 响应结构
* 错误结构
* 会话 / 消息 / 流式聊天相关行为

如果 API 行为发生变化，需要同步更新本文档。

---

## 2. 通用约定

### 2.1 响应格式

普通 JSON 接口成功时直接返回业务对象或业务列表。

示例：

```json id="x1ykb6"
{
  "id": "conversation_id",
  "title": "新的会话",
  "profileId": "general",
  "mode": "chat",
  "status": "active",
  "createdAt": "2026-06-17T10:00:00.000Z",
  "updatedAt": "2026-06-17T10:00:00.000Z"
}
```

---

### 2.2 错误格式

错误响应统一使用：

```ts id="6eugkd"
type ApiErrorResponse = {
  message: string
  code?: string
  details?: unknown
}
```

示例：

```json id="yns2fu"
{
  "message": "Conversation not found",
  "code": "CONVERSATION_NOT_FOUND"
}
```

要求：

* 不向前端返回 stack trace。
* 不返回 API Key。
* 不返回数据库连接信息。
* 不返回模型供应商密钥或内部敏感配置。

---

### 2.3 时间格式

所有时间字段使用 ISO 字符串。

示例：

```text id="q4063n"
2026-06-17T10:00:00.000Z
```

---

### 2.4 状态枚举

API 层状态值需要与 Prisma enum 和前端类型保持一致。

#### ConversationStatus

```ts id="ctfbh0"
type ConversationStatus = 'active' | 'archived' | 'deleted'
```

#### MessageRole

```ts id="c48cqv"
type MessageRole = 'user' | 'assistant' | 'tool' | 'system'
```

#### MessageStatus

```ts id="uupn20"
type MessageStatus = 'pending' | 'streaming' | 'done' | 'failed' | 'aborted'
```

#### ToolCallStatus

```ts id="p1k8d3"
type ToolCallStatus = 'pending' | 'running' | 'success' | 'failed'
```

#### ToolSource

```ts id="sc91q4"
type ToolSource = 'local' | 'mcp'
```

---

## 3. 核心数据结构

### 3.1 ConversationDTO

```ts id="m5jk5x"
type ConversationDTO = {
  id: string
  title: string | null
  profileId: string
  mode: string
  status: ConversationStatus
  createdAt: string
  updatedAt: string
}
```

---

### 3.2 MessageDTO

```ts id="gg2u0e"
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
  metadata?: unknown
  toolCalls?: ToolCallDTO[]
  createdAt: string
  updatedAt: string
}
```

---

### 3.3 ToolCallDTO

```ts id="80al8u"
type ToolCallDTO = {
  id: string
  messageId: string
  toolName: string
  source: ToolSource
  argumentsJson?: unknown
  resultJson?: unknown
  status: ToolCallStatus
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}
```

---

## 4. Conversation API

## 4.1 创建会话

```http id="9v6o9l"
POST /api/conversations
```

### Request Body

```ts id="xlwhpl"
type CreateConversationRequest = {
  profileId?: string
  mode?: string
  title?: string
}
```

### 默认值

```text id="ebve8h"
profileId = general
mode = chat
title = null
status = active
```

### Response

```ts id="e85xzq"
type CreateConversationResponse = ConversationDTO
```

### 说明

* 如果 `profileId` 不存在，应返回错误。
* 第一阶段 Profile 来自代码配置，不来自数据库。
* 创建会话时不创建默认消息。

---

## 4.2 获取会话列表

```http id="e13fxi"
GET /api/conversations
```

### Query

```ts id="xzdbhr"
type ListConversationsQuery = {
  status?: ConversationStatus
  profileId?: string
  limit?: number
  cursor?: string
}
```

### 默认行为

* 默认不返回 `deleted` 会话。
* 默认按 `updatedAt DESC` 排序。
* 第一阶段可以先不实现 cursor 分页，但接口预留。

### Response

```ts id="h6v0oj"
type ListConversationsResponse = {
  items: ConversationDTO[]
  nextCursor?: string | null
}
```

---

## 4.3 获取单个会话

```http id="x34dc9"
GET /api/conversations/:id
```

### Response

```ts id="jta94c"
type GetConversationResponse = ConversationDTO
```

### 错误

会话不存在：

```json id="9hpavd"
{
  "message": "Conversation not found",
  "code": "CONVERSATION_NOT_FOUND"
}
```

---

## 4.4 删除会话

```http id="xcrljo"
DELETE /api/conversations/:id
```

### 行为

第一阶段使用软删除：

```text id="v8uh90"
Conversation.status = deleted
```

不物理删除 Conversation、Message、ToolCall。

### Response

```ts id="usnuk3"
type DeleteConversationResponse = {
  id: string
  status: 'deleted'
}
```

---

## 5. Message API

## 5.1 获取会话消息列表

```http id="6wr9dp"
GET /api/conversations/:id/messages
```

### Query

```ts id="9wmx5q"
type ListMessagesQuery = {
  afterSeq?: number
  limit?: number
}
```

### 默认行为

* 按 `seq ASC` 排序。
* 如果传入 `afterSeq`，只返回 `seq > afterSeq` 的消息。
* 第一阶段默认返回当前会话全部消息即可。

### Response

```ts id="chll4u"
type ListMessagesResponse = {
  items: MessageDTO[]
}
```

---

## 5.2 中止 assistant 消息

```http id="u2clcv"
POST /api/messages/:id/abort
```

### Request Body

```ts id="ie7oj2"
type AbortMessageRequest = {
  content?: string
}
```

### 行为

用于停止生成后的显式状态修正。

要求：

* 只能中止 `assistant` 消息。
* 如果消息已经是 `done`，不应改成 `aborted`。
* 如果消息状态是 `streaming` 或 `pending`，可以改成 `aborted`。
* 如果请求体带有 `content`，保存当前已生成内容。
* 如果不带 `content`，保留数据库中已有内容。

### Response

```ts id="uvrxhv"
type AbortMessageResponse = MessageDTO
```

---

## 5.3 重试消息

```http id="5nam4l"
POST /api/messages/:id/retry
```

### Request Body

```ts id="60iwlt"
type RetryMessageRequest = {
  profileId?: string
  mode?: string
}
```

### 行为

用于对失败或中止的 assistant message 进行重试。

要求：

* 不覆盖旧的 failed / aborted message。
* 创建新的 assistant message。
* 新 assistant message 的状态进入 `streaming`。
* 新 assistant message 应关联到原始 user message 或旧 assistant message。
* 返回流式响应，或返回新 assistant message 后由前端再次调用 chat 接口。

### 第一阶段推荐实现

第一阶段推荐让 retry 接口直接触发新的流式生成。

```text id="3xvpmy"
POST /api/messages/:id/retry
  ↓
查找原 assistant message
  ↓
找到 parent user message
  ↓
创建新的 assistant message
  ↓
重新调用模型或 mock stream
  ↓
返回 stream
```

如果实现复杂，也可以拆成两步，但需要在代码和文档中保持一致。

---

## 6. Chat API

## 6.1 发送聊天消息

```http id="fya2zv"
POST /api/chat
```

### Request Body

```ts id="m8o771"
type SendChatRequest = {
  conversationId: string
  profileId?: string
  mode?: string
  content: string
  mock?: boolean
}
```

### 字段说明

#### conversationId

目标会话 ID。

必须存在，且不能是 `deleted` 会话。

---

#### profileId

本次消息使用的 Assistant Profile ID。

如果不传，使用 Conversation 的 `profileId`。

---

#### mode

本次消息使用的 Conversation Mode。

如果不传，使用 Conversation 的 `mode`。

第一阶段默认：

```text id="mjhxqm"
chat
```

---

#### content

用户输入内容。

要求：

* 必填。
* trim 后不能为空。
* 第一阶段可以限制最大长度，例如 2000 字符。

---

#### mock

是否强制使用 mock stream。

第一阶段也可以通过环境变量控制 mock 模式。

---

### Response

该接口返回流式响应。

推荐使用 `text/event-stream` 或兼容 `ReadableStream` 的响应格式。

第一阶段需要至少支持以下事件或数据片段：

```ts id="yhk1w7"
type ChatStreamEvent =
  | {
      type: 'message_created'
      userMessage: MessageDTO
      assistantMessage: MessageDTO
    }
  | {
      type: 'text_delta'
      messageId: string
      delta: string
    }
  | {
      type: 'tool_call_created'
      toolCall: ToolCallDTO
    }
  | {
      type: 'tool_call_updated'
      toolCall: ToolCallDTO
    }
  | {
      type: 'message_done'
      message: MessageDTO
    }
  | {
      type: 'message_failed'
      message: MessageDTO
      error: {
        message: string
        code?: string
      }
    }
```

### 推荐流式事件格式

如果使用 SSE，每个事件可以使用：

```text id="s3r2t3"
event: text_delta
data: {"messageId":"xxx","delta":"hello"}
```

如果使用普通 ReadableStream，也需要保证前端可以解析出事件类型。

### 行为

`POST /api/chat` 执行以下流程：

1. 校验 conversation 是否存在且未删除。
2. 解析本次使用的 `profileId` 和 `mode`。
3. 校验用户输入。
4. 创建 user message，状态为 `done`。
5. 创建 assistant message，状态为 `streaming`。
6. 返回 `message_created` 事件。
7. 调用 mock stream 或真实模型 stream。
8. 流式返回 `text_delta`。
9. 如触发工具调用，创建并更新 ToolCall。
10. 正常完成后更新 assistant message 为 `done`。
11. 返回 `message_done` 事件。
12. 失败时更新 assistant message 为 `failed`。
13. 返回 `message_failed` 事件。
14. 客户端中断时尽量保存已生成内容，并将 assistant message 标记为 `aborted`。

### 并发规则

`POST /api/chat` 只作用于请求中的目标 `conversationId`。

允许：

```text
Conversation A 正在 streaming
Conversation B 同时发起 streaming
```

禁止：

```text
Conversation A 已经有 assistant message 正在 streaming
Conversation A 再次发起新的 chat 请求
```

后端处理规则：

1. 不允许使用全局 streaming 锁。
2. 只检查目标 Conversation 内是否存在 `pending` 或 `streaming` 状态的 assistant message。
3. 如果目标 Conversation 已经存在 active streaming message，应返回 `409 Conflict`。
4. 不同 Conversation 的流式请求互不影响。
5. 停止生成时使用 `POST /api/messages/:id/abort`，按 messageId 精确中止，不按 conversationId 全局中止。

冲突错误示例：

```json
{
  "message": "Current conversation already has an active streaming message",
  "code": "CONVERSATION_STREAMING"
}
```


---

## 7. Profile API

第一阶段 Profile 使用代码配置，不入库。

可以提供只读接口给前端使用。

## 7.1 获取 Profile 列表

```http id="l5ioha"
GET /api/profiles
```

### Response

```ts id="p9fy4e"
type AssistantProfileDTO = {
  id: string
  name: string
  description: string
  enabledTools: string[]
  conversationModes?: string[]
}
```

注意：

* 不一定要把完整 `systemPrompt` 返回给前端。
* `systemPrompt` 可以只在服务端使用。

---

## 8. Tool API

第一阶段不要求提供独立工具执行接口。
工具调用由模型生成后，在 `POST /api/chat` 或 retry 流程中由后端执行。

可以提供只读接口用于前端展示可用工具。

## 8.1 获取工具列表

```http id="2ujwrd"
GET /api/tools
```

### Response

```ts id="prmhy9"
type ToolDTO = {
  name: string
  description: string
  source: ToolSource
}
```

注意：

* 不返回内部 execute 逻辑。
* 不返回敏感配置。
* 不开放任意工具调用接口。

---

## 9. 状态更新规则

### 9.1 User Message

创建后直接进入：

```text id="qn3u4w"
done
```

---

### 9.2 Assistant Message

正常生成：

```text id="8oysyy"
pending -> streaming -> done
```

失败：

```text id="4npcd4"
pending -> streaming -> failed
```

停止：

```text id="3kg4hj"
pending -> streaming -> aborted
```

第一阶段可以创建时直接设为：

```text id="k04z9j"
streaming
```

---

### 9.3 ToolCall

成功：

```text id="x9v9k2"
pending -> running -> success
```

失败：

```text id="qgntvy"
pending -> running -> failed
```

---

## 10. 第一阶段接口清单

必须实现：

```text id="p64ez5"
POST   /api/conversations
GET    /api/conversations
GET    /api/conversations/:id
DELETE /api/conversations/:id

GET    /api/conversations/:id/messages

POST   /api/chat
POST   /api/messages/:id/abort
POST   /api/messages/:id/retry

GET    /api/profiles
```

可选实现：

```text id="gr99mx"
GET    /api/tools
```

POST /api/chat 必须支持不同 conversationId 的并发请求，但必须拒绝同一 conversationId 内的并发生成。

---

## 11. 第一阶段明确不提供的接口

第一阶段不要实现：

```text id="ed98ee"
POST /api/login
POST /api/register
POST /api/upload
POST /api/rag/query
POST /api/mcp/connect
POST /api/tools/:name/execute
POST /api/email/send
POST /api/calendar/create
POST /api/files/delete
```

不要暴露任意工具执行接口。
不要让前端绕过模型流程直接执行高风险工具。
