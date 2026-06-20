# docs/architecture/tool-call-contract.md

# AIChatAssistant ToolCall 契约

## 1. 文档目的

本文档定义 V5 ToolCall 主链路的唯一核心契约，包括：

- ToolCall 生命周期
- SSE 事件顺序
- Tool Registry / Router / Executor 职责边界
- 本地工具输入输出契约
- Retry / Abort 与 ToolCall 的关系

如果本文档与其他 ToolCall 相关文档冲突，优先级建议为：

```text
docs/api-contract.md
> docs/architecture/tool-call-contract.md
> docs/architecture/streaming-protocol.md
> docs/rules/chat-flow.md
> docs/rules/backend.md
> docs/ui/interaction-rules.md
> docs/architecture/chat-flow-diagrams.md
```

说明：

- API 字段与 SSE payload 结构以 `docs/api-contract.md` 为准。
- 本文档负责定义 ToolCall 生命周期、职责边界和 V5 工具契约。
- 其他文档只保留摘要和引用，不重复维护完整 ToolCall 状态机。

---

## 2. V5 范围

V5 只实现两个本地工具：

```text
calculator
currentTime
```

V5 不实现：

```text
mockWeather
Ark 原生 Function Calling
MCP
远程工具
```

V5 目标是跑通完整 ToolCall 基础链路：

```text
用户消息
-> Mock Tool Router 规划工具调用
-> 创建 ToolCall(pending)
-> 执行器接管并更新为 running
-> 工具执行
-> 更新为 success / failed
-> assistant 输出本地格式化结果
-> assistant done
-> 页面刷新后 ToolCallCard 可恢复
```

---

## 3. ToolCall 状态机

V5 的 ToolCall 必须真实经过：

```text
pending
-> running
-> success | failed
```

语义：

- `pending`：ToolCall 已规划并持久化，但执行器尚未正式接管。
- `running`：执行器已经接管，正在校验参数或执行工具。
- `success`：工具执行成功，持久化 `result` 和 `finishedAt`。
- `failed`：参数校验或工具执行失败，持久化安全 `errorMessage` 和 `finishedAt`。

允许转换：

```text
pending -> running
running -> success
running -> failed
```

禁止：

```text
pending -> success
pending -> failed
success -> running / failed
failed -> running / success
```

V5 不实现：

```text
pending / running -> aborted
```

---

## 4. 数据库写入语义

实现阶段应具备等价能力：

```text
createPendingToolCall
markRunningIfPending
markSuccessIfRunning
markFailedIfRunning
```

要求：

1. ToolCall 创建时必须是 `pending`。
2. 执行器接管前更新为 `running`。
3. 只有 `running` 可以进入 `success` / `failed`。
4. 终态不能互相覆盖。
5. ToolCall 必须关联 assistant message。
6. ToolCall 不创建独立 Conversation seq。
7. 一条 assistant message 可以关联多个 ToolCall，但 V5 每轮最多一个。
8. 页面刷新后从 `MessageDTO.toolCalls` 恢复。

---

## 5. SSE 事件顺序

### 5.1 普通 ToolCall 成功

```text
message_created
-> tool_call_created(pending)
-> tool_call_updated(running)
-> tool_call_updated(success)
-> text_delta*
-> message_done
```

### 5.2 普通 ToolCall 失败

```text
message_created
-> tool_call_created(pending)
-> tool_call_updated(running)
-> tool_call_updated(failed)
-> text_delta*
-> message_done
```

### 5.3 Retry 命中工具

```text
retry_created
-> tool_call_created(pending)
-> tool_call_updated(running)
-> tool_call_updated(success | failed)
-> text_delta*
-> message_done
```

### 5.4 非工具普通消息

```text
message_created
-> text_delta*
-> message_done | message_failed
```

### 5.5 `tool_call_created`

```text
event: tool_call_created
data: {
  type: "tool_call_created",
  streamId: string,
  conversationId: string,
  assistantMessageId: string,
  toolCall: ToolCallDTO
}
```

此时必须满足：

```text
toolCall.status = pending
```

并且：

```text
assistantMessageId === toolCall.messageId
```

### 5.6 `tool_call_updated`

```text
event: tool_call_updated
data: {
  type: "tool_call_updated",
  streamId: string,
  conversationId: string,
  assistantMessageId: string,
  toolCall: ToolCallDTO
}
```

同一次 ToolCall 应依次出现：

```text
running
success | failed
```

要求：

1. `event === data.type`
2. ToolCall id 全程一致
3. `tool_call_created` 只出现一次
4. running update 只出现一次
5. terminal update 只出现一次
6. 不通过新增多个 ToolCall 模拟状态变化
7. `assistantMessageId` 是事件语义字段，用于前端快速定位所属 assistant message；它不改变 Prisma 外键字段名 `messageId`

---

## 6. Calculator 契约

工具名：

```text
calculator
```

输入：

```ts
type CalculatorArguments = {
  expression: string
}
```

输出：

```ts
type CalculatorResult = {
  expression: string
  normalizedExpression: string
  value: number
}
```

### 6.1 支持范围

Calculator 支持受限数学表达式：

- 整数
- 小数
- `+`
- `-`
- `*`
- `/`
- `^`
- 小括号
- 一元正号
- 一元负号
- 标准运算符优先级
- 多层括号嵌套

支持标准化：

```text
× -> *
÷ -> /
（ -> (
） -> )
```

允许兼容全角空格和普通空白字符。

### 6.2 运算优先级

优先级明确为：

```text
括号
-> 指数
-> 一元正负号
-> 乘除
-> 加减
```

指数采用右结合：

```text
2 ^ 3 ^ 2 = 2 ^ (3 ^ 2)
```

负号与指数的规则：

```text
-2 ^ 2 = -(2 ^ 2) = -4
(-2) ^ 2 = 4
2 ^ -2 = 0.25
```

实现阶段的 parser 必须同时支持：

```text
-2 ^ 2 = -4
2 ^ -2 = 0.25
```

### 6.3 安全要求

严禁：

```text
eval
Function
动态执行 JavaScript
```

推荐实现受限 tokenizer + parser，例如递归下降解析器。

### 6.4 限制

建议实现上限：

```text
最大表达式长度：200
最大 token 数：100
最大括号深度：20
最大指数绝对值：1000
```

结果必须满足：

```text
Number.isFinite(value) === true
```

以下情况应失败：

- 除数为 0
- 非法字符
- 缺少操作数
- 括号不匹配
- 连续非法运算符
- 空表达式
- 超过长度 / token / 深度限制
- 指数超限
- 结果为 `NaN` / `Infinity`
- 不完整表达式

失败示例：

```text
10 / (5 - 5)
```

该例用于证明失败来自真实表达式计算，而不是只对 `right === 0` 做特判。

### 6.5 V5 不支持

- 变量
- 赋值
- 方程求解
- 矩阵
- 单位换算
- 百分比金融语义
- 三角函数
- 对数
- 自定义函数
- 阶乘
- 隐式乘法，例如 `2(3+4)`
- 科学计算器完整语法

---

## 7. Calculator Router 规则

Mock Tool Router 只负责：

```text
选择 calculator
提取 expression 字符串
```

例如：

```json
{
  "toolName": "calculator",
  "arguments": {
    "expression": "(599 * 3 + 12.5) / 2"
  }
}
```

Router 不负责：

- tokenize
- 计算
- 运算符优先级
- 括号检查
- 安全校验

Router 只识别明确计算意图，例如：

```text
计算 ...
算一下 ...
calculate ...
```

可以识别表达式主体明显的输入，但不实现完整自然语言数学理解。

---

## 8. CurrentTime 契约

工具名：

```text
currentTime
```

输入：

```ts
type CurrentTimeArguments = {
  timeZone?: string
}
```

默认：

```text
UTC
```

输出：

```ts
type CurrentTimeResult = {
  iso: string
  timeZone: string
  formatted: string
}
```

规则：

1. 使用服务端当前时间。
2. `iso` 为 ISO 8601。
3. `timeZone` 为最终使用的 IANA 时区。
4. `formatted` 使用 `Intl.DateTimeFormat`。
5. 非法时区导致 ToolCall `failed`。
6. 不根据 IP、浏览器位置或用户画像自动推断时区。
7. V5 Mock Router 默认传空参数，返回 UTC。

触发词限定为明确关键词：

```text
当前时间
现在几点
current time
```

---

## 9. Tool Registry / Router / Executor 职责边界

### 9.1 Tool Registry

最小静态 Tool Registry 概念接口：

```ts
type ToolDefinition<TArguments, TResult> = {
  name: string
  description: string
  source: 'local'
  validateArguments: (input: unknown) => TArguments
  execute: (arguments: TArguments) => Promise<TResult>
}
```

Registry 至少支持：

```text
get
execute
```

### 9.2 Router

Mock Tool Router 只负责：

- 判断本轮是否命中工具
- 选择工具名
- 提取原始 arguments

Router 不负责：

- ToolCall 状态流转
- 参数校验
- 实际工具执行
- 写数据库
- 推送 ToolCall SSE

### 9.3 Executor

Tool Executor 负责：

```text
创建 pending
-> 推送 tool_call_created
-> pending -> running
-> 推送 tool_call_updated(running)
-> 参数校验与 execute
-> running -> success / failed
-> 推送 terminal tool_call_updated
```

不做：

- 动态插件加载
- 自动扫描目录
- MCP
- 远程工具
- 权限系统
- 用户自定义工具
- 依赖注入框架

---

## 10. Assistant 最终回答

V5 不把工具结果重新发送给模型。

使用本地 formatter 生成 assistant 文本。

Calculator success 示例：

```text
计算结果是 904.75。
```

Calculator failed 示例：

```text
计算失败：除数不能为 0。
```

CurrentTime success 示例：

```text
当前 UTC 时间是 2026-06-20T12:34:56.000Z。
```

关键规则：

```text
ToolCall failed
-> assistant 输出安全失败说明
-> assistant status = done
```

因此工具失败不等于 assistant 失败，也不进入 V4 的 assistant failed / retry 主链路。

---

## 11. Retry 与 Abort

### 11.1 Retry

Retry 重新针对原 parent user 做 Tool Router 规划。

命中工具时：

```text
retry_created
-> 创建新 ToolCall(pending)
-> running
-> success / failed
-> assistant done
```

要求：

1. 原 assistant 保留。
2. 原 ToolCall 保留。
3. 新 assistant 创建新的 ToolCall。
4. 不复用原 ToolCall id。
5. 不更新原 ToolCall。
6. 不创建新 user message。

### 11.2 Abort

V5 本地工具执行很快，不实现单独取消工具。

如果工具已经完成，而 assistant 文本还在 streaming，此时用户 Stop：

1. assistant 变为 `aborted`
2. ToolCall 保持 `success` / `failed`
3. 不把 ToolCall 改为 `aborted`

V5 不实现：

- ToolCall `aborted`
- pending / running 工具取消
- tool execution `AbortSignal`
- 工具超时
- 单独 retry ToolCall

---

## 12. ToolCallCard 恢复要求

ToolCallCard 支持四种状态：

### Pending

```text
计算器
等待执行……
```

### Running

```text
计算器
正在计算……
```

### Success

Calculator 示例：

```text
计算器
表达式：(599 × 3 + 12.5) ÷ 2
结果：904.75
```

CurrentTime 示例：

```text
当前时间
时区：UTC
时间：...
```

### Failed

```text
计算器
执行失败：除数不能为 0
```

要求：

1. 按 `toolCall.id` 更新同一张 Card。
2. pending / running update 不追加重复 Card。
3. 页面刷新后恢复最终状态。
4. 默认不展示完整 JSON。
5. pending 很短时不要求肉眼稳定观察到，但状态和 SSE 必须真实存在。
6. 不提供 ToolCall 单独停止、确认或 retry 按钮。
