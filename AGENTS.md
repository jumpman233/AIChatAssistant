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

完成代码修改后，尽量运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

如果命令不存在或无法运行，需要说明原因。不要声称已测试但实际没有运行。
