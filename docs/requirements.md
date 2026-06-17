# docs/requirements.md

# AIChatAssistant 需求说明

## 1. 项目定位

`AIChatAssistant` 是一个基于 Nuxt + TypeScript + Vite 的 AI Chat 应用。

第一阶段目标是完成一个可运行、可展示、可继续扩展的 AI Chat 底座，重点验证以下能力：

* 流式对话
* 前后端流式数据处理
* 聊天状态管理
* 停止生成
* 失败重试
* Markdown / 代码块渲染
* 基础工具调用
* 基础会话存储
* Assistant Profile 扩展口子
* 未来垂直领域扩展能力

当前项目不绑定任何具体垂直领域。
第一阶段不要将项目扩展成求职助手、学习助手、资料助手、心理陪伴助手或其他完整业务产品。

---

## 2. 技术栈

第一阶段技术栈：

* Nuxt
* Vue 3
* TypeScript
* Vite
* Prisma
* PostgreSQL
* Vercel AI SDK 或兼容模型 SDK

后端第一阶段使用 Nuxt server routes / Nitro 实现，不额外拆独立 Express / Fastify 服务。

---

## 3. 当前阶段目标

当前阶段目标是完成一个 AI Chat MVP。

MVP 需要具备：

1. 用户可以创建或进入一个会话。
2. 用户可以发送消息。
3. 用户消息可以立即展示。
4. Assistant 回复可以流式输出。
5. 用户可以停止生成。
6. 失败后可以重试。
7. 消息支持 Markdown 和代码块渲染。
8. 系统可以记录 Conversation、Message、ToolCall。
9. 系统可以通过 Assistant Profile 切换不同助手配置。
10. 系统可以通过 Tool Registry 注册和调用基础工具。
11. 系统保留未来垂直领域扩展口子，但不实现完整垂直业务。

---

## 4. MVP 必须实现

### 4.1 聊天基础能力

必须支持：

* 聊天主页面
* 消息输入框
* 发送消息
* 用户消息立即展示
* Assistant 消息流式展示
* 停止生成
* 失败重试
* 清空当前会话
* Markdown 渲染
* 代码块展示
* loading / streaming / failed / aborted / done 状态展示

### 4.2 多会话与并发生成规则

第一阶段支持多个 Conversation 同时存在，并支持用户在多个 Conversation 之间切换。

并发策略：

* 允许不同 Conversation 同时处于 streaming 状态。
* 同一个 Conversation 同一时间只允许一个 active streaming。
* 如果某个 Conversation 已经存在 `pending` 或 `streaming` 状态的 assistant message，则该 Conversation 暂时不能再次发送新消息。
* 不同 Conversation 的 streaming 状态、AbortController、错误状态和消息列表必须相互隔离。
* 停止生成时，只停止目标 assistant message，不影响其他 Conversation 中正在生成的消息。

第一阶段不做复杂冲突合并。
同一 Conversation 内的并发发送请求应被后端拒绝。


---

### 4.2 基础存储能力

必须支持基础会话存储。

第一阶段需要持久化：

* Conversation
* Message
* ToolCall

第一阶段不创建 KnowledgeSource 数据库表。
KnowledgeSource 只保留类型设计、文档说明或代码配置口子，用于未来接入 static-md、database、vector-db、mcp-resource 等知识源。

第一阶段不创建 AssistantProfile 数据库表。
Assistant Profile 使用代码配置，数据库中只保存 `profileId`。

---

### 4.3 Assistant Profile 能力

第一阶段至少内置两个 Profile：

* `general`：通用助手
* `domain-demo`：领域助手 Demo

要求：

* Profile 配置集中维护
* 每个 Profile 有独立 `id`
* 每个 Profile 可以配置 `name`
* 每个 Profile 可以配置 `description`
* 每个 Profile 可以配置 `systemPrompt`
* 每个 Profile 可以绑定不同工具列表
* 前端可以显示和切换当前 Profile

`domain-demo` 只用于展示未来垂直领域扩展能力，不代表当前项目已经确定具体领域方向。

---

### 4.4 工具调用能力

第一阶段通过 Tool Registry 管理工具。

必须内置以下安全本地工具：

* `calculator`
* `currentTime`
* `mockWeather`

工具要求：

* 工具必须统一注册
* 工具必须有白名单
* 工具参数必须校验
* 工具执行失败时返回明确错误
* 工具调用过程需要记录到 ToolCall
* 前端至少可以展示工具名和执行状态

第一阶段禁止实现高风险工具，例如：

* shell 执行
* 任意代码执行
* 文件删除
* 支付操作
* 邮件发送
* 日历写入
* 数据库任意写入
* 外部系统破坏性操作

---

### 4.5 Mock Stream 模式

第一阶段必须支持 mock stream 模式。

要求：

* 没有真实模型 API Key 时，仍然可以跑通聊天主链路
* mock 模式下前端能看到流式输出
* mock 模式下可以模拟成功、失败、中断等状态
* mock 模式不能影响真实模型模式

---

### 4.6 停止生成

第一阶段停止生成采用：

* 前端 `AbortController` 中断当前请求
* 后端提供接口显式标记 assistant message 为 `aborted`

停止后要求：

* 保留已生成的部分内容
* message 状态变为 `aborted`
* 用户可以基于该消息进行重试

---

### 4.7 失败重试

失败后要求：

* 不覆盖原失败消息
* 原 assistant message 保持 `failed`
* 错误信息需要保留
* 重试时创建新的 assistant message
* 新 assistant message 重新进入 `streaming` 状态

---

### 4.8 会话删除

第一阶段会话删除使用软删除。

删除会话时：

* 不直接物理删除 Conversation
* 将 Conversation 状态更新为 `deleted`
* 默认列表不展示 `deleted` 会话

---

## 5. MVP 明确不做

除非后续明确要求，第一阶段不要实现以下内容：

* 登录注册
* 多用户系统
* 用户权限
* Organization / Workspace
* 复杂管理后台
* RAG
* 文件上传
* 向量数据库
* 真实 MCP 接入
* 复杂 Agent 工作流
* 多 Agent 协作
* 完整垂直领域业务
* Electron 桌面端
* 真正实时多端同步
* 支付能力
* 邮件发送
* 日历写入
* 任意外部系统写操作
* 高风险本地工具

---

## 6. 关键成功标准

第一阶段完成后，需要满足：

1. 可以创建会话。
2. 可以发送用户消息。
3. 可以看到 Assistant 流式输出。
4. 可以停止生成，并保留已生成内容。
5. 失败后可以重试。
6. Markdown 和代码块显示正常。
7. 至少完成一次基础工具调用闭环。
8. ToolCall 可以被记录。
9. 至少可以切换两个 Assistant Profile。
10. 数据结构为未来垂直领域扩展保留口子。
11. README 能说明项目定位、架构设计和后续扩展方向。
12. 项目可以本地运行，后续可以部署上线。

---

## 7. 当前阶段开发原则

第一阶段遵守以下原则：

* 先做聊天主链路，不做复杂业务。
* 先做 mock stream，不急于接真实模型。
* 先做基础工具调用，不做复杂 MCP。
* 先做 Profile 配置，不做完整垂直产品。
* 先做基础会话存储，不做复杂用户系统。
* 先能稳定运行，再逐步增强视觉和扩展能力。
* 不因未来可能性提前引入过重架构。

一句话原则：

> 当前项目不是要一次性做成某个垂直领域产品，而是要做出一个可以承载未来垂直领域扩展的 AI Chat 底座。
