# OpenPCB React Hooks — src-react/src/hooks/

Core frontend state management. SSE streaming consumers, entity operations, and complex UI logic extraction.

## Development Mode Guidelines

**This is active development - v0.1.0. No backward compatibility required.**

### Playwright Verification (REQUIRED)

**Every UI change MUST be verified via Playwright.** Manual browser testing is not sufficient.

```bash
# Start development servers
npm run dev

# In another terminal - run Playwright in UI mode
npx playwright test --ui
```

### Refactoring Rules

- **Delete old code immediately** when refactoring - do not keep legacy compatibility layers
- **No deprecation periods** - breaking changes are acceptable
- **Remove unused exports** aggressively
- **Update all callers** when changing APIs - no overloads for backward compat
- **Clean imports** - remove dead imports immediately

## Overview

Hooks handle the bridge between UI and Bun Sidecar API, managing state for streaming, persistence, and navigation.

## Where to Look

| Category        | Primary Hook           | Purpose                                      |
| --------------- | ---------------------- | -------------------------------------------- |
| **Streaming**   | `useStreamChat.ts`     | SSE consumption, reconnection, message state |
| **Persistence** | `useChatOperations.ts` | Create/rename/delete chats & messages        |
| **Navigation**  | `useActiveChat.ts`     | Current chat context and routing state       |
| **Lists**       | `useChatList.ts`       | Chats, folders, and favorites management     |
| **UI State**    | `usePromptInput.ts`    | File attachments, mentions, input buffer     |
| **Metadata**    | `useProjects.ts`       | Workspace/Project context management         |

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

## Anti-Patterns

| Forbidden                        | Why                                       |
| -------------------------------- | ----------------------------------------- |
| Skip Playwright verification     | UI changes require automated verification |
| Keep legacy code during refactor | Delete old code immediately               |
