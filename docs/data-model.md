# docs/data-model.md

# AIChatAssistant 数据模型说明

## 1. 文档目的

本文档说明 `AIChatAssistant` 第一阶段的数据模型设计。

数据库结构的真实来源是：

```text
prisma/schema.prisma
```

本文档用于解释数据模型的设计意图、字段含义、模型关系和扩展口子。
如果本文档与 `prisma/schema.prisma` 不一致，以 `prisma/schema.prisma` 为准，并在修改数据库结构时同步更新本文档。

---

## 2. 第一阶段数据模型范围

第一阶段需要持久化以下核心模型：

* `Conversation`
* `Message`
* `ToolCall`

第一阶段不持久化：

* `User`
* `Auth`
* `Organization`
* `AssistantProfile`
* `KnowledgeSource`

说明：

* 当前项目第一阶段为单用户、本地开发和展示型项目，不设计登录注册和多用户权限。
* `AssistantProfile` 第一阶段使用代码配置，数据库只保存 `profileId`。
* `KnowledgeSource` 第一阶段只保留类型设计或代码配置口子，不创建数据库表，不接 RAG，不做文件上传。

---

## 3. 模型关系概览

```text
Conversation 1 ─── N Message
Message      1 ─── N ToolCall
```

说明：

* 一个 Conversation 表示一段聊天会话。
* 一个 Conversation 下有多条 Message。
* 一条 assistant Message 可能触发 0 到多次 ToolCall。
* ToolCall 记录工具调用过程、参数、结果、状态和错误信息。
* KnowledgeSource 第一阶段不参与数据库关系。

---

## 4. Enum 设计

第一阶段使用 Prisma enum 约束核心状态字段。

为了减少前后端映射成本，enum 值建议使用和 API / 前端状态一致的小写值。

### 4.1 ConversationStatus

```ts
type ConversationStatus =
  | 'active'
  | 'archived'
  | 'deleted'
```

含义：

* `active`：正常会话。
* `archived`：归档会话，第一阶段可暂不使用。
* `deleted`：软删除会话，默认列表不展示。

---

### 4.2 MessageRole

```ts
type MessageRole =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'system'
```

含义：

* `user`：用户消息。
* `assistant`：模型回复。
* `tool`：工具消息，第一阶段可保留扩展口子。
* `system`：系统消息，通常不直接展示给用户。

---

### 4.3 MessageStatus

```ts
type MessageStatus =
  | 'pending'
  | 'streaming'
  | 'done'
  | 'failed'
  | 'aborted'
```

含义：

* `pending`：已创建，但尚未开始处理。
* `streaming`：Assistant 正在流式输出。
* `done`：消息完成。
* `failed`：消息生成失败。
* `aborted`：用户主动停止生成或请求被中断。

---

### 4.4 ToolCallStatus

```ts
type ToolCallStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
```

含义：

* `pending`：工具调用已产生，但尚未执行。
* `running`：工具执行中。
* `success`：工具执行成功。
* `failed`：工具执行失败。

---

### 4.5 ToolSource

```ts
type ToolSource =
  | 'local'
  | 'mcp'
```

含义：

* `local`：本地工具。
* `mcp`：未来 MCP 工具，第一阶段只保留口子，不真实接入。

---

## 5. Conversation

`Conversation` 表示一段聊天会话。

### 5.1 字段设计

```ts
type Conversation = {
  id: string
  title: string | null
  profileId: string
  mode: string
  status: ConversationStatus
  createdAt: Date
  updatedAt: Date
}
```

### 5.2 字段说明

#### id

会话唯一 ID。

建议使用 Prisma `cuid()` 生成。

---

#### title

会话标题。

第一阶段可以为空。
后续可以根据第一条用户消息自动生成标题。

---

#### profileId

当前会话默认使用的 Assistant Profile ID。

第一阶段 Profile 不入库，使用代码配置。
这里仅保存字符串 ID，例如：

```text
general
domain-demo
```

---

#### mode

会话模式。

第一阶段默认：

```text
chat
```

后续可以扩展为：

```text
qa
review
analysis
planning
mock-interview
```

第一阶段只实现 `chat`，其他模式仅作为未来扩展方向。

---

#### status

会话状态。

默认值：

```text
active
```

删除会话时不做物理删除，而是设置为：

```text
deleted
```

---

#### createdAt / updatedAt

创建时间和更新时间。

`updatedAt` 用于会话列表排序。

---

### 5.3 设计说明

第一阶段会话删除采用软删除。

查询会话列表时，默认过滤：

```text
status != deleted
```

---

## 6. Message

`Message` 表示一条聊天消息。

### 6.1 字段设计

```ts
type Message = {
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

  createdAt: Date
  updatedAt: Date
}
```

### 6.2 字段说明

#### id

消息唯一 ID。

建议使用 Prisma `cuid()` 生成。

---

#### conversationId

所属 Conversation ID。

一条 Message 必须属于一个 Conversation。

---

#### parentMessageId

父消息 ID。

第一阶段主要用于失败重试和未来分支回复扩展。

推荐规则：

* 用户消息可以没有 `parentMessageId`。
* Assistant 回复可以将 `parentMessageId` 指向对应的 user message。
* 重试生成的新 assistant message 可以将 `parentMessageId` 指向原 user message 或失败的 assistant message。

第一阶段可采用简单规则：

```text
assistantMessage.parentMessageId = userMessage.id
```

---

#### role

消息角色。

可选值：

```text
user
assistant
tool
system
```

---

#### content

消息正文。

规则：

* user message 创建后直接写入完整内容。
* assistant message 创建时可以为空字符串。
* assistant message 流式输出完成后写入完整内容。
* aborted / failed 时尽量保存已生成的部分内容。

---

#### profileId

这条消息生成时使用的 Assistant Profile ID。

即使 Conversation 有默认 `profileId`，Message 仍然保存自己的 `profileId`，用于追踪历史消息生成时的配置。

---

#### mode

这条消息所属的 conversation mode。

第一阶段默认：

```text
chat
```

---

#### status

消息状态。

典型状态流转：

```text
user message:
pending -> done

assistant message:
pending -> streaming -> done
pending -> streaming -> failed
pending -> streaming -> aborted
```

第一阶段也可以在创建 user message 时直接设置为：

```text
done
```

创建 assistant message 时直接设置为：

```text
streaming
```

---

#### seq

消息在会话中的顺序号。

设计原因：

* 不完全依赖 `createdAt` 排序。
* 方便后续多端同步和增量拉取。
* 方便前端稳定渲染。

规则：

* 同一个 Conversation 内 `seq` 递增。
* 查询消息时按 `seq ASC` 排序。
* 建议增加唯一约束：`conversationId + seq`。

---

#### model

模型名称。

例如：

```text
mock
gpt-4.1
doubao-xxx
deepseek-xxx
```

第一阶段 mock stream 可以使用：

```text
mock
```

---

#### errorMessage

错误信息。

当 message 状态为 `failed` 时记录失败原因。
不要存储 API Key、stack trace、数据库连接信息等敏感内容。

---

#### metadata

扩展字段。

可用于记录：

* token 用量
* 模型供应商
* 请求耗时
* finish reason
* debug 信息
* 未来扩展字段

第一阶段不强依赖该字段。

---

### 6.3 设计说明

不要每个 token 都写数据库。

推荐策略：

1. 创建 assistant message，状态为 `streaming`。
2. 流式过程中在服务端内存中累积完整内容。
3. 前端实时展示 chunk。
4. 正常结束后，一次性更新 content 和 status。
5. 停止或失败时，保存当前已有内容，并更新状态。

---

## 7. ToolCall

`ToolCall` 记录一次工具调用。

### 7.1 字段设计

```ts
type ToolCall = {
  id: string
  messageId: string

  toolName: string
  source: ToolSource

  argumentsJson: unknown | null
  resultJson: unknown | null

  status: ToolCallStatus
  errorMessage: string | null

  startedAt: Date | null
  finishedAt: Date | null

  createdAt: Date
  updatedAt: Date
}
```

### 7.2 字段说明

#### id

工具调用唯一 ID。

建议使用 Prisma `cuid()` 生成。

---

#### messageId

所属 assistant message ID。

一条 assistant message 可以有多次工具调用。

---

#### toolName

工具名称。

第一阶段允许：

```text
calculator
currentTime
mockWeather
```

后续可以扩展 MCP 工具名称，例如：

```text
filesystem.readFile
database.query
```

---

#### source

工具来源。

第一阶段主要使用：

```text
local
```

`mcp` 只保留口子，不做真实 MCP 接入。

---

#### argumentsJson

工具调用参数。

必须保存为 JSON。

要求：

* 工具执行前必须校验参数。
* 不能盲目信任模型生成的参数。
* 不保存敏感信息。

---

#### resultJson

工具调用结果。

工具成功时保存结果。
工具失败时可以为空，并将错误写入 `errorMessage`。

---

#### status

工具调用状态。

典型流转：

```text
pending -> running -> success
pending -> running -> failed
```

---

#### errorMessage

工具调用错误信息。

不要保存 stack trace、密钥或敏感数据。

---

#### startedAt / finishedAt

工具执行开始和结束时间。

用于展示工具执行过程，也方便后续 debug。

---

### 7.3 设计说明

所有工具必须通过 Tool Registry 注册。
不要绕过 Tool Registry 直接执行工具。

第一阶段禁止高风险工具，包括但不限于：

* shell 执行
* 任意代码执行
* 文件删除
* 支付操作
* 邮件发送
* 日历写入
* 生产数据库写操作

---

## 8. KnowledgeSource

第一阶段不创建 `KnowledgeSource` 数据库表。

但需要在文档和代码设计中保留知识源扩展概念。

未来 KnowledgeSource 可以表示：

```ts
type KnowledgeSource = {
  id: string
  name: string
  type: 'static-md' | 'database' | 'vector-db' | 'mcp-resource'
  description?: string
  config?: unknown
  enabled: boolean
}
```

未来可用于：

* 静态 Markdown 知识
* 数据库知识
* 向量库知识
* MCP Resource
* 垂直领域知识源绑定

第一阶段不做：

* RAG
* 文件上传
* 文档切分
* embedding
* 向量检索
* 引用来源展示

---

## 9. AssistantProfile

第一阶段不创建 `AssistantProfile` 数据库表。

Assistant Profile 使用代码配置。

建议位置：

```text
server/profiles/index.ts
```

示例结构：

```ts
type AssistantProfile = {
  id: string
  name: string
  description: string
  systemPrompt: string
  enabledTools: string[]
  knowledgeSourceIds?: string[]
  conversationModes?: string[]
}
```

第一阶段至少内置：

```text
general
domain-demo
```

说明：

* `general` 是通用助手。
* `domain-demo` 只用于展示未来垂直领域扩展能力。
* `domain-demo` 不代表当前项目已经确定具体垂直领域。

数据库只保存 `profileId`，不保存完整 Profile 配置。

---

## 10. 删除策略

第一阶段 Conversation 使用软删除。

删除行为：

```text
Conversation.status = deleted
```

默认查询会话列表时不返回 `deleted` 会话。

Message 和 ToolCall 不单独提供删除能力。
如果未来需要物理删除 Conversation，可以通过数据库级联删除 Message 和 ToolCall。

---

## 11. 索引建议

### Conversation

建议索引：

```text
profileId
status
updatedAt
```

用途：

* 按 Profile 查询会话
* 过滤软删除会话
* 会话列表按更新时间排序

---

### Message

建议索引：

```text
conversationId + seq
status
profileId
parentMessageId
```

用途：

* 查询会话消息列表
* 按顺序展示消息
* 查询 streaming / failed / aborted 消息
* 支持重试和分支扩展

建议唯一约束：

```text
conversationId + seq
```

---

### ToolCall

建议索引：

```text
messageId
toolName
status
```

用途：

* 查询某条 assistant message 的工具调用
* 调试某类工具调用
* 查询失败工具调用

---

## 12. 第一阶段不做的数据库设计

第一阶段不要新增：

* User
* Session
* Account
* Auth
* Organization
* Workspace
* Permission
* AssistantProfile 表
* KnowledgeSource 表
* File 表
* Embedding 表
* Vector 表
* Payment 表
* AuditLog 表

这些不是当前 MVP 的必要条件。

---

## 13. 后续扩展方向

当前数据模型为后续扩展保留以下口子：

### 13.1 历史会话

通过 Conversation 和 Message 支持历史会话列表、会话恢复和刷新后恢复。

---

### 13.2 多端同步模拟

通过 `conversationId` 和 `seq`，未来 Web 和 Electron 可以连接同一后端，拉取同一会话消息。

后续可增加：

```text
GET /api/conversations/:id/messages?afterSeq=10
```

---

### 13.3 垂直领域扩展

通过 `profileId`、`mode`、Assistant Profile 代码配置和未来 KnowledgeSource 概念支持。

---

### 13.4 MCP 工具扩展

通过 `ToolCall.source = mcp` 和 Tool Registry 统一注册机制支持未来 MCP 工具。

---

### 13.5 RAG 扩展

未来如需接 RAG，可以新增：

* KnowledgeSource 表
* Document 表
* Chunk 表
* Embedding 表
* RetrievalRecord 表

第一阶段不实现。
