# Frontend File Inventory & Migration Status

## STORES & STATE MANAGEMENT

### Core Stores (CRITICAL - Oversized)
| File | Lines | Status | Action | Dependencies |
|------|-------|--------|--------|--------------|
| `src/stores/app-store.ts` | 366 | Active | **SPLIT into 3 stores** | workspace-api, project-api, design-api |
| `src/stores/navigation-store.ts` | ~60 | Active | Keep as-is | (minimal) |
| `src/stores/auth-store.ts` | 40 | Active | Keep as-is | (none) |
| `src/stores/update-store.ts` | ~30 | Active | Keep as-is | (none) |

**Post-Split Proposal**:
```
workspace-navigation.store    (activeWorkspaceId, setActiveWorkspace)
workspace-data.store         (workspaces[], CRUD ops)
project-navigation.store     (activeProjectId, setActiveProject)
project-data.store          (projects[], CRUD ops)
design-data.store           (designsByScope, CRUD ops)
```

---

## API CLIENT LAYER (src/lib/api/)

### CORE API CLIENTS (Stay in core)
| File | Lines | Backend Route | Status | Notes |
|------|-------|----------------|--------|-------|
| `workspace-api.ts` | 45 | `/api/v1/workspace` | Active | Workspace CRUD |
| `project-api.ts` | 41 | `/api/v1/project` | Active | Project CRUD |
| `design-api.ts` | 67 | `/api/v1/design` | Active | Design CRUD |
| `search-api.ts` | 40 | `/api/v1/search` | Active | Full-text search |

### TO BE DELETED (Folder/Favorite Removal)
| File | Lines | Decision | Reason |
|------|-------|----------|--------|
| `folder-api.ts` | 57 | DELETE | Being removed from plan |
| `favorite-api.ts` | 65 | DELETE | Being removed from plan |

### TO BE MOVED (AI Service Features)
| File | Lines | Target | Action |
|------|-------|--------|--------|
| `oauth-api.ts` | 114 | `modules/ai-service/react/lib/api/` | MOVE + integrate into settings |
| `mcp-api.ts` | 65 | `modules/ai-service/react/lib/api/` | MOVE + create settings panel |
| `bookmark-api.ts` | 65 | TBD (Q2) | MOVE to ai-service or DELETE |

### UNCLEAR/NEEDS DECISION
| File | Lines | Decision Needed | Impact |
|------|-------|-----------------|--------|
| `secrets-api.ts` | 81 | Rewrite for Electron | OAuth token + API key storage |
| `feedback-api.ts` | 60+ | Stay in core? | No clear owner |

### UNUSED/LEGACY
| File | Lines | Status | Action |
|------|-------|--------|--------|
| `file-api.ts` | 30 | Check usage | ? |
| `auth-api.ts` | 40 | Check usage | ? |

---

## HOOKS LAYER (src/hooks/)

### CORE HOOKS (Stay in core)
| File | Lines | Consumers | Status | Notes |
|------|-------|-----------|--------|-------|
| `useAppStore.ts` | ~20 | 71+ files | Active | **High coupling** |
| `useSearch.ts` | 35 | Home screen | Active | Search integration |
| `useHealthCheck.ts` | 50 | App init | Active | Backend readiness |
| `useProjectFiles.ts` | 40 | Project screen | Active | File management |
| `useFiles.ts` | 25 | (?) | Active | (?) |
| `useMediaFiles.ts` | 30 | Gallery | Active | Media loading |
| `useFileUpload.ts` | 170 | Upload screens | Active | File upload handling |
| `useTags.ts` | 95 | Content editing | Active | Tag management |
| `useContentEditor.ts` | 280 | Content editing | Active | Editor state |
| `useEditorSelection.ts` | 80 | Canvas | Active | Selection tracking |
| `useAutoSaveDraft.ts` | 85 | (?) | Active | Auto-save feature |
| `useSchematicAutoSave.ts` | 65 | Schematic editor | Active | Schema-specific autosave |
| `useCanvasWheel.ts` | test | (?) | Test | Wheel event handling |

### TO BE DELETED (Feature Removal)
| File | Lines | Reason |
|------|-------|--------|
| `useFolders.ts` | 93 | Folder feature removed |
| `useFavorites.ts` | 93 | Favorite feature removed |

### TO BE MOVED (AI Service)
| File | Lines | Target | Decision |
|------|-------|--------|----------|
| `useBookmarks.ts` | 94 | `modules/ai-service/react/hooks/` | Pending (Q2) |

---

## SCREENS & LAYOUT (src/screens/ & src/layout/)

### CORE LAYOUTS (Stay in core)
| File | Status | Notes |
|------|--------|-------|
| `layout/Home.tsx` | Active | Homepage - home screen |
| `layout/Layout.tsx` | Active | Root layout wrapper |
| `layout/ScreenRouter.tsx` | Active | Route switching |
| `layout/LeftSidebar.tsx` | Active | Navigation sidebar |
| `screens/ProjectScreen.tsx` | Active | Project hub UI |
| `screens/ProjectsListView.tsx` | Active | Projects list view |

### HOME SCREEN COMPONENTS (Requires Refactoring)
| File | Lines | Depends On | Action |
|------|-------|-----------|--------|
| `screens/home/ProjectSection.tsx` | ~80 | useAppStore | Keep |
| `screens/home/FolderSection.tsx` | ~120 | useFolders | **DELETE** (folder feature) |
| `screens/home/FavoritesSection.tsx` | ~80 | useFavorites | **DELETE** (favorite feature) |
| `screens/home/FolderContentView.tsx` | ~100 | useFolders | **DELETE** (folder feature) |
| `screens/home/MediaGallerySection.tsx` | ~70 | useMediaFiles | Keep |
| `screens/home/SearchCommand.tsx` | ~90 | useSearch | Keep |
| `screens/home/ImagePreviewModal.tsx` | ~80 | (?) | Keep |
| `screens/home/PDFPreviewModal.tsx` | ~80 | (?) | Keep |
| `screens/home/HomeHeader.tsx` | ~60 | (?) | Keep |

---

## SETTINGS (src/settings/)

### SETTINGS INFRASTRUCTURE (Incomplete)
| File | Lines | Status | Action |
|------|-------|--------|--------|
| `SettingsDialog.tsx` | 103 | Active | **REFACTOR to registry pattern** |
| `SettingsSidebar.tsx` | ~80 | Active | **UPDATE for registry** |
| `nav.ts` | 17 | Active | **UPDATE with missing entries** |
| `index.ts` | ~30 | Active | Update exports |

### SETTINGS PANELS (Partially Registered)
| File | Lines | Registered | Status | Action |
|------|-------|------------|--------|--------|
| `panels/GeneralPanel.tsx` | ~150 | YES | Active | Keep |
| `panels/AboutPanel.tsx` | ~80 | YES | Active | Keep |
| `panels/UsagePanel.tsx` | 120 | **NO** | Active | DECISION: keep/move |
| `panels/McpServersPanel.tsx` | 449 | **NO** | Active | **MOVE to ai-service** |

**Missing from nav.ts**:
- OAuth settings panel (doesn't exist yet)
- MCP servers panel (exists but not registered)
- Usage panel (exists but not registered)

---

## COMPONENTS (src/components/)

### UI PRIMITIVES (Shared, Core)
| Folder | Status | Action |
|--------|--------|--------|
| `ui/` | Active | Keep in core |
| `sidebar/` | Active | Keep in core |

### PROJECT COMPONENTS (Core)
| File | Status | Notes |
|------|--------|-------|
| `project/ProjectCreateDialog.tsx` | Active | Keep |
| `project/ProjectDeleteConfirmDialog.tsx` | Active | Keep |
| `GlobalStateProvider.tsx` | Active | Keep |
| `workspace/WorkspaceCreateDialog.tsx` | Active | Keep |
| `ErrorBoundary.tsx` | Active | Keep |

### CHAT COMPONENTS (To Be Moved)
These are currently in core but should be in modules:
- `components/chat/*` → modules/ai-service/react/components/chat/
- `components/ChatInterface/*` → modules/ai-service/react/components/
- `components/ai-elements/*` → modules/ai-service/react/components/

(Note: IMPORT_BREAKAGES doc already identifies these)

---

## CONTEXTS & PROVIDERS (src/contexts/)

| File | Status | Action |
|------|--------|--------|
| `SidebarButtonsContext.tsx` | Active | Keep in core |
| `BackendURLContext.tsx` | Active | Keep in core |

---

## UTILITIES & CONFIGURATION

| File | Status | Action |
|------|--------|--------|
| `lib/project-icons.ts` | Active | Keep |
| `lib/api/index.ts` | Active | Update exports (remove deleted APIs) |
| `vite.config.ts` | Active | Update for modules |
| `tsconfig.json` | Active | Update paths for modules |
| `tailwind.config.ts` | Active | Keep |

---

## MIGRATION IMPACT SUMMARY

### Total Files by Category:
- **Core (Stay)**: ~35 files
- **Move to ai-service**: ~8 files
- **Delete**: ~6 files
- **Refactor (No move)**: ~8 files
- **Unclear/Needs Decision**: 3 files

### Highest Refactor Effort:
1. **app-store.ts** (366 lines) - Store split + update 71 consumers
2. **SettingsDialog.tsx** (103 lines) + nav.ts - Registry pattern refactor
3. **Home screen components** (4 files) - Layout redesign after feature removal
4. **secrets-api.ts** (81 lines) - Tauri → Electron migration
5. **import path updates** - ~30 files need new module paths

### Blocked By Decisions:
- Q1: Folder/favorite scope → affects 4 files + home screen
- Q2: Bookmark scope → affects 2 files
- Q3: Usage panel location → affects settings architecture
- Q4: Secrets storage → affects api.ts and OAuth integration
- Q5: MCP panel purpose → affects settings structure

---

## IMPORT PATTERN CHANGES

### Current (app-store imports)
```typescript
import { useAppStore } from '@/stores/app-store';
const { activeWorkspaceId, activeProjectId } = useAppStore();
```
✗ Problem: Creates circular dependencies with module state

### Proposed After Split
```typescript
// Core navigation (read-only for modules)
import { useWorkspaceNavigation } from '@/stores/workspace-navigation';
import { useProjectNavigation } from '@/stores/project-navigation';

// Core data (CRUD in core only)
const workspace = useWorkspaceData();
workspace.create(...);  // Only in core

// Module hooks
import { useChat } from '@modules/ai-service/hooks/useChat';
```

---

## TSCONFIG PATH UPDATES NEEDED

Current:
```json
{
  "baseUrl": "src",
  "paths": {
    "@/*": ["*"],
    "@shared/*": ["../../src-ts/shared/*"]
  }
}
```

Proposed:
```json
{
  "baseUrl": ".",
  "paths": {
    "@/*": ["src/*"],
    "@shared/*": ["../src-ts/shared/*"],
    "@modules/*": ["../modules/*"],
    "@modules/ai-service/*": ["../modules/ai-service/react/*"],
    "@modules/designer/*": ["../modules/designer/react/*"]
  }
}
```

