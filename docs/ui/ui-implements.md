## 组件映射

左侧栏              -> ConversationSidebar.vue
会话项              -> ConversationItem.vue
顶部 Profile 区      -> ChatHeader.vue + ProfileSwitcher.vue
中间消息区域         -> MessageList.vue
用户消息             -> MessageItem.vue
Assistant 消息       -> MessageItem.vue + MarkdownRenderer.vue
CodeBlock            -> CodeBlock.vue
ToolCall 卡片        -> ToolCallCard.vue
底部输入区           -> MessageInput.vue
Failed/Aborted 区块  -> ErrorRetryBlock.vue

## nuxt ui 映射
按钮        -> UButton
输入框      -> UTextarea
状态标签    -> UBadge
卡片        -> UCard
Profile下拉 -> USelectMenu
错误提示    -> UAlert
Toast      -> UToast
确认弹窗    -> UModal