# docs/architecture/chat-flow-diagrams.md

# AIChatAssistant 聊天流程图与时序图

## 1. 文档目的

本文档用 Mermaid 图说明 `AIChatAssistant` 第一阶段聊天主链路的整体流程。

本文档用于辅助理解：

- 用户发送消息
- 后端创建 user / assistant message
- SSE 流式返回
- 前端解析 SSE event
- 停止生成
- 失败重试
- ToolCall
- 多会话同时 streaming
- 多页面 / 多 Tab 行为边界
- 历史消息加载与滚动交互
- Harness 如何复用同一套验证场景

本文档只用于辅助理解流程，不作为字段和接口的最高优先级定义。

如果本文档与其他文档冲突，优先级如下：

```text
1. docs/api-contract.md
2. docs/architecture/streaming-protocol.md
3. docs/rules/chat-flow.md
4. docs/architecture/chat-flow-diagrams.md
```

---

## 2. 图示分层原则

主时序图只使用以下参与方：

```text
用户
前端
后端
数据库
```

原因：

- 主流程更清楚。
- Codex 更容易理解边界。
- 避免在主图里混入过多实现细节。

内部实现职责，例如：

- `useChatStream`
- `conversationStore`
- `chatRuntimeStore`
- `chatService`
- `repository`
- `ToolRegistry`

不放进主时序图，而是在“Store 分工图”和“实现提醒”中说明。

---

## 3. 聊天主流程图

```mermaid
flowchart TD
  A["用户进入聊天页"] --> B{"是否已有 activeConversationId？"}

  B -- "没有" --> C["POST /api/conversations 创建 Conversation"]
  B -- "有" --> D["GET /api/conversations/:id 获取 Conversation 详情"]

  C --> E["GET /api/conversations/:id/messages?limit=50"]
  D --> E

  E --> F["前端渲染最近 50 条消息"]
  F --> F1["首次加载完成后默认滚动到底部"]

  F1 --> G["用户输入消息并点击发送"]
  G --> H{"当前 Conversation 是否正在 streaming？"}

  H -- "是" --> H1["前端禁止发送 / 提示当前会话正在生成中"]
  H -- "否" --> I["前端调用 POST /api/chat"]

  I --> J["后端校验 request body / conversation / profile / content"]
  J --> K{"同一 Conversation 是否已有 active assistant message？"}

  K -- "有" --> K1["返回 409 JSON error: CONVERSATION_STREAMING"]
  K1 --> K2["前端清理目标 Conversation runtime 并展示提示"]

  K -- "没有" --> L["生成 streamId"]
  L --> M["事务创建 user message: done"]
  M --> N["事务创建 assistant message: streaming"]
  N --> O["返回 SSE: message_created"]

  O --> P["前端插入 user message 和 assistant message"]
  P --> Q["后端开始 mock/model stream"]

  Q --> R{"是否触发 ToolCall？"}

  R -- "否" --> S["返回 SSE: text_delta"]
  R -- "是" --> R1["创建 ToolCall: running"]
  R1 --> R2["返回 SSE: tool_call_created"]
  R2 --> R3["执行工具"]
  R3 --> R4{"工具是否成功？"}
  R4 -- "成功" --> R5["更新 ToolCall: success"]
  R4 -- "失败" --> R6["更新 ToolCall: failed"]
  R5 --> R7["返回 SSE: tool_call_updated"]
  R6 --> R7
  R7 --> S

  S --> T["前端按 conversationId + messageId 追加 delta"]
  T --> U{"生成是否结束？"}

  U -- "正常完成" --> V["后端保存 assistant fullContent, status = done"]
  V --> W["返回 SSE: message_done"]
  W --> X["前端用最终 MessageDTO 覆盖本地消息，清理 runtime"]

  U -- "生成失败" --> Y["后端保存 partialContent, status = failed"]
  Y --> Z["返回 SSE: message_failed"]
  Z --> ZA["前端展示 failed + retry，清理 runtime"]

  U -- "用户停止" --> AB["前端 AbortController.abort()"]
  AB --> AC["POST /api/messages/:id/abort 携带 partial content"]
  AC --> AD["后端状态保护：pending/streaming -> aborted"]
  AD --> AE["前端用返回 MessageDTO 覆盖本地消息，展示 aborted + retry"]
```

---

## 4. 发送消息主时序图

```mermaid
sequenceDiagram
  autonumber

  actor User as 用户
  participant FE as 前端
  participant BE as 后端
  participant DB as 数据库

  User->>FE: 输入消息并点击发送
  FE->>FE: 检查当前 Conversation 是否 isStreaming

  alt 前端已知正在 streaming
    FE-->>User: 禁止发送 / 提示正在生成中
  else 前端允许发送
    FE->>FE: 创建 AbortController，设置 runtime isStreaming = true
    FE->>BE: POST /api/chat

    BE->>BE: 校验 request body / profile / content
    BE->>DB: 查询 Conversation
    DB-->>BE: Conversation
    BE->>DB: 检查 active assistant message

    alt 同会话已有 active streaming
      DB-->>BE: 存在 active assistant message
      BE-->>FE: 409 JSON error: CONVERSATION_STREAMING
      FE->>FE: 清理 runtime
      FE-->>User: 展示正在生成中
    else 可以生成
      BE->>BE: 生成 streamId
      BE->>DB: 事务创建 user message + assistant message
      DB-->>BE: userMessage + assistantMessage

      BE-->>FE: SSE message_created
      FE-->>User: 展示 user message + assistant 占位

      loop 流式生成
        BE-->>FE: SSE text_delta
        FE-->>User: 追加展示 assistant 内容
      end

      alt 正常完成
        BE->>DB: 更新 assistant message status = done, content = fullContent
        DB-->>BE: final MessageDTO
        BE-->>FE: SSE message_done
        FE->>FE: 用 final MessageDTO 覆盖本地消息，清理 runtime
        FE-->>User: 展示完成状态
      else 生成失败
        BE->>DB: 更新 assistant message status = failed, content = partialContent
        DB-->>BE: failed MessageDTO
        BE-->>FE: SSE message_failed
        FE->>FE: 用 failed MessageDTO 覆盖本地消息，清理 runtime
        FE-->>User: 展示错误和重试入口
      end
    end
  end
```

---

## 5. SSE 事件处理时序图

```mermaid
sequenceDiagram
  autonumber

  participant BE as 后端
  participant FE as 前端

  BE-->>FE: SSE frame: id + event + data + 空行
  FE->>FE: 按空行切分 SSE frame
  FE->>FE: 解析 id / event / data
  FE->>FE: JSON.parse(data)
  FE->>FE: 校验 event === data.type

  alt message_created
    FE->>FE: 插入 userMessage 和 assistantMessage
    FE->>FE: 记录 streamId / streamingMessageId
  else text_delta
    FE->>FE: 按 conversationId + messageId 追加 delta
  else tool_call_created / tool_call_updated
    FE->>FE: 更新对应 message 的 ToolCall
  else message_done
    FE->>FE: 用后端最终 message 覆盖本地 message
    FE->>FE: 清理目标 Conversation runtime
  else message_failed
    FE->>FE: 用 failed message 覆盖本地 message
    FE->>FE: 保存错误并清理 runtime
  end
```

---

## 6. 停止生成时序图

```mermaid
sequenceDiagram
  autonumber

  actor User as 用户
  participant FE as 前端
  participant BE as 后端
  participant DB as 数据库

  User->>FE: 点击停止
  FE->>FE: 找到当前 Conversation 的 abortController 和 streamingMessageId
  FE->>FE: 读取当前 assistant partial content
  FE->>FE: AbortController.abort()
  Note over FE: 本地 SSE 读取中断，但后端状态未必已更新

  FE->>BE: POST /api/messages/:id/abort，携带 partial content
  BE->>DB: 查询 message

  alt message 是 assistant 且 status = pending / streaming
    BE->>DB: 更新 status = aborted, content = partialContent
    DB-->>BE: MessageDTO(status = aborted)
    BE-->>FE: MessageDTO(status = aborted)
    FE->>FE: 覆盖本地 message，清理 runtime
    FE-->>User: 展示已停止 + 重试入口
  else message 已 done
    Note over BE: done 优先，不能被迟到的 abort 覆盖
    DB-->>BE: MessageDTO(status = done)
    BE-->>FE: MessageDTO(status = done)
    FE->>FE: 覆盖本地 message，清理 runtime
    FE-->>User: 保持完成状态
  else message 已 failed / aborted
    DB-->>BE: 当前 MessageDTO 或错误
    BE-->>FE: 当前状态或错误
    FE->>FE: 清理 runtime
  end
```

---

## 7. 重试时序图

```mermaid
sequenceDiagram
  autonumber

  actor User as 用户
  participant FE as 前端
  participant BE as 后端
  participant DB as 数据库

  User->>FE: 点击 failed / aborted 消息的重试
  FE->>BE: POST /api/messages/:id/retry

  BE->>DB: 查询旧 assistant message
  DB-->>BE: old assistant message

  alt old message 不是 failed / aborted
    BE-->>FE: JSON error: MESSAGE_NOT_RETRYABLE
    FE-->>User: 展示错误
  else old message 可重试
    BE->>DB: 检查当前 Conversation active assistant message

    alt 当前 Conversation 已有 active streaming
      BE-->>FE: 409 JSON error: CONVERSATION_STREAMING
      FE-->>User: 提示当前会话正在生成中
    else 无 active streaming
      BE->>DB: 查找 parent user message
      BE->>BE: 生成 new streamId
      BE->>DB: 创建新的 assistant message, status = streaming
      DB-->>BE: userMessage + newAssistantMessage

      BE-->>FE: SSE message_created
      FE-->>User: 展示新的 assistant message 占位，旧 failed/aborted 消息保留

      loop 流式生成
        BE-->>FE: SSE text_delta
        FE-->>User: 追加展示新 assistant 内容
      end

      alt retry 正常完成
        BE->>DB: 更新新 assistant status = done
        DB-->>BE: final MessageDTO
        BE-->>FE: SSE message_done
        FE-->>User: 展示新 assistant 完成状态
      else retry 失败
        BE->>DB: 更新新 assistant status = failed
        DB-->>BE: failed MessageDTO
        BE-->>FE: SSE message_failed
        FE-->>User: 展示新 failed message + retry
      end
    end
  end
```

---

## 8. ToolCall 时序图

```mermaid
sequenceDiagram
  autonumber

  participant BE as 后端
  participant DB as 数据库
  participant FE as 前端

  BE->>DB: 创建 ToolCall(status = pending)
  BE->>DB: 更新 ToolCall(status = running, startedAt)
  DB-->>BE: ToolCallDTO running

  BE-->>FE: SSE tool_call_created
  FE->>FE: 在对应 assistant message 上展示 ToolCallCard running

  BE->>BE: 执行本地工具

  alt 工具执行成功
    BE->>DB: 更新 ToolCall(status = success, result, finishedAt)
    DB-->>BE: ToolCallDTO success
    BE-->>FE: SSE tool_call_updated
    FE->>FE: 更新 ToolCallCard success
  else 工具执行失败
    BE->>DB: 更新 ToolCall(status = failed, errorMessage, finishedAt)
    DB-->>BE: ToolCallDTO failed
    BE-->>FE: SSE tool_call_updated
    FE->>FE: 更新 ToolCallCard failed
  end

  alt 工具失败但 assistant 可继续解释
    BE-->>FE: SSE text_delta
    BE-->>FE: SSE message_done
  else 工具失败导致生成无法继续
    BE->>DB: 更新 assistant message status = failed
    BE-->>FE: SSE message_failed
  end
```

---

## 9. 历史消息加载时序图

```mermaid
sequenceDiagram
  autonumber

  actor User as 用户
  participant FE as 前端
  participant BE as 后端
  participant DB as 数据库

  User->>FE: 进入 Conversation
  FE->>BE: GET /api/conversations/:id/messages?limit=50
  BE->>DB: 查询最近 50 条消息
  DB-->>BE: messages
  BE-->>FE: items + pageInfo
  FE-->>User: 渲染消息列表
  FE->>FE: 首次加载完成后默认滚动到底部

  alt hasMoreBefore = true
    FE-->>User: 在消息列表顶部展示“加载更早消息”按钮
  end

  User->>FE: 滑到顶部并点击“加载更早消息”
  FE->>FE: 记录当前 scrollHeight 和 scrollTop
  FE->>BE: GET /api/conversations/:id/messages?limit=50&beforeSeq=<minSeq>
  BE->>DB: 查询 seq < minSeq 的最近 50 条消息
  DB-->>BE: older messages
  BE-->>FE: older items + pageInfo
  FE->>FE: 将 older messages 插入消息列表头部
  FE->>FE: 恢复滚动位置，避免跳到底部
  FE-->>User: 用户继续停留在原阅读位置
```

---

## 10. 历史消息加载交互规则

### 10.1 首次进入 Conversation

前端调用：

```text
GET /api/conversations/:id/messages?limit=50
```

后端返回：

- 最近 50 条消息
- 按 `seq ASC` 输出
- `pageInfo.hasMoreBefore`
- `pageInfo.hasMoreAfter`

前端行为：

1. 渲染消息列表。
2. 默认滚动到底部。
3. 如果 `items.length < 50` 或 `hasMoreBefore = false`，不展示“加载更早消息”按钮。
4. 如果 `hasMoreBefore = true`，在消息列表顶部展示“加载更早消息”按钮。

---

### 10.2 加载更早消息

第一阶段不做自动触底加载，采用显式按钮。

触发条件：

```text
用户滑到消息列表顶部
```

前端行为：

1. 顶部展示“加载更早消息”按钮。
2. 用户点击按钮。
3. 取当前消息列表最小 `seq` 作为 `beforeSeq`。
4. 调用：

```text
GET /api/conversations/:id/messages?limit=50&beforeSeq=<minSeq>
```

5. 将返回的 older messages 插入列表头部。
6. 保持当前阅读位置，不要跳到底部。
7. 如果 `hasMoreBefore = false`，隐藏“加载更早消息”按钮。

---

### 10.3 streaming 时自动滚动

streaming 过程中：

- 如果用户接近底部，则 `text_delta` 到来时自动滚动到底部。
- 如果用户已经向上查看历史，不强制滚动到底部。
- 第一阶段可以先不做复杂“新消息提示按钮”，但不要在用户阅读历史时强制拉到底部。

---

## 11. 多会话并发规则图

```mermaid
flowchart LR
  A["Conversation A"] --> A1{"A 是否已有 active assistant？"}
  B["Conversation B"] --> B1{"B 是否已有 active assistant？"}

  A1 -- "没有" --> A2["允许 A 开始 streaming"]
  A1 -- "有" --> A3["拒绝 A 新请求: 409 CONVERSATION_STREAMING"]

  B1 -- "没有" --> B2["允许 B 开始 streaming"]
  B1 -- "有" --> B3["拒绝 B 新请求: 409 CONVERSATION_STREAMING"]

  A2 -. "不影响" .-> B2
  B2 -. "不影响" .-> A2

  A3 -. "只影响 A" .-> B2
  B3 -. "只影响 B" .-> A2
```

---

## 12. 多页面 / 多 Tab 行为图

```mermaid
flowchart TD
  A["页面 A 打开 Conversation X"] --> B["页面 A 调用 POST /api/chat"]
  B --> C["页面 A 实时接收 SSE delta"]
  C --> D["页面 A 本地展示 streaming 内容"]

  E["页面 B 打开同一个 Conversation X"] --> F["页面 B 调用 GET /api/conversations/:id"]
  F --> G{"Conversation X 是否 isStreaming？"}

  G -- "是" --> H["页面 B 显示正在生成中"]
  H --> I["页面 B 禁止继续发送同会话消息"]
  H --> J["页面 B 调用 GET /api/conversations/:id/messages"]
  J --> K["页面 B 只能看到数据库已落库消息"]
  K --> L["页面 B 不实时显示页面 A 的 delta"]

  C --> M{"页面 A stream 是否完成？"}
  M -- "完成" --> N["后端保存 final assistant message"]
  N --> O["页面 B 手动刷新或重新拉取 messages"]
  O --> P["页面 B 获得最终 assistant message"]
```

---

## 13. 前端 Store 分工图

```mermaid
flowchart TD
  A["ChatPage"] --> B["useConversation"]
  A --> C["useChatStream"]
  A --> D["useProfiles"]

  B --> E["conversationStore"]
  C --> E
  C --> F["chatRuntimeStore"]
  D --> G["profileStore"]

  E --> E1["conversations"]
  E --> E2["activeConversationId"]
  E --> E3["messagesByConversationId"]
  E --> E4["appendMessage / replaceMessage / appendMessageDelta"]

  F --> F1["conversationStates"]
  F --> F2["streamId"]
  F --> F3["isStreaming"]
  F --> F4["streamingMessageId"]
  F --> F5["AbortController"]
  F --> F6["runtime error"]

  G --> G1["profiles"]
  G --> G2["currentProfileId"]
```

---

## 14. Harness 验证复用图

```mermaid
flowchart TD
  A["pnpm verify:mvp"] --> B["reset test db"]
  B --> C["seed test data"]
  C --> D["conversation.scenario.ts"]
  D --> E["single-stream.scenario.ts"]
  E --> F["multi-stream.scenario.ts"]
  F --> G["abort-retry.scenario.ts"]
  G --> H["tool-call.scenario.ts"]
  H --> I["Playwright UI states"]
  I --> J["Markdown / CodeBlock E2E"]
  J --> K["输出验证报告"]

  E --> S["readSseStream parser"]
  F --> S
  G --> S
  H --> S

  S --> S1["解析 id"]
  S --> S2["解析 event"]
  S --> S3["解析 data JSON"]
  S --> S4["校验 event === data.type"]
  S --> S5["收集 ChatStreamEvent"]
```

---

## 15. 实现提醒

Codex 实现聊天相关任务时，应先阅读：

```text
docs/api-contract.md
docs/architecture/streaming-protocol.md
docs/rules/chat-flow.md
docs/architecture/chat-flow-diagrams.md
```

实现时以文字契约为准，图只用于理解。

关键边界：

- `POST /api/chat` 和 `POST /api/messages/:id/retry` 返回标准 SSE。
- SSE event 使用 `id + event + data + 空行`。
- `GET /api/conversations/:id/messages` 默认 `limit = 50`。
- 首次加载历史消息后默认滚动到底部。
- 用户滑到顶部后，通过按钮加载更早 50 条。
- 加载更早消息后保持当前阅读位置，不要跳到底部。
- streaming 时，如果用户接近底部，则自动滚动到底部；如果用户正在查看历史，不要强制滚动。
- 不同 Conversation 可以同时 streaming。
- 同一 Conversation 不能同时存在多个 active assistant message。
- 发起生成的页面实时接 SSE delta。
- 其他页面只知道 conversation 正在 streaming，不实时同步 delta。
- 生成完成后，其他页面通过重新拉取 messages 获得最终内容。
- conversationStore 管稳定数据。
- chatRuntimeStore 管运行时 streaming 状态。
- Harness 必须复用真实 SSE parser。
