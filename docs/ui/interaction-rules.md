# docs/ui/interaction-rules.md

# AIChatAssistant UI 交互规则

## 1. 文档目的

本文档定义 `AIChatAssistant` 第一阶段的前端交互规则。

本文档关注：

- 用户在页面上如何操作
- 页面如何反馈状态
- 会话切换如何表现
- 历史消息如何加载
- streaming 时如何滚动
- 停止、失败、重试如何展示
- ToolCall 如何展示
- 多会话与多页面行为边界

本文档不负责定义 API 字段、数据库结构或 SSE 事件格式。

相关文档优先级建议：

```text
1. docs/api-contract.md
2. docs/architecture/streaming-protocol.md
3. docs/rules/chat-flow.md
4. docs/rules/frontend-vue.md
5. docs/ui/interaction-rules.md
6. docs/ui/ui-implements.md
7. docs/architecture/chat-flow-diagrams.md
```

说明：

- API 字段和协议以 `api-contract.md` 为准。
- SSE 读取和写入细节以 `streaming-protocol.md` 为准。
- 聊天状态机以 `chat-flow.md` 为准。
- Vue / Pinia / Nuxt UI 代码规范以 `frontend-vue.md` 为准。
- 本文档只描述 UI 层交互行为。

---

## 2. 总体交互原则

第一阶段 UI 交互优先级：

```text
1. 状态正确
2. 流程可预期
3. 操作入口清晰
4. 视觉还原
5. 动效和细节优化
```

不要为了视觉效果破坏以下规则：

- 同一 Conversation streaming 时不能再次发送。
- 不同 Conversation 可以同时 streaming。
- 停止生成只影响目标 assistant message。
- failed / aborted message 不能被重试覆盖。
- 前端收到 stream event 时必须按 `conversationId` 和 `messageId` 更新对应消息。
- 非发起生成页面不实时同步 delta，只能知道 conversation 正在 streaming。

---

## 3. 页面整体结构

第一阶段主页面结构：

```text
ChatPage
  ├─ ConversationSidebar
  ├─ ChatHeader
  ├─ MessageList
  └─ MessageInput
```

核心区域：

- 左侧：Conversation 列表
- 顶部：当前 Profile、mode、状态、页面级操作
- 中间：消息列表
- 底部：消息输入区

页面不做：

- 登录入口
- 用户头像系统
- 团队空间
- 支付入口
- 文件上传
- 知识库管理后台
- 复杂 Agent 流程页

---

## 4. Conversation 列表交互

### 4.1 初始化

页面加载时：

1. 调用 `GET /api/profiles`
2. 调用 `GET /api/conversations`
3. 如果存在会话：
   - 默认选中最近更新的 active Conversation
   - 加载该 Conversation 的最近 50 条 messages
4. 如果不存在会话：
   - 展示空会话状态
   - 可以等待用户点击“新建会话”
   - 也可以在用户首次发送消息前自动创建 Conversation

第一阶段推荐：

```text
用户点击“新建会话”后创建 Conversation。
```

---

### 4.2 新建会话

用户点击“新建会话”：

1. 前端调用 `POST /api/conversations`
2. 创建成功后插入左侧会话列表顶部
3. 设置为 activeConversationId
4. 清空当前 MessageList
5. 展示空会话状态

新建会话不自动发送消息。

---

### 4.3 切换会话

用户点击左侧某个 Conversation：

1. 设置 `activeConversationId`
2. 调用 `GET /api/conversations/:id`
3. 调用 `GET /api/conversations/:id/messages?limit=50`
4. 渲染最近 50 条消息
5. 首次加载完成后默认滚动到底部

规则：

- 切换 Conversation 不清空其他 Conversation 的 runtime state。
- 如果原 Conversation 正在 streaming，切走后它仍可继续接收自己的 SSE event。
- 如果新 Conversation 正在 streaming，输入区应进入“当前会话正在生成中”的状态。
- 前端不得把 A 会话的 stream event 写入 B 会话。

---

### 4.4 删除会话

用户点击删除会话：

1. 展示确认弹窗。
2. 用户确认后调用 `DELETE /api/conversations/:id`。
3. 删除是软删除。
4. 左侧列表移除该 Conversation。
5. 如果删除的是当前 active Conversation：
   - 自动切换到列表中下一个 active Conversation
   - 如果没有其他 Conversation，展示空会话状态

删除时不物理删除 messages。

---

### 4.5 会话列表 streaming 标识

`GET /api/conversations` 返回：

```ts
isStreaming: boolean
activeAssistantMessageId: string | null
```

左侧 ConversationItem 需要展示：

- 当前会话是否选中
- 是否正在 streaming
- 标题
- 更新时间
- 可选：最后一条消息摘要

如果非当前 Conversation 正在 streaming：

- 左侧展示生成中状态
- 不打断当前 Conversation 操作
- 不自动切换会话

---

## 5. 历史消息加载交互

### 5.1 首次进入 Conversation

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
2. 首次加载完成后默认滚动到底部。
3. 如果 `items.length < 50` 或 `hasMoreBefore = false`，不展示“加载更早消息”按钮。
4. 如果 `hasMoreBefore = true`，在消息列表顶部展示“加载更早消息”按钮。

说明：

- “最近 50 条”是后端查询语义。
- 前端收到后按 `seq ASC` 渲染，所以视觉上仍然从旧到新排列。
- 首次进入会话时，用户通常期望看到最新消息，因此默认滚动到底部。

---

### 5.2 加载更早消息

第一阶段采用显式按钮，不做自动触顶加载。

触发条件：

```text
用户滑到消息列表顶部
```

前端行为：

1. 顶部展示“加载更早消息”按钮。
2. 用户点击按钮。
3. 记录当前 scroll 容器状态：
   - `scrollHeight`
   - `scrollTop`
4. 取当前消息列表最小 `seq` 作为 `beforeSeq`。
5. 调用：

```text
GET /api/conversations/:id/messages?limit=50&beforeSeq=<minSeq>
```

6. 将返回的 older messages 插入消息列表头部。
7. DOM 更新后恢复滚动位置，避免页面跳到底部。
8. 如果 `pageInfo.hasMoreBefore = false`，隐藏“加载更早消息”按钮。

滚动位置恢复规则：

```text
newScrollTop = newScrollHeight - oldScrollHeight + oldScrollTop
```

说明：

- 加载更早消息后，用户应继续停留在原阅读位置。
- 不要因为插入旧消息导致用户视野突然跳动。
- 不要在加载更早消息后自动滚动到底部。

---

### 5.3 拉取新消息

当需要获取某个 seq 之后的新消息时，可以调用：

```text
GET /api/conversations/:id/messages?limit=50&afterSeq=<maxSeq>
```

典型场景：

- 非发起生成页面在生成完成后手动刷新消息
- 页面重新获得焦点后校准消息
- 后续轮询或轻量同步

第一阶段可以先不做自动轮询。

---

## 6. 消息列表滚动规则

### 6.1 首次加载

首次加载某个 Conversation 的最近消息后：

```text
默认滚动到底部
```

原因：

- 聊天产品默认展示最新上下文
- 最近 50 条消息里，用户一般需要看到最新 assistant 回复或输入区附近

---

### 6.2 streaming 自动滚动

streaming 中收到 `text_delta` 时：

如果用户接近底部：

```text
自动滚动到底部
```

如果用户已经向上查看历史：

```text
不要强制滚动到底部
```

第一阶段可以用简单阈值判断：

```ts
const threshold = 80
const isNearBottom =
  scrollHeight - scrollTop - clientHeight < threshold
```

规则：

- 用户接近底部时，delta 到来自动滚动到底部。
- 用户不接近底部时，delta 到来只更新消息，不改变滚动位置。
- 第一阶段可以暂不做“有新消息”悬浮按钮，但不要强制打断用户阅读历史。

---

### 6.3 加载更早消息

加载更早消息后：

```text
保持当前阅读位置
```

不要：

- 自动滚动到底部
- 自动滚动到顶部
- 因为插入旧消息导致用户视野跳动

---

### 6.4 切换会话

切换到另一个 Conversation 并加载最近 50 条消息后：

```text
默认滚动到底部
```

如果未来需要记忆每个 Conversation 的 scrollTop，可以后续扩展。第一阶段不做。

---

## 7. MessageInput 交互

### 7.1 默认状态

输入框默认可输入。

支持：

- 多行输入
- Enter 发送
- Shift + Enter 换行
- 发送按钮
- 空内容不能发送

第一阶段建议：

```text
trim 后为空时禁用发送按钮
```

---

### 7.2 发送中状态

当前 active Conversation 正在 streaming 时：

- 输入框可以禁用，或保持可输入但禁用发送按钮
- 发送按钮变为停止按钮，或旁边展示停止按钮
- 明确展示“正在生成中”状态
- 不允许同一 Conversation 再次发送

推荐第一阶段：

```text
当前 Conversation streaming 时：
- 输入框仍可输入草稿
- 发送按钮禁用
- 展示 Stop 按钮
```

这样用户可以提前写下一条，但不能发送，交互更自然。

---

### 7.3 停止按钮

当前 Conversation streaming 时展示停止按钮。

用户点击停止：

1. 前端调用当前 Conversation 的 `AbortController.abort()`
2. 读取当前 assistant partial content
3. 调用 `POST /api/messages/:id/abort`
4. 用后端返回的 MessageDTO 覆盖本地消息
5. MessageInput 恢复可发送状态

停止按钮只影响当前 active Conversation 的 `streamingMessageId`。

不要停止其他 Conversation 的 stream。

---

### 7.4 发送失败

如果 `POST /api/chat` 在 stream 开始前失败：

- 清理当前 Conversation runtime state
- 展示错误提示
- 不插入 user message 和 assistant message，除非后端已经返回 message_created
- 如果错误是 `CONVERSATION_STREAMING`，提示“当前会话正在生成中”

如果 stream 开始后失败：

- 由 `message_failed` SSE event 驱动 UI
- 展示 failed message
- 展示重试入口

---

## 8. Message 展示交互

### 8.1 User Message

User message：

- 靠右展示，或以明显用户样式展示
- status 通常为 `done`
- 不展示 retry
- 不展示 ToolCallCard

---

### 8.2 Assistant Message: streaming

Assistant message 处于 `streaming` 时：

- 展示已生成内容
- 展示生成中状态，例如 cursor / loading indicator
- 如果当前 Conversation 是 active Conversation，MessageInput 显示停止按钮
- 不展示 retry

---

### 8.3 Assistant Message: done

Assistant message 处于 `done` 时：

- 展示完整内容
- 不展示错误提示
- 不展示“已停止”
- 第一阶段可以不支持 done message 的重新生成

---

### 8.4 Assistant Message: failed

Assistant message 处于 `failed` 时：

- 保留已生成 partial content
- 展示错误提示
- 展示“重试”按钮
- 不删除旧消息
- 不覆盖旧消息
- 不把 failed 当成 aborted

---

### 8.5 Assistant Message: aborted

Assistant message 处于 `aborted` 时：

- 保留已生成 partial content
- 展示“已停止”状态
- 展示“重试”按钮
- 不展示为失败错误
- 不删除旧消息

---

### 8.6 Retry 展示

用户点击 failed / aborted message 的“重试”后：

- 旧 failed / aborted message 保留
- 新 assistant message 作为新消息展示
- 新 assistant message 进入 `streaming`
- 新消息完成后变为 `done`
- 如果 retry 再次失败，新消息变成 `failed`

不要复用旧 message UI。

---

## 9. ToolCallCard 交互

### 9.1 running

ToolCall 状态为 `running` 时：

- 展示工具名称
- 展示执行中状态
- 可以展示参数摘要
- 不展示最终结果

如果 ToolCall running 属于当前正在生成的 assistant message，则该 Conversation 仍视为 streaming。

---

### 9.2 success

ToolCall 状态为 `success` 时：

- 展示工具名称
- 展示成功状态
- 展示结果摘要
- 结果过长时截断或折叠

---

### 9.3 failed

ToolCall 状态为 `failed` 时：

- 展示工具名称
- 展示失败状态
- 展示安全错误信息
- 不展示内部 stack trace
- 是否导致 assistant message failed，由后端状态决定

---

## 10. ProfileSwitcher 交互

### 10.1 Profile 加载

页面初始化时调用：

```text
GET /api/profiles
```

ProfileSwitcher 展示可用 Profile。

---

### 10.2 切换 Profile

切换 Profile 后：

- 更新 `profileStore.currentProfileId`
- 新建 Conversation 时使用当前 Profile
- 已存在 Conversation 的 `profileId` 不因切换 Profile 被修改

也就是说：

```text
Profile 切换影响后续新会话，不 retroactively 修改旧会话。
```

如果用户在已有 Conversation 中切换 Profile 并发送消息，第一阶段建议：

```text
仍以该 Conversation 自身 profileId 为准。
```

避免一个 Conversation 内混用多个 Profile。

---

## 11. 空会话状态

当没有 active Conversation，或当前 Conversation 没有 messages 时，展示空状态。

空状态内容建议包含：

- 标题：开始一次 AI 对话
- 简短说明
- 示例问题按钮

示例问题：

```text
解释一下什么是流式响应
帮我写一个简单的 Markdown 示例
现在几点？顺便算一下 599 * 3
```

用户点击示例问题：

- 如果当前没有 active Conversation，先创建 Conversation
- 将示例问题填入输入框或直接发送
- 第一阶段建议：点击后填入输入框，由用户确认发送

---

## 12. 多会话 streaming 交互

第一阶段规则：

- 不同 Conversation 可以同时 streaming。
- 同一 Conversation 不能同时 streaming。
- 左侧会话列表显示每个 Conversation 的 streaming 状态。
- 当前 Conversation streaming 时，MessageInput 禁止再次发送。
- 非当前 Conversation streaming 时，不影响当前 Conversation 操作。

用户切到一个正在 streaming 的 Conversation：

- MessageList 展示当前已收到的本地内容或数据库内容。
- 如果这是发起 stream 的同一页面，应继续看到实时 delta。
- 如果不是发起 stream 的页面，只能看到数据库已落库内容，且展示“正在生成中”状态。
- 生成完成后可以通过手动刷新或重新拉取 messages 获取最终内容。

---

## 13. 多页面 / 多 Tab 行为

MVP 阶段明确：

```text
发起生成的页面：实时接 SSE delta。
其他页面：能看到该 conversation 正在 streaming，但不实时同步 delta。
生成完成后：其他页面通过刷新或重新拉取 messages 获得最终内容。
```

其他页面进入正在 streaming 的 Conversation 时：

- 输入框应禁止发送
- 显示“当前会话正在生成中”
- 可以提供“刷新消息”按钮
- 不显示非本页面收到的实时 delta

第一阶段不做：

- BroadcastChannel 多 Tab 同步
- WebSocket
- Conversation 级 SSE 订阅
- 跨页面实时 delta 广播
- 自动轮询同步 partial content

---

## 14. 错误与 Toast 交互

### 14.1 普通错误

普通 JSON API 错误：

- 可以使用 Toast 或 Alert 展示
- 错误信息应简短
- 不展示 stack trace
- 不展示内部路径
- 不展示密钥或连接信息

---

### 14.2 CONVERSATION_STREAMING

当收到：

```text
409 CONVERSATION_STREAMING
```

前端表现：

- 当前 Conversation 输入区保持禁用或恢复为 streaming 状态
- 提示“当前会话正在生成中”
- 不创建新消息
- 不清空已有消息

---

### 14.3 网络错误

网络错误时：

- 清理相关 runtime state
- 展示可理解错误
- 如果后端已经创建 assistant message，并通过后续 messages 拉取得到 failed 状态，以后端状态为准

---

## 15. Loading 与 Disabled 规则

### 15.1 页面初始化

页面初始化时：

- 左侧列表可以显示 skeleton 或 loading
- 主区域可以显示 loading
- 不要阻塞整个页面超过必要范围

---

### 15.2 会话切换

切换会话加载 messages 时：

- MessageList 显示局部 loading
- 左侧列表保持可用
- 不要清空当前消息后长时间白屏
- 加载成功后替换为目标 Conversation messages

---

### 15.3 发送消息

发送消息后：

- 当前 Conversation 进入 streaming 状态
- 发送按钮禁用
- 停止按钮可用
- 同会话再次发送被禁止

---

## 16. Nuxt UI 使用建议

常见交互映射：

```text
按钮        -> UButton
输入框      -> UTextarea
状态标签    -> UBadge
卡片        -> UCard
Profile下拉 -> USelectMenu
错误提示    -> UAlert / UToast
确认弹窗    -> UModal
Tooltip     -> UTooltip
```

规则：

- Nuxt UI 用于基础交互控件。
- 业务组件仍由项目自定义。
- 不要为了使用 Nuxt UI 破坏状态结构。
- 不要把复杂业务状态写进 UI 组件内部。

---

## 17. 第一阶段不做的交互

第一阶段不做：

- 文件拖拽上传
- 富文本编辑器
- 消息编辑
- 消息删除
- 消息收藏
- 多选消息
- 对 done message 重新生成
- 多端实时 delta 同步
- 自动轮询 partial content
- Conversation 级实时订阅
- 复杂快捷键系统
- 复杂移动端手势
- 像素级 Figma 还原
- 复杂动画

---

## 18. 验收清单

第一阶段 UI 交互至少满足：

1. 首次进入能加载会话列表。
2. 能新建会话。
3. 能切换会话。
4. 能加载当前会话最近 50 条消息。
5. 首次加载消息后默认滚动到底部。
6. 有更早消息时，顶部出现“加载更早消息”按钮。
7. 点击“加载更早消息”后再拉取 50 条，并保持阅读位置。
8. 能发送消息并看到 streaming。
9. streaming 时，同一 Conversation 不能再次发送。
10. 不同 Conversation 可以同时 streaming。
11. 左侧列表能展示非当前 Conversation 正在 streaming。
12. 点击停止后，消息变为 aborted，并保留 partial content。
13. failed / aborted message 能展示重试入口。
14. 重试不会覆盖旧消息。
15. ToolCall running / success / failed 能清楚展示。
16. 非发起生成页面能看到 Conversation 正在 streaming，但不实时同步 delta。
17. 生成完成后，非发起页面能通过重新拉取 messages 获得最终内容。
18. 用户阅读历史时，streaming delta 不会强制把页面拉到底部。
