# Import/Path Breakages from Chat/Provider Files Migration

## Overview
Files moved from `src-react/src/*` and `src-ts/src/*` to `modules/ai-service/` created import breakages across the codebase. The tsconfig paths resolve `@/` to `src-react/src`, which no longer contains these files.

---

## GROUPED BY IMPORTER FILE

### src-react/src/layout/Home.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/chat/ChatSidebar` | `@modules/ai-service/react/components/chat/ChatSidebar` | Now in ai-service module |
| `@/components/ChatInterface` | `@modules/ai-service/react/components/ChatInterface` | Now in ai-service module |
| `@/hooks/useActiveChat` | `@modules/ai-service/react/hooks/useActiveChat` | Now in ai-service module |
| `@/hooks/useStreamChat` | `@modules/ai-service/react/hooks/useStreamChat` | Now in ai-service module |
| `@/stores/chat-store` | `@modules/ai-service/react/stores/chat-store` | Now in ai-service module |
| `@/hooks/useChatOperations` | `@modules/ai-service/react/hooks/useChatOperations` | Now in ai-service module |

### src-react/src/screens/home/HomePromptInput.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/hooks/useChatOperations` | `@modules/ai-service/react/hooks/useChatOperations` | Now in ai-service module |
| `@/stores/chat-store` | `@modules/ai-service/react/stores/chat-store` | Now in ai-service module |

### src-react/src/screens/home/FolderSection.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/chat-api` (moveChatToFolder) | `@modules/ai-service/react/lib/api/chat-api` | Now in ai-service module |
| `@/hooks/useChatList` | `@modules/ai-service/react/hooks/useChatList` | Now in ai-service module |

### src-react/src/components/ErrorBoundary.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ai-elements/conversation` | `@modules/ai-service/react/components/ai-elements/conversation` | Now in ai-service module |

### src-react/src/screens/ProjectScreen.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/hooks/useChatList` | `@modules/ai-service/react/hooks/useChatList` | Now in ai-service module |
| `@/hooks/useChatOperations` | `@modules/ai-service/react/hooks/useChatOperations` | Now in ai-service module |

### src-react/src/screens/ProjectScreen.test.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/hooks/useChatOperations` | `@modules/ai-service/react/hooks/useChatOperations` | Test imports |

### modules/knowledge/react/hooks/usePageChat.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/chat-api` | `@modules/ai-service/react/lib/api/chat-api` | Cross-module import |
| `@/hooks/useStreamChat` | `@modules/ai-service/react/hooks/useStreamChat` | Cross-module import |
| `@/stores/chat-store` | `@modules/ai-service/react/stores/chat-store` | Cross-module import |

### modules/knowledge/react/components/Chat/PageChatPanel.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ChatInterface` | `@modules/ai-service/react/components/ChatInterface` | Cross-module import |

### modules/ai-service/react/ChatScreen.tsx ⚠️ CRITICAL
Using wrong `openpcb-app/src` prefix instead of module-relative imports

| Broken Import | New Target | Notes |
|---|---|---|
| `openpcb-app/src/components/chat/CollapsibleChatSidebar` | `./components/chat/CollapsibleChatSidebar` or `@modules/ai-service/react/components/chat/CollapsibleChatSidebar` | Same module - use relative |
| `openpcb-app/src/components/ChatInterface` | `./components/ChatInterface` | Same module - use relative |
| `openpcb-app/src/hooks/useStreamChat` | `./hooks/useStreamChat` | Same module - use relative |
| `openpcb-app/src/stores/chat-store` | `./stores/chat-store` | Same module - use relative |
| `openpcb-app/src/hooks/useChatOperations` | `./hooks/useChatOperations` | Same module - use relative |
| `openpcb-app/src/lib/api/chat-api` | `./lib/api/chat-api` | Same module - use relative |
| `openpcb-app/src/components/ai-elements/prompt-input` | `./components/ai-elements/prompt-input` | Same module - use relative |
| `openpcb-app/src/hooks/useMessageActions` | `./hooks/useMessageActions` | Same module - use relative |
| `openpcb-app/src/hooks/useBookmarks` | `@/hooks/useBookmarks` | Remains in src-react |
| `openpcb-app/src/components/ChatInterface/types` | `./components/ChatInterface/types` | Same module - use relative |
| `openpcb-app/src/components/ChatMediaSidebar` | `./components/ChatMediaSidebar` | Same module - use relative |

### modules/ai-service/react/components/ai-elements/prompt-input.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/chat/MentionAutocomplete` | `@modules/ai-service/react/components/chat/MentionAutocomplete` | Same module |

### modules/ai-service/react/stores/chat-store.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/chat-api` | `@modules/ai-service/react/lib/api/chat-api` | Same module |

### modules/ai-service/react/hooks/useStreamChat.test.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/chat-api` (vi.mock) | `@modules/ai-service/react/lib/api/chat-api` | Test mock |

### modules/ai-service/react/hooks/useChatList.test.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/chat-api` (vi.mock) | `@modules/ai-service/react/lib/api/chat-api` | Test mock |

### modules/ai-service/react/hooks/useActiveChat.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/stores/chat-store` | `@modules/ai-service/react/stores/chat-store` | Same module |

### modules/ai-service/react/hooks/useChatOperations.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/chat-api` | `@modules/ai-service/react/lib/api/chat-api` | Same module |

### modules/ai-service/react/hooks/useStreamChat.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/chat-api` | `@modules/ai-service/react/lib/api/chat-api` | Same module |

### modules/ai-service/react/hooks/useModuleChat.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/hooks/useStreamChat` | `@modules/ai-service/react/hooks/useStreamChat` | Same module |
| `@/stores/chat-store` | `@modules/ai-service/react/stores/chat-store` | Same module |

### modules/ai-service/react/hooks/useChatList.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/chat-api` | `@modules/ai-service/react/lib/api/chat-api` | Same module |

### modules/ai-service/react/components/ai/ModelSelector.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/stores/chat-store` | `@modules/ai-service/react/stores/chat-store` | Same module |
| `@/lib/api/provider-api` | `@modules/ai-service/react/lib/api/provider-api` | Same module |

### modules/ai-service/react/components/ChatInterface/ChatInterface.test.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ChatInterface/components` (vi.mock) | `@modules/ai-service/react/components/ChatInterface/components` | Test mock |
| `@/components/chat/MessageTextWithMentions` (vi.mock) | `@modules/ai-service/react/components/chat/MessageTextWithMentions` | Test mock |

### modules/ai-service/react/components/ChatInterface.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/chat/messages` | `@modules/ai-service/react/lib/chat/messages` | Same module |
| `@/components/chat/MessageTextWithMentions` | `@modules/ai-service/react/components/chat/MessageTextWithMentions` | Same module |
| `@/components/ChatInterface/components` | `@modules/ai-service/react/components/ChatInterface/components` | Same module |
| `@/components/ChatInterface/types` | `@modules/ai-service/react/components/ChatInterface/types` | Same module |
| `@/hooks/useChatInterface` | `@modules/ai-service/react/hooks/useChatInterface` | Same module |
| `@/components/MessageFooter` | `@modules/ai-service/react/components/MessageFooter` | Same module |

### modules/ai-service/react/components/chat/ChatList.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/chat-api` | `@modules/ai-service/react/lib/api/chat-api` | Same module |

### modules/ai-service/react/components/ChatInterface/examples/EmbeddedChatExample.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ChatInterface` | `@modules/ai-service/react/components/ChatInterface` | Same module |
| `@/components/ChatInterface/presets` | `@modules/ai-service/react/components/ChatInterface/presets` | Same module |
| `@/hooks/useStreamChat` | `@modules/ai-service/react/hooks/useStreamChat` | Same module |

### modules/ai-service/react/components/ChatInterface/examples/ProjectChatExample.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ChatInterface` | `@modules/ai-service/react/components/ChatInterface` | Same module |
| `@/components/ChatInterface/presets` | `@modules/ai-service/react/components/ChatInterface/presets` | Same module |
| `@/hooks/useStreamChat` | `@modules/ai-service/react/hooks/useStreamChat` | Same module |

### modules/ai-service/react/components/ChatInterface/examples/MainChatExample.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ChatInterface` | `@modules/ai-service/react/components/ChatInterface` | Same module |
| `@/hooks/useStreamChat` | `@modules/ai-service/react/hooks/useStreamChat` | Same module |

### modules/ai-service/react/components/ChatInterface/examples/ModuleChatExample.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ChatInterface` | `@modules/ai-service/react/components/ChatInterface` | Same module |
| `@/hooks/useModuleChat` | `@modules/ai-service/react/hooks/useModuleChat` | Same module |

### modules/ai-service/react/tests/knowledge/PageChatPanel.lifecycle.test.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ChatInterface` (vi.mock) | `@modules/ai-service/react/components/ChatInterface` | Same module |

### modules/ai-service/react/hooks/useChatInterface.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/chat/markdown` | `@modules/ai-service/react/lib/chat/markdown` | Same module |
| `@/lib/chat/messages` | `@modules/ai-service/react/lib/chat/messages` | Same module |
| `@/lib/chat/clipboard` | `@modules/ai-service/react/lib/chat/clipboard` | Same module |

### modules/ai-service/react/hooks/usePromptInput.ts
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/chat/files` | `@modules/ai-service/react/lib/chat/files` | Same module |
| `@/lib/chat/clipboard` | `@modules/ai-service/react/lib/chat/clipboard` | Same module |

### modules/ai-service/react/components/MessageFooter.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ai-elements/message` | `@modules/ai-service/react/components/ai-elements/message` | Same module |
| `@/components/ai-elements/BranchIndicator` | `@modules/ai-service/react/components/ai-elements/BranchIndicator` | Same module |
| `@/components/ai-elements/BranchSelectorPopover` | `@modules/ai-service/react/components/ai-elements/BranchSelectorPopover` | Same module |

### modules/ai-service/react/components/ChatInterface/components/ModelBadge.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ai/ModelLoadingBadge` | `@modules/ai-service/react/components/ai/ModelLoadingBadge` | Same module |

### modules/ai-service/react/components/ChatInterface/components/ChatHeader.test.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/components/ai/ModelLoadingBadge` (vi.mock) | `@modules/ai-service/react/components/ai/ModelLoadingBadge` | Test mock |

### modules/ai-service/react/settings/panels/ApiKeysPanel.tsx
| Broken Import | New Target | Notes |
|---|---|---|
| `@/lib/api/provider-api` | `@modules/ai-service/react/lib/api/provider-api` | Same module |

---

## IMPORT PATTERN SUMMARY

### Pattern 1: src-react files importing from @/
**Rule:** Replace `@/` prefix with `@modules/ai-service/react/`

```
@/components/chat/X        → @modules/ai-service/react/components/chat/X
@/components/ChatInterface → @modules/ai-service/react/components/ChatInterface
@/hooks/useStreamChat      → @modules/ai-service/react/hooks/useStreamChat
@/lib/api/chat-api         → @modules/ai-service/react/lib/api/chat-api
@/stores/chat-store        → @modules/ai-service/react/stores/chat-store
```

### Pattern 2: Within modules/ai-service/react/ files
**Current Issue:** Using `openpcb-app/src/` or `@/` prefixes for same-module imports

**Recommended:** Use consistent approach:
- Option A: Relative paths for same-module (`../components/X`)
- Option B: Full module path (`@modules/ai-service/react/components/X`) for consistency with cross-module imports

**Exception:** External imports from src-react (e.g., `useBookmarks`) should use `@/` prefix

### Pattern 3: Cross-module imports (modules/knowledge → modules/ai-service)
**Rule:** Use full module path `@modules/ai-service/react/...`
```
@/lib/api/chat-api         → @modules/ai-service/react/lib/api/chat-api
@/components/ChatInterface → @modules/ai-service/react/components/ChatInterface
```

---

## FILES TO UPDATE (Sorted by Priority)

### High Priority (External imports broken)
1. `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/layout/Home.tsx` (6 broken imports)
2. `/Users/andrejvysny/andrejvysny/OpenPCB/modules/ai-service/react/ChatScreen.tsx` (11 broken imports - CRITICAL)
3. `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/ErrorBoundary.tsx` (1 broken import)
4. `/Users/andrejvysny/andrejvysny/OpenPCB/modules/knowledge/react/hooks/usePageChat.ts` (3 broken imports)

### Medium Priority (Internal module imports)
5. `/Users/andrejvysny/andrejvysny/OpenPCB/modules/ai-service/react/components/ChatInterface.tsx` (6 broken imports)
6. `/Users/andrejvysny/andrejvysny/OpenPCB/modules/ai-service/react/hooks/useChatInterface.ts` (3 broken imports)
7. `/Users/andrejvysny/andrejvysny/OpenPCB/modules/ai-service/react/components/ai-elements/prompt-input.tsx` (1 broken import)
8. `/Users/andrejvysny/andrejvysny/OpenPCB/modules/ai-service/react/stores/chat-store.ts` (1 broken import)

### Low Priority (Test files)
9. Various test files in modules/ai-service/react/

---

## SUMMARY STATISTICS

- **Total files with broken imports:** 33
- **Total broken imports:** ~80+
- **Critical files:** 1 (ChatScreen.tsx)
- **External breaks (src-react/src & modules/knowledge):** 8 files
- **Internal breaks (within modules/ai-service):** 25 files
