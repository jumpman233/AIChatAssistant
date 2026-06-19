# docs/rules/chat-flow.md

# AIChatAssistant 聊天状态流转规则

## 1. 文档目的

本文档定义 `AIChatAssistant` 第一阶段聊天主链路的状态流转规则。

覆盖范围：

* 用户发送消息
* Assistant 流式生成
* 停止生成
* 失败处理
* 重试
* 工具调用
* 数据库存储策略
* 前端状态展示要求

如果本文件与 `docs/api-contract.md` 或 `prisma/schema.prisma` 发生冲突，需要同步修正。

---

## 2. 核心状态枚举

### 2.1 MessageStatus

```ts id="w956kx"
type MessageStatus =
  | 'pending'
  | 'streaming'
  | 'done'
  | 'failed'
  | 'aborted'
```

含义：

* `pending`：消息已创建，但尚未开始处理。
* `streaming`：Assistant 正在流式输出。
* `done`：消息正常完成。
* `failed`：消息生成失败。
* `aborted`：用户主动停止生成，或请求被中断。

### 2.1.1 状态转换

允许转换：

```text
pending -> streaming
pending -> done | failed | aborted
streaming -> done | failed | aborted
```

终态：

```text
done
failed
aborted
```

终态之间禁止转换：

```text
done -X-> failed / aborted
failed -X-> done / aborted
aborted -X-> done / failed
```

所有 `done` / `failed` / `aborted` 写入都必须是条件终态更新：只有当前状态仍为 `pending` / `streaming` 时才能成功。第一个成功落库的终态获胜。

---

### 2.2 ToolCallStatus

```ts id="dtzt2n"
type ToolCallStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
```

含义：

* `pending`：工具调用已创建，但尚未执行。
* `running`：工具执行中。
* `success`：工具执行成功。
* `failed`：工具执行失败。

---

## 3. 普通聊天流程

### 3.1 正常流程

```text id="1sx8zg"
用户输入消息
  ↓
前端调用 POST /api/chat
  ↓
后端校验 conversation / profile / content
  ↓
创建 user message，status = done
  ↓
创建 assistant message，status = streaming
  ↓
返回 message_created 事件
  ↓
开始 mock stream 或真实模型 stream
  ↓
前端接收 text_delta 并实时展示
  ↓
后端累积 assistant fullContent
  ↓
模型正常结束
  ↓
后端更新 assistant message:
  - content = fullContent
  - status = done
  ↓
返回 message_done 事件
```

---

### 3.2 数据库写入规则

用户消息：

```text id="hhzjx3"
role = user
status = done
content = 用户完整输入
```

Assistant 消息：

```text id="h4g3v8"
role = assistant
status = streaming
content = ""
```

生成完成后：

```text id="ltwfyb"
status = done
content = 完整 assistant 输出
```

---

## 4. 流式响应规则

### 4.1 不要每个 token 写库

流式过程中不要每个 token 都写数据库。

推荐策略：

```text id="dkm6rl"
服务端内存累积 fullContent
前端实时展示 delta
完成 / 停止 / 失败时再落库
```

原因：

* 降低数据库写入频率
* 避免流式输出卡顿
* 降低实现复杂度
* 避免大量无意义 update

---

### 4.2 流式事件

推荐事件类型：

```ts id="wyb92e"
type ChatStreamEvent =
  | { type: 'message_created'; userMessage: MessageDTO; assistantMessage: MessageDTO }
  | { type: 'retry_created'; sourceAssistantMessageId: string; assistantMessage: MessageDTO }
  | { type: 'text_delta'; messageId: string; delta: string }
  | { type: 'tool_call_created'; toolCall: ToolCallDTO }
  | { type: 'tool_call_updated'; toolCall: ToolCallDTO }
  | { type: 'message_done'; message: MessageDTO }
  | { type: 'message_failed'; message: MessageDTO; error: { message: string; code?: string } }
```

前端不要只依赖纯文本 chunk。
应尽量解析结构化事件，便于后续展示 tool call、状态、错误和重试。

---

### 4.3 多会话 streaming 并发规则

第一阶段支持多个 Conversation 同时存在，并允许不同 Conversation 同时处于 `streaming` 状态。

并发边界以 `conversationId` 为准：

* 允许不同 Conversation 同时 streaming。
* 禁止同一个 Conversation 同时存在多个 active streaming。
* active streaming 指该 Conversation 下存在 `role = assistant` 且 `status` 为 `pending` 或 `streaming` 的消息。
* 后端不能使用全局 streaming 锁，只能检查目标 `conversationId`。
* 前端 runtime state 必须按 `conversationId` 隔离。
* 停止生成时必须按 `messageId` 精确停止，不影响其他 Conversation。

允许的情况：

```text
Conversation A:
  assistantMessageA.status = streaming

Conversation B:
  assistantMessageB.status = streaming
```

禁止的情况：

```text
Conversation A:
  assistantMessageA1.status = streaming
  assistantMessageA2.status = streaming
```

后端在处理 `POST /api/chat` 时，创建新消息前必须检查目标 Conversation 内是否已有：

```text
role = assistant
status in [pending, streaming]
```

如果存在，应返回：

```http
409 Conflict
```

错误结构：

```json
{
  "message": "Current conversation already has an active streaming message",
  "code": "CONVERSATION_STREAMING"
}
```

---

### 4.4 前端展示规则

前端接收到 `message_created` 后：

* 立即展示 user message
* 创建 assistant message 占位
* assistant message 状态为 `streaming`

前端接收到 `text_delta` 后：

* 将 delta 追加到对应 assistant message 的 content
* 保持状态为 `streaming`

前端接收到 `message_done` 后：

* 用后端返回的最终 message 覆盖本地 assistant message
* 状态变为 `done`

前端接收到 `message_failed` 后：

* 用后端返回的 failed message 覆盖本地 assistant message
* 状态变为 `failed`
* 展示错误提示和重试入口

---

## 5. 停止生成规则

### 5.1 停止策略

第一阶段停止生成采用双层策略：

```text id="y40gyn"
前端使用目标 Conversation 对应的 AbortController 中断当前流式请求
+
调用 POST /api/messages/:id/abort 显式标记目标 assistant message 为 aborted
+
服务端通过 active stream registry 取消对应 Provider
```

停止生成只影响目标 assistant message。
如果其他 Conversation 正在 streaming，不应被中断。

---

### 5.2 前端停止流程

```text id="sw3q13"
用户点击停止
  ↓
前端根据 activeConversationId 找到对应 ConversationRuntimeState
  ↓
读取该 assistant message 的 rawContent
  ↓
前端调用 POST /api/messages/:id/abort
  ↓
请求体带上 rawContent，不使用 displayContent
  ↓
后端先条件更新 assistant message 为 aborted
  ↓
服务端取消对应 Provider AbortController
  ↓
前端用后端返回的 message 覆盖本地 message
  ↓
前端取消本地 fetch / reader 并清理目标 Conversation runtime
```

---

### 5.3 后端停止规则

`POST /api/messages/:id/abort` 以 `messageId` 为停止边界，不以全局状态或 `conversationId` 为停止边界。

`POST /api/messages/:id/abort` 规则：

* 只能作用于 assistant message。
* 如果 message 状态是 `streaming` 或 `pending`，可以更新为 `aborted`。
* 如果 message 状态已经是 `aborted`，重复 abort 幂等成功，返回当前 MessageDTO。
* 如果 message 状态已经是 `done` 或 `failed`，不能改为 `aborted`，返回 `409 MESSAGE_NOT_ABORTABLE`。
* 非 assistant message 不能 abort，返回 `409 MESSAGE_NOT_ABORTABLE`。
* message 不存在返回 404。
* 请求体携带停止时前端已收到的 `rawContent`，允许为空字符串。
* 后端保存该 `rawContent` 作为 partial content。
* 返回最终 MessageDTO。
* Provider 主动取消产生的 `AbortError` 不视为 provider failure，不写 `failed`。

---

### 5.4 停止后的 UI 规则

消息状态为 `aborted` 时：

* 展示已生成的部分内容
* 展示“已停止”状态
* 展示重试入口
* 不自动删除消息
* 不把 aborted 显示成 failed

---

## 6. 失败处理规则

### 6.1 失败来源

失败可能来自：

* 模型 API 报错
* 网络中断
* 服务端异常
* 工具调用失败
* 请求超时
* 参数校验失败
* stream 解析异常

---

### 6.2 后端失败流程

```text id="cbhvyr"
生成过程中发生错误
  ↓
停止继续输出
  ↓
保存当前已生成 content
  ↓
更新 assistant message:
  - status = failed
  - errorMessage = 安全错误信息
  ↓
返回 message_failed 事件
```

---

### 6.3 错误信息规则

`errorMessage` 可以包含：

* 用户可理解的失败原因
* 简短错误码
* 是否可以重试

`errorMessage` 不允许包含：

* stack trace
* API Key
* 数据库连接信息
* 模型供应商密钥
* 服务器内部敏感路径
* 大量原始错误对象

---

### 6.4 失败后的 UI 规则

消息状态为 `failed` 时：

* 展示已生成的部分内容，如果有
* 展示错误提示
* 展示重试入口
* 不自动删除失败消息
* 不覆盖失败消息内容

---

## 7. 重试规则

### 7.1 基本原则

重试时不要覆盖旧消息。

旧的 failed / aborted assistant message 必须保留。
重试时创建新的 assistant message。

重试仍然遵守同一 Conversation 内的并发限制：

* 如果该 Conversation 已经存在 active streaming，不能再次重试。
* 如果其他 Conversation 正在 streaming，不影响当前 Conversation 的重试。

---

### 7.2 重试对象

第一阶段主要支持对以下消息重试：

```text id="ovjgtt"
assistant message with status = failed
assistant message with status = aborted
```

不支持 `done`、`pending`、`streaming` 或非 assistant message。不可 retry 返回 `409 MESSAGE_NOT_RETRYABLE`。

---

### 7.3 重试流程

推荐流程：

```text id="wavhqb"
用户点击 failed / aborted assistant message 的重试
  ↓
前端调用 POST /api/messages/:id/retry
  ↓
后端查找原 assistant message
  ↓
后端查找对应 parent user message
  ↓
创建新的 assistant message，status = streaming
  ↓
重新调用 mock stream 或真实模型
  ↓
返回 retry_created
  ↓
返回 text_delta*
  ↓
返回 message_done 或 message_failed
```

retry 不允许直接执行：

```text
failed -> streaming
aborted -> streaming
```

---

### 7.4 parentMessageId 规则

第一阶段推荐：

```text id="zhwn2a"
assistantMessage.parentMessageId = userMessage.id
```

重试生成的新 assistant message 也可以使用：

```text id="rij7zw"
newAssistantMessage.parentMessageId = sameUserMessage.id
```

这样可以表达：

```text id="wodvtp"
同一条 user message 下有多次 assistant 尝试
```

---

### 7.5 重试后的 UI 规则

重试后：

* 旧 failed / aborted message 保留
* 新 assistant message 进入 `streaming`
* 新内容单独展示
* 不覆盖旧消息
* 用户可以看见历史失败和新的尝试

---

## 8. seq 规则

`seq` 表示同一 conversation 内消息顺序。

规则：

* 同一个 conversation 内 `seq` 单调递增。
* 查询消息时按 `seq ASC` 排序。
* `conversationId + seq` 应保持唯一。
* 创建 user message 和 assistant message 时，需要分配连续 seq。

典型情况：

```text id="hesj9s"
seq = 1 user message
seq = 2 assistant message
seq = 3 user message
seq = 4 assistant message
```

重试时：

```text id="ja2myk"
seq = 1 user message
seq = 2 assistant message failed
seq = 3 assistant message retry streaming/done
```

不要复用旧 message 的 seq。

多会话并发时，`seq` 只在同一个 Conversation 内递增，不同 Conversation 的 `seq` 互不影响：

```text
Conversation A:
  seq = 1 user
  seq = 2 assistant streaming

Conversation B:
  seq = 1 user
  seq = 2 assistant streaming
```

创建 user message 和 assistant message 时，应在同一个数据库事务中完成。
即使第一阶段后端会拒绝同一 Conversation 内并发 streaming，也应避免同一 Conversation 内 seq 分配出现竞争。

---

## 9. ToolCall 规则

### 9.1 工具调用创建

当模型触发工具调用时：

```text id="d7d4l7"
创建 ToolCall
status = pending
source = local 或 mcp
toolName = 工具名称
argumentsJson = 模型给出的参数
```

执行前：

```text id="7xz1xf"
status = running
startedAt = 当前时间
```

执行成功：

```text id="bp1zsm"
status = success
resultJson = 工具结果
finishedAt = 当前时间
```

执行失败：

```text id="kp9m70"
status = failed
errorMessage = 安全错误信息
finishedAt = 当前时间
```

---

### 9.2 工具调用和 Assistant Message 的关系

ToolCall 必须关联到 assistant message。

```text id="87y5jj"
assistant message 1 ─── N tool call
```

第一阶段不要求创建单独的 `tool` role message。
工具过程主要通过 ToolCall 记录和前端 ToolCallCard 展示。

---

### 9.3 工具调用失败是否导致 Assistant 失败

第一阶段推荐规则：

* 工具自身失败时，ToolCall 状态为 `failed`。
* 是否导致 assistant message 失败，由 chatService 决定。
* 如果模型可以基于工具失败生成解释，则 assistant message 仍可以 `done`。
* 如果工具失败导致整个生成无法继续，则 assistant message 设置为 `failed`。

---

## 10. 清空当前会话规则

第一阶段“清空当前会话”可以有两种实现。

### 10.1 推荐实现：创建新会话

```text id="icmnqp"
用户点击清空
  ↓
前端创建新的 Conversation
  ↓
切换到新 Conversation
```

优点：

* 不破坏旧数据
* 实现简单
* 符合聊天产品常见行为

---

### 10.2 不推荐第一阶段实现：删除所有消息

不建议第一阶段做：

```text id="5d91go"
DELETE all messages in current conversation
```

原因：

* 容易引入误删
* 需要额外接口
* 对当前 MVP 价值不高

---

## 11. 会话删除规则

第一阶段会话删除是软删除。

```text id="g1kgoh"
Conversation.status = deleted
```

要求：

* 默认会话列表不展示 `deleted`
* `deleted` 会话不能继续发送新消息
* 物理删除暂不提供接口

---

## 12. Mock Stream 规则

mock stream 是第一阶段优先能力。

要求：

* 不依赖真实模型 API Key
* 可以模拟流式输出
* 可以模拟成功
* 可以模拟失败
* 可以模拟慢速输出
* 可以模拟中断后的状态修正

mock stream 仍然必须走真实的状态流转：

```text id="5oaavk"
创建 user message
创建 assistant message
返回 text_delta
完成后保存 assistant message
```

不要让 mock stream 只做前端假数据。

---

## 13. 前端状态管理要求

前端 runtime state 必须按 `conversationId` 隔离，不能只维护一份全局 `messages`、`isStreaming` 和 `AbortController`。

前端至少维护：

```ts id="mzgxip"
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

要求：

* 切换 Conversation 时，只切换 `activeConversationId`，不要清空其他 Conversation 的 runtime state。
* 不同 Conversation 的 `messages`、`isStreaming`、`streamingMessageId`、`abortController` 和 `error` 必须相互隔离。
* 不同 Conversation 可以同时存在 `isStreaming = true`。
* 同一个 Conversation 内如果 `isStreaming = true`，应禁止再次发送消息或返回明确提示。
* 新请求开始前只清理目标 Conversation 的旧 `AbortController`。
* 请求结束、失败或中止后只清空目标 Conversation 的 streaming 状态。
* 刷新页面后可以通过 `conversationId` 重新加载对应 messages。
* 前端展示应以服务端返回的最终 message 状态为准。
* 如果非当前 Conversation 正在 streaming，可以在会话列表中展示生成中状态，但不应打断当前 Conversation。

---

## 14. 不允许的行为

第一阶段不要做：

* 每个 token 都写数据库
* 停止生成后删除 partial content
* 重试时覆盖旧 failed message
* 重试时复用旧 assistant message id
* 把 aborted 当成 failed 展示
* 使用全局 streaming 锁阻止不同 Conversation 同时生成
* 前端只维护一份全局 messages / isStreaming / AbortController
* 停止一个 Conversation 时误中断其他 Conversation
* 让前端直接调用模型厂商 API
* 让前端直接执行工具
* 绕过 Tool Registry 执行工具
* 创建高风险工具
* 在错误信息中暴露敏感信息

---

## 15. 第一阶段验收标准

聊天状态流转至少满足：

1. 正常发送消息后，user message 为 `done`。
2. Assistant 开始生成时，assistant message 为 `streaming`。
3. 生成完成后，assistant message 为 `done`。
4. 停止生成后，assistant message 为 `aborted`，并保留部分内容。
5. 失败后，assistant message 为 `failed`，并保留错误信息。
6. 重试后，旧消息保留，新建 assistant message。
7. 消息按 `seq ASC` 稳定展示。
8. 工具调用至少能记录 `pending/running/success/failed` 状态。
9. mock stream 与真实模型 stream 使用同一套状态规则。
10. 不同 Conversation 可以同时 streaming。
11. 同一个 Conversation 内不能同时存在多个 active streaming。
12. 停止生成只影响目标 assistant message，不影响其他 Conversation。
