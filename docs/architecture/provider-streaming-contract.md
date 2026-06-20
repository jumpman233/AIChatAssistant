# Provider Streaming Contract

本文定义所有流式 `ChatModelProvider` 接入项目时必须遵守的通用取消、超时和清理规则。Provider 厂商协议本身仍由各 Provider 自己实现。

## 适用边界

本契约只覆盖：

- 外部 `AbortSignal` 桥接
- 流式 idle timeout
- 网络活动续期
- 第一个 abort 原因获胜
- timer / listener / reader 等资源清理

Provider 仍然负责：

- URL、请求 body、鉴权 header
- HTTP 状态和厂商错误体处理
- SSE / NDJSON / WebSocket 等上游协议解析
- delta、finish reason、usage 等字段提取
- 厂商错误到统一 Provider 错误的转换

不要为了复用本契约创建通用 Provider 基类或万能 SSE Provider。

## 生命周期

标准流式生命周期：

```text
创建 StreamAbortCoordinator
-> 发起 Provider 请求，并传入 coordinator.signal
-> 收到 HTTP response 后 markActivity
-> 每个非空网络 chunk 到达后 markActivity
-> 正常完成 / 用户取消 / idle timeout / failure
-> cleanup
```

`cleanup` 必须在正常完成后尽快执行，并在 `finally` 中兜底执行。

## 取消来源

当前支持两个明确来源：

```text
user
timeout
```

规则：

- 用户主动 stop 触发外部 `AbortSignal`，Provider 应分类为 `aborted`。
- idle timeout 触发内部取消，Provider 应分类为 `timeout`。
- 第一个来源获胜，后续用户取消或 timeout 不得覆盖已有来源。
- 如果出现没有明确来源的 `AbortError`，不得直接当成用户主动停止，应按 Provider 自己的安全错误分类处理。

## Timeout 语义

项目默认使用 idle timeout，不使用绝对总时长 timeout。

idle timeout 表示：

```text
建连和流式读取期间，连续没有收到任何上游网络数据的最长时间。
```

它不表示：

```text
整个生成过程允许的最大总时长。
```

例如 `ARK_TIMEOUT_MS=30000` 时，只要 Ark 每隔数秒持续返回非空网络 chunk，生成总时长超过 30 秒也应继续正常运行。

## 网络活动定义

非空网络 chunk 即 activity，不要求必须产生 `text_delta`。

以下都应续期 idle timer：

- SSE comment
- role delta
- finish reason
- usage
- 合法但不产生文本的 frame
- 其他非空网络 chunk

不要只在解析到普通文本 delta 后才续期。

## 错误分类

建议映射：

```text
用户取消 -> aborted
Provider idle timeout -> timeout
普通网络错误 -> network_error 或更具体 Provider failure
```

ChatService 对 `aborted` 的处理应继续遵守 V4 状态机：不写 `failed`，不发送 `message_failed`，数据库 `aborted` 终态由 abort API 决定。

## 资源清理

Provider 必须清理：

- idle timer
- 外部 `AbortSignal` listener
- reader 或厂商 SDK stream
- 其他临时流式资源

`cleanup` 必须可重复调用。`cleanup` 后 `markActivity` 不得重新创建 timer。

## Provider 接入清单

新增或修改流式 Provider 时至少检查：

- 是否使用 `StreamAbortCoordinator`
- 是否将 `coordinator.signal` 传给真实网络请求
- 是否在收到 response 后调用 `markActivity`
- 是否在每个非空网络 chunk 后调用 `markActivity`
- 是否区分 user abort 与 timeout
- 是否保证第一个 abort 原因获胜
- 是否在正常完成和 `finally` 中 cleanup
- 是否避免记录 prompt、完整 delta、完整回答、密钥、Authorization 和完整原始响应
