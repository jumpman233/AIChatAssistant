import { defineStore } from 'pinia'
import type { ConversationRuntimeState, TypewriterRuntimeState } from '~/types/chat'
import {
  appendTypewriterDelta,
  createTypewriterState,
  drainTypewriter,
  flushTypewriter,
} from '~/utils/typewriter'

const DRAIN_INTERVAL_MS = 16
const DONE_DRAIN_INTERVAL_MS = 10

const createRuntimeState = (conversationId: string): ConversationRuntimeState => ({
  abortController: null,
  conversationId,
  error: null,
  isStreaming: false,
  streamId: null,
  streamingMessageId: null,
  typewriters: {},
})

export const useChatRuntimeStore = defineStore('chatRuntime', () => {
  const conversationStates = ref<Record<string, ConversationRuntimeState>>({})
  const doneTypewriters = ref<Record<string, boolean>>({})
  const renderTick = ref(0)

  const ensureRuntimeState = (conversationId: string) => {
    conversationStates.value[conversationId] ??= createRuntimeState(conversationId)
    return conversationStates.value[conversationId]
  }

  const getRuntimeState = (conversationId: string) => {
    return conversationStates.value[conversationId] ?? null
  }

  const getTypewriter = (messageId: string) => {
    for (const state of Object.values(conversationStates.value)) {
      const typewriter = state.typewriters[messageId]

      if (typewriter) {
        return typewriter
      }
    }

    return null
  }

  const isMessageTyping = (messageId: string) => {
    const typewriter = getTypewriter(messageId)
    return Boolean(typewriter?.isTyping || typewriter?.pendingText)
  }

  const isConversationStreaming = (conversationId: string) => {
    return Boolean(conversationStates.value[conversationId]?.isStreaming)
  }

  const isMessageStreaming = (conversationId: string, messageId: string) => {
    const state = conversationStates.value[conversationId]
    return Boolean(state?.isStreaming && state.streamingMessageId === messageId)
  }

  const touchRender = () => {
    renderTick.value += 1
  }

  const clearTypewriterTimer = (typewriter: TypewriterRuntimeState) => {
    if (typewriter.timerId) {
      clearTimeout(typewriter.timerId)
      typewriter.timerId = null
    }
  }

  const removeTypewriter = (conversationId: string, messageId: string) => {
    const state = conversationStates.value[conversationId]

    if (!state?.typewriters[messageId]) {
      return
    }

    clearTypewriterTimer(state.typewriters[messageId])
    delete state.typewriters[messageId]
    delete doneTypewriters.value[messageId]
    touchRender()
  }

  const scheduleDrain = (conversationId: string, messageId: string) => {
    const state = ensureRuntimeState(conversationId)
    const typewriter = state.typewriters[messageId]

    if (!typewriter || typewriter.timerId) {
      return
    }

    const done = Boolean(doneTypewriters.value[messageId])
    const drainIntervalMs = done ? DONE_DRAIN_INTERVAL_MS : DRAIN_INTERVAL_MS

    typewriter.timerId = setTimeout(() => {
      const latestState = conversationStates.value[conversationId]
      const latestTypewriter = latestState?.typewriters[messageId]

      if (!latestTypewriter) {
        return
      }

      latestTypewriter.timerId = null

      const done = Boolean(doneTypewriters.value[messageId])
      latestState.typewriters[messageId] = drainTypewriter(latestTypewriter, {
        done,
      })
      touchRender()

      const nextTypewriter = latestState.typewriters[messageId]

      if (nextTypewriter.pendingText.length > 0) {
        scheduleDrain(conversationId, messageId)
        return
      }

      if (done) {
        removeTypewriter(conversationId, messageId)
      }
    }, drainIntervalMs)
  }

  const startStream = (conversationId: string, abortController: AbortController) => {
    const state = ensureRuntimeState(conversationId)
    state.abortController = abortController
    state.error = null
    state.isStreaming = true
    state.streamId = null
    state.streamingMessageId = null
  }

  const attachStream = (input: {
    conversationId: string
    streamId: string
    messageId: string
    initialContent?: string
  }) => {
    const state = ensureRuntimeState(input.conversationId)
    state.streamId = input.streamId
    state.streamingMessageId = input.messageId
    state.isStreaming = true
    state.error = null
    state.typewriters[input.messageId] = createTypewriterState(
      input.messageId,
      input.initialContent ?? '',
    )
    delete doneTypewriters.value[input.messageId]
    touchRender()
  }

  const appendDelta = (conversationId: string, messageId: string, delta: string) => {
    const state = ensureRuntimeState(conversationId)
    state.typewriters[messageId] ??= createTypewriterState(messageId)
    state.typewriters[messageId] = appendTypewriterDelta(state.typewriters[messageId], delta)
    touchRender()
    scheduleDrain(conversationId, messageId)
  }

  const syncFinalContent = (conversationId: string, messageId: string, finalContent: string) => {
    const state = ensureRuntimeState(conversationId)
    state.typewriters[messageId] ??= createTypewriterState(messageId)

    const typewriter = state.typewriters[messageId]

    if (finalContent.startsWith(typewriter.rawContent)) {
      const missingText = finalContent.slice(typewriter.rawContent.length)
      typewriter.rawContent = finalContent
      typewriter.pendingText += missingText
    } else {
      state.typewriters[messageId] = {
        ...flushTypewriter(typewriter),
        displayContent: finalContent,
        rawContent: finalContent,
      }
    }
  }

  const finishStream = (input: {
    conversationId: string
    messageId: string
    finalContent: string
    error?: string | null
  }) => {
    const state = ensureRuntimeState(input.conversationId)
    state.abortController = null
    state.error = input.error ?? null
    state.isStreaming = false
    state.streamId = null
    state.streamingMessageId = null
    syncFinalContent(input.conversationId, input.messageId, input.finalContent)
    doneTypewriters.value[input.messageId] = true
    touchRender()
    scheduleDrain(input.conversationId, input.messageId)
  }

  const failBeforeStream = (conversationId: string, error: string) => {
    const state = ensureRuntimeState(conversationId)
    state.abortController = null
    state.error = error
    state.isStreaming = false
    state.streamId = null
    state.streamingMessageId = null
  }

  const clearRuntimeState = (conversationId: string) => {
    const state = conversationStates.value[conversationId]

    if (!state) {
      return
    }

    for (const typewriter of Object.values(state.typewriters)) {
      clearTypewriterTimer(typewriter)
    }

    delete conversationStates.value[conversationId]
    touchRender()
  }

  const clearAllRuntimeStates = () => {
    for (const state of Object.values(conversationStates.value)) {
      for (const typewriter of Object.values(state.typewriters)) {
        clearTypewriterTimer(typewriter)
      }
    }

    conversationStates.value = {}
    doneTypewriters.value = {}
    touchRender()
  }

  return {
    appendDelta,
    attachStream,
    clearAllRuntimeStates,
    clearRuntimeState,
    conversationStates,
    failBeforeStream,
    finishStream,
    getRuntimeState,
    getTypewriter,
    isConversationStreaming,
    isMessageStreaming,
    isMessageTyping,
    renderTick,
    startStream,
  }
})
