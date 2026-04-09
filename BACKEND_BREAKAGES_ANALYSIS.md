# Backend Compile/Runtime Breakages Analysis

**Status**: 37 TypeScript compilation errors preventing server startup
**Scope**: Core-only startup (homepage/projects/designs) without AI features
**Project**: /Users/andrejvysny/andrejvysny/OpenPCB

---

## SECTION 1: MISSING FILES & ACTIVE IMPORTS IN CORE

### 1. DATABASE SCHEMAS (Most Critical - Blocks All Repos)

| Moved File | Imported By | Impact |
|---|---|---|
| `modules/ai-service/ts/db/schema/chat.ts` | 8 files (schema/index.ts exports) | **BLOCKING**: Drizzle schema compilation fails |
| `modules/ai-service/ts/db/schema/message.ts` | 7 files (schema/index.ts exports) | **BLOCKING**: DatabaseAccess cannot instantiate |
| `modules/ai-service/ts/db/schema/provider.ts` | 2 files (stream.schema.ts) | **BLOCKING**: StreamService schemas broken |
| `modules/ai-service/ts/db/schema/provider-api-key.ts` | 1 file (schema/index.ts) | **BLOCKING**: Schema index exports |
| `modules/ai-service/ts/db/schema/provider-oauth.ts` | 1 file (schema/index.ts) | **BLOCKING**: Schema index exports |

### 2. SERVICE LAYER (DI Container Depends On)

| Service | Imported By | Impact |
|---|---|---|
| `modules/ai-service/ts/services/chat-service.ts` | `src/core/di/setup.ts:10` | **BLOCKING**: DI Container cannot initialize |
| `modules/ai-service/ts/services/message-service.ts` | `src/core/di/setup.ts:17`, `src/main.ts:34` | **BLOCKING**: Message service init fails |
| `modules/ai-service/ts/services/stream-service.ts` | `src/core/di/setup.ts:21` | **BLOCKING**: StreamController broken |
| `modules/ai-service/ts/services/provider-service.ts` | `src/core/di/setup.ts:19` | **BLOCKING**: ProviderController broken |

### 3. SERVICE DEPENDENCIES (Indirectly Blocking)

| Service | Imported By | Impact |
|---|---|---|
| `modules/ai-service/ts/services/chat-manager.ts` | task-orchestrator, task-system (3 files) | **BLOCKING**: Core task execution depends on this |
| `modules/ai-service/ts/services/chat-task-lock.ts` | task-orchestrator, task-startup-recovery (3 files) | **BLOCKING**: Race condition prevention broken |

### 4. REPOSITORIES (Database Access Layer)

- `modules/ai-service/ts/db/repositories/chat.ts` - Referenced in `src/db/index.ts:27`
- `modules/ai-service/ts/db/repositories/message.ts` - Referenced in `src/db/index.ts:28`
- `modules/ai-service/ts/db/repositories/provider.ts` - Referenced in `src/db/index.ts:39`
- `modules/ai-service/ts/db/repositories/provider-api-key.ts` - Referenced in `src/db/index.ts:38`

### 5. CONTROLLERS (HTTP Route Handlers)

- `modules/ai-service/ts/controllers/chat-controller.ts` - `src/core/di/setup.ts:25`
- `modules/ai-service/ts/controllers/stream-controller.ts` - `src/core/di/setup.ts:37`
- `modules/ai-service/ts/controllers/provider-controller.ts` - `src/core/di/setup.ts:35`
- `modules/ai-service/ts/controllers/message-action-controller.ts` - `src/core/di/setup.ts:39`

### 6. MAPPERS & SCHEMAS

- `modules/ai-service/ts/mappers/chat-mapper.ts` - `src/domain/mappers/index.ts:1`
- `modules/ai-service/ts/schemas/chat.schema.ts` - `src/core/schemas/index.ts:15`
- `modules/ai-service/ts/schemas/provider.schema.ts` - `src/core/schemas/index.ts:17`, `stream.schema.ts:8`

---

## SECTION 2: COMPILATION ERROR CATEGORIES

### Category A: Schema Export Chain Failures (HIGHEST PRIORITY)

**Files**: `src/db/schema/index.ts`
- Line 18: `export * from "./chat"` → MISSING FILE
- Line 19: `export * from "./message"` → MISSING FILE
- Line 38-40: Provider exports → MISSING FILES (3)

**Consequence**: Drizzle schema compilation fails → DatabaseAccess cannot instantiate → All repositories fail

### Category B: DI Container Initialization (BLOCKS MAIN.TS)

**File**: `src/core/di/setup.ts`
- Lines 10, 17, 19, 21: Service imports fail
- Lines 25, 35, 37, 39: Controller imports fail

**Consequence**: `setupDIContainer()` cannot be called → main.ts fails at line 269

### Category C: Task System Dependencies (Blocks Execution Engine)

**Files**:
- `task-orchestrator.ts:21` - ChatManager import
- `task-orchestrator.ts:24` - ChatTaskLock import
- `task-system.ts:17` - ChatManager import
- `assistant-message-persistence.ts:7` - ChatManager import

**Consequence**: Task execution pipeline cannot initialize → Core task infrastructure compromised

### Category D: Core Services with Broken Dependencies

- `project-service.ts:6` - Chat schema import
- `branch-service.ts:2` - Message schema import
- `file-service.ts:20` - MessageContent import

---

## SECTION 3: MINIMAL BACKEND EDIT SET FOR CORE-ONLY STARTUP

**21 files must be edited** to achieve homepage/projects-only startup:

### PHASE 1: REMOVE MOVED FILE REFERENCES FROM EXPORT CHAINS (3 files)

1. **src/db/schema/index.ts** - Remove lines 18-19 (chat/message), 38-40 (provider)
2. **src/core/schemas/index.ts** - Remove lines 15, 17 (chat.schema, provider.schema)
3. **src/db/index.ts** - Remove imports and properties for chat, message, provider repos

### PHASE 2: FIX DI CONTAINER & STARTUP (4 files)

4. **src/core/di/setup.ts** - Remove all moved service/controller imports and registrations
5. **src/core/di/container.ts** - Remove moved TOKENS
6. **src/main.ts** - Remove provider/message initialization
7. **src/transport/router/core-router.ts** - Remove chat/provider/stream routes

### PHASE 3: FIX CORE SERVICES (8 files)

8. **src/domain/services/index.ts** - Remove moved service exports
9. **src/domain/mappers/index.ts** - Remove chat-mapper export
10. **src/domain/services/project-service.ts** - Remove chat cascade delete
11. **src/domain/services/folder-service.ts** - Fix repo usage
12. **src/db/repositories/folder.ts** - Remove chat join, stub chatCount
13. **src/db/repositories/favorite.ts** - Remove chat join, return empty/stub
14. **src/db/repositories/bookmark.ts** - Remove message join
15. **src/domain/services/file-service.ts** - Add MessageContent stub type

### PHASE 4: FIX TASK SYSTEM (5 files)

16. **src/domain/services/queue/task-orchestrator.ts** - Remove ChatManager, ChatTaskLock
17. **src/domain/services/queue/task-system.ts** - Remove ChatManager import
18. **src/domain/services/queue/task-startup-recovery.ts** - Remove ChatTaskLock
19. **src/domain/services/queue/task-load-dependency-coordinator.ts** - Remove ChatTaskLock
20. **src/domain/services/queue/assistant-message-persistence.ts** - Remove ChatManager

### PHASE 5: OPTIONAL CLEANUP (1 file)

21. **src/domain/services/branch-service.ts** - Move to module or stub (message-specific logic)

---

## SECTION 4: RISKS FROM REMOVING CHAT/PROVIDER REPOS

### Tier 1: CRITICAL - Will Break Core Functions

| Risk | Location | Mitigation |
|---|---|---|
| Favorite Service stops working | FavoriteRepository.findByWorkspace() joins chat | Stub response (empty favorites) |
| Bookmark Service broken | BookmarkRepository joins message table | Filter out message bookmarks |
| Folder operations incomplete | FolderRepository.findByWorkspaceWithChatCount() joins chat | Stub chatCount to 0 |

### Tier 2: MEDIUM - Partial Degradation

| Risk | Location | Mitigation |
|---|---|---|
| Project cascade delete broken | project-service.ts:6 | Bypass chat cascade check |
| Branch service non-functional | branch-service.ts:2 | Move to ai-service module |
| File attachment handling degraded | file-service.ts:20 | File listing works, context lost |

---

## SECTION 5: VALIDATION COMMANDS

### TypeScript Compilation Check
```bash
cd /Users/andrejvysny/andrejvysny/OpenPCB/src-ts
npx tsc --noEmit
# Expected: 0 errors
```

### Check for remaining moved references
```bash
grep -r "chat-service\|message-service\|stream-service\|provider-service\|chat-manager\|chat-task-lock" src --include="*.ts" | grep import
# Expected: 0 results in core files (only in modules/ai-service/)
```

### Runtime boot test
```bash
npm run dev:backend
# Expected: "[Bun Sidecar] Server running on http://localhost:3000"
# NOT Expected: "Cannot find module", "ChatService is not a constructor"
```

### Full dev server test
```bash
npm run dev
# Expected: Homepage loads, project list visible, no chat panel
```

---

## SECTION 6: COMPLETE FILE LIST

### Missing Files (In Module, Imported by Core) - 23 files

**Schemas (5)**:
- chat.ts, message.ts, provider.ts, provider-api-key.ts, provider-oauth.ts

**Services (6)**:
- chat-service.ts, message-service.ts, stream-service.ts, provider-service.ts, chat-manager.ts, chat-task-lock.ts

**Repositories (4)**:
- chat.ts, message.ts, provider.ts, provider-api-key.ts

**Controllers (4)**:
- chat-controller.ts, stream-controller.ts, provider-controller.ts, message-action-controller.ts

**Mappers & Schemas (3)**:
- chat-mapper.ts, chat.schema.ts, provider.schema.ts

**Other (1)**:
- provider-oauth.ts (repository)

### Core Services Needing Modification - 8 files

1. src/domain/services/project-service.ts
2. src/domain/services/folder-service.ts
3. src/domain/services/branch-service.ts
4. src/domain/services/file-service.ts
5. src/db/repositories/folder.ts
6. src/db/repositories/favorite.ts
7. src/db/repositories/bookmark.ts
8. src/domain/services/queue/task-orchestrator.ts (+ 4 more task files)

---

## CRITICAL FINDING

**BranchService should be moved to ai-service module**

BranchService is tightly coupled to message structure and chat operations. It's not a general "project branch" service - it's a "message branch" service. It should be in the module where it can access the message schema.

