# AGENTS.md

## 项目说明

本项目名为 `AIChatAssistant`。

这是一个基于 Nuxt + TypeScript + Vite 的 AI Chat 应用，第一阶段目标是完成一个支持流式对话、基础工具调用、会话存储和垂直领域扩展口子的 AI Chat 底座。

当前项目不绑定任何具体垂直领域。不要在未经明确要求的情况下，将项目扩展成求职助手、学习助手、资料助手、心理陪伴助手或其他完整业务产品。

## 技术栈

* Nuxt
* Vue 3
* TypeScript
* Vite
* Prisma
* PostgreSQL
* Vercel AI SDK 或兼容模型 SDK

## 文档索引与优先级

处理需求、架构、API、聊天状态、SSE、前端 UI、交互规则、测试 Harness 相关任务前，必须先阅读对应文档。

### 基础需求与数据

* `docs/requirements.md`：项目需求、MVP 边界、明确不做的内容。
* `docs/data-model.md`：数据模型说明。
* `prisma/schema.prisma`：数据库结构的真实来源。

### API 与流式协议

* `docs/api-contract.md`：前后端 API 契约、DTO、错误结构、SSE event 字段定义。涉及接口和字段时优先看它。
* `docs/architecture/streaming-protocol.md`：标准 SSE 协议实现细节、后端写流、前端读流、错误边界、abort/retry 竞态、Harness parser 复用规则。
* `docs/rules/chat-flow.md`：聊天状态机规则，包括 streaming、failed、aborted、retry、ToolCall、seq、多会话并发。

聊天相关实现的优先级：

```text
docs/api-contract.md
> docs/architecture/streaming-protocol.md
> docs/rules/chat-flow.md
> docs/architecture/chat-flow-diagrams.md
```

如果这些文档有冲突，按上面的优先级处理，并在回复中说明冲突点，不要自行猜测。

### 架构图与流程图

* `docs/architecture/chat-flow-diagrams.md`：聊天主流程、发送消息、SSE 事件处理、停止、重试、ToolCall、多会话、多页面、历史消息加载、Harness 复用的 Mermaid 图。该文档用于理解流程，不作为字段和接口的最高优先级定义。

### 前端规范与交互

* `docs/rules/frontend-vue.md`：Vue 3、Pinia、Nuxt UI、Tailwind、组件职责、Store/Composable 分工规范。
* `docs/ui/interaction-rules.md`：UI 交互规则，包括历史消息加载、滚动行为、输入框、停止、失败、重试、ToolCall、多会话、多页面行为。
* `docs/ui/ui-implements.md`：Figma 设计稿到项目组件、Nuxt UI 组件的映射关系。
* `docs/ui/photos/`：当前 UI 状态截图，包括空会话、正常对话、Streaming、ToolCall、Failed、Aborted、多会话 Streaming。

实现 UI 时优先级：

```text
状态正确
> 流式稳定
> 组件清晰
> 视觉还原
```

### 后端规范

* `docs/rules/backend.md`：后端接口、service、repository、Prisma、错误处理、工具调用等实现规范。

### MVP 版本与验证

* `docs/rules/verification.md`：开发验证、Harness、测试数据库、验证命令选择、最终验收规则。
* `docs/progress-guideline.md`：MVP 前可验证小版本、每阶段验证步骤、最终 Harness 设计。

如果文档和当前代码不一致：

* 对于理解现有实现，以当前代码行为为准。
* 对于本次要实现的新行为，以对应需求文档、API 契约和规则文档为准。
* 如果本次修改改变了代码行为，需要同步更新相关文档。
* 如果发现文档之间或文档与代码之间存在冲突，不要自行猜测，先在回复中说明冲突点和建议处理方式。

## 当前必须做

* 流式聊天主链路
* 停止生成
* 失败重试
* Markdown / 代码块渲染
* Conversation / Message / ToolCall / KnowledgeSource 基础存储
* Assistant Profile 配置
* Tool Registry
* 本地安全工具：calculator、currentTime、mockWeather
* mock stream 模式
* 基础 README 和架构说明

## 当前明确不做

除非用户明确要求，否则不要实现：

* 登录注册
* 多用户权限
* RAG
* 文件上传
* 真实 MCP 接入
* 复杂 Agent 工作流
* 多 Agent 协作
* 完整垂直领域产品
* Electron 桌面端
* 真正实时多端同步
* 支付、邮件发送、日历写入、删除数据等高风险工具

## 数据库约束

数据库结构真实来源是：

* `prisma/schema.prisma`

数据库说明文档是：

* `docs/data-model.md`

第一阶段核心模型：

* `Conversation`
* `Message`
* `ToolCall`
* `KnowledgeSource`

第一阶段不要新增 `User`、`Auth`、`Organization`、`Payment` 或复杂权限模型。

Assistant Profile 第一阶段使用代码配置，数据库中只保存 `profileId`。不要擅自新增 `AssistantProfile` 数据库表。

## 后端约束

后端使用 Nuxt server routes。

API 文件只负责：

* 解析请求
* 校验参数
* 调用 service
* 返回响应
* 处理 HTTP 错误

不要把业务流程、数据库查询、模型流式处理、工具执行逻辑直接堆在 `server/api` 文件里。

具体规范见：

* `docs/rules/backend.md`

## 前端约束

前端使用 Vue 3 Composition API 和 `<script setup lang="ts">`。

页面负责组合，组件负责展示，状态和请求逻辑放到 composables 中。

具体规范见：

* `docs/rules/frontend-vue.md`

## 实现约束

* 优先小步修改
* 不要重构无关文件
* 不要扩大项目范围
* 不要随意新增生产依赖
* 核心数据结构必须有明确 TypeScript 类型
* 数据库访问必须经过 repository
* 业务流程必须经过 service
* API handler 保持薄层
* 修改数据库结构时，同步更新 `docs/data-model.md`
* 修改接口行为时，同步更新 `docs/api-contract.md`
* 修改聊天状态流转时，同步更新 `docs/rules/chat-flow.md`

## 修改约束

* 不要在未阅读对应文档的情况下实现聊天、SSE、abort、retry、ToolCall、多会话 streaming、历史消息加载、UI 交互或 Harness。
* 涉及 API 字段时，以 `docs/api-contract.md` 为准。
* 涉及 SSE 实现时，以 `docs/architecture/streaming-protocol.md` 为准。
* 涉及聊天状态机时，以 `docs/rules/chat-flow.md` 为准。
* 涉及前端组件、Store、Composable 时，以 `docs/rules/frontend-vue.md` 为准。
* 涉及用户交互、滚动、历史消息加载、输入框状态时，以 `docs/ui/interaction-rules.md` 为准。
* 涉及 Figma 还原时，同时参考 `docs/ui/ui-implements.md` 和 `docs/ui/photos/`。
* 流程图只用于辅助理解；不要用流程图覆盖 API 契约或状态机规则。

## 验证要求

详细验证规则见：

* `docs/rules/verification.md`：开发验证、Harness、测试数据库、验证命令选择、最终验收规则。
* `docs/progress-guideline.md`：MVP 小版本节奏和各阶段应沉淀的验证场景。

执行规则：

* 根据改动范围选择最小有效验证，不要机械跑全部命令。
* 不要声称运行过未实际运行的验证。
* Harness 必须使用 `TEST_DATABASE_URL`，不得 fallback 到 `DATABASE_URL`。
* 最终回复必须说明实际运行的验证、未运行的验证及原因。

## 其他

Windows 编码规则继承全局约定
