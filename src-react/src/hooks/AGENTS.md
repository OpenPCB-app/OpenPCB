# OpenPCB React Hooks — src-react/src/hooks/

Core frontend state management. SSE streaming consumers, entity operations, and complex UI logic extraction.

## Overview
Hooks handle the bridge between UI and Bun Sidecar API, managing state for streaming, persistence, and navigation.

## Where to Look

| Category | Primary Hook | Purpose |
|----------|--------------|---------|
| **Streaming** | `useStreamChat.ts` | SSE consumption, reconnection, message state |
| **Persistence**| `useChatOperations.ts`| Create/rename/delete chats & messages |
| **Navigation** | `useActiveChat.ts` | Current chat context and routing state |
| **Lists** | `useChatList.ts` | Chats, folders, and favorites management |
| **UI State** | `usePromptInput.ts` | File attachments, mentions, input buffer |
| **Metadata** | `useProjects.ts` | Workspace/Project context management |

## Hook Patterns

### SSE Streaming (`useStreamChat`)
- **Lifecycle**: `submitMessage` → POST → SSE Subscribe → `consumeSseStream()`
- **State Management**: Local `useState` for messages + `useRef` for sequence tracking
- **Reconnection**: `recoverFromInterruptedStream` handles network drops/interruption
- **Event Handling**: Maps `token`, `reasoning`, `model_loading`, `done` to UI state

### API Composition
- **Standard Fetch**: Most hooks use `src-react/src/lib/api/` wrappers
- **Optimistic UI**: `useChatOperations` updates local state before API resolution
- **Unified Types**: Shared types from `@shared/types` and `@shared/sdk`

### State Management Strategy
- **Zustand**: Global stores for persistent UI state (sidebar, theme)
- **Context**: Environment-wide values (BackendURL, ChatContext)
- **Hooks**: Transient business logic and feature-specific state

## Conventions

- **Naming**: `use[Feature].ts` using kebab-case
- **Return Object**: Always return a flat object `{ state, actions, isLoading }`
- **Memoization**: `useCallback` for all stable action functions
- **Refs**: Use `useRef` for tracking stream sequence and abort controllers
- **Cleanup**: Always implement `AbortController` in `useEffect` or actions
- **Validation**: Strict TypeScript—no `any` for API responses
