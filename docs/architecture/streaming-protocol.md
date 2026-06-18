# docs/architecture/streaming-protocol.md

# AIChatAssistant SSE 流式协议实现说明

## 1. 文档目的

本文档定义 `AIChatAssistant` 第一阶段的流式协议实现细节。

本文档回答：

- 为什么使用 SSE
- 后端如何返回标准 SSE
- 前端如何读取和解析 SSE
- `POST /api/chat` 的完整生命周期
- `POST /api/messages/:id/retry` 如何复用同一套流协议
- stream 开始前错误和 stream 开始后错误如何区分
- abort 如何处理竞态
- 多会话同时 streaming 如何隔离
- 非发起生成页面如何感知 conversation 正在 streaming
- Harness 如何复用同一套 SSE parser

本文档不重复定义完整 API 字段。字段、DTO、HTTP 状态码和事件类型以：

```text
docs/api-contract.md
```

为准。

如果本文档与其他文档冲突，优先级建议如下：

```text
1. docs/api-contract.md
2. docs/architecture/streaming-protocol.md
3. docs/rules/chat-flow.md
4. docs/architecture/chat-flow-diagrams.md
```

---

## 2. 核心设计原则

### 2.1 使用标准 SSE frame

第一阶段流式接口使用标准 SSE frame：

```text
id: <eventId>
event: <eventType>
data: <json>

```

要求：

- `Content-Type` 必须是 `text/event-stream; charset=utf-8`
- 每个事件以空行结束
- `data` 必须是 JSON 字符串
- `event` 必须等于 `data.type`
- 前端必须按 SSE frame 解析，不要按纯文本 chunk 处理

---

### 2.2 使用 POST + fetch 读取 SSE

第一阶段保留：

```text
POST /api/chat
POST /api/messages/:id/retry
```

这两个接口都需要 request body，因此前端不使用浏览器原生 `EventSource`。

前端使用：

```ts
fetch(url, {
  method: 'POST',
  body: JSON.stringify(payload),
  signal: abortController.signal,
})
```

然后读取：

```ts
response.body.getReader()
```

说明：

- 协议格式仍然是标准 SSE。
- 客户端读取方式是 `fetch + ReadableStream`。
- 这样可以支持 POST body、AbortController、后续鉴权和更精确的错误处理。

---

### 2.3 后端状态是权威来源

原则：

```text
数据库里的 Message / ToolCall = 最终可信状态
前端 conversationStore = 后端数据的前端缓存
前端 chatRuntimeStore = 当前流式请求的运行时状态
```

前端可以实时拼接 `text_delta`，但在收到 `message_done` / `message_failed` 后，应以后端返回的完整 `MessageDTO` 覆盖本地 message。

---

### 2.4 不每个 token 写数据库

流式过程中不要每个 token 都写数据库。

推荐策略：

```text
服务端内存累积 fullContent
前端实时展示 delta
完成 / 停止 / 失败时再落库
```

原因：

- 降低数据库写入频率
- 避免流式输出卡顿
- 降低实现复杂度
- 避免大量无意义 update

---

### 2.5 MVP 不做跨页面实时 delta 同步

第一阶段明确边界：

```text
发起生成的页面：实时接 SSE delta。
其他页面：能看到该 conversation 正在 streaming，但不实时同步 delta。
生成完成后：其他页面通过刷新或重新拉取 messages 获得最终内容。
```

实现方式：

- `GET /api/conversations` 返回 `isStreaming` / `activeAssistantMessageId`
- `GET /api/conversations/:id` 返回 `isStreaming` / `activeAssistantMessageId`
- `GET /api/conversations/:id/messages` 返回数据库中已落库的消息
- 不提供 `GET /api/conversations/:id/status`
- 不提供 `GET /api/conversations/:id/events`
- 不使用 WebSocket
- 不做 BroadcastChannel 多 Tab 同步
- 不做多端实时 delta 广播

---

## 3. SSE Event 基本结构

每个 SSE event 的 `data` 都是一个 `ChatStreamEvent`。

事件类型以 `docs/api-contract.md` 为准，第一阶段至少包含：

```text
message_created
text_delta
tool_call_created
tool_call_updated
message_done
message_failed
```

每个事件必须包含：

```text
streamId
conversationId
```

涉及具体 assistant message 的事件必须包含：

```text
messageId
```

或包含完整：

```text
message: MessageDTO
```

---

## 4. eventId 与 streamId

### 4.1 streamId

`streamId` 表示一次流式生成请求。

每次调用以下接口时，后端都生成新的 `streamId`：

```text
POST /api/chat
POST /api/messages/:id/retry
```

作用：

- 区分不同 Conversation 的并发 stream
- 区分同一个 Conversation 中不同时间的 stream
- 防止前端把旧 stream 的事件写入错误位置
- 方便 Harness 收集和断言某次请求的事件序列

前端收到事件后，应同时校验：

```text
conversationId
streamId
messageId
```

不要只依赖当前 active conversation。

---

### 4.2 eventId

`eventId` 表示某个 stream 内的事件序号。

建议格式：

```text
evt_<streamId>_<seq>
```

或简单使用：

```text
1
2
3
...
```

第一阶段不要求支持断线重连和 `Last-Event-ID` 恢复。

`eventId` 的主要作用是：

- 调试
- Harness 输出定位
- 事件顺序观察

---

## 5. 后端 SSE 写入规则

### 5.1 推荐响应头

流式接口成功时返回：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
```

如果部署环境支持，也可以补充：

```http
X-Accel-Buffering: no
```

用于避免某些反向代理缓冲响应。

---

### 5.2 写入函数建议

服务端可以封装一个统一函数：

```ts
type WriteSseEventInput = {
  id: string
  event: string
  data: unknown
}

function writeSseEvent(input: WriteSseEventInput) {
  return [
    `id: ${input.id}`,
    `event: ${input.event}`,
    `data: ${JSON.stringify(input.data)}`,
    '',
    '',
  ].join('\n')
}
```

要求：

- `event` 等于 `data.type`
- 每个事件后必须有空行
- 不要把多个 JSON 直接拼成普通文本
- 不要返回非结构化 token chunk

---

## 6. POST /api/chat 生命周期

### 6.1 stream 开始前

后端在打开 SSE stream 前必须完成以下校验：

1. 校验 request body 格式。
2. 校验 `conversationId` 存在。
3. 校验 conversation 未 `deleted`。
4. 校验 `profileId` 有效。
5. 校验 `content` 非空。
6. 检查目标 Conversation 是否已有 active assistant message。

active assistant message 定义：

```text
role = assistant
status in ['pending', 'streaming']
```

如果存在 active assistant message，返回普通 JSON error：

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

注意：

- 该错误发生在 stream 开始前。
- 不要打开 SSE stream。
- 不要创建新的 user message。
- 不要创建新的 assistant message。

---

### 6.2 创建消息

通过校验后：

1. 生成 `streamId`。
2. 在同一个数据库事务中创建 user message 和 assistant message。
3. user message：
   - `role = user`
   - `status = done`
   - `content = 用户输入`
4. assistant message：
   - `role = assistant`
   - `status = streaming`
   - `content = ''`
   - `parentMessageId = userMessage.id`
5. 分配同一 Conversation 内连续 `seq`。

事务要求：

```text
创建 user message 和 assistant message 必须在同一个 transaction 中完成。
```

原因：

- 避免 seq 竞争
- 避免 user message 创建成功但 assistant message 创建失败
- 保证前端收到 `message_created` 后两条 message 都有稳定 id

---

### 6.3 发送 message_created

消息创建成功后，第一个 SSE event 必须是：

```text
event: message_created
```

data 包含：

```ts
{
  type: 'message_created',
  streamId: string,
  conversationId: string,
  userMessage: MessageDTO,
  assistantMessage: MessageDTO
}
```

前端收到后：

- 插入 user message
- 插入 assistant message 占位
- 设置该 Conversation 的 `isStreaming = true`
- 记录 `streamId`
- 记录 `streamingMessageId = assistantMessage.id`

---

### 6.4 发送 text_delta

生成过程中，每个可展示文本增量发送：

```text
event: text_delta
```

data 包含：

```ts
{
  type: 'text_delta',
  streamId: string,
  conversationId: string,
  messageId: string,
  delta: string
}
```

后端同时在内存中累积：

```text
fullContent += delta
```

要求：

- 不每个 delta 写数据库
- `messageId` 必须是当前 assistant message id
- `conversationId` 必须是目标 conversation id
- 前端根据 `conversationId + messageId` 追加内容

---

### 6.5 正常完成 message_done

生成正常结束时：

1. 后端更新 assistant message：
   - `content = fullContent`
   - `status = done`
2. 查询或组装最终 `MessageDTO`
3. 发送：

```text
event: message_done
```

data 包含：

```ts
{
  type: 'message_done',
  streamId: string,
  conversationId: string,
  message: MessageDTO
}
```

前端收到后：

- 用后端返回的完整 `MessageDTO` 替换本地 assistant message
- 清理该 Conversation 的 runtime state
- `isStreaming = false`
- `streamId = null`
- `streamingMessageId = null`
- `abortController = null`
- `error = null`

---

### 6.6 stream 开始后失败 message_failed

如果 SSE stream 已经开始，生成过程中发生错误：

1. 停止继续输出。
2. 保存当前已生成 `partialContent`。
3. 更新 assistant message：
   - `content = partialContent`
   - `status = failed`
   - `errorMessage = 安全错误信息`
4. 发送：

```text
event: message_failed
```

data 包含：

```ts
{
  type: 'message_failed',
  streamId: string,
  conversationId: string,
  message: MessageDTO,
  error: {
    message: string,
    code?: string
  }
}
```

前端收到后：

- 用 failed `MessageDTO` 替换本地 assistant message
- 展示错误提示
- 展示重试入口
- 清理该 Conversation 的 runtime state

错误信息不得包含：

- stack trace
- API Key
- 数据库连接信息
- 模型供应商密钥
- 服务器内部敏感路径
- 大量原始错误对象

---

## 7. POST /api/messages/:id/retry 生命周期

`retry` 使用与 `POST /api/chat` 相同的 SSE 协议和前端 parser。

### 7.1 stream 开始前

后端必须先校验：

1. message 存在。
2. message 是 assistant message。
3. message status 是 `failed` 或 `aborted`。
4. 找到对应 parent user message。
5. Conversation 存在且未 deleted。
6. 目标 Conversation 不存在 active assistant message。

如果不满足，返回普通 JSON error，不打开 SSE stream。

---

### 7.2 创建新 assistant message

retry 不覆盖旧 message。

后端创建新的 assistant message：

```text
role = assistant
status = streaming
parentMessageId = sameUserMessage.id
content = ''
```

旧 failed / aborted message 必须保留。

---

### 7.3 retry 的 message_created

retry 的第一个 SSE event 仍然使用：

```text
event: message_created
```

但 data 中可以只包含新 assistant message，也可以为了统一仍返回：

```ts
{
  type: 'message_created',
  streamId: string,
  conversationId: string,
  userMessage: MessageDTO,
  assistantMessage: MessageDTO
}
```

第一阶段建议保持和 `POST /api/chat` 完全一致，返回同一条 parent user message 和新 assistant message。

这样前端可以复用同一个 `message_created` handler。

---

## 8. ToolCall 流程

### 8.1 创建 ToolCall

当 mock/model stream 触发工具调用时：

1. 创建 ToolCall：
   - `status = pending`
2. 更新为：
   - `status = running`
   - `startedAt = now`
3. 发送：

```text
event: tool_call_created
```

data 包含：

```ts
{
  type: 'tool_call_created',
  streamId: string,
  conversationId: string,
  messageId: string,
  toolCall: ToolCallDTO
}
```

---

### 8.2 更新 ToolCall

工具执行成功：

```text
status = success
result = 工具结果
finishedAt = now
```

工具执行失败：

```text
status = failed
errorMessage = 安全错误信息
finishedAt = now
```

每次关键状态变化时发送：

```text
event: tool_call_updated
```

data 包含：

```ts
{
  type: 'tool_call_updated',
  streamId: string,
  conversationId: string,
  messageId: string,
  toolCall: ToolCallDTO
}
```

---

### 8.3 ToolCall 失败与 Assistant 状态

第一阶段规则：

- ToolCall 自身失败时，ToolCall 状态为 `failed`。
- 是否导致 assistant message `failed`，由 `chatService` 决定。
- 如果 assistant 可以基于工具失败继续生成解释，则 assistant message 可以最终 `done`。
- 如果工具失败导致生成无法继续，则 assistant message 设置为 `failed`，并发送 `message_failed`。

---

## 9. 前端 SSE 读取流程

前端 `useChatStream()` 负责读取 SSE，不允许组件直接读取 stream。

### 9.1 sendMessage 流程

```text
MessageInput.vue
  -> emit send
  -> ChatPage / useChatStream
  -> useChatStream.sendMessage(conversationId, content)
  -> fetch POST /api/chat
  -> readSseStream(response)
  -> 按 event.type 分发到 stores
```

### 9.2 前端请求前检查

发送前：

1. 根据 `conversationId` 获取 runtime state。
2. 如果 `isStreaming = true`，前端禁止发送。
3. 创建 `AbortController`。
4. 设置 runtime state：
   - `streamId = null`
   - `isStreaming = true`
   - `abortController = controller`
   - `error = null`

注意：

- 前端检查只是用户体验优化。
- 后端仍必须做 active streaming 检查。
- 后端是最终并发保护。

---

### 9.3 fetch 后错误处理

如果 response 不是 `2xx`：

1. 按普通 JSON error 读取。
2. 清理 runtime state。
3. 展示错误。
4. 不进入 SSE parser。

例如 `409 CONVERSATION_STREAMING`。

如果 response 是 `2xx` 且 `Content-Type` 是 `text/event-stream`，进入 SSE parser。

---

### 9.4 事件分发

| SSE event | 前端动作 |
|---|---|
| `message_created` | 插入 userMessage 和 assistantMessage；记录 streamId / streamingMessageId |
| `text_delta` | 按 conversationId + messageId 追加 delta |
| `tool_call_created` | 插入或更新对应 message 的 ToolCall |
| `tool_call_updated` | 更新对应 message 的 ToolCall |
| `message_done` | 用后端最终 message 覆盖本地 message；清理 runtime |
| `message_failed` | 用 failed message 覆盖本地 message；保存错误；清理 runtime |

要求：

- 不要默认写入当前 active conversation。
- 必须使用 event 中的 `conversationId`。
- 必须使用 event 中的 `messageId` 或 `message.id`。
- 如果 event.streamId 与 runtime 中记录的 streamId 不一致，应忽略或记录异常。

---

## 10. SSE Parser 要求

建议封装：

```ts
readSseStream(response: Response, handlers: ChatStreamHandlers): Promise<void>
```

或在 Harness 中封装：

```ts
readSseStream(response: Response): Promise<ChatStreamEvent[]>
```

Parser 需要处理：

- chunk 边界可能切开一条 SSE frame
- 单个 SSE event 以空行结束
- `event:` 行
- `id:` 行
- `data:` 行
- `data` 需要 JSON.parse
- `event` 必须等于 `data.type`
- 解析失败时输出原始 frame，便于定位

第一阶段可不支持：

- 多行 `data:`
- `retry:` 字段
- `Last-Event-ID` 断线恢复
- EventSource 自动重连

如后续需要，可以再扩展。

---

## 11. Abort 停止生成

### 11.1 前端停止流程

用户点击停止：

1. 找到当前 active Conversation 的 runtime state。
2. 获取：
   - `abortController`
   - `streamingMessageId`
   - 当前 assistant partial content
3. 调用 `abortController.abort()`。
4. 本地 SSE 读取会中断。
5. 调用：

```text
POST /api/messages/:id/abort
```

请求体带：

```ts
{
  content: partialContent
}
```

6. 后端返回 `MessageDTO`。
7. 前端用后端返回的 message 覆盖本地 message。
8. 清理该 Conversation runtime state。

---

### 11.2 为什么 abort 后还要调用 abort API

`AbortController.abort()` 只能中断当前页面对 SSE 的读取。

它不能保证：

- 后端生成流程已经停止
- 数据库 message 状态已经变为 `aborted`
- partial content 已经保存

因此必须调用：

```text
POST /api/messages/:id/abort
```

显式修正服务端状态。

---

### 11.3 abort 竞态规则

可能出现竞态：

```text
stream 正常完成
用户几乎同时点击 stop
```

后端必须保护状态：

- 如果 message 仍是 `pending` / `streaming`，可以更新为 `aborted`。
- 如果 message 已经是 `done`，不能覆盖为 `aborted`。
- 如果 message 已经是 `failed` / `aborted`，返回当前状态或按接口规则处理。
- `done` 优先于迟到的 abort。

---

## 12. 多会话并发处理

### 12.1 后端规则

并发边界是 `conversationId`。

允许：

```text
Conversation A streaming
Conversation B streaming
```

禁止：

```text
Conversation A 同时存在两个 active assistant message
```

后端不能使用全局 streaming 锁。

`POST /api/chat` 和 `POST /api/messages/:id/retry` 都必须检查目标 Conversation 是否已有 active assistant message。

---

### 12.2 前端规则

前端 runtime state 按 `conversationId` 隔离。

推荐结构：

```ts
type ConversationRuntimeState = {
  conversationId: string
  streamId: string | null
  isStreaming: boolean
  streamingMessageId: string | null
  abortController: AbortController | null
  error: string | null
}

type ChatRuntimeState = {
  conversationStates: Record<string, ConversationRuntimeState>
}
```

稳定数据放在 `conversationStore`：

```ts
type ConversationState = {
  activeConversationId: string | null
  conversations: ConversationDTO[]
  messagesByConversationId: Record<string, MessageDTO[]>
}
```

Profile 状态放在 `profileStore`：

```ts
type ProfileState = {
  currentProfileId: string
  profiles: AssistantProfileDTO[]
}
```

---

## 13. 多页面 / 多 Tab 行为

MVP 阶段的行为边界：

```text
发起生成的页面：实时接 SSE delta。
其他页面：能看到该 conversation 正在 streaming，但不实时同步 delta。
生成完成后：其他页面通过刷新或重新拉取 messages 获得最终内容。
```

具体表现：

- 页面 A 发起 Conversation X 的 `POST /api/chat`。
- 页面 A 实时接收 SSE delta。
- 页面 B 打开 Conversation X。
- 页面 B 调用 `GET /api/conversations/:id`，看到：
  - `isStreaming = true`
  - `activeAssistantMessageId = msg_xxx`
- 页面 B 的输入框应禁止发送，或提示“当前会话正在生成中”。
- 页面 B 调用 `GET /api/conversations/:id/messages`，只能看到数据库中已落库内容。
- 因为不每个 token 写库，页面 B 不保证能看到 partial content。
- 生成完成后，页面 B 重新拉取 messages，看到最终 assistant message。

---

## 14. 历史消息拉取与流式生成的关系

历史消息接口：

```text
GET /api/conversations/:id/messages?limit=50&beforeSeq=...&afterSeq=...
```

规则：

- 默认 `limit = 50`
- 按 `seq ASC` 输出
- `beforeSeq` 用于加载更早消息
- `afterSeq` 用于拉取某个 seq 之后的新消息
- 不保证返回 streaming 中的 partial content
- 最终消息以数据库状态为准

典型使用：

1. 页面初始化，调用 `GET /api/conversations`。
2. 进入某个 conversation，调用 `GET /api/conversations/:id/messages?limit=50`。
3. 用户向上滚动，使用 `beforeSeq` 拉取更早消息。
4. 生成完成后，非发起页面可以使用 `afterSeq` 拉取新消息。

---

## 15. Harness 复用要求

Harness 必须复用同一套 SSE parser。

建议文件：

```text
tests/harness/utils/stream-client.ts
```

建议函数：

```ts
readSseStream(response): Promise<ChatStreamEvent[]>
```

要求：

- 按标准 SSE frame 解析
- 校验 `event` 和 `data.type` 一致
- 收集所有事件
- 支持超时
- 支持中断
- 失败时输出原始 frame
- V2、V3、V4、V5、V9 都复用该 parser

Harness 不能为了测试绕过真实 SSE 协议。

---

## 16. 第一阶段明确不做

第一阶段不做：

- EventSource 客户端
- WebSocket
- 多页面实时 delta 广播
- `GET /api/conversations/:id/events`
- `GET /api/conversations/:id/status`
- `Last-Event-ID` 断线恢复
- SSE 自动重连
- 每 token 写库
- BroadcastChannel 多 Tab 同步
- 真实 MCP
- RAG
- 文件上传
- 高风险工具

