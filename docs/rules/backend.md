# docs/rules/backend.md

## 后端分层原则

本项目第一阶段使用 Nuxt server routes 作为后端 API 层。

后端代码分为：

```text
server/api          # HTTP 接口层
server/services     # 业务流程层
server/repositories # 数据访问层
server/tools        # 工具定义、工具注册、本地工具、MCP 预留
server/profiles     # Assistant Profile 配置
server/utils        # 服务端通用工具
```

## API 层规范

`server/api` 下的文件只负责 HTTP 边界处理。

允许做：

* 读取 query/body/params
* 参数校验
* 调用 service
* 返回响应
* 将错误转换成 HTTP 响应

不要做：

* 直接写复杂业务流程
* 直接写 Prisma 查询
* 直接编排模型流式响应
* 直接执行工具逻辑
* 引入前端组件或浏览器代码

推荐结构：

```ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const input = validateInput(body)

  const result = await someService(input)

  return result
})
```

## Service 层规范

`server/services` 负责业务编排。

聊天主流程应放在：

```text
server/services/chat/
  chatService.ts
  streamService.ts
  mockStreamService.ts
```

聊天 service 负责：

1. 确认 conversation 存在
2. 创建 user message
3. 创建 assistant message，初始状态为 `streaming`
4. 调用 mock stream 或真实模型 stream
5. 累积 assistant 输出内容
6. 成功时更新为 `done`
7. 停止时更新为 `aborted`
8. 失败时更新为 `failed`
9. 如果存在 tool call，记录 ToolCall

## Repository 层规范

`server/repositories` 负责数据库访问。

建议文件：

```text
conversationRepository.ts
messageRepository.ts
toolCallRepository.ts
```

repository 只处理数据读写，不处理模型调用、流式响应、UI 状态和 HTTP 细节。

第一阶段 / V1 不创建 `KnowledgeSource` 表，不实现 `knowledgeSourceRepository`。`KnowledgeSource` 只保留为未来扩展方向或类型口子。

## 工具调用规范

所有工具必须通过统一 Tool Registry 注册。

第一阶段允许的本地工具：

* calculator
* currentTime
* mockWeather

每个工具至少包含：

```ts
type ToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  source: 'local' | 'mcp'
  execute?: (args: unknown) => Promise<unknown>
}
```

要求：

* 工具必须白名单注册
* 工具参数必须校验
* 工具执行失败时返回明确错误
* 工具调用状态需要记录到 ToolCall
* 第一阶段禁止 shell、文件删除、任意代码执行、支付、邮件发送、日历写入等高风险工具

## 流式响应规范

不要每个 token 都写数据库。

推荐策略：

1. 创建 assistant message，状态为 `streaming`
2. 流式过程中在内存中累积内容
3. 前端实时展示 chunk
4. 完成后一次性保存完整内容，状态改为 `done`
5. 停止或失败时保存当前已有内容，状态改为 `aborted` 或 `failed`

## Provider 配置与 Adapter 规范

Provider 选择的唯一配置入口是：

```env
AI_CHAT_PROVIDER=mock
```

当前只允许：

```text
mock
ark
```

规则：

1. `mock` 使用本地 Mock Provider，无网络依赖、无真实 AI 成本，是默认值。
2. `ark` 使用火山方舟真实流式接口，必须存在 Ark 所需配置。
3. 未知 Provider 值必须明确失败，不允许静默 fallback。
4. 未设置 `AI_CHAT_PROVIDER` 时默认使用 `mock`。
5. Provider 选择只能发生在服务端。
6. 不允许前端通过普通业务请求任意指定 Provider。
7. 不允许把 Ark 配置放进 Nuxt public runtime config。
8. V2.6 不做产品 UI 中的 Provider 切换按钮。

Ark 服务端环境变量：

```env
ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=
ARK_TIMEOUT_MS=30000
```

启用 `ark` 时，`ARK_API_KEY`、`ARK_BASE_URL`、`ARK_MODEL` 必须存在。`ARK_TIMEOUT_MS` 必须是正整数。

Provider Adapter 调用链：

```text
POST /api/chat
-> ChatService
-> ProviderFactory
-> MockChatProvider / ArkChatProvider
-> 统一 Provider delta
-> 项目内部 SSE
-> 前端
```

Provider 负责：

* 构造厂商请求
* 解析厂商流
* 提取普通文本 delta
* 将厂商错误转成统一 Provider 错误
* 跳过空 delta
* 处理上游 timeout

Provider 不负责：

* 创建数据库 Message
* 更新 Message 状态
* 输出项目内部 SSE
* 管理前端 typewriter
* 渲染 Markdown
* 直接修改 conversation store

ChatService 负责：

* 前置校验
* active streaming guard
* 创建 user message
* 创建 assistant message
* 构造 conversation history
* 消费统一 Provider stream
* 累积 fullContent
* 输出内部 `text_delta`
* done / failed 落库
* 输出内部 `message_done` / `message_failed`

无论 Provider 是 `mock` 还是 `ark`，前端内部 SSE 契约保持不变。不得把 Ark 原始 SSE 透传给前端，不得让前端解析 Ark chunk，不得为 Ark 增加前端专用分支。

## 后端可读日志规范

后端 service 层应在关键状态节点输出可读日志，帮助开发者理解业务链路。

规则：

1. 日志应集中在 service / stream / harness 辅助工具中，不要散落在每个 repository 或每个组件里。
2. Route handler 保持薄层，除非处理框架级异常，否则不承担主要日志逻辑。
3. 后端日志重点记录：
   * request start
   * conversationId / messageId / streamId
   * active streaming guard 结果
   * user message / assistant message 创建结果
   * seq 分配结果
   * SSE event 类型摘要
   * done / failed 状态落库结果
4. 不要打印完整 prompt、完整 assistant content、用户隐私内容或大段 delta。
5. 对 `text_delta` 只记录：
   * delta index
   * delta length
   * fullContent length
   不记录完整 delta 文本。
6. 日志必须可关闭或可降噪。
7. 建议通过环境变量控制：
   * `AI_CHAT_LOG_LEVEL=debug|info|warn|error|silent`
   * `AI_CHAT_HARNESS_VERBOSE=true|false`
8. 开发环境可以输出 info/debug；测试和生产默认不应输出大量 debug。
9. 不要为了日志污染业务逻辑。日志辅助函数应保持轻量、无副作用。
10. 失败日志要包含足够定位信息，但不要泄露敏感内容。
11. 应用或聊天请求启动时，应安全输出当前 Provider，例如：
    ```text
    [chat] provider selected provider=mock
    [chat] provider selected provider=ark
    ```
    只输出规范 Provider 名称。
12. 禁止输出 API Key、Authorization header、完整 Base URL 查询参数、完整 prompt、完整回答或数据库连接串。

## 错误返回规范

接口错误返回保持统一：

```ts
type ApiErrorResponse = {
  message: string
  code?: string
  details?: unknown
}
```

不要把 stack trace、API Key、数据库连接信息等敏感信息返回给前端。

## 后端测试边界

后端验证策略以 `docs/rules/verification.md` 为准。

Nuxt server route 不要求逐个编写孤立单测。接口行为、数据库状态和跨层流程优先通过 `tests/harness/scenarios/` 中的真实 API + `TEST_DATABASE_URL` 集成验证覆盖。

单元测试只覆盖低成本、高价值的纯逻辑，例如：

* 分页参数处理
* DTO 转换
* SSE frame 构造 / parser
* chat state guard
* abort / retry 状态判断
* active streaming 判断
* ToolCall 参数校验
* error response 标准化

不要为了覆盖率 mock Prisma 写大量脆弱测试。涉及数据库真实状态的验证放到 Harness，不放到 unit test。
