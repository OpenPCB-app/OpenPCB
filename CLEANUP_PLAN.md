# OpenPCB Cleanup Plan

Detailed file-by-file cleanup actions. Organized by phase, ordered by risk. Every item was verified via grep for active callers before categorizing as REMOVE vs SKIP.

**Constraints**: No functionality changes, no feature additions, no feature removals.

---

## Phase 1: Legacy Naming (Safe Renames)

**Risk: Low** — Affects Rust compilation and lock files only. No runtime behavior change.

### Rust Crate Renames

| #   | Action | File                                               | Change                                                                                         |
| --- | ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1.1 | RENAME | `src-tauri/crates/bridge/Cargo.toml:2`             | `name = "one_mind_bridge"` → `name = "openpcb_bridge"`                                         |
| 1.2 | RENAME | `src-tauri/crates/common-modules/Cargo.toml:2`     | `name = "one_mind_module_support"` → `name = "openpcb_module_support"`                         |
| 1.3 | UPDATE | `src-tauri/Cargo.toml:34`                          | `one_mind_bridge = { path = "crates/bridge" }` → `openpcb_bridge = { path = "crates/bridge" }` |
| 1.4 | UPDATE | `src-tauri/crates/bridge-introspect/Cargo.toml:14` | `one_mind_bridge = { path = "../bridge" }` → `openpcb_bridge = { path = "../bridge" }`         |

### Rust Source References (replace all `one_mind_bridge` → `openpcb_bridge`)

| #    | File                                             | Occurrences | Lines                                                                                                                                               |
| ---- | ------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.5  | `src-tauri/src/lib.rs`                           | 3           | `use one_mind_bridge::` (L5), `one_mind_bridge::dispatch_bridge_request` (L37), `one_mind_bridge::TauriEventSink` (L42)                             |
| 1.6  | `src-tauri/src/core_bridge.rs`                   | 3           | `use one_mind_bridge::BridgeResult` (L4), `one_mind_bridge::BridgeError::handler_failed` (L24, L32, L47)                                            |
| 1.7  | `src-tauri/src/sidecar/bun_ts/bun_bridge.rs`     | ~10         | `use one_mind_bridge::BridgeResult` (L15), multiple `one_mind_bridge::BridgeError::handler_failed` calls                                            |
| 1.8  | `src-tauri/src/secrets_bridge.rs`                | ~20         | `use one_mind_bridge::BridgeResult` (L5), `one_mind_bridge::BridgeError::handler_failed` throughout, `map_secrets_bridge_error` helper (L508, L526) |
| 1.9  | `src-tauri/crates/bridge-macros/src/lib.rs`      | ~15         | All `::one_mind_bridge::` codegen references (L279, L379, L382, L395, L433, L466, L476, L477, L480, L495, L498, L503, L509, L510, L511, L591, L608) |
| 1.10 | `src-tauri/crates/bridge-introspect/src/main.rs` | 1           | `use one_mind_bridge::BridgeModuleRegistration` (L2)                                                                                                |

### Lock Files and Test Fixtures

| #    | Action | File                                                        | Change                                                                                 |
| ---- | ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1.11 | REGEN  | `src-tauri/Cargo.lock`                                      | Auto-regenerates on `cargo build` after crate renames. No manual edit needed.          |
| 1.12 | REGEN  | `src-react/package-lock.json`                               | Delete file, run `npm install` to regenerate. Fixes `"name": "OneMind-app"` on line 2. |
| 1.13 | UPDATE | `src-ts/tests/integration/chat-fork.integration.test.ts:18` | `"onemind-chat-fork-"` → `"openpcb-chat-fork-"`                                        |
| 1.14 | UPDATE | `src-ts/tests/integration/tool-call.integration.test.ts:61` | `"onemind-tool-call-"` → `"openpcb-tool-call-"`                                        |

### Verification

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cd src-ts && bun test tests/integration/chat-fork.integration.test.ts
cd src-ts && bun test tests/integration/tool-call.integration.test.ts
```

---

## Phase 2: Dead Demo Code Removal

**Risk: Low** — Demo/example code with zero production callers. Confirmed via grep: no frontend references to `greet`, `startBackendProgress`, `backend-notification`, or `backend-progress`.

### commands.rs Cleanup

**File**: `src-tauri/src/commands.rs`

| #   | Action | What                                  | Lines  | Reason                                                                            |
| --- | ------ | ------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| 2.1 | DELETE | `BACKEND_NOTIFICATION_EVENT` const    | L11    | Only used by demo code                                                            |
| 2.2 | DELETE | `BACKEND_PROGRESS_EVENT` const        | L12    | Only used by demo code                                                            |
| 2.3 | DELETE | `BackendNotification` struct + `impl` | L14-35 | Only used by `start_backend_progress()`                                           |
| 2.4 | DELETE | `now_epoch_seconds()` helper          | L37-41 | Only used by `BackendNotification::new()`                                         |
| 2.5 | DELETE | `greet()` function                    | L44-46 | Demo "Hello World" — zero callers                                                 |
| 2.6 | DELETE | `start_backend_progress()` function   | L55-78 | Demo progress emitter — zero callers; references undefined `BackendProgress` type |

**After cleanup**, `commands.rs` retains only:

```rust
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::Serialize;
use specta::Type;

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub process_id: u32,
    pub last_checked_epoch: u32,
}

pub fn server_status() -> ServerStatus {
    ServerStatus {
        process_id: std::process::id(),
        last_checked_epoch: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_secs() as u32,
    }
}
```

### core_bridge.rs Cleanup

**File**: `src-tauri/src/core_bridge.rs`

| #    | Action | What                                        | Lines          | Reason                                                                                                             |
| ---- | ------ | ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2.7  | DELETE | `bridge_events!` macro call                 | L9-13          | Both events (`backend-notification`, `backend-progress`) are demo-only. `BackendProgress` type doesn't even exist. |
| 2.8  | DELETE | `greet` bridge command + `GreetArgs` struct | L20-26, L61-64 | Demo command — zero callers                                                                                        |
| 2.9  | DELETE | `startBackendProgress` bridge command       | L40-54         | Demo command — zero callers                                                                                        |
| 2.10 | KEEP   | `serverStatus` bridge command               | L28-38         | Legitimate production use                                                                                          |

**After cleanup**, `core_bridge.rs` retains only:

```rust
use bridge_macros::{bridge_cmd, bridge_module};
use openpcb_bridge::BridgeResult;  // renamed from one_mind_bridge
use crate::commands;

#[derive(Default)]
pub struct CoreBridge;

#[bridge_module(ns = "core")]
impl CoreBridge {
    #[bridge_cmd(name = "serverStatus")]
    fn server_status(&self, _args: ()) -> BridgeResult {
        let status = commands::server_status();
        serde_json::to_value(status).map_err(|e| {
            openpcb_bridge::BridgeError::handler_failed(
                "core", "serverStatus", anyhow::anyhow!("{}", e),
            )
        })
    }
}
```

### Removed Imports

| #    | Action | File                           | Change                                                                                           |
| ---- | ------ | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| 2.11 | UPDATE | `src-tauri/src/commands.rs`    | Remove unused imports: `thread`, `Emitter`, `Runtime`, `AppHandle` (only needed by deleted code) |
| 2.12 | UPDATE | `src-tauri/src/core_bridge.rs` | Remove unused imports: `Deserialize`, `tauri::{AppHandle, Runtime}`, `bridge_events` macro       |

### Verification

```bash
cargo check --manifest-path src-tauri/Cargo.toml
# Verify no frontend callers (already confirmed):
grep -r "greet\|startBackendProgress\|backend-notification\|backend-progress" src-react/  # expect: no results
```

---

## Phase 3: Deprecated Code Cleanup

**Risk: Medium** — Safe removals require caller migration. Items with active callers are explicitly SKIPPED.

### Safe Removals

| #   | Action           | File                                 | Change                                           | Pre-check Result                                                                                                                    |
| --- | ---------------- | ------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | REMOVE           | `src-ts/src/db/schema/base.ts:68-72` | Delete deprecated `now()` function and its JSDoc | Zero callers confirmed. All code uses `now()` from `core/utils/time`.                                                               |
| 3.2 | MIGRATE + REMOVE | `src-ts/shared/sdk/index.ts:20-89`   | Remove `CoreSDK` wrapper object                  | 1 caller: `src-react/src/stores/app-store.ts`. Migrate to use generated functions (`listWorkspaces`, `healthCheck`, etc.) directly. |

#### 3.2 Migration Detail: CoreSDK → Generated Functions

**File to modify**: `src-react/src/stores/app-store.ts`

Replace:

```typescript
import { CoreSDK } from "@shared/sdk";
// ... CoreSDK.health(), CoreSDK.workspaces.list(), etc.
```

With direct imports from generated SDK:

```typescript
import { healthCheck } from "@shared/sdk/generated/health/health";
import { listWorkspaces } from "@shared/sdk/generated/workspaces/workspaces";
// ... use functions directly
```

Then remove the `CoreSDK` const and its imports from `src-ts/shared/sdk/index.ts` (lines 20-89).

### Deferred Items (SKIP — Active Callers)

| #   | Item                                       | File                                                        | Active Callers                                                                                            | Required Migration (Out of Scope)                                              |
| --- | ------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 3.3 | `isPinned` column                          | `src-ts/src/db/schema/chat.ts:41`                           | 7 files: chat-service, chat-manager, chat-mapper, chat repo, list-chats tool + test                       | Data migration from `isPinned` to `favorite` table rows + update all 7 callers |
| 3.4 | `fileReferenceId` field                    | `src-ts/src/db/schema/message.ts:123`                       | stream-service.ts:1300 (writes), chat-mapper.ts:207-208 (reads as fallback)                               | Migrate stream-service to use `fileId`, remove fallback in chat-mapper         |
| 3.5 | `chatToChat()` method                      | `src-ts/src/domain/mappers/chat-mapper.ts:82`               | Called by `chatToChatWithMessages()` (L142), list mapping (L256)                                          | Inline into callers or remove deprecation annotation                           |
| 3.6 | `EDIT_CONTENT_TOOL` const                  | `src-ts/src/domain/services/tools/edit-content-tool.ts:163` | stream-service.ts (L991, L992, L996, L998)                                                                | Migrate stream-service to use `editContentToolSpec`                            |
| 3.7 | `ProjectMetadata` interface                | `src-ts/shared/types/project.types.ts:76`                   | DB schema project.ts (L5, L12, L38), ProjectRecord, CreateProjectInput, UpdateProjectInput, generated SDK | Remove `@deprecated` annotation (it's actively used, annotation is misleading) |
| 3.8 | Legacy task types `"chat"`, `"completion"` | `src-ts/src/db/schema/task.ts:53-54`                        | Schema enum only, but existing DB rows may reference them                                                 | Keep in enum for backward compat; optionally add comment noting they're dead   |

### Verification

```bash
cd src-ts && npx tsc --noEmit
npx tsc -p src-react/tsconfig.json --noEmit
npm run test:ts
npm run test:react
```

---

## Phase 4: Commented-Out Code Cleanup

**Risk: Low** — Removing dead comments only. No behavioral changes. Project infrastructure (DB tables, API endpoints, component files) preserved.

### React Frontend — Disabled Projects Feature Comments

| #   | File                                                                 | Lines     | What to Remove                                                                            | What to Keep                                                                      |
| --- | -------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 4.1 | `src-react/src/layout/ScreenRouter.tsx:9`                            | 1 line    | `// import { ProjectScreen } from "@/screens/ProjectScreen";`                             | The `"project"` case in switch (renders HomeScreen — this is the active behavior) |
| 4.2 | `src-react/src/screens/HomeScreen.tsx:9-20`                          | ~12 lines | Commented imports (`ProjectCreateDialog`) and commented hooks (`useProjects`, navigation) | All active code                                                                   |
| 4.3 | `src-react/src/screens/ChatScreen.tsx:76`                            | 1 line    | Commented project lookup logic                                                            | `projectId` set to `null` (this is the active behavior)                           |
| 4.4 | `src-react/src/components/ChatInterface/components/ProjectBadge.tsx` | ~50 lines | Commented imports (L3-7) and commented implementation block (L17-54)                      | Keep the file, keep `export function ProjectBadge() { return null; }`             |

### Backend — Disabled Engine Export

| #   | File                                                    | Lines  | What to Remove                                        |
| --- | ------------------------------------------------------- | ------ | ----------------------------------------------------- |
| 4.5 | `src-ts/src/infrastructure/ai-providers/engines/mod.ts` | 1 line | Commented `// export { LocalEngine } from './local';` |

### What NOT to Delete

These items belong to the disabled Projects feature but are infrastructure used elsewhere or needed for re-enablement:

- `src-react/src/screens/ProjectScreen.tsx` — Keep file (will be re-enabled)
- `src-react/src/screens/ProjectScreen.test.tsx` — Keep test
- `src-react/src/components/sidebar/ProjectsSection.tsx` — Keep
- `src-ts/src/db/schema/project.ts` — Keep (DB table, used by designs)
- `src-ts/src/db/repositories/project.ts` — Keep
- `src-ts/src/transport/controllers/project-controller.ts` — Keep (API endpoints)
- All project-related API endpoints — Keep
- `src-react/src/hooks/useProjects.ts` — Keep
- `src-react/src/lib/api/project-api.ts` — Keep

### Verification

```bash
npm run test:react
npx tsc -p src-react/tsconfig.json --noEmit
cd src-ts && npx tsc --noEmit
```

---

## Summary

| Phase              | Items                           | Risk   | Est. Files Changed                           |
| ------------------ | ------------------------------- | ------ | -------------------------------------------- |
| 1. Legacy Naming   | 14 actions                      | Low    | ~10 Rust files + 2 test files + 2 lock files |
| 2. Dead Demo Code  | 12 actions                      | Low    | 2 Rust files                                 |
| 3. Deprecated Code | 2 removals + 6 documented skips | Medium | 2-3 TS files                                 |
| 4. Commented Code  | 5 cleanups                      | Low    | 5 files (4 React + 1 TS)                     |
| **Total**          | **33 actions**                  |        | **~22 files**                                |

### End-to-End Verification (After All Phases)

```bash
# Rust
cargo check --manifest-path src-tauri/Cargo.toml

# TypeScript
cd src-ts && npx tsc --noEmit
npx tsc -p src-react/tsconfig.json --noEmit

# Tests
npm run test:ts
npm run test:react

# Runtime
npm run dev    # Verify app starts in browser at :1420

# E2E
npx playwright test
```
