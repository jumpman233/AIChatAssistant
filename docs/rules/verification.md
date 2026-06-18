# 验证与 Harness 规则

## 目标

开发验证必须服务于最终 Harness 验收，不要在最后重新设计一套验收流程。

验证规则需要同时满足：

* 日常开发能快速确认当前改动闭环。
* 每个小版本的稳定验证步骤能沉淀为可复用 scenario 或 E2E spec。
* 最终 `verify:mvp` 能复用前面沉淀的流程、工具、断言和关键场景，而不是另起一套验收实现。

## 默认节奏

* 按 `docs/progress-guideline.md` 的 V0-V9 小版本推进，每次只验证当前任务涉及的最小闭环。
* 每个版本先用人工步骤确认行为，再把稳定的关键步骤沉淀成可复用 Harness scenario 或 E2E spec。
* 新增验证脚本时，优先复用既有 `tests/harness/utils/` 中的 api-client、stream-client、db-assert、wait、test-data 等工具，不要为每个场景复制 fetch、stream 解析或数据库断言逻辑。
* V2 以后涉及流式响应的验证必须复用统一 stream client，能够收集 `message_created`、`text_delta`、`tool_call_created`、`tool_call_updated`、`message_done`、`message_failed`，并支持超时和失败时输出原始片段。
* 涉及数据库断言时，应同时验证 API 行为和数据库状态，尤其是 soft delete、message status、seq、ToolCall status、retry 是否创建新消息、旧消息是否保留。

## 后端接口与逻辑测试覆盖矩阵

本矩阵直接放在本文档中，作为后端验证策略的主入口。若后续接口和单元测试清单继续膨胀，可以拆到独立测试矩阵文档，再由本文档指路。

### 总原则

1. 不要求为每个 Nuxt server route 编写孤立 route 单测。
2. API 行为优先通过 `tests/harness/scenarios/` 中的真实 API + `TEST_DATABASE_URL` 集成验证覆盖。
3. 单元测试只覆盖低成本、高价值、可独立验证的纯逻辑。
4. Route handler 应保持薄层，只负责：
   * 读取 request params / body / query
   * 调用 service
   * 返回 response
   * 处理标准错误结构
5. 复杂逻辑必须下沉到 service / mapper / validator / utils，再写 unit test。
6. 不要为了覆盖率大量 mock Prisma 写脆弱测试。
7. 涉及数据库真实状态、Prisma 写入、seq、soft delete、streaming 状态、ToolCall 持久化的验证，应放到 Harness。

### 必须由 Harness 覆盖的接口

以下接口的主要行为通过 Harness 覆盖，不要求额外为 route handler 写孤立单测。

#### Conversation / Message 基础 API

接口：

* `POST /api/conversations`
* `GET /api/conversations`
* `GET /api/conversations/:id`
* `DELETE /api/conversations/:id`
* `GET /api/conversations/:id/messages`
* `GET /api/profiles`

对应 Harness：

* `tests/harness/scenarios/conversation.scenario.ts`
* 命令：`pnpm verify:v1`

必须验证：

* 创建 conversation 成功
* conversation 列表能查到新会话
* conversation detail 可读
* 初始 `ConversationDTO.isStreaming = false`
* 初始 `ConversationDTO.activeAssistantMessageId = null`
* `GET /api/conversations/:id/messages?limit=50` 返回 `items=[]`
* 空消息列表也返回正确 `pageInfo`
* soft delete 后默认列表不返回 deleted 会话
* 数据库中 conversation 是 soft delete，不是物理删除

#### Chat Stream API

接口：

* `POST /api/chat`

对应 Harness：

* `tests/harness/scenarios/single-stream.scenario.ts`
* `tests/harness/scenarios/multi-stream.scenario.ts`
* 命令：
  * `pnpm verify:v2`
  * `pnpm verify:v3`

必须验证：

* 返回 `text/event-stream`
* 收到 `message_created`
* 收到至少一个 `text_delta`
* 正常结束收到 `message_done`
* stream event 可被统一 `stream-client` 解析
* user message 和 assistant message 正确落库
* message `seq` 正确且不重复
* assistant message 最终 `status = done`
* 不同 conversation 可以同时 streaming
* 同一 conversation 已有 active streaming 时再次发送返回 `409 CONVERSATION_STREAMING`
* `GET /api/conversations` / `GET /api/conversations/:id` 能返回真实 `isStreaming` 和 `activeAssistantMessageId`

#### Abort / Retry API

接口：

* `POST /api/messages/:id/abort`
* `POST /api/messages/:id/retry`

对应 Harness：

* `tests/harness/scenarios/abort-retry.scenario.ts`
* 命令：`pnpm verify:v4`

必须验证：

* streaming 中调用 abort 后 message 变为 `aborted`
* partial content 被保存
* 已经 `done` 的 message 不能被迟到 abort 覆盖成 `aborted`
* 原 stream completion 不能把已经 `aborted` 的 message 覆盖成 `done`
* aborted message 可以 retry
* failed message 可以 retry
* done message 不可 retry
* retry 不覆盖旧 message
* retry 创建新的 assistant message
* 新 message 的 `parentMessageId` 指向同一条 user message
* retry 前如果 conversation 已有 active streaming，返回 `409 CONVERSATION_STREAMING`

#### ToolCall API / ToolCall 流程

如果第一阶段有工具列表接口：

* `GET /api/tools`

其 API 返回结构可由 Harness 或轻量 API check 覆盖；工具调用主链路必须由 Harness 覆盖。

对应 Harness：

* `tests/harness/scenarios/tool-call.scenario.ts`
* 命令：`pnpm verify:v5`

必须验证：

* mock prompt 可稳定触发 ToolCall
* stream 中能收到 `tool_call_created`
* stream 中能收到 `tool_call_updated`
* ToolCall 记录正确落库
* ToolCall status 可以从 `running` 变为 `success`
* 工具失败时 ToolCall status = `failed`
* ToolCall failed 不应破坏 message 状态机规则
* calculator / currentTime / mockWeather 至少覆盖成功路径
* 至少覆盖一个工具失败路径

### 必须由单元测试覆盖的逻辑

以下逻辑应放在 `tests/unit/`，不依赖真实数据库，不 mock Prisma，不通过真实 HTTP 请求验证。

#### Pagination / Message List 逻辑

建议测试文件：

* `tests/unit/pagination.test.ts`

覆盖：

* `limit` 缺省为 50
* `limit` 最大值限制
* `beforeSeq` 参数解析
* `afterSeq` 参数解析
* `beforeSeq` 和 `afterSeq` 不建议同时使用；如果实现中禁止同时使用，需要测试错误路径
* 未传 before/after 时表示拉最近 limit 条
* 返回结果最终按 `seq ASC`
* `pageInfo.hasMoreBefore`
* `pageInfo.hasMoreAfter`
* `pageInfo.beforeSeq`
* `pageInfo.afterSeq`

#### DTO Mapper 逻辑

建议测试文件：

* `tests/unit/dto-mapper.test.ts`

覆盖：

* ConversationDTO 基础字段映射
* 无 active assistant message 时：
  * `isStreaming = false`
  * `activeAssistantMessageId = null`
* 有 active assistant message 时：
  * `isStreaming = true`
  * `activeAssistantMessageId = <messageId>`
* MessageDTO 字段映射
* ToolCallDTO 字段映射
* 不向前端泄露内部字段

#### Chat State Guard 逻辑

建议测试文件：

* `tests/unit/chat-state.test.ts`

覆盖：

* `pending` / `streaming` 视为 active streaming
* `done` / `failed` / `aborted` 不视为 active streaming
* 同 conversation 有 active streaming 时禁止再次 start stream
* 不同 conversation 的 active streaming 互不影响
* `streaming` message 可以 abort
* `pending` message 可以 abort
* `done` message 不可 abort
* `failed` message 不可 abort
* `aborted` message 不可 abort
* `failed` message 可以 retry
* `aborted` message 可以 retry
* `done` message 不可 retry
* retry 必须创建新 assistant message，不覆盖旧 message
* abort 后的 message 不得被 stream completion 覆盖成 done
* done message 不得被迟到 abort 覆盖成 aborted

#### SSE Frame / Parser 逻辑

建议测试文件：

* `tests/unit/sse.test.ts`

覆盖：

* 标准 SSE frame 构造：
  * `id:`
  * `event:`
  * `data:`
  * 空行结束
* `event` 和 `data.type` 一致性校验
* `message_created` event
* `text_delta` event
* `tool_call_created` event
* `tool_call_updated` event
* `message_done` event
* `message_failed` event
* parser 能处理分块 chunk
* parser 能处理一块里多个 event
* parser 遇到非法 JSON 时返回可诊断错误
* parser 失败时能保留原始片段用于调试

#### Error Response 逻辑

建议测试文件：

* `tests/unit/error-response.test.ts`

覆盖：

* 标准 error response 结构
* `docs/api-contract.md` 中已定义的 error code
* HTTP status 和 error code 映射一致
* 未写入 `docs/api-contract.md` 的新 error code，不得仅根据测试文档自行新增；必须先更新 API 契约

错误码名称必须与 `docs/api-contract.md` 保持一致。如果测试矩阵需要新增细分 code，先对齐 `docs/api-contract.md` 后再实现。

#### Tool Registry / Tool Schema 逻辑

建议测试文件：

* `tests/unit/tool-schema.test.ts`

覆盖：

* tool name 唯一
* tool input schema 校验
* calculator 参数校验
* currentTime 参数校验
* mockWeather 参数校验
* 工具执行成功返回标准 result
* 工具执行失败返回标准 error
* 工具失败不会绕过 ToolCall status 更新规则

#### Mock Stream Control 逻辑

建议测试文件：

* `tests/unit/mock-stream.test.ts`

覆盖：

* 可配置输出延迟
* 可配置 chunk 数量
* 可配置指定失败点
* 可配置触发 tool call
* 可配置工具成功
* 可配置工具失败
* mock / harness 控制参数不应成为真实模型 API 契约

### 不建议编写的测试

除非出现明确复杂逻辑，否则不要为以下内容编写大量孤立 route 单测：

* `server/api/conversations/index.post.ts`
* `server/api/conversations/index.get.ts`
* `server/api/conversations/[id].get.ts`
* `server/api/conversations/[id].delete.ts`
* `server/api/conversations/[id]/messages.get.ts`
* `server/api/chat.post.ts`
* `server/api/messages/[id]/abort.post.ts`
* `server/api/messages/[id]/retry.post.ts`

这些 route handler 应保持足够薄。其行为由 Harness 覆盖，内部复杂逻辑由 service / mapper / validator / utils 的 unit test 覆盖。

### 允许的例外

如果某个 route handler 出现以下情况，可以补少量 route 单测：

* 参数读取逻辑复杂且无法合理下沉
* 框架层行为容易出错
* response header 特别关键，例如 `Content-Type: text/event-stream`
* 回归 bug 明确发生在 route handler 薄层

即使如此，也应优先考虑把逻辑下沉，而不是扩大 route 单测范围。

## `verify:mvp` 规则

* 最终 `verify:mvp` 应复用 V1-V8 已沉淀的流程、工具、断言和关键场景，但不要求机械顺序执行 `verify:v1` 到 `verify:v5` 或所有历史命令。
* `verify:mvp` 可以组织为更高层的完整 MVP flow，只要它复用了前面积累的 api-client、stream-client、db-assert、测试数据和关键断言，且覆盖最终验收所需行为即可。
* 不要为了“复用”而重复跑低价值、重复初始化或互相冲突的历史场景。
* 不要在 V9 另起一套与前面验证逻辑无关的全新验收实现。

## Harness 数据库要求

* Harness 必须使用测试数据库，读取 `TEST_DATABASE_URL`。
* 不允许 Harness fallback 到 `DATABASE_URL`。
* 如果没有配置 `TEST_DATABASE_URL`，Harness 必须直接失败。
* Harness 不修改 `.env`。
* 需要连接测试库时，只能在测试子进程环境变量中临时将 `DATABASE_URL` 覆盖为 `TEST_DATABASE_URL`。
* reset / seed / cleanup 只能作用于测试数据库，不允许删除开发库或线上库数据。
* 涉及 reset test db、migration、seed 的脚本必须把目标数据库来源写清楚，避免误操作。
* 默认使用温和 reset：按外键依赖顺序清空业务表、重置必要序列或使用事务隔离测试数据，不默认 drop schema / drop database。
* `prisma migrate reset` 破坏性更强，除非明确确认，否则 Harness 不应默认使用。

## 验证命令选择

完成代码修改后，根据改动范围尽量运行相关命令，而不是机械跑全部命令。

常见命令：

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

## 最终回复要求

最终回复中必须说明：

* 实际运行了哪些验证命令。
* 哪些命令没有运行以及原因。
* 本次新增或修改的人工验证步骤是否已经沉淀为可复用 Harness scenario / E2E spec；如果还没有，需要说明后续应沉淀到哪个文件或命令。
* 本次验证是否满足 `docs/progress-guideline.md` 中对应小版本的要求。
