# P103 — Designer crash-durable edit recovery (OPENPCB-103) + H07 remaining coordinator gaps (OPENPCB-55)

Status: design rev 2 (adversarial review addressed — see §10), ready for implementation.
Repo: `/Users/andrejvysny/workspace/openpcb/OpenPCB` (designed at 839365e, re-verified at master @ d5547f9;
the intervening commits touch only keyboard/tooltip/assistant-fixture files, none are P103 inputs).
No `../shared` package changes; no re-pin required (see §3.10).

Binding user decisions applied (Designer-P0):
- Journal write failure **blocks** the edit (it is not sent). Includes a missing native bridge in the native app (§3.4.2).
- Separate journal namespace `designer-recovery-<dbhash>`; Docs dir `knowledge-drafts-<dbhash>` untouched.
- Retry of an acknowledgement-unknown write **reuses the original commandId** (and the exact original envelope).
- Lookup route `GET /designs/:designId/commands/:commandId` verifies design + session match.

---

## 1. Scope & acceptance mapping

### OPENPCB-103 acceptance → design element

| # | Acceptance criterion | Design element |
|---|---|---|
| 103-1 | Exercise delayed/reordered writes, 409, 4xx/5xx, socket loss before/after commit, double activation, design switch; distinguish pending/failed/conflicted/ack-unknown; never "Saved" before ack | §3.3 queue state `unknown` + synchronous slot reservation; §3.5 classification (transport/5xx → unknown, 4xx → failed, REVISION_CONFLICT → conflicted); §3.6 `dispatchOnce`; per-design lanes. Tests: S3, S5, S8 unit; S10 native |
| 103-2 | After durable ack, kill/restart native app, recover intent with no automatic mutation; explicit retry applies at most once using authoritative evidence; ambiguous non-idempotent writes never blindly replayed | §3.4 two-phase journal (queued → sending) before send; §3.7 hydrate (reads only + cleanup of lookup-proven commits); §3.8 classification; retry = exact original envelope (PK-guarded at-most-once, §3.2); history retry guarded by `expectedRevision`; BOM retry guarded by `expectedPartId`; autolayout retry replays via command log (§3.2.5); never-sent records only via reviewed apply |
| 103-3 | Storage failure, unreadable/future records, stale base revision; preserve unknown records; recover/export/discard; no overwrite of newer work; document pre-ack/power-loss boundary | §3.4 failure policy (block, incl. missing bridge); serialized CAS per record with exact-attempt retry; decode → `unsupported`/`unreadable` never auto-deleted; compat stamp (§3.4.1) → `incompatible`; BOM binding guard; rules dialog explicit base; §3.9 Export/Discard; §6 boundary text |
| 103-4 | Regression tests: persisted model, command count, history, native failure/restart evidence; reuse Docs storage contract with Docs regression; H46 separate | §3.1 reuse `AtomicRecordStore` + `DraftJournal` interface unchanged; S1 IPC test proves Docs dir/keys unchanged; Docs e2e re-run; S10 asserts revision, history depth, command-log count |
| 103-5 | Completion record: repro, TID, regression cmd/result, impl SHA, hashes, native evidence path | S11 (user-gated): `docs/qa/2026-10-hardening/evidence/designer-command-recovery.json`; Plane comment drafted, saved only on approval |

### OPENPCB-55 (H07) remaining gaps → design element

| Gap (audit) | Design element |
|---|---|
| Design-rules/net-class save bypasses coordinator (`use-pcb-design-rules-dialog.tsx:59-90`) | §3.6.1 hook takes `dispatch` from workspace with **explicit open-time base** and `retainPolicy:"unknown-only"`; S7 |
| BOM override PATCH unversioned side channel (`api.ts:412-429`) | §3.6.2 BOM sideband through the lane + journal + server `expectedPartId` binding guard; S2/S5/S7 |
| Autolayout/autoroute/autoplace apply mutate outside the queue | §3.6.3 `runExclusive` lane barrier + §3.2.5 real server-side replay for `/autolayout/apply`; S2/S5/S7 |
| Missing regressions: two inspectors, delete→undo→redo delayed, double-click, reordered responses | S8 |
| History `expectedRevision` optional for HTTP | §3.2.3 HTTP routes require it (400 otherwise); SDK stays optional, documented; S2 |
| H05 renderer / packaged evidence / T-134/T-200 reconciliation | Out of code scope; S11 user-gated; depends OPENPCB-100/101 |

### Non-goals
- Selective undo / merging across sessions. BOM override undo history and multi-writer CAS (H23).
- Power-loss qualification (`F_FULLFSYNC`) — stated as an unqualified boundary (§6). "Mark acked, GC later" deferred (§10 rejected/deferred).
- Journalling `pcb_set_view_state` (display-only, H20) — lost on crash by design; deferred (not retained) while a lane is blocked (§3.6.4).
- Packaged-build qualification (needs OPENPCB-100/101 and a `shared/` publish by the user).
- DB-restore lineage detection inside P103 — handled as an H46 constraint (§8).

---

## 2. Current state (verified file:line facts)

Queue / coordinator
- `src/shared/frontend/commands/revision-command-queue.ts`: states `pending|acknowledged|conflicted|cancelled|failed`; `:61-67` `observe` only advances an **idle** lane (`!lane.pending`); `:111-135` `enqueue` increments `pending` **synchronously** and always mints `crypto.randomUUID()`; `:147` `cancelled = lane.blocked && !reviewed` evaluated at execution start; `:154-155` ack sets `lane.revision = result.revision` (non-monotonic); `:164-168` every non-conflict error → `failed`; `:102` reapply refused for `failed`; `:56-60` `hasUnsettledEdits`.
- `src/modules/designer/frontend/lib/command-coordinator.ts:10-12` `DesignerAction = command | undo | redo`; `:73-104` sender computes `baseRevision` lazily (`getSchematicProjection` when lane revision null); `:92-100` net-merge confirm re-sends with a **fresh** commandId + `confirmMerge:true`; `:106-117` `reject`; `:119-154` history coalescing; `:157-180` `getDesignerCommandCoordinator(api, scope?)` — **unscoped call creates a new coordinator every time** and registers no `beforeunload`.
- `useDesignerWorkspace.ts:157-166` scope = `${backendURL}/api/modules/${moduleId}` or `undefined` when no backendURL; `:286`, `:624-626` `queue.observe` (projection load + `notifyExternalRevisionBump`); `Space.tsx:1162-1163` assistant-change notification → `notifyExternalRevisionBump`; `usePcbWorkspace.ts:144` PCB refresh → same.
- `docs/designer/command-ordering.md:7` "An external revision observation never silently rebases an in-flight queue."
- `components/CommandQueueNotice.tsx:50` reapply only `state!=="failed" && kind==="command"`; rendered `Space.tsx:1344-1350`.
- `pcb/pcb-view-store.ts:179,269` `pcb_set_view_state` goes through the workspace dispatcher (lane); results ignored, errors swallowed (`:186-191`, `:250`).

Journal
- `electron/src/main/draft-journal-ipc.ts:9-50` channels `draft-journal:{read,write,remove,list}`, frame check `:16-23` against `allowedUrl` (= `isAllowedAppUrl`, `index.ts:112`), dir `knowledge-drafts-<sha256(realpath(db))>`; registered `index.ts:61` (before `rendererTrust` at `:309`).
- Existing trust helper: `electron/src/main/credential-ipc.ts:12-43` `CredentialSender`/`CredentialTrust`/`CredentialIpcRegistrar`/`requireTrustedCredentialSender` (main contents, not destroyed, main frame, origin == `trust.rendererOrigin()`); used by `local-api-ipc.ts:1-25` with `rendererTrust` (`index.ts:309-312`).
- `electron/src/preload/index.ts:53-59` exposes `electronAPI.draftJournal` (preload is a separate tsup build ⇒ renderer/preload skew is possible); `vite-env.d.ts:40-41` typing; `getAppVersions?(): AppVersions{app,…}` (`vite-env.d.ts:25-33,55`).
- `src/core/backend/storage/atomic-record-store.ts`: per-key serialized CAS; `:180-184` **same token+value write is idempotent success**; `:186-191` stale `expectedToken` ⇒ "Record conflict"; `:205-221` `publish` = tmp(`<file>.<uuid>.tmp`)+fsync+rename+**dir fsync** — a throw after rename leaves the new token on disk; SIGKILL leaves `.tmp` behind; `:224-236` remove of an absent record returns `false` (idempotent); `:239-259` `list()` counts **every non-`.json` file** as unreadable.
- `knowledge/frontend/lib/page-draft-journal.ts:17,120-151` keeps the exact failed CAS attempt and retries it unchanged.

Backend
- `designer_command_log` (`0002…sql:84-94`): `command_id PK, design_id, session_id, command_type, command_json, result_json, issued_at, applied_revision, created_at`; `0020_operation_receipts.sql` adds identity columns. Last designer migration: `0020_operation_receipts.sql`.
- `store.ts:752-766` `replay(row)`: UI rows compare design/session/type/`JSON.stringify(command)`; returns `parseDispatchResultJson(result_json) ?? conflict(base, appliedRevision)` — **an unparseable logged result replays as REVISION_CONFLICT with actual ≥ 0** (looks like a normal conflict ⇒ invites a fresh-id reapply of an already-applied command). `:812-818` in-tx re-check; `:820-875` conflicts and missing-design results are logged; `:1088-1090` `afterCommandCommit` hook fires after commit **inside the try**; `:1119-1146` catch → `racedLog` ⇒ `replay` ⇒ a throwing hook still yields a normal 200 (no unknown outcome is produced server-side).
- `results.ts:11-~140` `parseDispatchResultJson` whitelist **lacks** `INVALID_PCB_FREE_HOLE`, `PCB_FREE_HOLE_NOT_FOUND`, `INVALID_PCB_FREE_PAD`, `PCB_FREE_PAD_NOT_FOUND`, `INVALID_PCB_OVERLAY`, `PCB_OVERLAY_NOT_FOUND` (built at `:296-318`, declared `types.ts:2519-2544`).
- `routes.ts:2834-2875` `parseCommand` whitelist drops unknown fields (client cannot reproduce `command_json` byte-for-byte; also: a newer-build command retried by an older build silently loses fields).
- `routes.ts:3664-3678` `POST /designs/:designId/commands` → 200 `{result}` (REVISION_CONFLICT is a 200 body).
- `routes.ts:523-544` `parseHistoryBody` `expectedRevision` optional; `:4024-4048` undo/redo. HTTP callers: `api.ts:594-632` (always sends), `designer-commands.test.ts:388-414` (omits), `electron-designer-hardening.spec.ts:415`.
- 404s: `@openpcb/contracts` `NotFoundError` always has type `https://openpcb.dev/problems/not-found`; unmatched routes (`http-router.ts:111,128`, `module-registry.ts:35`) and "Design not found" are **indistinguishable by type**.
- BOM: `routes.ts:3364-3377` PATCH `/designs/:designId/bom/refs/:refdes` → `store.updateBomOverride` (`store.ts:708-716`) → `bom-overrides.ts:42-104` resolves `partId` from **whichever part carries `refdes` now** (binding at write time). `parseBomOverridePatch` (`routes.ts:368`) reads named fields only (unknown keys ignored). `BomLineRef.partId` is available client-side (`types.ts:3152-3158`). Only writer: this route.
- Autolayout: `backend/autolayout/apply-candidate.ts:3-18` header promises "replay … BEFORE anything else", **not implemented**: `:87-108` re-fetches the candidate from the cloud and compares the board digest (`AUTO_LAYOUT_STALE`) before `:120-131` dispatching with `commandId = applyRequestId`. A retry after a lost-ack commit ⇒ STALE. Error codes in `autolayout/errors.ts:11-33`. Legacy `/autoroute/apply` (`routes.ts:3757-3826`) and `/autoplace/apply` (`:3890`) dispatch one envelope per op, `baseRevision:null`, random ids (not idempotent).
- Frontend apply sites: `useAutoLayoutJob.ts:206-237` (comment "stable per attempt" but mints a fresh `applyRequestId` per call), `PcbCanvas.tsx:901`, `PcbAutorouteDialog.tsx:219`, `PcbCanvas.tsx:6348` `onApplied → refresh → observe`.
- Rules dialog: `pcb/use-pcb-design-rules-dialog.tsx:59-90` own `createDesignerApi`, `baseRevision = projection?.revision ?? fallbackRevision` (the revision the dialog **rendered**), full-replace `pcb_set_design_rules`; callers `PcbCanvas.tsx:5607` (`designer-pcb-session`) and `DesignerDrcView.tsx:26,188` (`designer-drc-session`).
- BOM view: `DesignerBomView.tsx:230-257` direct `api.updateBomOverride` loops.
- `api.ts:86-103` `fetchData` throws plain `Error` (status lost; fetch `TypeError` raw); no timeout.
- Assistant writes under `designer-ui-session` (`assistant/backend/tools/designer-tools.ts:32`) — the same session as UI schematic edits.
- `src/modules/designer/AGENTS.md:41` says duplicate commandId is "rejected" — wrong (replayed).
- Test infra: `npm run test:backend` = `npm run test --workspace src/core/backend --` (cwd `src/core/backend`, paths are `tests/<file>`); helpers `tests/helpers/designer-runtime.ts`; fault hook `createDesignerStore(ctx, { afterCommandCommit })`; Electron unit tests `bun test electron/tests`; Playwright desktop regexes `playwright.config.ts:36-38`.

---

## 3. Design

### 3.0 Layering
- `electron/` — namespaced record-journal IPC (main) + preload bridge.
- `src/core/contracts/app/draft-journal.ts` — unchanged interface; doc comment notes two namespaces.
- `src/shared/frontend/storage/native-record-journal.ts` (new) — bridge accessor shared by knowledge + designer.
- `src/shared/frontend/commands/revision-command-queue.ts` — generic queue semantics only.
- `src/sdks/designer/types.ts` — lookup/head/compat DTO types only (no `DesignerSDK` method).
- `src/modules/designer/backend/*` — store methods, routes, autolayout replay, BOM guard.
- `src/modules/designer/frontend/lib/*` — record schema, journal wrapper, classifier, request errors, coordinator.
- No `src/core/backend/*` import from modules. No `../shared` package edits.

### 3.1 Electron namespaced journal

New `electron/src/main/record-journal-ipc.ts`:

```ts
import type { CredentialIpcRegistrar, CredentialSender, CredentialTrust } from "./credential-ipc.js";

export interface RecordJournalNamespace {
  readonly channel: "draft-journal" | "designer-recovery-journal";
  readonly directoryPrefix: "knowledge-drafts" | "designer-recovery";
  readonly unavailableMessage: string;          // Docs keeps "Draft journal unavailable to this frame"
  readonly sweepStaleTemporaries: boolean;      // Docs false (binding: Docs behaviour unchanged), designer true
}
export const DOCS_DRAFT_JOURNAL: RecordJournalNamespace;
export const DESIGNER_RECOVERY_JOURNAL: RecordJournalNamespace;

export interface RecordJournalDeps {
  ipc: CredentialIpcRegistrar;                  // ipcMain in production, fake in tests
  trust: CredentialTrust;                       // rendererTrust (index.ts:309)
  backendReady(): boolean;                      // !!getBackendPayload()
  env(): { root?: string; dbPath?: string };    // APP_DATA_DIR / OPENPCB_DB_PATH
  realpath(path: string): string;
  createStore(directory: string): AtomicRecordStore;
  sweep?(directory: string): Promise<number>;   // deletes `*.json.*.tmp`; returns count
}
/** Pure; exported for tests. `${root}/${prefix}-${sha256(realpath(dbPath))}` */
export function journalDirectory(root: string, dbRealPath: string, ns: RecordJournalNamespace): string;
export function registerRecordJournalIpc(deps: RecordJournalDeps, ns: RecordJournalNamespace): void;
```
- Authorization **reuses** `requireTrustedCredentialSender(event, deps.trust)` plus `deps.backendReady()`; any failure throws `Error(ns.unavailableMessage)` (no `CredentialError` leaks to the Docs UI). This replaces the hand-rolled frame check. Trust delta for Docs: `isAllowedAppUrl` accepted {backend url, dev 1420}; `rendererTrust` accepts exactly the renderer origin (packaged: backend url; dev: 1420) — identical for every real renderer load; covered by the Docs native regression (S10 case 10).
- One cached `AtomicRecordStore` per namespace per DB scope (as today). On first store creation for a namespace with `sweepStaleTemporaries`, `await deps.sweep(dir)` **before** the store is used: the app holds the single-instance lock, so any `*.json.<uuid>.tmp` at open is from a killed process (finding 13). Docs keeps today's behaviour (follow-up suggested, §9).
- `draft-journal-ipc.ts` → `registerDraftJournalIpc(deps) { registerRecordJournalIpc(deps, DOCS_DRAFT_JOURNAL) }`. `index.ts`: move both registrations after `rendererTrust` (`:309`), passing `{ ipc: ipcMain, trust: rendererTrust, backendReady, env, realpath: realpathSync, createStore, sweep }`.
- Preload (`:53-59`) add sibling `designerRecoveryJournal: { read, write, remove, list } satisfies DraftJournal` on `designer-recovery-journal:*`.
- `vite-env.d.ts` add `designerRecoveryJournal?: DraftJournal`.
- New `src/shared/frontend/storage/native-record-journal.ts`:
  ```ts
  export type NativeRecordJournalName = "draftJournal" | "designerRecoveryJournal";
  export type NativeJournalAvailability =
    | { kind: "native"; journal: DraftJournal }
    | { kind: "browser" }                       // no window.electronAPI at all
    | { kind: "missing-bridge" };               // electronAPI present, bridge absent/invalid (preload skew)
  export function isDraftJournal(value: unknown): value is DraftJournal; // moved from knowledge
  export function nativeRecordJournal(name: NativeRecordJournalName): NativeJournalAvailability;
  ```
  `knowledge/frontend/lib/native-draft-journal.ts` keeps its current signature (`DraftJournal | undefined`; maps `missing-bridge` → `undefined`, unchanged Docs behaviour).

### 3.2 Backend

#### 3.2.1 Types (`src/sdks/designer/types.ts`, after `DesignerOperationReceiptLookup`)
```ts
/** UI command lookup over designer_command_log (OPENPCB-103). */
export type DesignerCommandLookup =
  | { status: "missing"; headRevision: number }
  | { status: "mismatch" } // id belongs to another design/session/type or an operation identity
  | { status: "found"; commandType: string; appliedRevision: number; committedAt: string;
      headRevision: number; result: DesignerDispatchResult }
  | { status: "found-unparsed"; commandType: string; appliedRevision: number; committedAt: string;
      headRevision: number; rawOk: boolean; rawCode: string | null }; // logged, but this build cannot rebuild it
export interface DesignerRecoveryHead { headRevision: number; refdesPartId?: string | null }
export interface DesignerRecoveryCompat { schemaHead: string; commandEpoch: number }
```

#### 3.2.2 Results parser hardening (`results.ts`, finding 10)
- Rewrite `parseDispatchResultJson`'s `ok:false` branch as an exhaustive table `const FAILURE_PARSERS: { [C in DesignerDispatchFailureCode]: (rec) => DesignerDispatchResult | null }` (where `DesignerDispatchFailureCode = Extract<DesignerDispatchResult, {ok:false}>["code"]`) — adding a result code without a parser fails typecheck. Adds the six missing codes.
- `replay(row)` fallback (`store.ts:765`): unparseable `ok:true` ⇒ `{ ok:true, revision: row.appliedRevision, createdEntityId:null, idempotent:true }`; unparseable `ok:false` ⇒ `conflict(base, -1)` (classified "rejected / not applied", never a reapply-able conflict). Never `conflict(base, appliedRevision)`.
- Export `inspectLoggedResult(json): { rawOk: boolean | null; rawCode: string | null }` for the lookup.

#### 3.2.3 Store (`store.ts`; interface `DesignerStore` at :206)
```ts
lookupCommand(designId, commandId, sessionId, commandType): Promise<DesignerCommandLookup | null>;
getRecoveryHead(designId, refdes?: string): Promise<DesignerRecoveryHead | null>;
/** internal (not on the SDK): raw UI log row for autolayout replay */
getLoggedUiCommand(commandId): { designId; sessionId; commandType; command: unknown; resultJson: string; appliedRevision: number } | null;
updateBomOverride(designId, refdes, patch, expectedPartId?: string | null): Promise<BomOverride | null | "binding-changed">;
```
`lookupCommand` (synchronous drizzle calls, no `await` between reads): head null ⇒ `null`; no row ⇒ `missing`; identity row or design/session/type differ ⇒ `mismatch`; parse ok ⇒ `found`; parse null ⇒ `found-unparsed` with `inspectLoggedResult` (never `mismatch`).
`updateBomOverride`: when `expectedPartId !== undefined`, resolve `partId` exactly as `upsertBomOverride` does **in the same synchronous call**; differs ⇒ return `"binding-changed"` with no write.

Payload hash: dropped (server whitelist normalization; design+session+type + PK-guarded replay, which also compares `command_json`, suffice). Recorded deviation.

#### 3.2.4 Routes (`routes.ts`)
- `GET /designs/:designId/commands/:commandId?sessionId=&commandType=` (registered after :3664). Validation 1..128 chars ⇒ `ValidationError`. `null` ⇒ `DesignNotFoundError`.
- `GET /designs/:designId/recovery-head[?refdes=]` ⇒ `{ head: DesignerRecoveryHead }` (`refdesPartId` present iff `refdes` given; `null` = no schematic part carries it). `null` ⇒ `DesignNotFoundError`.
- `GET /recovery/compat` ⇒ `{ compat: { schemaHead: DESIGNER_SCHEMA_HEAD, commandEpoch: DESIGNER_COMMAND_EPOCH } }` from new `backend/recovery-compat.ts` (`DESIGNER_SCHEMA_HEAD = "0020_operation_receipts"`, `DESIGNER_COMMAND_EPOCH = 1`). A Bun test asserts `DESIGNER_SCHEMA_HEAD` equals the lexicographically last `backend/migrations/*.sql` basename, so every migration forces a bump.
- `DesignNotFoundError` (module-local): `AppError("Design '<id>' not found", 404, "Design Not Found", "https://openpcb.dev/problems/designer/design-not-found")` — the **only** 404 the client treats as `orphaned` (finding 14). Used by the three recovery routes only.
- `parseHistoryBody`: `expectedRevision` **required** (`ValidationError`). SDK `undo/redo(expectedRevision?)` stay optional for in-process callers; JSDoc on `DesignerSDK.undo/redo` (`src/sdks/designer/index.ts:324-333`).
- BOM PATCH: route additionally reads optional top-level `expectedPartId: string | null` (absent = legacy). `"binding-changed"` ⇒ `AppError("Reference '<refdes>' now refers to a different part", 409, "BOM Binding Changed", "https://openpcb.dev/problems/designer/bom-binding-changed")`. Older backends ignore the key (rollback-safe).

#### 3.2.5 Autolayout apply replay (`autolayout/apply-candidate.ts`, finding 1)
New **step 0** before `getLayoutResult`:
```ts
const prior = deps.findPriorApply(request.applyRequestId); // store.getLoggedUiCommand
```
- `prior` exists but design/session/type `pcb_apply_autolayout_candidate`/`jobId`/`candidateId`/`snapshotDigest` differ ⇒ `AutoLayoutError("AUTO_LAYOUT_REQUEST_CONFLICT", …)` (new code in `errors.ts` union + 409 mapping).
- logged ok (parsed, or unparsed `rawOk`) ⇒ return `{ applied:true, revision: appliedRevision, jobId, candidateId, placementOperationCount, routeOperationCount (from the logged command arrays), drc: null, warnings: [], replayed: true }` — no cloud fetch, no digest check, no dispatch, no DRC run. `ApplyCandidateResult` gains `replayed?: true`.
- logged ok:false ⇒ same mapping as today's non-ok branch (`:131+`).
- Header comment kept accurate. The frontend shows "Already applied (response was lost)"; DRC null already renders "not checked".

#### 3.2.6 Docs fix
`src/modules/designer/AGENTS.md:41` → "Command log provides idempotency: a duplicate `commandId` replays the logged result (success, rejection or conflict) without re-executing; a different payload under the same id returns `REVISION_CONFLICT`."

### 3.3 Generic queue changes (`revision-command-queue.ts`)

```ts
export type CommandState = "pending" | "acknowledged" | "conflicted" | "cancelled" | "failed" | "unknown";
export type RetainedState = "conflicted" | "cancelled" | "failed" | "unknown";
export interface RetainedCommand<T> {
  id: string;            // stable retained id (= recordId for designer)
  commandId: string;     // id a same-id retry must reuse (last attempt actually sent)
  input: T;
  state: RetainedState;
  message: string;
  origin: "session" | "recovered";
  attempt?: unknown;     // opaque exact sent envelope (commandId/baseRevision/issuedAt…) kept in memory (finding 19)
}
export interface QueueAck { revision: number | null }
export type QueueExecute<T, R> =
  (input: T, revision: number | null, commandId: string, attempt?: unknown) => Promise<R>;
export type RetainPolicy = "all" | "unknown-only";
export interface SubmitOptions { commandId?: string; retainPolicy?: RetainPolicy }
export interface QueueOptions { gate?: () => Promise<void>; defaultUnclassified?: "failed" | "unknown" }

export class RevisionConflictError extends Error {}       // → conflicted
export class CommandDeclinedError extends Error {}        // → not retained (unchanged)
export class CommandRejectedError extends Error {}        // → failed (server definitively did not apply)
export class CommandNotSentError extends Error {}         // → cancelled (definitively not sent)
export class AcknowledgementUnknownError extends Error {} // → unknown
export class LaneBlockedError extends Error {}            // exclusive refused; nothing retained
```
- **Slot reservation stays synchronous** (finding 3): `submit`/`exclusive` increment `pending` and chain on `tail` in the calling tick — before any `await` in the caller — so `observe` cannot move `lane.revision` while an edit is being journaled or while hydrate runs, `isSettled` is false and "Saving…" shows immediately.
- `execute` first `await options.gate?.()` (designer: `coordinator.ready`), **then** evaluates `cancelled = lane.blocked && !reviewed` (so records adopted by hydrate block edits that were queued before hydrate finished).
- Error → state (in order): blocked&!reviewed ⇒ `cancelled`; `CommandDeclinedError` ⇒ not retained; `RevisionConflictError` ⇒ `conflicted`; `CommandRejectedError` ⇒ `failed`; `CommandNotSentError` ⇒ `cancelled`; `AcknowledgementUnknownError` ⇒ `unknown`; anything else ⇒ `options.defaultUnclassified` (**`"failed"` in S3** — today's behaviour; the designer coordinator sets `"unknown"` in S5 together with `fetchData` classification, finding 24).
- `retainPolicy:"unknown-only"` (form surfaces, finding 9): `conflicted|failed|cancelled(not-sent)` outcomes are **not retained** and do not block; the lane state reverts like `CommandDeclinedError`; the error is rethrown to the caller. `unknown` is always retained (it may have applied). A lane-blocked cancellation is also not retained under this policy (the form still holds the values) — the caller gets `LaneBlockedError`.
- Retained `commandId = error.attemptCommandId ?? id`; `attempt = error.attempt` (coordinator attaches both).
- Methods (all `emit()` after mutation):
```ts
submit<R extends QueueAck>(aggregateId, input, execute, options?: SubmitOptions): Promise<R>;
reapply<R extends QueueAck>(aggregateId, retainedId, execute): Promise<R>;      // conflicted|cancelled only; fresh id
retrySameId<R extends QueueAck>(aggregateId, retainedId, execute): Promise<R>;  // unknown only; commandId + attempt reused
retain(aggregateId, input, state: "cancelled", message, extra?: Partial<RetainedCommand<T>>): string;
adopt(aggregateId, items: RetainedCommand<T>[]): void;      // blocked = retained.length > 0
resolveRetained(aggregateId, retainedId,
  r: { state: "acknowledged"; revision: number } | { state: "conflicted" | "failed"; message: string }): void;
removeRetained(aggregateId, retainedId): void;              // throws if pending
exclusive<R extends QueueAck>(aggregateId, run: (revision: number | null) => Promise<R>): Promise<R>;
isBlocked(aggregateId): boolean;
aggregates(): string[];
```
- Ack revision rule: `lane.revision = r === null ? lane.revision : (lane.revision === null ? r : Math.max(lane.revision, r))`.
- `exclusive`: as submit (pending, tail); after gate, blocked ⇒ `LaneBlockedError`; success ⇒ `lane.revision = result.revision` exactly (may be null); throw ⇒ `lane.revision = null`, rethrow, not retained.

### 3.4 Designer recovery journal

#### 3.4.1 Record schema (`frontend/lib/designer-recovery-record.ts`, new)
```ts
export const DESIGNER_RECOVERY_SCHEMA = "openpcb.designer-recovery";
export const DESIGNER_RECOVERY_VERSION = 1;
/** Client record-format epoch; extra guard alongside the server compat stamp. */
export const DESIGNER_RECOVERY_EPOCH = 1;

export interface RecoveryCompat {
  schemaHead: string | null;  // from GET /recovery/compat (null ⇒ unknown ⇒ review-only on recovery)
  commandEpoch: number | null;
  recordEpoch: number;        // DESIGNER_RECOVERY_EPOCH
  appVersion: string | null;  // electronAPI.getAppVersions().app
}
export interface SentCommand { commandId: string; baseRevision: number; issuedAt: number }

export type RecoveredAction =
  | { kind: "command"; sessionId: string; command: DesignerCommand; sent?: SentCommand }
  | { kind: "undo" | "redo"; sessionId: string; expectedRevision?: number }
  | { kind: "bom_override"; refdes: string; patch: BomOverridePatch;
      partId: string | null;          // resolved from the BOM projection at enqueue (BomLineRef.partId)
      observedHead?: number };        // lane/head revision at send

export interface DesignerRecoveryRecordV1 {
  schema: typeof DESIGNER_RECOVERY_SCHEMA;
  version: 1;
  compat: RecoveryCompat;
  recordId: string;          // UUID; stable across same-id retry, net-merge re-send and fresh-id reapply
  designId: string;
  createdAt: string;         // ISO UTC, informational only
  seq: number;               // journal-global monotonic: max(seq of loaded records)+1, then +1 per record (finding 18)
  phase: "queued" | "sending";
  action: RecoveredAction;
  lastKnown: { state: "queued" | "sending" | "unknown" | "conflicted" | "failed" | "cancelled"; message?: string; at: string };
}
export const recoveryKey = (designId: string, recordId: string) => `v1/${designId}/${recordId}`;
export function encodeRecord(r: DesignerRecoveryRecordV1): string;
export type DecodedRecord =
  | { ok: true; record: DesignerRecoveryRecordV1 }
  | { ok: false; reason: "malformed" | "future-version" | "key-mismatch" };
export function decodeRecord(key: string, value: string): DecodedRecord;
```
`decodeRecord` (finding 2): JSON object; schema; `version > 1` ⇒ `future-version`; other ⇒ `malformed`; `recordId/designId` 1..128; key match else `key-mismatch`; `phase`/`action.kind` enums; `seq` safe int ≥ 0; `compat` shape. **Phase-conditional ids**: `phase==="queued"` ⇒ `sent`/`expectedRevision`/`observedHead` must be **absent**; `phase==="sending"` ⇒ command `sent` required (`commandId` 1..128, `baseRevision` safe int ≥ 0, `issuedAt` finite), history `expectedRevision` required, bom `observedHead` required. Any top-level/`action`/`sent`/`compat` key outside the v1 set ⇒ `malformed` (newer-build records are preserved, never re-encoded). Never include HTTP headers / bearer.

#### 3.4.2 Journal wrapper (`frontend/lib/designer-recovery-journal.ts`, new)
```ts
export type JournalStatus = "durable" | "volatile" | "error";
export interface JournalHandle { readonly key: string; readonly recordId: string; record: DesignerRecoveryRecordV1 }
export interface LoadedJournal {
  records: JournalHandle[];   // sorted by (seq, key)
  unsupported: Array<{ key: string; token: string; raw: string | null; reason: string }>;
  unreadableCount: number;
  maxSeq: number;
}
export class DesignerRecoveryJournal {
  constructor(availability: NativeJournalAvailability, opts?: { now?: () => Date; onChange?: () => void });
  status: JournalStatus;      // browser ⇒ volatile; missing-bridge ⇒ error (finding 12); native ⇒ durable
  error: string | null;
  prepare(designId: string, action: RecoveredAction, compat: RecoveryCompat): Promise<JournalHandle>;
  markSending(handle: JournalHandle, action: RecoveredAction): Promise<void>;
  note(handle: JournalHandle, lastKnown: DesignerRecoveryRecordV1["lastKnown"]): void;   // coalesced, best effort
  settle(handle: JournalHandle): Promise<void>;
  removeUnsupported(key: string, token: string): Promise<void>;
  load(): Promise<LoadedJournal>;
  probe(): Promise<void>;     // write+remove `v1/_probe/<uuid>`
}
```
- **Per-record serialization** (finding 6): each handle owns a private promise chain and the current `{ token }` plus an optional `pendingAttempt: { kind: "write"; input } | { kind: "remove"; input }`. Every operation for a recordId runs on that chain. Before running a new op, a retained `pendingAttempt` is retried **unchanged** (same token + value ⇒ the store accepts it idempotently, `atomic-record-store.ts:180-184`; remove of an absent record succeeds) — this also covers "renamed then dir-fsync threw". Ack check as `PageDraftJournal` (`token` and `value` equal, else "acknowledgement mismatch"). `note` coalesces: only the latest `lastKnown` is written; a `markSending`/`settle` queued after it supersedes pending notes.
- Failure policy: `prepare`/`markSending` failure ⇒ `status = "error"`, `error = msg`, rethrow (caller blocks) — set on **any** such failure, not only `load()` (finding 4). `note` failure ⇒ `console.warn`, attempt kept; never blocks. `settle` failure ⇒ attempt kept; the item stays visible as "cleanup pending" (never claims removal).
- `missing-bridge` (native app, preload skew): `status="error"`, `error="Recovery journal bridge missing — restart OpenPCB"`; every edit is refused (`CommandNotSentError`) and retained in memory; close guard prompts. Volatile only when `window.electronAPI` is absent (browser dev / Vitest default).
- Volatile mode: methods resolve with in-memory handles, no IO; not blocked.
- `load()`: `list()`; non-`v1/` keys ⇒ `unsupported{raw:null,"unknown-key-schema"}`; `read` throw ⇒ `unreadableCount++`; decode failure ⇒ `unsupported{raw}`; `list()` throw ⇒ `status="error"`, rethrow.

#### 3.4.3 Write protocol per action (coordinator)
All public mutating methods are **synchronous up to `queue.submit`** (no `await` before it):
1. `prepared = this.prepareChain = this.prepareChain.then(async () => { await this.listed; await this.ensureCompat(); return journal.prepare(designId, action /*queued, no ids*/, compat); })` — call order = journal order across designs. `listed` = journal listed + `seq` base known (fast, local IO only); `ensureCompat` fetches `GET /recovery/compat` once (5 s timeout; failure ⇒ throws ⇒ prepare fails ⇒ blocked; 404 ⇒ stamp `null`s).
2. `queue.submit(designId, input, execute, opts)` in the same tick. `execute` (runs after gate + FIFO): `handle = await prepared` (failure ⇒ `CommandNotSentError("Not sent: recovery journal unavailable — <msg>")` — under policy `all` retained `cancelled` with `nonDurable: true`); compute base (explicit `opts.baseRevision` ?? lane revision ?? head read) / `expectedRevision` / `observedHead`; `await journal.markSending(handle, action+ids)` (failure ⇒ `CommandNotSentError`; record stays `queued` = truthful).
3. Network call (with the lane revision/attempt). Net-merge: `markSending` with the new commandId + `confirmMerge:true` before the second send; errors carry `attemptCommandId` and `attempt`.
4. Outcome: ok / declined merge ⇒ `settle` (background); retained outcomes ⇒ `note`; non-retained (form policy) definitive outcomes ⇒ `settle`.
5. Reapply (fresh id) / apply-reviewed: if the retained item has a handle ⇒ same record via `markSending` (one record per intent). If it has **no** record (failed prepare, finding 4) ⇒ `prepare` first, then `markSending`.
6. Same-id retry: requires a `sending` record (or in-memory `attempt` in volatile mode); resends `attempt` exactly; no new write.
7. `pcb_set_view_state`: not journaled (§3.6.4).

### 3.5 Request error classification

New `frontend/lib/request-errors.ts`:
```ts
export class DesignerTransportError extends Error {}  // fetch threw (TypeError/AbortError/timeout) or 2xx body unreadable
export class DesignerHttpError extends Error {
  constructor(message: string, readonly status: number, readonly problemType: string | null) {}
}
export const DESIGN_NOT_FOUND_TYPE = "https://openpcb.dev/problems/designer/design-not-found";
export const BOM_BINDING_CHANGED_TYPE = "https://openpcb.dev/problems/designer/bom-binding-changed";
```
`api.ts` `fetchData`: wrap `fetch` ⇒ `DesignerTransportError`; non-ok ⇒ `DesignerHttpError(problem.detail ?? problem.title ?? "HTTP <s>", status, problem.type ?? null)` (messages unchanged); 2xx parse failure / missing `data` ⇒ `DesignerTransportError`. Optional `init.signal`; recovery reads (`lookupCommand`, `getRecoveryHead`, `getRecoveryCompat`) pass `AbortSignal.timeout(5000)`.

Coordinator `classifySendFailure(error)` — only around the network call:

| Observation | Error | Queue state | Applied? |
|---|---|---|---|
| `DesignerTransportError` | `AcknowledgementUnknownError` | unknown | maybe |
| `DesignerHttpError` ≥ 500 | `AcknowledgementUnknownError` | unknown | maybe |
| `DesignerHttpError` 409 `BOM_BINDING_CHANGED_TYPE` | `RevisionConflictError` | conflicted | no |
| `DesignerHttpError` other 4xx | `CommandRejectedError` | failed | no |
| 200 `REVISION_CONFLICT actual ≥ 0` | `RevisionConflictError` | conflicted | no |
| 200 `REVISION_CONFLICT actual = -1` / other `ok:false` / `HISTORY_EMPTY` | `CommandRejectedError` | failed | no |
| 200 `NET_MERGE_REQUIRES_CONFIRM` | confirm flow | — | no |
| History `REVISION_CONFLICT` | `RevisionConflictError` | conflicted | no |

"Saved" is only ever derived from `acknowledged`.

### 3.6 Coordinator (`frontend/lib/command-coordinator.ts` + new `frontend/lib/coordinator-recovery.ts`)

```ts
export type DesignerAction =
  | { kind: "command"; command: DesignerCommand; sessionId: string; recordId?: string }
  | { kind: "undo" | "redo"; sessionId: string; recordId?: string }
  | { kind: "bom_override"; refdes: string; partId: string | null; patch: BomOverridePatch; recordId?: string };

export interface DispatchOptions {
  sessionId?: string;            // default: workspace commandSession
  baseRevision?: number;         // explicit expected base (forms); overrides lane revision
  retainPolicy?: RetainPolicy;   // default "all"
  activationKey?: string;        // coalesce concurrent identical activations (dispatchOnce)
}
type Api = Pick<ReturnType<typeof createDesignerApi>, "dispatch" | "getSchematicProjection" | "undo" | "redo"
  | "lookupCommand" | "getRecoveryHead" | "getRecoveryCompat" | "updateBomOverride">;

export function designerCoordinatorScope(backendURL: string, moduleId: string): string;
export function getDesignerCommandCoordinator(api: Api, scope?: string): DesignerCommandCoordinator;
export function peekDesignerCommandCoordinator(scope: string): DesignerCommandCoordinator | undefined;

export class DesignerCommandCoordinator {
  readonly queue: RevisionCommandQueue<DesignerAction>;   // gate = () => this.ready; defaultUnclassified "unknown"
  readonly journal: DesignerRecoveryJournal;
  readonly recovery: CoordinatorRecovery;                 // §3.7
  readonly listed: Promise<void>;                         // journal listed, seq base known (never rejects)
  readonly ready: Promise<void>;                          // hydrate done (never rejects; bounded)
  onResolved: ((designId: string) => void) | null;
  dispatch(designId, command, options?: DispatchOptions): Promise<DesignerDispatchResult>;
  reapply(designId, retainedId): Promise<DesignerDispatchResult>;
  history(designId, sessionId, kind, refresh): Promise<void>;
  updateBomOverride(designId, refdes, partId: string | null, patch, options?: { retainPolicy?: RetainPolicy }): Promise<{ override: BomOverride; bom: BomProjection | null }>;
  runExclusive<R extends { revision: number | null }>(designId, run: () => Promise<R>): Promise<R>;
  isSettled(designId): boolean;           // pending===0 && retained.length===0 && no deferred view state (H19 export gate)
  hasNonDurableEdits(): boolean;          // close guard (§3.9.3)
}
```
- Scoped coordinators get the native journal (`nativeRecordJournal("designerRecoveryJournal")`) and hydrate. **Unscoped** coordinators (no backendURL) get a volatile journal and never hydrate (finding 20).
- One hydrate per renderer: a module-level `ownedRecordIds: Set<string>` holds every recordId adopted or created in this renderer; hydrate skips them (protects against a second scope in the same renderer, e.g. backend restarted on a new port, and against records `prepare`d in this process before `list()` returned).
- `dispatch` with `activationKey`: `key = JSON.stringify([designId, activationKey])`; a pending promise for `key` is returned instead of dispatching (rules Save, Add board pour (H19)). Same pattern as `historyPending`. (`runExclusiveOnce` from rev 1 is dropped — autolayout uses its own in-flight state + stable `applyRequestId`, §3.6.3.)
- `reject()` throws `CommandRejectedError` for non-conflict results (message unchanged); history `HISTORY_EMPTY` ⇒ `CommandRejectedError`.
- On `AcknowledgementUnknownError`: `recovery.check(designId, retainedId)` after 250 ms, 1 s, 4 s (stops at first non-`unavailable` evidence; reads only; runs on the record's journal chain so it never races user actions).

#### 3.6.1 Rules dialog (H16/H17, findings 8, 9, 23)
`use-pcb-design-rules-dialog.tsx` options: `{ designId; projection; sessionId; dispatch: (command, options) => Promise<DesignerDispatchResult>; onSaved? }` (removes `backendURL`, `moduleId`, `fallbackRevision`, internal `createDesignerApi`).
- On open, capture `openedRevision = projection.revision`. `handleSave` dispatches with `{ sessionId, baseRevision: openedRevision, retainPolicy: "unknown-only", activationKey: "pcb_set_design_rules" }` — a full-replace save built from a stale form can never overwrite a newer assistant/other-session change (incl. H08 reassignments): the server returns `REVISION_CONFLICT`.
- Outcomes: conflict ⇒ not retained, dialog stays open: "The design changed since you opened the rules. Reload rules (your edits will be discarded) or Cancel." Reload re-reads the projection into the form and recaptures `openedRevision`. Rejection (e.g. `INVALID_DRC_RULE`) ⇒ not retained, inline error (today's behaviour). Lane blocked ⇒ `LaneBlockedError` ⇒ "Resolve the edits waiting in the Designer edit queue first." Not sent (journal) ⇒ "Not saved: recovery journal unavailable." Unknown ⇒ retained (blocks lane), dialog closes with "Outcome unknown — kept in the edit queue for review; do not re-save."
- **Session unchanged** (finding 23): PCB canvas keeps `designer-pcb-session`, DRC view keeps `designer-drc-session` (passed explicitly). Unifying them is open question §9-2.
- Callers: `PcbCanvas.tsx:5607` pass `dispatch: props.dispatchCommand`; `DesignerDrcView` gains `dispatchCommand`, `Space.tsx:1548,1611` pass `actions.dispatchCommand`. Workspace `dispatchCommand(command, options?)` forwards `DispatchOptions`.

#### 3.6.2 BOM sideband (H23, findings 7, 9)
Workspace action `updateBomOverride(refdes, partId, patch)` → `coordinator.updateBomOverride(selectedDesignId, refdes, partId, patch, { retainPolicy: "unknown-only" })`. `partId` comes from the `BomLineRef` the user edited.
- Execute: `observedHead = lane.revision ?? (await getRecoveryHead(designId)).headRevision` (read failure ⇒ not sent); `markSending`; `api.updateBomOverride(designId, refdes, patch, { expectedPartId: partId })`; returns `{ ...response, revision: null }` (lane revision untouched).
- Server-side binding guard (§3.2.4) makes every BOM send — first, retry or reviewed — refuse to land on a different part than the one the user edited.
- Outcomes: 400 ⇒ not retained, inline cell error; binding-changed 409 ⇒ not retained, inline "R1 now refers to a different part — reload BOM"; unknown ⇒ retained. `markCheckedDnp` awaits sequentially; first non-ok stops the loop and reports.

#### 3.6.3 Exclusive external applies (finding 1)
`runExclusive(designId, run)` = `queue.exclusive(designId, () => run())` (synchronous reservation; gate = ready). Not journaled.
- `useAutoLayoutJob`: options gain `runExclusive`. `applyAttemptRef: { key: "jobId:candidateId:snapshotDigest"; applyRequestId } | null`. On apply: reuse `applyRequestId` iff the ref key matches **and** the previous attempt ended **unknown** (transport / 5xx); otherwise mint a new one. Clear the ref on any definitive outcome (success, replay, any `AutoLayoutError` code). So apply → undo → apply mints a fresh id (no silent no-op replay), and a lost-response retry replays via §3.2.5. `LaneBlockedError` ⇒ `failed` "Resolve retained edits before applying". `replayed:true` ⇒ "Already applied (response was lost)".
- `PcbCanvas.tsx:901`, `PcbAutorouteDialog.tsx:219` (legacy, not idempotent): wrap in `runExclusive(async () => ({ ...(await apply(...)), revision: null }))`; on unknown outcome no retry is offered — "Outcome unknown; refreshing the board" and refresh.
- `PcbCanvas` props gain `runExclusive`; Space passes `actions.runExclusive`.

#### 3.6.4 View state while a lane is blocked (finding 16)
`dispatch` of `pcb_set_view_state` when `queue.isBlocked(designId)` (or recovered items not yet hydrated for it): merge `patch` into `deferredViewState[designId]` (latest field wins), reject with `CommandDeclinedError("View state deferred")` (pcb-view-store already swallows; local view is already applied). No retained row. On the lane's blocked→unblocked transition (queue subscription) submit one merged `pcb_set_view_state`. Not journaled; lost on crash (non-goal). `isSettled` false while deferred exists.

### 3.7 Hydration (`CoordinatorRecovery.hydrate`, once per scoped coordinator; re-runnable)
```
if journal.status === "volatile": listed/ready resolve; return
try loaded = await journal.load()           // resolves `listed` (sets seq base = loaded.maxSeq + 1)
catch: journal.status = "error"; resolve listed+ready; return   // edits blocked; banner "Retry journal"
compat = await ensureCompat() (failure tolerated here: classification uses current = unknown ⇒ unavailable rows)
for each design group (concurrency 4, sequential within a design; overall deadline 20 s):
  for handle in records (sorted by seq) not in ownedRecordIds:
    evidence = await gather(handle)          // reads only, 5 s timeout each; deadline exceeded ⇒ unavailable
    c = classifyRecovered(handle.record, evidence, currentCompat)
    if c.autoClear: await journal.settle(handle) (failure ⇒ adopt as unknown "cleanup pending");
                    autoCleared.push({ recordId, commandType, revision, legality: result.legality, warnings }); continue
    queue.adopt(designId, [{ id: recordId, commandId: sent?.commandId ?? recordId, input, attempt: sent,
                             state: c.state, message: c.message, origin: "recovered" }])
    ownedRecordIds.add(recordId); info.set(recordId, { handle, classification: c })
expose: autoCleared, unsupported, unreadableCount, otherDesignCounts
```
`ready` resolves after hydrate. Startup performs **no design mutation**; journal cleanup only for lookup-proven commits.
- **Retry journal** (finding 5): `recovery.retryJournal()` = `journal.probe()` → on success `status="durable"` → **re-run hydrate** (load → classify → adopt, skipping owned ids) → only then is the journal-error block lifted; edits retained as non-durable `cancelled` meanwhile remain for explicit apply-reviewed (which `prepare`s first).

### 3.8 Evidence & classification (`frontend/lib/command-recovery.ts`, pure)
```ts
export type RecoveryEvidence =
  | { kind: "lookup"; lookup: DesignerCommandLookup }
  | { kind: "head"; head: DesignerRecoveryHead }
  | { kind: "orphaned" }                       // 404 with DESIGN_NOT_FOUND_TYPE only
  | { kind: "unavailable"; message: string };  // transport / timeout / 5xx / any other 404/405
export function classifyRecovered(record, ev, current: RecoveryCompat): RecoveryClassification;
```
Gathering: command `sending` ⇒ `lookupCommand(designId, sent.commandId, {sessionId, commandType})`; history/bom/queued ⇒ `getRecoveryHead(designId, bom ? refdes : undefined)`.
Compat check: `incompatible` iff `record.compat.recordEpoch !== DESIGNER_RECOVERY_EPOCH`, or either side's `schemaHead`/`commandEpoch` is null or differs, or both `appVersion`s are non-null and differ (finding 11).

| Record | Evidence | state | label | actions | autoClear |
|---|---|---|---|---|---|
| any, incompatible | any | failed | incompatible | export, discard | no |
| any | orphaned | failed | orphaned | export, discard | no |
| any | unavailable | unknown | unavailable | check-status, export, discard | no |
| `queued` command/bom | head | cancelled | not-sent | apply-reviewed, export, discard | no |
| `queued` undo/redo | head | cancelled | not-sent | export, discard | no |
| command `sending` | found ok / found-unparsed rawOk | — | saved | — | **yes** |
| command `sending` | found `REVISION_CONFLICT actual≥0` | conflicted | conflicted | apply-reviewed, export, discard | no |
| command `sending` | found other ok:false / found-unparsed !rawOk | failed | rejected | export, discard | no |
| command `sending` | missing | unknown | not-recorded | retry-same-id, export, discard | no |
| command `sending` | mismatch | unknown | mismatch | export, discard | no |
| undo/redo `sending` | head == expected | unknown | not-recorded | retry-same-id, export, discard | no |
| undo/redo `sending` | head != expected | unknown | head-moved | export, discard | no |
| bom `sending` | `refdesPartId !== partId` | conflicted | binding-changed | apply-reviewed, export, discard | no |
| bom `sending` | binding same, head != observedHead | unknown | head-moved | apply-reviewed, export, discard | no |
| bom `sending` | binding same, head == observedHead | unknown | unverifiable | retry-same-id, export, discard | no |

In-session items: `failed`/`conflicted` history items get export/discard only — **no apply-reviewed for undo/redo ever** (finding 15: the assistant shares `designer-ui-session`, so a fresh Undo could undo the AI's entry); the user re-issues Undo manually.

Action semantics:
- **retry-same-id**: `queue.retrySameId` resending the exact `attempt` (commandId, sessionId, baseRevision, issuedAt, command) / same `expectedRevision` / same BOM patch + `expectedPartId`. At most once via PK + in-tx re-check (+ `command_json` compare), history `expectedRevision`, BOM binding guard. Stale base ⇒ backend logs `REVISION_CONFLICT` under that id ⇒ `conflicted` ⇒ apply-reviewed. Recovered items need a confirm dialog. Disabled while any pending.
- **apply-reviewed** (command/bom only): refresh projection; confirm dialog showing base vs head (BOM: "R1 → part <current> (was <recorded>)"); `queue.reapply` (fresh id; BOM re-resolves `partId` from the refreshed BOM and sends it as `expectedPartId`); same record via `markSending`, or `prepare` first when record-less.
- **check-status**: re-gather; may `resolveRetained` + settle.
- **export**: `openpcb-designer-recovery-<designId>-<recordId>.json` `{ format: "openpcb.designer-recovery-export", version: 1, exportedAt, record | raw, classification, evidence }`.
- **discard**: confirm → `journal.settle(handle)` first (on the record's chain); success ⇒ `removeRetained`; failure ⇒ keep, show error. Discard-all sequential, stop on first failure.
- Unsupported/unreadable: never auto-removed; Export (raw) / Discard (CAS by token, confirm) / "Open data folder" for unreadable.

### 3.9 UI

#### 3.9.1 `CommandQueueNotice.tsx` + new `RetainedEditRow.tsx`
- Pending: "Saving design… N pending". Journal `status==="error"` (load, prepare, markSending failure or missing bridge): banner "Edits paused: recovery journal unavailable (<msg>). Retry journal" (hidden for `missing-bridge`, which says "restart OpenPCB").
- Retained header: "N edit(s) need review. Submission paused; nothing is retried automatically."
- Row: humanized type, state chip (`unknown` "Outcome unknown", `failed` "Rejected", `conflicted` "Design changed", `cancelled` "Not sent"), origin line, label message, `<details>` raw JSON, buttons per `actions`.

#### 3.9.2 `DesignerRecoveryPanel.tsx` (new; in `Space.tsx` above `CommandQueueNotice`)
Shown for: auto-cleared ("N edits from the previous session were already saved" — **plus** per-item legality/warnings: "K saved with DRC refusals/warnings" with the list; dismissible only after display; finding 17), other-design records (list + Open), orphaned, unsupported/unreadable counts, journal error. Hook `hooks/useDesignerRecovery.ts` (`peekDesignerCommandCoordinator`, subscribes to queue + recovery).

#### 3.9.3 Close guard
`beforeunload` uses `coordinator.hasNonDurableEdits()`: `prepareChain` unsettled || any lane `pending > 0` || any retained item without a durable record (volatile, missing bridge, failed prepare) || deferred view state is **excluded** (display-only). Durable retained items do not prompt.

### 3.10 Shared packages / pins
No change in `../shared`. Uses pinned `@openpcb/contracts` `AppError`/`ValidationError` as-is. `src/shared/frontend/commands/*` and `src/shared/frontend/storage/*` are in-tree.

---

## 4. Task breakdown (commit-sized slices)

Order: **A = {S1, S2, S3}** parallel (disjoint files) → S4 (needs S2 types + S3 `RetainedState`) → S5 → S6 → S7 (both touch `Space.tsx`, sequential) → S8, S9, S10. S11 user-gated. S3's `defaultUnclassified:"failed"` keeps behaviour unchanged until S5 flips it with `fetchData` classification (no interim "Outcome unknown" for plain 4xx).

### S1 — Namespaced record-journal IPC (careful) — deps: none
Files: `electron/src/main/record-journal-ipc.ts` (new ~120), `draft-journal-ipc.ts` (→ ~10), `index.ts` (move registrations after `rendererTrust`, +deps), `preload/index.ts` (+8), `vite-env.d.ts` (+1), `contracts/app/draft-journal.ts` (doc), `src/shared/frontend/storage/native-record-journal.ts` (new ~45), `knowledge/frontend/lib/native-draft-journal.ts` (→ ~8).
Tests: `electron/tests/record-journal-ipc.test.ts` (new ~170): `journalDirectory` (`knowledge-drafts-<sha>` / `designer-recovery-<sha>`, same sha); trust via `requireTrustedCredentialSender` rejects other contents, destroyed contents, subframe, null frame, other origin; backend-not-ready rejected; error message per namespace; registers exactly `<channel>:read|write|remove|list` on the fake registrar; two namespaces → two directories; Docs key not listed via designer channel (temp dir, real store); designer namespace sweeps a pre-seeded `x.json.<uuid>.tmp` before first `list()` (unreadableCount 0) while Docs leaves it (unchanged). `native-record-journal` unit test: browser / missing-bridge / native. Existing `knowledge/frontend/tests/draft-journal.test.ts` unchanged and passing.
Est: 190 src + 190 test.

### S2 — Backend: lookup, head, compat, parser, BOM guard, autolayout replay, HTTP expectedRevision (critical) — deps: none
Files: `src/sdks/designer/types.ts` (+30), `src/sdks/designer/index.ts` (JSDoc), `backend/results.ts` (exhaustive failure-parser table, `inspectLoggedResult`), `backend/store.ts` (replay fallback, `lookupCommand`, `getRecoveryHead`, `getLoggedUiCommand`, `updateBomOverride` guard), `backend/bom-overrides.ts` (export the partId resolver), `backend/recovery-compat.ts` (new), `backend/routes.ts` (3 GET routes, `DesignNotFoundError`, BOM `expectedPartId`, `parseHistoryBody`), `backend/autolayout/{apply-candidate,errors,register-routes}.ts` (step 0, `AUTO_LAYOUT_REQUEST_CONFLICT`, deps wiring), `src/modules/designer/AGENTS.md:41`.
Tests:
- new `tests/designer-command-lookup.test.ts` (~240): missing (headRevision); found ok (appliedRevision, idempotent); found conflict; found rejected; **found for each of the six previously-unparseable codes**; found-unparsed (hand-inserted log row with an unknown code / garbage result ⇒ rawOk/rawCode, never mismatch); mismatch (other session / type / design / identity row); typed 404 for unknown and deleted design vs generic 404 for an unmatched path; 400 for missing params; concurrent same-id POSTs ⇒ one commit.
- new `tests/designer-dispatch-result-roundtrip.test.ts` (~80): for every member of the `DesignerDispatchResult` failure-code union (fixture list typed `Record<DesignerDispatchFailureCode, DesignerDispatchResult>` so a new code without a fixture fails typecheck): `parseDispatchResultJson(JSON.stringify(r))` deep-equals `r`; replay of an unparseable ok row returns ok with appliedRevision; unparseable ok:false replays `actual:-1`.
- `tests/designer-recovery-routes.test.ts` (~120): recovery-head with/without refdes (bound, unbound ⇒ null); compat equals `DESIGNER_SCHEMA_HEAD` and that equals the last migration basename; BOM PATCH with matching `expectedPartId` writes, with stale `expectedPartId` (after renaming R1→R2 and R3→R1) ⇒ 409 typed and no row change, without key ⇒ legacy.
- **after-commit lost response** (finding 25a): in-process `dispatchCommand` succeeds, the test discards the result, then lookup ⇒ found ok, and re-POST of the identical envelope ⇒ same result, revision unchanged, undoDepth +1 only once. (The `afterCommandCommit` hook is not used for this — a throwing hook is caught and replayed as a normal 200.)
- `designer-autolayout-apply-service.test.ts` (+~80): commit, drop response, retry same `applyRequestId` ⇒ original result with `replayed:true` and **no** cloud fetch / digest check (fake client asserts zero calls); same id with another candidate ⇒ `AUTO_LAYOUT_REQUEST_CONFLICT`; apply → undo → apply with a new id ⇒ applied again.
- `designer-commands.test.ts:394,408` send `expectedRevision`; missing ⇒ 400, no history consumed.
Est: 220 src + 560 test.

### S3 — Queue states & primitives (critical) — deps: none
Files: `revision-command-queue.ts` (186 → ~340), `command-coordinator.ts` (minimal: `CommandRejectedError` for non-conflict results and `HISTORY_EMPTY`), `CommandQueueNotice.tsx` (reapply only `conflicted|cancelled`; `unknown` text).
Tests: new `revision-command-queue.test.ts` (~300): error-class mapping; `defaultUnclassified` both values; `retrySameId` reuses `commandId` + `attempt`, unknown only; `reapply` refuses unknown/failed; monotonic revision; `retain`/`adopt` block; `resolveRetained`; `removeRetained` throws while pending; `exclusive` ordering/refusal/revision/no retain; **gate**: an item submitted before the gate resolves is cancelled when `adopt` blocks the lane before the gate opens; **observe during a reserved-but-unexecuted slot does not change the revision the execute receives** (finding 3); `retainPolicy:"unknown-only"` does not retain/block conflicted/failed/blocked and does retain unknown; FIFO under reordered resolution.
Est: 160 src + 300 test.

### S4 — Recovery record, journal wrapper, classifier (critical) — deps: S2 (types), S3 (`RetainedState`)
Files: `frontend/lib/designer-recovery-record.ts` (~170), `frontend/lib/designer-recovery-journal.ts` (~240), `frontend/lib/command-recovery.ts` (~150).
Tests: `designer-recovery-record.test.ts` (~140: round-trip; queued **without** ids decodes ok; queued **with** ids ⇒ malformed; sending without ids ⇒ malformed; future/key-mismatch/extra keys); `designer-recovery-journal.test.ts` (~220, fake bridge: CAS tokens; ack mismatch; **per-record serialization** — `note` then immediate `settle` never produce "Record conflict"; failed write retried with identical token+value; "rename then fsync throw" fake ⇒ next op succeeds; prepare/markSending failure sets `status="error"`; missing-bridge ⇒ error; `load` buckets + `maxSeq`; unsupported never written/removed); `command-recovery.test.ts` (~90: invariants only — `autoClear` only for found-ok/rawOk; retry-same-id never for queued/mismatch/incompatible/head-moved history; incompatible on each compat field). Row-by-row behaviour is asserted through the coordinator in S5 (finding 25b).
Est: 560 src + 450 test.

### S5 — api errors + coordinator integration + workspace actions (critical) — deps: S1, S3, S4
Files: `frontend/lib/request-errors.ts` (~45), `frontend/api.ts` (+~75: `fetchData` classification + signal, `lookupCommand`, `getRecoveryHead`, `getRecoveryCompat`, `updateBomOverride(…, {expectedPartId})`), `command-coordinator.ts` (→ ~360), `coordinator-recovery.ts` (~300), `hooks/useDesignerWorkspace.ts` (+~55: `dispatchCommand(command, options?)`, `updateBomOverride`, `runExclusive`, `onResolved`, discard → `recovery.discardAll`).
Tests: new `command-coordinator.recovery.test.ts` (~450, fake journal + api): journal before `api.dispatch`; observe landing while `prepare` is pending does not change the sent base (finding 3); "Saving…"/`isSettled=false` immediately; prepare failure ⇒ not sent, retained cancelled non-durable, status error, close guard; Retry journal ⇒ probe ⇒ rehydrate adopts disk records **before** unblocking (finding 5); apply-reviewed of a record-less item calls `prepare` then `markSending` (finding 4); markSending failure ⇒ not sent; missing-bridge ⇒ every edit refused; ack ⇒ settle; transport ⇒ unknown + auto-check found-ok resolves; 5xx unknown; 4xx failed; conflict; net-merge journals the new commandId first; hydrate per §3.8 row (found-ok auto-cleared with legality summary, found-unparsed, missing ⇒ retry sends exact attempt once, stale base ⇒ conflicted ⇒ reapply reuses record key, queued ⇒ not-sent, typed 404 orphaned vs generic 404 unavailable, timeout ⇒ unavailable, incompatible); history head-moved has no retry; BOM: partId sent as `expectedPartId`, binding-changed recovered ⇒ apply-reviewed re-resolves; `retainPolicy:"unknown-only"` rejection does not block the lane (finding 9); explicit `baseRevision` overrides lane (finding 8); view-state deferred while blocked and flushed once on unblock (finding 16); unscoped coordinator volatile, no hydrate (finding 20); second scope skips owned records; `seq` continues from `maxSeq`; volatile same-id retry uses in-memory `attempt` after an intervening `observe` (finding 19). Update `useDesignerWorkspace.test.tsx` mocks and its "uncertain transport" expectation `failed` → `unknown`.
Est: 840 src + 470 test.

### S6 — Recovery UI (careful) — deps: S5
Files: `CommandQueueNotice.tsx` (≤200), `RetainedEditRow.tsx` (~170), `DesignerRecoveryPanel.tsx` (~200), `hooks/useDesignerRecovery.ts` (~110), `frontend/lib/download-json.ts` (~20), `Space.tsx` (+~12).
Tests: `DesignerRecoveryPanel.test.tsx` (~170: auto-cleared incl. warnings list, other-design + Open, orphaned, unsupported Export/Discard, unreadable + Open data folder), `CommandQueueNotice.test.tsx` (~170: buttons per classification; history rows never show apply; retry confirm; discard failure keeps row; journal-error banner for prepare failure; missing-bridge text).
Est: 720 src + 340 test.

### S7 — H07 consumers on the coordinator (careful) — deps: S5, after S6
Files: `pcb/use-pcb-design-rules-dialog.tsx`, `components/DesignerDrcView.tsx`, `pcb/PcbCanvas.tsx` (:5607, `runExclusive`, :901, :6329), `pcb/autolayout/AutoLayoutDialog.tsx`, `pcb/autolayout/state/useAutoLayoutJob.ts`, `pcb/PcbAutorouteDialog.tsx`, `components/DesignerBomView.tsx`, `Space.tsx` (:1463-1466, :1538-1554, :1611-1620).
Tests: `pcb/use-pcb-design-rules-dialog.test.tsx` (~130: dispatch receives `baseRevision = openedRevision` even after the workspace lane advanced; conflict keeps dialog open with Reload, nothing retained; `INVALID_DRC_RULE` inline, lane not blocked; double Save ⇒ one dispatch; DRC caller passes `designer-drc-session`), `useAutoLayoutJob.test.ts` (~110: through `runExclusive`; id reused only after unknown; new id after success/definitive error and after undo; `replayed` message; LaneBlockedError), `DesignerBomView.test.tsx` (+~60: sends `partId`; 400 inline; binding-changed inline; unknown retained).
Est: 230 src + 300 test.

### S8 — H07 regression matrix (standard) — deps: S5, S7
Files: new `hooks/useDesignerWorkspace.ordering.test.tsx` (~300): two inspectors FIFO; delete→undo→redo delayed; double-click ⇒ one command; reordered responses; design switch mid-flight. Backend `tests/designer-command-ordering.test.ts` (+~80): delete→undo→redo exact; stale HTTP redo ⇒ conflict, no history consumed.
Est: 380 test.

### S9 — Docs (standard) — deps: S5–S7
`docs/designer/command-ordering.md` (replace "not crash-durable" :36-38; "Recovery journal", "Durability boundary" §6; HTTP `expectedRevision` required; consumers: rules dialog (explicit base), BOM sideband (binding guard), exclusive applies (autolayout replay); view-state deferral), `knowledge/frontend/lib/DRAFT-RECOVERY.md` (IPC generalized; Docs namespace/dir/behaviour unchanged).
Est: 90 lines.

### S10 — Native recovery e2e (careful; run needs native env) — deps: S6, S7
Files: `tests/e2e/electron-designer-recovery.spec.ts` (~420), `tests/e2e/electron-native-helpers.ts` (+~30 `terminateNativeSession` lifted from `electron-docs-recovery-cases.ts:73-96`), `playwright.config.ts:36-38`.
Cases: 1 socket loss before commit (abort) ⇒ unknown ⇒ not recorded ⇒ Retry ⇒ +1 once. 2 socket loss after commit (`route.fetch()` then abort; NOT VERIFIED that Electron surfaces this as a transport error — fallback: fulfil with a truncated 200 body, which `fetchData` classifies as transport) ⇒ saved, no retry. 3 503 ⇒ unknown ⇒ Retry once; 400 ⇒ Rejected. 4 external POST bumps revision while a delayed UI edit is gated ⇒ conflicted ⇒ Apply reviewed once. 5 kill with edit pending (journal file in `designer-recovery-<scope>`) ⇒ relaunch ⇒ no mutation before click ⇒ not recorded ⇒ Retry ⇒ one commit. 6 kill after commit ⇒ "already saved". 7 window-close variant of 5. 8 `chmod 0o500` designer dir ⇒ "Edits paused", revision unchanged; `0o700` ⇒ Retry journal ⇒ pre-existing record from case setup adopted ⇒ Apply reviewed. 9 future/unreadable + stale `.tmp` ⇒ counts (tmp swept, not counted), files byte-identical. 10 Docs regression (`electron-docs-hardening.spec.ts`). 11 rules dialog opened, external change, Save ⇒ "design changed", no overwrite.
Assertions per case: projection revision, history undoDepth, lookup for involved ids, `sqlite3 … count(*) from designer_command_log` (skip if no `/usr/bin/sqlite3`). JSON evidence via `info.attach`; `nativeScreenshot`.
Est: 450 test.

### S11 — Evidence & reconciliation (user-gated) — deps: S10 native run, OPENPCB-100/101
`docs/qa/2026-10-hardening/evidence/designer-command-recovery.json`, `reconciliation.json` (T-134/T-200). Plane comments drafted; saved only after approval.

---

## 5. Edge cases & failure modes

1. **Journal latency**: two fsync'd writes + one remove per edit, serialized in `prepareChain`; slot reserved synchronously so ordering/observe are unaffected. Budget p95 < 50 ms; S10 records timings.
2. **Value > 16 MiB**: `prepare` throws ⇒ not sent, "Edit too large for crash recovery".
3. **Out-of-order IPC acks across keys** — `prepareChain`; per-record chain for ops on one key.
4. **Observe during prepare/hydrate** — blocked by synchronous `pending` reservation; never rebases (command-ordering.md:7).
5. **Hydrate slow/backend down** — 5 s per read, 20 s total; remainder `unavailable`; `ready` always resolves.
6. **Same-id retry while original in flight** — PK + in-tx re-check ⇒ replay.
7. **Retry with stale base** ⇒ logged conflict ⇒ apply-reviewed (fresh id).
8. **Older-commit replay** ⇒ monotonic lane rule.
9. **Unparseable logged result** ⇒ lookup `found-unparsed` (rawOk decides saved/rejected); replay never reports a reapply-able conflict.
10. **Net-merge during retry** — confirm again; `markSending` first; declined ⇒ settle.
11. **Design deleted** ⇒ typed 404 ⇒ orphaned. Route missing (rollback) ⇒ generic 404 ⇒ unavailable.
12. **Journal `list()` fails** ⇒ error ⇒ edits blocked ⇒ Retry journal ⇒ probe + rehydrate.
13. **Settle/note fails** ⇒ exact attempt retried on next op; record lingers ⇒ next start found-ok ⇒ auto-cleared.
14. **Dir fsync throws after rename** ⇒ same token+value retry succeeds idempotently.
15. **Stale `.tmp`** (SIGKILL in publish) ⇒ swept at designer journal open.
16. **Tampered record** ⇒ key-mismatch ⇒ unsupported.
17. **App upgrade/downgrade between write and retry** ⇒ compat stamp mismatch ⇒ incompatible (export/discard). Manual `DESIGNER_COMMAND_EPOCH` bump for semantic changes without a migration (H08/H13).
18. **Preload/renderer skew** ⇒ missing-bridge ⇒ blocked, "restart OpenPCB".
19. **Form rejection** (rules typo, bad BOM price) ⇒ inline, lane not blocked.
20. **Stale rules form** ⇒ explicit base ⇒ conflict ⇒ Reload; never overwrites.
21. **BOM re-annotation** between write and retry ⇒ server 409 binding-changed / recovered `binding-changed` ⇒ reviewed only.
22. **View-state while blocked** ⇒ deferred & merged, flushed once on unblock; lost on crash.
23. **History head-moved / conflicted** ⇒ export/discard only; user re-issues Undo.
24. **Autolayout lost response** ⇒ same `applyRequestId` ⇒ server replay (step 0). Apply→undo→apply ⇒ new id. Legacy autoroute/autoplace ⇒ no retry; refresh.
25. **Two records' order across crashed sessions** ⇒ `seq` (journal-global, continues from `maxSeq`), clock-independent.
26. **Two coordinators in one renderer** ⇒ `ownedRecordIds`; unscoped = volatile.
27. **Two app processes** ⇒ single-instance lock (as Docs).
28. **Backend URL changes per launch** ⇒ journal keyed by DB, not URL.
29. **Assistant writes** ⇒ lane conflict path; identity rows → `mismatch`.
30. **DB restored at the same path** ⇒ out of P103 scope; H46 must quarantine the designer-recovery dir on restore (§8).

---

## 6. Migration / rollback & data safety

- **No SQL migration.**
- **New on-disk data**: `<APP_DATA_DIR>/designer-recovery-<sha256(realpath(db))>/` (AtomicRecordStore envelope v1, 0700/0600). Docs dir untouched.
- **Rollback**: reverting S5–S7 leaves the directory unused. Reverting S2 ⇒ recovery routes 404 with the generic type ⇒ `unavailable` (never `orphaned`/"not recorded"); compat 404 ⇒ records stamped null ⇒ review-only on recovery; BOM `expectedPartId` ignored by the old route.
- **Never auto-deleted**: unsupported/future/unreadable records, missing-design records, non-ok/missing records. Auto-removed only: lookup-proven commits and user discards (CAS). Stale `.tmp` files (designer namespace only) are swept at open — they are never published records.
- **Backups**: H46 owns DB backups; this item writes nothing to the design DB at startup.
- **Durability boundary text (for `docs/designer/command-ordering.md`)**:
  1. Before the journal acknowledges the `queued` write, an edit exists only in renderer memory (UI shows Saving…, close guard prompts).
  2. After that acknowledgement (tmp fsync + rename + dir fsync) the intent survives renderer crash, app kill and OS restart.
  3. A design commit is durable per SQLite WAL defaults; acknowledgement removes the journal record.
  4. **Power loss / drive write-cache loss is not qualified**: macOS `fsync` does not issue `F_FULLFSYNC` for the journal or SQLite, so a just-acknowledged commit may be lost while its journal removal persisted.
  5. Browser (non-Electron) sessions are volatile. A native app with a missing bridge refuses edits.

---

## 7. Verification commands

Run from `/Users/andrejvysny/workspace/openpcb/OpenPCB`. (`test:backend` runs with cwd `src/core/backend` — paths are `tests/<file>`.)
```
npm run typecheck
npx --no-install tsc -p electron/tsconfig.json --noEmit
bun test electron/tests/record-journal-ipc.test.ts electron/tests/local-api-ipc.test.ts
npm run test:backend -- tests/designer-command-lookup.test.ts tests/designer-dispatch-result-roundtrip.test.ts \
  tests/designer-recovery-routes.test.ts tests/designer-autolayout-apply-service.test.ts \
  tests/designer-command-ordering.test.ts tests/designer-commands.test.ts \
  tests/designer-history-session.test.ts tests/atomic-record-store.test.ts
npx --no-install vitest run --config src/core/frontend/vitest.config.ts \
  src/shared/frontend/commands \
  src/shared/frontend/storage \
  src/modules/designer/frontend/lib \
  src/modules/designer/frontend/hooks \
  src/modules/designer/frontend/components/CommandQueueNotice.test.tsx \
  src/modules/designer/frontend/components/DesignerRecoveryPanel.test.tsx \
  src/modules/designer/frontend/components/DesignerBomView.test.tsx \
  src/modules/designer/frontend/pcb/use-pcb-design-rules-dialog.test.tsx \
  src/modules/designer/frontend/pcb/autolayout \
  src/modules/designer/frontend/pcb/pcb-view-persistence.test.ts \
  src/modules/knowledge/frontend/tests/draft-journal.test.ts \
  src/core/frontend/src/designer-api.test.ts
npm run gen:check
npm run test:react
npm run test:backend   # full Bun suite (baseline 3332 pass per 2026-10-14 comment; not re-run in review)
# native (macOS GUI host)
npm run build --workspace electron
OPENPCB_E2E_NO_WEBSERVER=1 OPENPCB_CAPTURE=1 npx --no-install playwright test --project=electron-desktop \
  tests/e2e/electron-designer-recovery.spec.ts tests/e2e/electron-designer-hardening.spec.ts tests/e2e/electron-docs-hardening.spec.ts --workers=1
```

---

## 8. Cross-item interfaces

| Item | Consumes from P103 | Provides to / constrains P103 |
|---|---|---|
| H08 (net split/merge identity) | Retry re-enters `confirmNetMerge`; auto-cleared summary shows result `legality`/warnings | New result fields (fragment warnings, dropped assignments, orphaned copper) **must be added to the exhaustive `parseDispatchResultJson` table** (typecheck enforces new codes, not new fields — add round-trip fixtures) and surface in the auto-cleared summary. Semantic change without a migration ⇒ bump `DESIGNER_COMMAND_EPOCH` in the same commit |
| H13 (Y-up frame) | — | Same epoch rule; a migration bumps `DESIGNER_SCHEMA_HEAD` (test-enforced) |
| H14 (KiCad import atomicity) | Typed 404 ⇒ orphaned | Already met: import uses session `"import-kicad-project"` (`import/kicad-project/commit.ts:262`) outside the coordinator |
| H19 (pour action, export gating) | `coordinator.isSettled`; `dispatch(..., {activationKey})` for "Add board pour" | Export UI disabled unless `isSettled` and server DRC snapshot == head. H19 edits `api.ts:49-53` — same file as S5 (rebase carefully) |
| H16/H17 (rules, net classes) | S7 rules dialog | Any rules/net-class editor must take `dispatch` from the workspace with an explicit open-time `baseRevision`, never `createDesignerApi().dispatch` |
| H20 (view state) | View-state deferral while blocked | — |
| H21 (gestures) | Gestures via `dispatchCommand` ⇒ journaled | Must not bypass the coordinator |
| H23 (BOM) | BOM sideband through lane + journal + `expectedPartId` | If BOM gains a second writer or undo, H23 adds CAS/history |
| H46 (DB backup/restore) | — | A restore at the same DB path **must** move `designer-recovery-<hash>/` aside (e.g. `…-restored-<ts>/`) atomically with the DB swap; otherwise a "not-recorded" record could retry onto a different lineage with a coinciding revision |
| OPENPCB-100/101 | — | Packaged evidence gates closure (S11) |
| Assistant (b3a4b70) | Identity rows ⇒ `mismatch`; shares `designer-ui-session` ⇒ no fresh-id history apply | Assistant recovery separate |

---

## 9. Open questions (user must answer)

1. **Closure criteria**: OPENPCB-103/55 closure requires packaged native evidence, blocked by OPENPCB-100/101 (and a `shared/` tag publish). Accept unpackaged native evidence (S10 on dev Electron) as interim, keeping the items open until packaged evidence exists?
2. **Rules-save history session**: keep today's split (`designer-drc-session` from the DRC view, `designer-pcb-session` from the PCB canvas — DRC-view saves are not undoable from the canvas), or unify both on the PCB session (one undo stack; changes undo semantics)? Design default: keep today's split.
3. **Docs `.tmp` sweep**: Docs' journal has the same stale-`.tmp` ⇒ permanent "unreadable" issue. Fix it in P103 (touches Docs behaviour, outside the binding "Docs untouched") or file a Plane follow-up? Design default: follow-up.

Decided here (rationale recorded):
- Browser/dev without Electron: volatile, not blocked. Native without the bridge: blocked.
- No user override to keep editing while the journal fails; "Retry journal" probe + rehydrate.
- Payload hash dropped from lookup.
- HTTP history routes require `expectedRevision`; SDK optional for in-process callers.
- Form surfaces (rules, BOM) don't retain definitive rejections/conflicts; only `unknown` blocks.
- Power-loss qualification and "mark acked, GC later" out of scope (Plane follow-up suggested).

---

## 10. Review response (rev 2)

Accepted and fixed (finding → section):
1 autolayout replay → §3.2.5, §3.6.3, S2/S7 tests · 2 phase-conditional ids → §3.4.1, S4 · 3 synchronous reservation + gate + timeouts → §3.3, §3.4.3, §3.7, S3/S5 · 4 record-less reapply prepares; status error on any prepare/markSending failure → §3.4.2-3 · 5 rehydrate after probe → §3.7 · 6 per-record chain + exact-attempt retry → §3.4.2 · 7 BOM `partId` + server `expectedPartId` + head/binding classification → §3.2.4, §3.6.2, §3.8 · 8 explicit open-time base → §3.6.1 · 9 `retainPolicy:"unknown-only"` → §3.3, §3.6.1-2 · 10 exhaustive parser, six codes, `found-unparsed`, replay fallback → §3.2.2-3 · 11 compat stamp (schema head, command epoch, app version) → §3.2.4, §3.4.1, §3.8 · 12 missing-bridge ⇒ blocked → §3.1, §3.4.2 · 13 `.tmp` sweep (designer ns) → §3.1 · 14 typed design-404 → §3.2.4, §3.8 · 15 no history apply-reviewed → §3.8 · 16 view-state deferral → §3.6.4 · 17 auto-cleared warnings → §3.7, §3.9.2 · 18 `seq` → §3.4.1 · 19 in-memory `attempt` → §3.3 · 20 unscoped volatile + `ownedRecordIds` → §3.6 · 23 session decision → §9-2 · 24 S3 keeps `failed` default until S5 → §3.3, §4 · 25 tests (lost response by discarding the result; classifier via S5; tests for 3/7/8/12/13) → S2–S7 · 26 deps param + `requireTrustedCredentialSender` → §3.1 · 27 commands → §7 · 28 header, S4 deps, `runExclusiveOnce` dropped → header, §4, §3.6.

### Rejected / modified review findings
- **21 (lineage token inside P103) — modified**: verified there is no cheap write-time lineage evidence (projections carry no `updatedAt`; a restored backup carries the same DB identity; a client-side token would need a new per-send read). Restore is a deliberate H46 operation that knows the DB is swapped, so the guard belongs there: H46 must quarantine the designer-recovery directory on restore (§8). Residual risk documented (§5-30).
- **22 (mark acked, GC at next startup) — deferred**: (a) the "acked" mark is written with the same unqualified `fsync` as the SQLite commit, so after power loss it is not reliable evidence either; (b) it makes startup cost O(edits in the last session) lookups instead of O(unsettled edits). The AC only requires documenting the boundary (§6). Suggested Plane follow-up together with `F_FULLFSYNC` qualification.
- **26 (reuse trust helper) — accepted with a noted delta**: `rendererTrust` checks the exact renderer origin instead of `isAllowedAppUrl`'s set; identical for every real renderer load; covered by the Docs native regression.
