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

## 工作前必须阅读

在进行非简单修改前，请先阅读：

* `docs/requirements.md`：需求范围、当前阶段目标、明确不做的内容
* `docs/data-model.md`：数据库结构说明
* `prisma/schema.prisma`：数据库结构真实来源
* `docs/api-contract.md`：后端接口契约
* `docs/rules/backend.md`：后端代码结构与接口规范
* `docs/rules/frontend-vue.md`：Vue3 前端组件与代码结构规范
* `docs/rules/chat-flow.md`：聊天、流式响应、停止生成、失败重试的状态流转规则
* `docs/progress-guideline.md`：MVP 前可验证小版本计划、Harness 场景沉淀和验收节奏

如果本次涉及前端 UI、Figma 还原、聊天页面视觉或组件实现，还需要阅读：

* `docs/ui/ui-implements.md`：设计稿到项目组件、Nuxt UI 组件的映射关系
* `docs/ui/photos/`：当前聊天 UI 需求截图，覆盖空会话、正常对话、Streaming、Tool Call、Failed、Aborted、多会话同时 Streaming 等状态

如果文档和代码不一致，以当前代码行为为准；如果本次修改改变了行为，需要同步更新相关文档。

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

## 验证要求

开发验证必须服务于最终 Harness 验收，不要在最后重新设计一套验收流程。

默认节奏：

* 按 `docs/progress-guideline.md` 的 V0-V9 小版本推进，每次只验证当前任务涉及的最小闭环。
* 每个版本先用人工步骤确认行为，再把稳定的关键步骤沉淀成可复用 Harness scenario 或 E2E spec。
* 新增验证脚本时，优先复用既有 `tests/harness/utils/` 中的 api-client、stream-client、db-assert、wait、test-data 等工具，不要为每个场景复制 fetch、stream 解析或数据库断言逻辑。
* V2 以后涉及流式响应的验证必须复用统一 stream client，能够收集 `message_created`、`text_delta`、`tool_call_created`、`tool_call_updated`、`message_done`、`message_failed`，并支持超时和失败时输出原始片段。
* 涉及数据库断言时，应同时验证 API 行为和数据库状态，尤其是 soft delete、message status、seq、ToolCall status、retry 是否创建新消息、旧消息是否保留。
* 最终 `verify:mvp` 应复用 V1-V8 已沉淀的流程、工具、断言和关键场景，但不要求机械顺序执行 `verify:v1` 到 `verify:v5` 或所有历史命令。
* `verify:mvp` 可以组织为更高层的完整 MVP flow，只要它复用了前面积累的 api-client、stream-client、db-assert、测试数据和关键断言，且覆盖最终验收所需行为即可。
* 不要为了“复用”而重复跑低价值、重复初始化或互相冲突的历史场景；也不要在 V9 另起一套与前面验证逻辑无关的全新验收实现。

Harness 数据库要求：

* Harness 必须使用测试数据库，读取 `TEST_DATABASE_URL`。
* 不允许 Harness fallback 到 `DATABASE_URL`。
* 如果没有配置 `TEST_DATABASE_URL`，Harness 必须直接失败。
* Harness 不修改 `.env`；需要连接测试库时，只能在测试子进程环境变量中临时将 `DATABASE_URL` 覆盖为 `TEST_DATABASE_URL`。
* reset / seed / cleanup 只能作用于测试数据库，不允许删除开发库或线上库数据。
* 涉及 reset test db、migration、seed 的脚本必须把目标数据库来源写清楚，避免误操作。

完成代码修改后，根据改动范围尽量运行相关命令，而不是机械跑全部命令：

```bash
pnpm verify:base
pnpm verify:v1
pnpm verify:v2
pnpm verify:v3
pnpm verify:v4
pnpm verify:v5
pnpm e2e:ui
pnpm e2e:markdown
pnpm verify:mvp
pnpm lint
pnpm typecheck
pnpm test
```

当前阶段命令可能尚未全部存在。若命令不存在、依赖未安装、服务未启动、数据库未配置或无法运行，需要明确说明原因；不要声称已测试但实际没有运行。

最终回复中必须说明：

* 实际运行了哪些验证命令。
* 哪些命令没有运行以及原因。
* 本次新增或修改的人工验证步骤是否已经沉淀为可复用 Harness scenario / E2E spec；如果还没有，需要说明后续应沉淀到哪个文件或命令。
* 本次验证是否满足 `docs/progress-guideline.md` 中对应小版本的要求。

## 其他

Windows 编码规则继承全局约定
