# OpenPCB Core/Module Extraction: Migration Plan Critique
## Frontend (React) Focus Review

**Date**: April 8, 2026  
**Scope**: Frontend migration only (`src-react/src`)  
**Plan Reviewed**: Keep workspace/project in core, remove folders/favorites/branches, move bookmarks/MCP/OAuth to ai-service, keep usage/secrets in core

---

## 1. KEY RISKS & FLAWS IN CURRENT PLAN

### 1.1 CRITICAL: Workspace/Project Coupling is Over-Centralized
**Risk Level**: HIGH  
**Issue**: Keeping workspace/project in core makes sense for desktop app, BUT the frontend has architectural debt:
- `app-store.ts` (366 lines) violates separation of concerns
  - Manages workspace CRUD, project CRUD, design CRUD, and ALL active state
  - Single Zustand store manages 7 related actions for 3 data types
  - No clear boundary between "navigation state" vs "data state"
- `useAppStore` is imported **71+ times** across frontend
- Every feature (chat, library, designer, settings) calls `useAppStore.activeWorkspaceId / activeProjectId`

**What can break**:
- Moving designer/library to modules creates coupling to core store
- Modules cannot be tested in isolation
- Hard to implement workspace switching in designer without cascading store updates

**Recommendation**: Before module extraction, split `app-store.ts` into:
1. `workspace-navigation.store` (activeWorkspaceId)
2. `project-navigation.store` (activeProjectId)
3. `data.store` (CRUD for workspaces/projects/designs)

---

### 1.2 CRITICAL: Settings Panels Architecture is Incomplete
**Risk Level**: CRITICAL  
**Issue**: Plan says "move bookmarks/MCP/OAuth to ai-service" but settings UI integration is broken:

Current state:
- `SettingsDialog.tsx` uses hardcoded `panelComponents` map (only `general` + `about`)
- `nav.ts` has no entries for usage/mcp/oauth/bookmarks
- `UsagePanel.tsx` & `McpServersPanel.tsx` exist but NOT registered in nav
- These panels use **Tauri bridge** (secrets-api.ts line 1: `commands.bridgeInvoke`)

What must happen:
1. Migrate all secrets API from Tauri→Electron IPC
2. Move MCP settings panel to ai-service module
3. Move OAuth settings panel to ai-service module
4. **Move or delete** bookmarks panel (unclear if it's being removed entirely)
5. **Move or delete** usage panel (unclear if staying in core or moving)
6. Update settings nav to dynamically load panels from modules

**Current blockers**:
- `secrets-api.ts` still references `@shared/generated/tauri-bindings` (Tauri v2 bindings that no longer exist)
- No mapping of settings panels to modules in `nav.ts`
- No clear decision: does usage stay in core or move? Same for secrets.

---

### 1.3 MAJOR: Folder/Favorites Removal Not Fully Specified
**Risk Level**: MEDIUM-HIGH  
**Issue**: Files exist and are being referenced, but removal strategy is vague:

Existing implementations:
- `/hooks/useFolders.ts` (93 lines, used in home UI)
- `/hooks/useFavorites.ts` (93 lines, used in home UI)
- `/screens/home/FolderSection.tsx` (complex folder UI)
- `/screens/home/FavoritesSection.tsx` (favorites UI)
- `/lib/api/folder-api.ts` (REST client)
- `/lib/api/favorite-api.ts` (REST client)

**What's unclear**:
- Are these "chat" folders/favorites (knowledge module)?
- Are they "project" folders/favorites?
- If being removed, what replaces the UI in home screen?
- If these are chat-related, why are the APIs in `src-react/src/lib/api` and not in `modules/knowledge`?

**Missing**: Frontend migration plan for home screen after removal

---

### 1.4 MAJOR: OAuth API Mismatch
**Risk Level**: MEDIUM-HIGH  
**Issue**: oauth-api.ts exists in frontend but backend structure unclear:

Current state:
- `/lib/api/oauth-api.ts` (114 lines) implements OAuth flow
- Uses `customFetch` from `@shared/sdk/mutator`
- Supports 'codex' + 'github-copilot' providers
- **No OAuth panel registered in settings**

Problems:
- OAuth code exists but settings nav doesn't include it
- Unclear whether OAuth should be in AI Settings panel or separate
- OAuth is tied to AI providers but settings structure doesn't show this

**Missing**: OAuth UI integration plan

---

### 1.5 MAJOR: Bookmarks are Orphaned
**Risk Level**: MEDIUM  
**Issue**: bookmark-api.ts exists but is it being removed or kept?

- `/lib/api/bookmark-api.ts` (65 lines)
- `/hooks/useBookmarks.ts` (94 lines)
- **Referenced in**: `modules/ai-service/react/ChatScreen.tsx` (per IMPORT_BREAKAGES)

**Problem**: Plan says "move bookmarks to ai-service" but:
- No clarity on whether bookmarks are per-chat or global
- No UI panel currently exists for bookmark settings
- Unclear if "move to ai-service" means move the backend API or just the frontend hooks

---

### 1.6 SIGNIFICANT: Import Path Strategy Not Defined
**Risk Level**: MEDIUM  
**Issue**: Plan doesn't specify frontend import rules for modules:

Current chaos (from IMPORT_BREAKAGES):
```
❌ @/hooks/useChatList → @modules/ai-service/react/hooks/useChatList
❌ @/components/ChatInterface → @modules/ai-service/react/components/ChatInterface
✅ Can't use @/ for cross-module imports
```

But the plan doesn't specify:
1. How should core imports look?
   - `@/hooks/useAppStore` ← core store
   - `@/components/ui/Button` ← shared UI
2. How should cross-module imports look?
   - `@modules/ai-service/hooks/useChat`?
   - `@ai-service/hooks/useChat`?
3. Should module exports be re-exported from core or used directly?
4. Will eslint rules enforce boundaries?

**Missing**: Frontend import architecture specification

---

### 1.7 SIGNIFICANT: Secrets Storage Migration Path Missing
**Risk Level**: MEDIUM  
**Issue**: Secrets currently use Tauri bridge but plan doesn't detail Electron replacement:

Current state:
- `secrets-api.ts` uses `@shared/generated/tauri-bindings`
- Unclear: does this store API keys locally or in cloud?
- Plan says "keep secrets in core" but doesn't specify:
  - How Electron IPC replaces Tauri bridge
  - Whether electron-keytar or file-based storage
  - How OAuth tokens are persisted

**Missing**: Secrets storage architecture for Electron

---

## 2. MISSING IMPLEMENTATION STEPS

### 2.1 Pre-Migration Refactoring
- [ ] Split `app-store.ts` into separate concerns (2-3 stores)
- [ ] Create `core/react/stores/index.ts` barrel export
- [ ] Extract workspace/project data types to `@shared/types` if not already done
- [ ] Audit all 71 `useAppStore` imports and categorize by intent

### 2.2 Settings Architecture Redesign
- [ ] Define settings panel registry (dynamic loading from modules)
- [ ] Create module interface for settings panels
- [ ] Move `SettingsDialog.tsx` type system to support dynamic panels
- [ ] Create `core/react/components/SettingsPanel` base component

### 2.3 Folder/Favorites Decision
- [ ] **DECISION REQUIRED**: Are folders/favorites being removed or moved?
- [ ] If removed: What replaces folder UI in home screen?
- [ ] If moved: Confirm destination (ai-service for chat folders?)
- [ ] Update home screen layout accordingly

### 2.4 OAuth UI Integration
- [ ] Create `AIServiceSettingsPanel.tsx` (or AI settings tab)
- [ ] Move OAuth flow from `oauth-api.ts` into AI settings UI
- [ ] Register AIServiceSettingsPanel in settings nav
- [ ] Integrate with provider configuration (API keys, OAuth tokens)

### 2.5 Secrets API Modernization
- [ ] Replace Tauri bridge in `secrets-api.ts` with Electron IPC
- [ ] Define Electron IPC schema for secret operations
- [ ] Implement electron-keytar integration
- [ ] Test API key storage/retrieval flow

### 2.6 Bookmarks Classification
- [ ] **DECISION REQUIRED**: Confirm bookmarks scope (chat-level? global?)
- [ ] If moving to ai-service: move both hooks + API to `modules/ai-service/react/lib`
- [ ] If being removed: delete all files and update imports

### 2.7 Module Boundary Documentation
- [ ] Define frontend import paths convention
- [ ] Document which stores are core vs module
- [ ] Create eslint config to enforce import rules
- [ ] Update tsconfig paths for modules

---

## 3. DEPENDENCIES & ORDERING CORRECTIONS

### Current Plan Order (as stated):
1. Keep workspace/project in core
2. Remove folders/favorites/branches
3. Move bookmarks/MCP/OAuth to ai-service
4. Keep usage/secrets in core

### CORRECT ORDER (with prerequisites):

**Phase 0: Preparation (BLOCKS everything else)**
```
a. DECISION: Are folders/favorites/bookmarks being removed or moved?
b. DECISION: Does usage stay in core or move to ai-service?
c. DECISION: Which secrets management system (electron-keytar vs file)?
d. Split app-store.ts into navigation + data stores
e. Create settings panel registry system
f. Migrate secrets API from Tauri→Electron
```

**Phase 1: Core Settings Infrastructure**
```
1. Create AIServiceSettingsPanel stub in core
2. Update SettingsDialog to support dynamic panels
3. Register core panels (General, About) + empty AI panel
4. Test settings dialog loads
```

**Phase 2: Remove Deprecated Features**
```
1. Delete folder-api.ts + useFolders.ts
2. Delete favorite-api.ts + useFavorites.ts
3. Delete or move bookmark-api.ts + useBookmarks.ts
4. Update home screen layout (remove folder/favorite sections)
5. Update FolderSection.tsx → cleanup or delete
6. Update FavoritesSection.tsx → cleanup or delete
```

**Phase 3: Move AI Service Features to Module**
```
1. Move MCP settings panel code from core→modules/ai-service
2. Move OAuth settings panel + oauth-api.ts → modules/ai-service
3. If bookmarks stay: move hooks + API → modules/ai-service
4. Create AIServiceSettingsPanel inside module
5. Export panel from module SDK
6. Wire into core settings registry
```

**Phase 4: Keep Core Features (No Movement)**
```
1. Workspace/project stays in core (no changes needed)
2. Usage stays in core (no changes needed)
3. Secrets stays in core + replaces Tauri with Electron IPC
```

**Dependencies that create ordering problems**:
- ❌ Can't move MCP/OAuth before deciding on settings architecture
- ❌ Can't remove folders/favorites until home screen refactor
- ❌ Can't keep secrets in core without Electron migration first
- ✅ MUST split app-store before module extraction (modules will depend on core stores)

---

## 4. CONCRETE FILE/PATH HOT SPOTS

### CRITICAL FRONTEND FILES (High Refactor Risk)

| File | Lines | Reason | Action |
|---|---|---|---|
| `src/stores/app-store.ts` | 366 | Oversized, mixed concerns | **SPLIT** into 2-3 stores |
| `src/settings/SettingsDialog.tsx` | 103 | Hardcoded panels | **REFACTOR** to use registry |
| `src/settings/nav.ts` | 17 | Missing entries | **ADD** mcp/oauth/bookmarks entries |
| `src/lib/api/secrets-api.ts` | 81 | Tauri dependency | **REWRITE** for Electron IPC |
| `src/lib/api/oauth-api.ts` | 114 | No UI integration | **MOVE** to ai-service module |
| `src/lib/api/mcp-api.ts` | 65 | No settings panel | **MOVE** to ai-service module |
| `src/lib/api/bookmark-api.ts` | 65 | Orphaned | **DECISION**: keep/move/delete |
| `src/lib/api/folder-api.ts` | 57 | Being removed | **DELETE** |
| `src/lib/api/favorite-api.ts` | 65 | Being removed | **DELETE** |
| `src/hooks/useFolders.ts` | 93 | Being removed | **DELETE** |
| `src/hooks/useFavorites.ts` | 93 | Being removed | **DELETE** |
| `src/hooks/useBookmarks.ts` | 94 | Orphaned | **MOVE** to ai-service |
| `src/screens/home/FolderSection.tsx` | ? | Uses useFolders | **DELETE or REFACTOR** |
| `src/screens/home/FavoritesSection.tsx` | ? | Uses useFavorites | **DELETE or REFACTOR** |
| `src/settings/panels/McpServersPanel.tsx` | 449 | Not in nav | **MOVE** to ai-service + add to nav |
| `src/settings/panels/UsagePanel.tsx` | 120 | Not in nav | **DECISION**: keep or move |

### IMPORT REFACTORING HOTSPOTS

**Files importing from moved locations** (per IMPORT_BREAKAGES):

| File | Current Import | Issue | Fix |
|---|---|---|---|
| `src/layout/Home.tsx` | `@/components/ChatSidebar` | Old path | Use module import |
| `src/screens/ProjectScreen.tsx` | `@/hooks/useChatList` | Old path | Use module import |
| `modules/ai-service/ChatScreen.tsx` | `openpcb-app/src/...` | Wrong prefix | Fix to relative imports |
| `modules/knowledge/react/hooks/usePageChat.ts` | `@/hooks/useStreamChat` | Cross-module | Use proper module path |

### STORE DEPENDENCY GRAPH (Frontend)

```
useAppStore (366 lines)
├── Consumers: 71+ imports
├── useWorkspaces() → Core
├── useProjects() → Core  
├── useDesigns() → Core
├── setActiveWorkspace() → affects navigation in ALL modules
├── setActiveProject() → affects designer module state
└── [PROBLEM] Too many concerns in one store
```

**After split**:
```
workspace-navigation.store (activeWorkspaceId)
├── Consumers: design editor, project list
└── Readonly except for navigation

project-navigation.store (activeProjectId)
├── Consumers: project screen, designer
└── Readonly except for navigation

workspace-data.store (CRUD ops)
├── createWorkspace, deleteWorkspace
└── Private data ops

project-data.store (CRUD ops)
├── createProject, deleteProject
└── Private data ops
```

---

## 5. CLARIFYING QUESTIONS FOR USER

### ARCHITECTURE DECISIONS

**Q1**: Do folders/favorites refer to **chat organization** or **project organization**?
- If chat: Should they be in knowledge module instead of removed?
- If project: Do they provide value or can they be deleted entirely?
- **Impact**: Affects 4 files + home screen layout

**Q2**: Where should **bookmarks** live?
- Current: `src/hooks/useBookmarks.ts` + `src/lib/api/bookmark-api.ts`
- Referenced in: ai-service ChatScreen.tsx
- Decision: Move to ai-service module or delete?
- **Impact**: Affects migration scope

**Q3**: What is the **usage panel** tracking?
- Current: Exists in `UsagePanel.tsx` but not in settings nav
- Question: Should it stay in core or move to ai-service?
- Is this showing API usage or workspace quotas?
- **Impact**: Affects settings architecture

**Q4**: Should **secrets storage** use electron-keytar or encrypted file?
- Current: Tauri bridge (`secrets-api.ts`)
- Options: (1) electron-keytar (system keyring), (2) encrypted SQLite, (3) file-based
- Decision impacts: How OAuth tokens and API keys are persisted
- **Impact**: Critical for Electron migration

**Q5**: What is the **MCP server panel** for?
- Current: `McpServersPanel.tsx` (449 lines) exists but not in settings nav
- Is this AI-related (Claude Desktop style) or something else?
- Should it be in ai-service settings or separate?
- **Impact**: Settings architecture

### MIGRATION SEQUENCING

**Q6**: Can **app-store refactoring** happen before module extraction?
- Splitting into 2-3 stores requires some imports to change
- Modules will import from core stores
- Should this be done in Phase 0 or deferred?
- **Impact**: Critical path length

**Q7**: Should **settings panels be dynamically loaded** from modules?
- Current: Hardcoded in SettingsDialog
- Proposed: Use registry pattern so modules export settings panels
- Decision: Build registry now or hardcode ai-service panels for now?
- **Impact**: Long-term extensibility vs short-term speed

**Q8**: What is the **exact scope of "workspace/project stays in core"**?
- Does this include: (a) CRUD operations, (b) routing logic, (c) workspace switcher UI?
- Or only: (a) data store, (b) API client?
- Affects: How designer module accesses workspace context
- **Impact**: Module boundary clarity

### MIGRATION MECHANICS

**Q9**: How should **modules import core features**?
- Option A: `@/stores/app-store` (using tsconfig path from core)
- Option B: `@modules/core/stores/app-store` (explicit path)
- Option C: Dependency injection container (pass stores as props)
- **Impact**: Import path conventions

**Q10**: Should **home screen be refactored** before or after module extraction?
- Home currently shows: Projects, Folders, Favorites, Chat sections
- If removing folders/favorites: UI needs redesign
- Do this before or after moving chat to modules?
- **Impact**: Affects home screen component dependencies

---

## SUMMARY: RECOMMENDED NEXT STEPS

**DO IMMEDIATELY** (clarification):
1. Answer Q1-Q5 above
2. Specify which API/types are moving where
3. Decide on secrets storage mechanism

**DO FIRST** (unblocks everything):
1. Split `app-store.ts` into navigation + data stores
2. Migrate `secrets-api.ts` from Tauri→Electron IPC
3. Refactor settings dialog to support dynamic panel registry

**DO BEFORE EXTRACTION**:
1. Remove folder/favorite features from home screen (if deleting)
2. Register missing settings panels (MCP, OAuth)
3. Update settings nav.ts with all panel entries

**DO DURING EXTRACTION**:
1. Move MCP/OAuth panels to ai-service module
2. Move bookmark hooks/API to ai-service if keeping
3. Update all imports to use module paths
4. Enforce boundaries with eslint

**DO NOT DO**:
1. Don't keep workspace/project in core WHILE having scattered import paths
2. Don't move settings panels to modules before building registry system
3. Don't move secrets/usage without Electron migration plan

