# Pinia Stores

This directory is reserved for Pinia stores.

Planned stores:

* `conversation.ts`: conversation list, active conversation, message cache.
* `chatRuntime.ts`: per-conversation streaming state, AbortController, temporary stream errors.
* `profile.ts`: assistant profile list and current profile.
* `tool.ts`: available tool metadata and tool UI state.

Install Pinia before adding store files:

```bash
pnpm add pinia @pinia/nuxt
```
