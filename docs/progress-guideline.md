# AIChatAssistant MVP 前可验证小版本计划（含 Harness 验证）

## 目标

这个计划不按“后端阶段 / 前端阶段 / UI 阶段”机械拆分，而是按**可运行、可验证的小版本**推进。

每个版本都需要同时关注：

- 后端最小能力
- 前端最小能力
- 状态流转
- 验证方式
- 可沉淀到 Harness 的验证场景
- 本阶段不做什么

核心原则：

> 每一步都应该能本地跑起来，并验证一个明确闭环。不要让 Codex 一次性实现整个 MVP。

最终目标不是只靠人工 checklist，而是逐步把每个小版本的验证步骤沉淀成可复用 scenario，最后通过一套 Harness 完成 MVP 主链路验收。

---

## 总体版本路线

```text
V0 工程基线
V1 会话与消息存储骨架
V2 单会话 Mock Stream 闭环
V2.5 V2 收尾检查与边界修复
V2.6 豆包真实 AI Provider Spike
V3 多会话 Streaming 运行时
V4 停止生成与失败重试
V5 基础 ToolCall 闭环
V6 UI 状态完整还原
V7 Markdown、代码块与体验增强
V8 MVP Candidate
V9 Harness 验证版本
```

推荐推进方式：

1. 每个版本先人工验证。
2. 版本稳定后，把关键验证步骤沉淀成可复用 scenario。
3. 最后 V9 复用 V1-V8 沉淀的流程、工具、断言和关键场景，组织一键 MVP 验收；不要求机械顺序执行所有历史版本命令。

后端测试策略：

- API 行为和数据库真实状态优先沉淀到 `tests/harness/scenarios/`，通过真实 API + `TEST_DATABASE_URL` 覆盖。
- 单元测试只覆盖分页参数、DTO 转换、SSE frame/parser、chat state guard、abort/retry 判断、active streaming 判断、ToolCall 参数校验、error response 标准化等低成本纯逻辑。
- 不要求为每个 Nuxt server route 编写孤立单测，不为了覆盖率 mock Prisma 写大量脆弱测试。
- 具体规则见 `docs/rules/verification.md` 和 `docs/rules/backend.md`。

---

## V0：工程基线版本

### 目标

确认项目基础设施可用，保证后续 Codex 生成代码不会卡在环境、依赖、UI 框架、编码问题上。

### 后端/工程内容

- Nuxt 项目可启动
- TypeScript 配置正常
- Prisma 安装完成
- PostgreSQL 连接方式确认
- `prisma/schema.prisma` 存在并可生成 Prisma Client
- `.env.example` 包含必要变量
  - `DATABASE_URL`：开发/业务数据库
  - `TEST_DATABASE_URL`：Harness 专用测试数据库
- 本地开发库和 Harness 测试库的人工建库教程见 `docs/setup/database.md`
  - TODO：如果该文件不存在，需要补充独立建库教程，不要在本文档中展开数据库操作细节
- `AGENTS.md` 和 docs 规则文件已放入仓库
- Windows / WSL / UTF-8 / LF 等基础工程约束明确
- Harness 基础 devDependencies 已安装：
  - `tsx`
  - `@playwright/test`
  - `dotenv`
  - `execa`
  - `@types/node`

### 前端内容

- Tailwind CSS 接入
- Nuxt UI 接入
- Pinia 接入
- 首页能展示最小 Nuxt UI 组件，例如：
  - `UButton`
  - `UBadge`
  - `UTextarea`

### 人工验证步骤

```bash
pnpm install
pnpm dev
pnpm typecheck
npx prisma generate
```

浏览器中确认：

- Nuxt 页面可打开
- Nuxt UI 组件样式正常
- 控制台没有 `Unknown component` 或样式缺失错误

### 可沉淀 Harness 场景

暂不需要复杂 Harness。可保留为工程脚本：

```bash
pnpm verify:base
```

建议未来包含：

```bash
pnpm typecheck
npx prisma generate
```

### 不做

- 不做聊天页面
- 不做数据库业务接口
- 不做流式响应
- 不做真实模型
- 不做 ToolCall

---

## V1：会话与消息存储骨架版本

### 目标

先跑通最基本的数据闭环：创建会话、查询会话、切换会话、加载消息。

### 后端内容

- 完成 Prisma migration
- 实现 repository 层：
  - `conversationRepository`
  - `messageRepository`
  - `toolCallRepository`
- 实现基础 API：
  - `POST /api/conversations`
  - `GET /api/conversations`
  - `GET /api/conversations/:id`
  - `DELETE /api/conversations/:id`
  - `GET /api/conversations/:id/messages`
    - 支持 `limit` / `beforeSeq` / `afterSeq`
    - `limit` 默认 `50`
    - 返回 `pageInfo`
    - 即使消息为空，也要返回符合 `docs/api-contract.md` 的结构
  - `GET /api/profiles`
- 会话删除使用软删除：
  - `Conversation.status = deleted`
- 默认会话列表不返回 `deleted`
- 初始 `ConversationDTO` 中：
  - `isStreaming = false`
  - `activeAssistantMessageId = null`

### 前端内容

- 建立 Pinia store：
  - `conversationStore`
  - `profileStore`
- 页面具备基础布局：
  - 左侧会话列表
  - 顶部 Profile 区
  - 中间消息区域
  - 底部输入区可以先禁用
- 支持：
  - 创建新会话
  - 切换会话
  - 加载当前会话消息
  - 首次进入会话时拉取最近 50 条消息，并按 `seq ASC` 渲染
  - 刷新页面后重新加载会话列表

### 人工验证步骤

本地运行后验证：

1. 点击“新建会话”
2. 左侧出现新会话
3. 切换会话后主区域更新
4. 刷新页面后会话仍存在
5. 删除会话后左侧列表不再展示
6. 数据库中会话状态为 `deleted`，不是物理删除

### 可沉淀 Harness 场景

建议沉淀为：

```text
tests/harness/scenarios/conversation.scenario.ts
```

自动验证内容：

1. 调用 `POST /api/conversations` 创建会话
2. 调用 `GET /api/conversations` 确认会话存在
3. 调用 `GET /api/conversations/:id` 确认详情可读
4. 调用 `GET /api/conversations/:id/messages?limit=50` 确认初始消息列表为空，且 `pageInfo` 结构符合契约
5. 调用 `DELETE /api/conversations/:id`
6. 再次调用 `GET /api/conversations`，确认默认列表不返回 deleted 会话
7. 查询数据库，确认会话是软删除

建议命令：

```bash
pnpm verify:v1
```

### 不做

- 不做发送消息
- 不做流式输出
- 不做 abort / retry
- 不做 ToolCall
- 不做 Markdown 渲染

---

## V2：单会话 Mock Stream 闭环版本

### 目标

跑通最小聊天主链路：用户发送消息，后端创建 user message 和 assistant message，前端看到 mock 流式输出，结束后落库。

### 后端内容

- 实现 `POST /api/chat`
- 流式协议已确定使用标准 SSE
  - 字段、DTO、SSE event 以 `docs/api-contract.md` 为准
  - SSE frame、前后端读写、错误边界、abort/retry 竞态以 `docs/architecture/streaming-protocol.md` 为准
- 只使用 mock stream，不接真实模型
- 请求参数：
  - `conversationId`
  - `profileId`
  - `mode`
  - `content`
- 后端流程：
  1. 校验 conversation 存在且未 deleted
  2. 校验 content 非空
  3. 创建 user message，`status = done`
  4. 创建 assistant message，`status = streaming`
  5. 返回结构化 stream events：
     - `message_created`
     - `text_delta`
     - `message_done`
     - `message_failed`
  6. 服务端内存累积 `fullContent`
  7. 生成完成后更新 assistant message：
     - `content = fullContent`
     - `status = done`
- 不每个 token 写数据库

### 前端内容

- 建立 `chatRuntimeStore`
- 建立 `useChatStream`
- 输入框可发送消息
- 前端解析 stream event
- 实时追加 assistant 内容
- 实现基础 typewriter display buffer
- 区分 `rawContent` / `displayContent` / `pendingText`
- `text_delta` 不直接整段跳出，而是通过 typewriter 节奏展示
- streaming 中使用 `markdown-it` 做基础 Markdown 渲染
- 实现 `normalizeStreamingMarkdown`，至少支持未闭合代码块临时闭合
- 消息结束后状态变成 `done`
- 当前会话生成中时，输入框禁用或展示“正在生成”

### 人工验证步骤

1. 创建一个会话
2. 输入一条消息并发送
3. user message 立即显示
4. assistant message 逐段出现
5. 生成完成后状态为 `done`
6. 刷新页面后 user message 和 assistant message 仍存在
7. 数据库中 `seq` 顺序正确：
   - user message seq = 1
   - assistant message seq = 2

### 可沉淀 Harness 场景

建议沉淀为：

```text
tests/harness/scenarios/single-stream.scenario.ts
```

自动验证内容：

1. 创建 conversation
2. 调用 `POST /api/chat`
3. 通过 `stream-client` 读取 stream event
4. 断言收到：
   - `message_created`
   - 至少一个 `text_delta`
   - `message_done`
5. 查询消息列表
6. 断言：
   - 存在 user message，status = done
   - 存在 assistant message，status = done
   - assistant content 不为空
   - seq 正确且不重复

建议命令：

```bash
pnpm verify:v2
```

### 不做

- 不做多会话同时 streaming
- 不做停止生成
- 不做失败重试
- 不做工具调用
- 不接真实模型
- 不做完整代码高亮
- 不做代码复制按钮
- 不做复杂表格优化
- 不做 Nuxt Content / MDC 聊天消息渲染

---

## V2.5：V2 收尾检查与边界修复

### 已完成内容

V2.5 只做 V2 单会话 Mock Stream 闭环的收尾检查、回归和必要边界修复，不进入 V3 / V4 / V5。

完成项：

* `ErrorRetryBlock` 只有 `retryable=true` 时才展示重试按钮。
* 页面卸载统一清理 typewriter timer。
* Markdown raw HTML 关闭。
* fake stream / fake message 前端主链路已移除。
* `pnpm typecheck` 通过。
* `pnpm verify:v1` 通过。
* `pnpm verify:v2` 通过。
* 人工页面验证通过。

---

## V2.6：豆包真实 AI Provider Spike

### 定位

V2.6 位于 V2.5 收尾检查之后，用真实火山方舟 / 豆包流式接口验证当前架构，尽早暴露 Provider Adapter、历史消息、上游流解析和错误处理方面的问题。

它不是完整多 Provider 产品化，不进入 V3 / V4 / V5，不改变前端内部 SSE 契约。

详细规则归属：

* Ark 上游流解析、Provider delta 到内部 SSE 的转换、Conversation History 规则，见 `docs/architecture/streaming-protocol.md`。
* Provider 配置、职责边界、安全和日志规则，见 `docs/rules/backend.md`。
* Harness 强制 mock、真实 Provider smoke 隔离，见 `docs/rules/verification.md`。

### 实施步骤与交付物

1. 抽象统一 `ChatModelProvider`。
2. 将现有 mock stream 收敛为 `MockChatProvider`。
3. 新增 `ArkChatProvider`。
4. 通过统一配置 `AI_CHAT_PROVIDER=mock|ark` 选择当前 Provider。
5. 调用火山方舟 Chat Completions 流式接口。
6. 将 Ark 外部 chunk 转换为统一 provider delta。
7. 再由 chat service 转换成项目内部 SSE。
8. 验证真实回复最终落库。
9. 验证连续两轮对话能够携带历史上下文。
10. 新增独立真实 Provider smoke。
11. Mock Provider 长期保留。
12. 默认 Harness 永远使用 Mock Provider。

### 验证命令计划

后续实现阶段约定增加：

```bash
pnpm dev:mock
pnpm dev:ark
pnpm smoke:ai-provider
```

语义：

* `pnpm dev:mock`：显式以 `AI_CHAT_PROVIDER=mock` 启动开发服务，不调用真实 AI，用于普通开发和稳定调试。
* `pnpm dev:ark`：显式以 `AI_CHAT_PROVIDER=ark` 启动开发服务，从用户本地 `.env` 读取 Ark 配置，用于人工验证真实豆包流，不得输出真实 API Key。
* `pnpm smoke:ai-provider`：显式验证真实 Ark Provider，不属于默认 Harness，只有用户主动运行时才允许产生真实 AI 请求和费用。

如果考虑 Windows、macOS 和 Linux 跨平台兼容，实现阶段可以使用 `cross-env`，但该依赖需要另行确认后再安装。

### 成功标准

1. `AI_CHAT_PROVIDER=mock` 时，现有 V2 mock stream 行为和 `verify:v1` / `verify:v2` 保持稳定。
2. `AI_CHAT_PROVIDER=ark` 时，能通过真实 Ark 流式接口得到回复，并以项目内部 SSE 输出给前端。
3. Ark 真实回复最终写入 assistant message，状态为 `done`。
4. 连续两轮对话能携带符合规则的历史上下文。
5. Ark 上游失败、超时或非法 chunk 能转换为安全的 `message_failed`，不泄露密钥、Authorization、完整 prompt 或完整回答。
6. `pnpm smoke:ai-provider` 可独立验证真实 Ark Provider，且不属于默认 Harness。
7. 默认 Harness 强制使用 Mock Provider，不调用真实 Ark，不产生真实 AI 费用。

### 不做

* 不做产品 UI Provider 开关。
* 不做多个真实 Provider。
* 不做模型选择 UI。
* 不做 ToolCall。
* 不做 reasoning 展示。
* 不做 usage 持久化和计费。
* 不做 abort / retry 正式闭环。
* 不做复杂重试和 fallback。
* 不做 Provider 管理后台。
* 不做 Responses API。
* 不修改前端内部 SSE 协议。
* 不让默认 Harness 调用真实 AI。

---

## V3：多会话 Streaming 运行时版本

### 目标

实现核心并发策略：

- 允许不同 Conversation 同时 streaming
- 禁止同一个 Conversation 同时 streaming

### 已完成内容

V3 已完成多会话 Streaming 运行时闭环，完成项包括：

* 不同 Conversation 可以同时 streaming。
* 同一 Conversation 只允许一个 active assistant stream。
* PostgreSQL conversation 行锁保证同会话 guard 与消息创建原子性。
* A/B 的 SSE、message、runtime、typewriter 相互隔离。
* 切换会话不影响后台生成。
* 侧边栏显示非当前会话生成状态。
* 当前会话生成时禁止重复发送，但不影响其他会话。
* `verify:v3` 使用 Mock Provider 验证：
  * A/B stream 真正重叠。
  * streaming 中间态 list/detail。
  * duplicate 请求返回 409。
  * 409 不影响原 A/B stream。
  * 最终 DTO 恢复。
  * API/DB/content/seq/parent 隔离。
* `dev:mock:slow` 用于人工观察多会话状态。
* V3 人工验证通过。

### 后端内容

- 复用并验证现有同会话 active streaming guard
- active streaming 定义：
  - `role = assistant`
  - `status in [pending, streaming]`
- 如果目标 conversation 已有 active streaming，返回：

```json
{
  "message": "Current conversation already has an active streaming message",
  "code": "CONVERSATION_STREAMING"
}
```

HTTP 状态码：

```text
409 Conflict
```

- 不使用全局 streaming 锁
- 不同 conversationId 的 `/api/chat` 请求互不影响
- 不同 conversation 可以同时 streaming
- 同一 conversation 只能存在一个 active assistant stream
- A 的重复请求返回 409 时，A 原 stream 和 B stream 均不受影响
- `GET /api/conversations` 和 `GET /api/conversations/:id` 需要根据 active assistant message 返回真实的：
  - `isStreaming`
  - `activeAssistantMessageId`
- streaming 期间 list/detail 返回真实 `isStreaming=true` 和对应 `activeAssistantMessageId`
- 完成后 list/detail 恢复为 `isStreaming=false` / `activeAssistantMessageId=null`

### 前端内容

- 检查并补齐现有 `conversationStore`：
  - `activeConversationId`
  - `conversations`
  - `messagesByConversationId`
- 检查并补齐现有 `chatRuntimeStore`：
  - `conversationStates`
  - 每个 conversation 独立的 reader / request
  - 每个 conversation 独立的 `AbortController`
  - 每个 conversation 独立的 `streamingMessageId`
  - 每个 conversation 独立的 typewriter runtime
  - 每个 conversation 独立的 timer
  - 每个 conversation 独立的 error
- 左侧会话列表能展示非当前会话的 streaming 状态
- 左侧列表展示非当前 conversation 的 streaming 状态
- 切换会话不清空其他会话 runtime state
- 切换 active conversation 不影响后台 conversation 的 stream
- stream event 必须基于请求上下文中的 conversationId 更新数据，不能依赖当前 activeConversationId
- 一个 conversation 结束或失败时，不能清理其他 conversation runtime
- V3 不实现停止按钮和 abort API；`AbortController` 仅作为每个请求的 runtime 资源存在

### 人工验证步骤

1. 创建 Conversation A
2. 创建 Conversation B
3. 在 A 中发送消息，让 A streaming
4. 切换到 B
5. 在 B 中发送消息，让 B streaming
6. 确认 A 和 B 可以同时 streaming
7. 切回 A，A 的内容仍在更新或已完成
8. 在 A streaming 时再次对 A 发送消息，应被拒绝或前端禁止
9. 后端同会话重复请求返回 `409 CONVERSATION_STREAMING`

### 可沉淀 Harness 场景

建议沉淀为：

```text
tests/harness/scenarios/multi-stream.scenario.ts
```

自动验证内容：

1. 创建 Conversation A 和 B
2. 使用带可控延迟的 Mock Provider
3. 并发调用 A、B 的 `/api/chat`
4. 确认两个 stream 在时间上重叠，而不是先后完成
5. A、B 分别收到：
   - `message_created`
   - `text_delta`
   - `message_done`
6. A、B 的 `conversationId`、`streamId`、`messageId` 不串流
7. 在 A 尚未结束时再次请求 A
8. 断言：
   - HTTP 409
   - `code = CONVERSATION_STREAMING`
9. 断言 A 原 stream 继续完成
10. 断言 B stream 继续完成
11. streaming 期间查询 list/detail：
   - A、B 均 `isStreaming=true`
   - `activeAssistantMessageId` 分别正确
12. 完成后查询：
   - `isStreaming=false`
   - `activeAssistantMessageId=null`
13. API 和数据库分别断言：
   - A、B 内容与各自 delta 拼接一致
   - seq 各自独立且不重复
   - 不存在跨 conversation 消息污染
14. `pnpm verify:v3` 必须强制：
   - `AI_CHAT_PROVIDER=mock`
   - 不调用真实 Ark
   - 不产生真实 AI 费用

建议命令：

```bash
pnpm verify:v3
```

### 不做

- 不做停止生成
- 不做重试
- 不做 ToolCall
- V3 自动验证默认只使用 Mock Provider
- 不要求 Ark 多会话并发作为验收条件
- 不新增真实 Provider 专属并发逻辑
- 不做跨进程分布式锁
- 不做任务队列

---

## V4：停止生成与失败重试版本

### 目标

补齐停止生成、partial content 保存、服务端 Provider 取消、`aborted` 终态、`failed` / `aborted` retry、新 assistant message 创建、多会话隔离和 `verify:v4`。

字段、错误码和 SSE event 以 `docs/api-contract.md` 为准；Provider 取消、终态竞争和 retry stream 协议以 `docs/architecture/streaming-protocol.md` 为准；状态机以 `docs/rules/chat-flow.md` 为准。

### V4-1：后端状态机、Provider 取消与 Harness

交付内容：

* 服务端 active stream registry。
* Provider `AbortSignal`。
* `POST /api/messages/:id/abort`。
* 条件终态更新：第一个成功落库的 `done` / `failed` / `aborted` 获胜。
* `POST /api/messages/:id/retry`。
* retry assistant 原子创建。
* 独立内部 SSE event：`retry_created`。
* Mock `failAtChunk`。
* `verify:v4`。

本步骤不实现前端停止 / 重试按钮。

### V4-2：前端停止与重试交互

交付内容：

* 当前会话停止按钮。
* 只允许停止存在本地 `AbortController` 的 stream。
* 停止时提交 typewriter runtime 中的 `rawContent`，不使用 `displayContent`。
* abort API 成功后清理本地 reader / controller。
* failed / aborted message 展示 retry。
* retry 流处理 `retry_created`。
* 原 failed / aborted 消息保留。
* 新 assistant message 单独展示。
* 多会话人工验证。
* V1 到 V4 回归。

### 人工验证步骤

停止生成：

1. 发送消息
2. assistant streaming 中点击停止
3. 当前 assistant message 变成 `aborted`
4. partial content 保留
5. 其他 conversation 的 streaming 不受影响

失败重试：

1. 通过 mock 参数或测试模式制造失败
2. assistant message 变成 `failed`
3. 点击重试
4. 旧 failed message 保留
5. 新 assistant message 生成
6. 新旧消息 seq 不重复

### 可沉淀 Harness 场景

建议沉淀为：

```text
tests/harness/scenarios/abort-retry.scenario.ts
```

自动验证内容：

1. 创建 conversation
2. 发起 mock stream
3. 在收到部分 `text_delta` 后调用 abort
4. 断言 assistant message status = aborted
5. 断言 partial content 被保存
6. 调用 retry
7. 断言旧 aborted message 仍存在
8. 断言新 assistant message 被创建
9. 断言 retry 后新 message 可以 done
10. 通过 mock fail 模式制造 failed message
11. 对 failed message retry，并断言旧消息不被覆盖

建议命令：

```bash
pnpm verify:v4
```

### 成功标准

1. 停止真正取消服务端 Provider。
2. assistant 最终状态为 `aborted`。
3. partial content 等于停止时提交的 `rawContent`。
4. `aborted` 不会被后续 `done` / `failed` 覆盖。
5. retry 保留旧消息并创建新 assistant。
6. retry stream 首事件为 `retry_created`。
7. `failed` / `aborted` 均可 retry。
8. 不可 abort / retry 返回稳定错误码。
9. A stop / retry 不影响 B stream。
10. `verify:v4` 强制 Mock Provider，不调用 Ark。

### 不做

- 自动 Harness 默认使用 Mock Provider
- 不扩展真实 Provider 专属 abort / retry 行为
- 不做刷新后的停止
- 不做跨标签页停止
- 不做断线恢复
- 不做多实例 registry
- 不做 Redis / 队列
- 不做 ToolCall
- 不做 Ark 自动 Harness
- 不做复杂 retry policy
- 不做自动重试
- 不做 retry 次数限制和管理后台

---

## V5：基础 ToolCall 闭环版本

### 目标

跑通基础工具调用的展示与记录能力。

### 后端内容

- 实现 Tool Registry
- 实现本地工具：
  - `calculator`
  - `currentTime`
  - `mockWeather`
- 每个工具包含：
  - `name`
  - `description`
  - `inputSchema`
  - `source`
  - `execute`
- 工具参数必须校验
- 创建和更新 ToolCall：
  - `pending`
  - `running`
  - `success`
  - `failed`
- mock stream 中可以先用规则模拟工具调用，不一定依赖真实模型判断
- ToolCall 关联到 assistant message

### 前端内容

- ToolCallCard 展示：
  - 工具名称
  - running / success / failed 状态
  - 参数摘要
  - 结果或错误
- MessageItem 能渲染 toolCalls
- ToolCall running 时，对应 assistant message 仍视为 streaming

### 人工验证步骤

1. 输入“现在几点，顺便算一下 599 * 3”
2. 后端模拟触发：
   - `currentTime`
   - `calculator`
3. 前端展示 ToolCallCard running
4. 工具完成后展示 success
5. 数据库中存在 ToolCall 记录
6. 制造一个工具失败，前端展示 failed ToolCallCard

### 可沉淀 Harness 场景

建议沉淀为：

```text
tests/harness/scenarios/tool-call.scenario.ts
```

自动验证内容：

1. 创建 conversation
2. 发送触发 tool call 的 mock prompt
3. 读取 stream event
4. 断言收到 tool call 相关事件，或在 message 完成后查询到 ToolCall
5. 断言存在：
   - `calculator` success
   - `currentTime` success
6. 制造工具失败
7. 断言 ToolCall status = failed，errorMessage 存在
8. 断言工具失败不会破坏消息状态规则

建议命令：

```bash
pnpm verify:v5
```

### 不做

- 不做真实 MCP
- 不做高风险工具
- 不做任意工具执行接口
- 不做文件、邮件、日历、支付等写操作

---

## V6：UI 状态完整还原版本

### 目标

让界面基本匹配 Figma 状态图，并保证所有状态可见、可测。

### 后端内容

- 不新增大后端能力
- 可补充必要 mock 数据或测试开关，用于制造：
  - streaming
  - failed
  - aborted
  - tool call running
  - tool call success
  - tool call failed
  - 多会话 simultaneous streaming

### 前端内容

具体 UI 交互、滚动、输入框、历史消息加载、失败、停止、重试、多页面行为，以 `docs/ui/interaction-rules.md` 为准。本文档只保留本阶段要完成的能力和验证重点，不重复定义完整交互规则。

根据 `docs/ui/ui-implements.md` 和 `docs/ui/photos/` 实现或完善：

- ChatPage
- ConversationSidebar
- ConversationItem
- ChatHeader
- ProfileSwitcher
- MessageList
- MessageItem
- MessageInput
- ToolCallCard
- MarkdownRenderer
- CodeBlock
- StreamingIndicator
- ErrorRetryBlock

覆盖状态：

- 空会话
- 正常对话
- Streaming
- Tool Call
- Failed
- Aborted
- 多会话同时 Streaming

### 人工验证步骤

逐张对照 Figma 状态图：

1. 空会话状态是否正确
2. 正常对话状态是否正确
3. Streaming 状态是否正确
4. ToolCall 状态是否正确
5. Failed + retry 是否正确
6. Aborted + retry 是否正确
7. 多会话 streaming 是否正确
8. 移动端或窄屏下是否基本可用

### 可沉淀 Harness 场景

建议后续沉淀为 Playwright：

```text
tests/e2e/ui-states.spec.ts
```

自动验证内容：

1. 打开首页
2. 看到空会话状态
3. 创建会话
4. 发送消息
5. 看到 streaming 状态
6. 触发 stop
7. 看到 aborted 状态和 retry 按钮
8. 触发失败模式
9. 看到 failed 状态和 retry 按钮
10. 触发 tool call
11. 看到 ToolCallCard
12. 创建第二个会话
13. 看到左侧多会话 streaming 状态

建议命令：

```bash
pnpm e2e:ui
```

### 不做

- 不追求像素级还原
- 不做复杂动画
- 不做营销首页
- 不做完整响应式后台

---

## V7：Markdown、代码块与体验增强版本

### 目标

补齐聊天产品的基本可用体验。

### 后端内容

- 不新增核心后端链路
- 保持 API 契约稳定

### 前端内容

具体 UI 交互、滚动、输入框、历史消息加载、失败、停止、重试、多页面行为，以 `docs/ui/interaction-rules.md` 为准。本文档只保留本阶段要完成的能力和验证重点，不重复定义完整交互规则。

- Markdown 渲染
- 代码块渲染
- 完整代码块高亮
- 代码块语言标识
- 代码复制按钮
- 表格优化
- done 后最终 Markdown 渲染体验优化
- streaming 中 Markdown 抖动优化
- Toast / Alert
- 空状态示例问题
- 自动滚动策略按 `docs/ui/interaction-rules.md` 实现
- 输入快捷键按 `docs/ui/interaction-rules.md` 实现
- loading / disabled / failed / aborted 细节优化

### 人工验证步骤

1. assistant 返回 Markdown 列表，能正常展示
2. assistant 返回代码块，能正常高亮或至少正确排版
3. 复制代码按钮可用
4. streaming 时自动滚动合理
5. 用户上滑查看历史时不被强制拉到底部
6. failed / aborted 状态交互清楚

### 可沉淀 Harness 场景

建议沉淀为：

```text
tests/e2e/markdown-codeblock.spec.ts
```

自动验证内容：

1. 发送能返回 Markdown 的 mock prompt
2. 断言列表、标题、段落展示存在
3. 发送能返回代码块的 mock prompt
4. 断言代码块容器存在
5. 断言语言标识存在
6. 点击复制按钮
7. 断言复制动作成功或 Toast 出现
8. 验证输入框 Enter / Shift+Enter 行为

建议命令：

```bash
pnpm e2e:markdown
```

### 不做

- 不做复杂富文本编辑
- 不做文件上传
- 不做 RAG
- 不做真实 MCP

---

## V8：MVP Candidate 版本

### 目标

整理成可展示、可讲解、可部署的 MVP 候选版本。

### 后端内容

- Mock Provider 稳定
- Ark Provider smoke 稳定
- Provider 切换入口和环境变量说明完整
- 基础工具调用稳定
- abort / retry 稳定
- 多会话 streaming 稳定
- 错误结构统一
- 环境变量整理
- 基础日志

### 前端内容

- Figma 核心状态基本还原
- 主流程可连续演示
- 空状态、失败状态、停止状态、工具状态清晰
- 基础响应式可用

### 文档内容

- README
- 架构说明
- 本地启动说明
- 环境变量说明
- 数据模型说明
- API 契约链接
- Roadmap

Roadmap 可以包含：

- 更多 AI Provider
- Responses API
- usage / 成本统计
- 上下文压缩
- Go MCP Tool Service
- 领域 Profile 扩展
- KnowledgeSource / RAG
- Electron 桌面端
- 多端同步

### 人工验证步骤

完整演示路径：

1. 启动项目
2. 创建会话
3. 发送普通消息
4. 看到流式输出
5. 停止生成
6. 重试
7. 触发工具调用
8. 创建第二个会话
9. 两个会话同时 streaming
10. 刷新页面后数据可恢复
11. 删除会话后不再显示
12. README 能解释项目架构和后续方向

### 可沉淀 Harness 场景

此阶段不新增独立 scenario，主要是准备 V9 的完整串联验收。

建议先确保以下命令都可独立运行，作为定位问题时的定向回归入口：

```bash
pnpm verify:v1
pnpm verify:v2
pnpm verify:v3
pnpm verify:v4
pnpm verify:v5
pnpm e2e:ui
pnpm e2e:markdown
```

这些命令不要求在 `verify:mvp` 中机械串联执行。`verify:mvp` 应复用它们沉淀出的工具、测试数据和关键断言，组织更高层的完整验收流。

### 不做

- 不做真实生产级账号系统
- 不做完整垂直领域产品
- 不做真实 MCP
- 不做 Electron
- 不做 RAG

---

## V9：Harness 验证版本

### 目标

将 V1-V8 的人工验证流程沉淀为可重复运行的 Harness，支持一键验证 MVP 主链路。

最终命令目标：

```bash
pnpm verify:mvp
```

Harness 不是重新写一套新验证，而是复用前面每个小版本沉淀出来的流程、工具、测试数据、关键断言和 scenario。

`verify:mvp` 不需要机械执行 `verify:v1` 到 `verify:v5`。推荐定位是一个更高层的完整 MVP 验收入口：复用已有 `api-client`、`stream-client`、`db-assert`、测试数据、关键断言和必要 E2E，覆盖 MVP 主链路。

---

### Harness 覆盖范围摘要

至少覆盖：

- 工程基础检查
- 测试数据库 reset / seed
- Conversation API
- Message API
- Mock Stream
- 多会话并发 streaming
- Abort / Retry
- ToolCall
- UI E2E
- Markdown / CodeBlock 基础展示

### Harness 规则引用

具体 Harness 规则不在本文档重复定义：

- 验证命令选择、测试数据库、`verify:mvp` 组织方式、复用工具、最终回复要求，见 `docs/rules/verification.md`。
- 后端测试策略、unit test 与 Harness 的边界，见 `docs/rules/verification.md` 和 `docs/rules/backend.md`。
- 字段、DTO、SSE event 以 `docs/api-contract.md` 为准。
- SSE frame、前后端读写、错误边界、abort/retry 竞态、Harness SSE parser 复用规则，以 `docs/architecture/streaming-protocol.md` 为准。

---

## Codex 执行规则

每个版本任务都要求 Codex 输出：

1. 修改了哪些文件
2. 实现了哪些能力
3. 如何本地验证
4. 哪些内容没有做
5. 是否有与 docs 冲突的地方

每个版本完成后尽量运行：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm dev
```

如果命令不存在或无法运行，必须明确说明，不要假装已经验证。

---

## 当前优先级

当前已完成 V0、V1、V2、V2.5、V2.6、V3。

下一步进入 V4：停止生成与失败重试。
