# OPENPCB-56 (EDA H08/P1) — Durable electrical net identity

Status: design rev 2 (adversarial review addressed, §10). Ready for implementation.
Repo: `/Users/andrejvysny/workspace/openpcb/OpenPCB` (master @ d5547f9; `839365e..d5547f9` touches no file cited here).
This file is the H08 design. There is no separate `H08.md`.

No `../shared` package change and no re-pin. Every slice typechecks against the currently pinned
`@openpcb/*` tags: `@openpcb/command-pattern` patches are generic over the component union, and
`@openpcb/contracts` and the board-snapshot contract are untouched.

Binding user decision (H08), restated as the rule this design implements:
- **Split:** the fragment with the **most pins** keeps the durable id. With it go every assignment
  (net class, length group, diff pair, rule scope) and all copper. Other fragments get fresh ids,
  no assignments, and the user sees a warning.
- **Merge:** the survivor is the predecessor with the most pins. The losers' ids retire. Their
  assignments stop applying, and this is reported.
- **Copper on a retired id is ORPHANED.** Orphaned copper blocks manufacturing export.

Retirement never rewrites dependents. "Dropped" means the assignment is keyed by an id that is no
longer active, so it is inert. That is what makes undo/redo exact (§3.6).

---

## 1. Scope & acceptance mapping

| # | Plane acceptance criterion | Design element | Slice |
|---|---|---|---|
| A1 | Durable identity comes from stable entity/pin membership, not coordinates or names. Display names are separate | Persisted active set `{id, members, displayOverride?}` (§3.2). The kernel matches membership tokens `(kind, entityId)` (§3.3). Display name is derived per net: label/rail/portal, else the H14 override, else `Net_<seq>`, or `unconnected-(…)` for a lone pin (§3.4). `DesignerDerivedNet.autoNamed` | S1, S3, S4 |
| A2 | Deterministic split/merge semantics with specified membership and invalidation | Kernel successor policy `inherit-most-pins`. Its total order includes a binder-supplied "more dependents, then lower seq" key (§3.3). Transitions and retirements are reported. Dependents become inert and are reported (§3.7) | S1, S4, S5 |
| A3 | Identities preserved across move, rotate, refdes rename, import, reload, undo/redo | Binding is by membership, and moves, rotations and renames do not change membership. Import materialises ids at commit (§3.8). Reload reads the persisted state (§3.5). Identity entities live in the ECS world, so history patches restore them. Contested members are sanitised (§3.6) | S4–S6, S8, S13 |
| A4 | One identity mapping consumed by routing, pours, DRC, rules, length groups, schematic projection and manufacturing snapshots; no fuzzy matching | `net.id` is durable, and every consumer already keys by `net.id` / `padNets`. Projection-time `bindNetName`, the zone name binding and import first-match-by-name are removed for durable designs in **S5**. They are kept only in legacy mode (§3.5.4). Names resolve once, at command and import boundaries (§3.8) | S5, S7, S8 |
| A5 | Versioned migration with backup and provenance; ambiguous legacy bindings are reported and quarantined, never guessed | `0022_net_identity.sql`. A lazy per-design migration writes a logical backup row (schematic + PCB + histories, sha256) in the same tx. Evidence is per copper island, with pour evidence (§3.10). Every reference that is not proven goes to `designer_net_identity_quarantine` and keeps its legacy value | S3, S6 |
| A6 | Dangling net references detected at command/import/export | Command: `NET_REFERENCE_DANGLING` / `NET_REFERENCE_AMBIGUOUS`. Ids are design-salted, so an id copied from another design is `foreign-design` (§3.2, §3.8). Import: quarantine plus a warning. Export: the gate plus non-overridable DRC `NET_ORPHANED_COPPER` (§3.11) | S7, S8, S9 |
| A7 | Regression and property tests: moving or renaming an already-routed design loses no bindings | `designer-net-identity-t132.test.ts` (including delete-and-redraw), invariant-based `designer-net-identity-property.test.ts` (§7) | S13 |
| A8 | Undo/redo and save/reopen preserve identities exactly | `designer.net_identity` world components. Cross-session contested members are sanitised deterministically (§3.6). Tests: undo/redo chains across sessions, the finding-1 scenario, reboot on the same DB | S5, S13 |
| A9 | Colliding labels or hierarchical names never accidentally merge unrelated nets | The merge gate is extended to `update_primitive_text`, `move_primitive` and `rotate_primitive`. Geometry merges of ≥2 named nets are also gated (default, Q3) (§3.12). Auto names disambiguate on collision (§3.4). Sheet scoping is H14's job (§8) | S5, S12, S13 |
| A10 | Legacy fixtures migrate reproducibly or fail with a recoverable diagnostic; S1 regressions stay live | S0 captures real pre-H08 fixtures. The migration is deterministic. On failure the design runs in **legacy mode**: it is editable, export is blocked, a banner shows `lastError`, and it can be retried. Retry is automatic after a migrator-version bump. Transient SQLite errors are never persisted (§3.10.1). `deriveNetsAndJunctions` stays byte-identical | S0, S4, S5, S6, S10 |
| A11 | Until repaired, unresolved or orphaned copper blocks qualified manufacturing | Non-overridable DRC `NET_ORPHANED_COPPER`, plus the export gate. The gate also blocks on inert rule-side references (§3.9). Repair goes through `pcb_rebind_net_references` and the panel (§3.13). `designer.outputQuarantine` is **not** touched | S9, S10, S11 |
| A12 | Contract consumable by H14, H17, H23; H46 owns shared migration infra | §8. `initializeNetIdentity` and `setNetDisplayOverride` are the H14 seams (H08-a, H08-b provided). Durable ids serve as H17 keys. Stable names serve H23. The local logical backup gives way to H46's snapshot when that lands | S5, S6, S14 |

Explicitly out of scope:
- Lifting `designer.outputQuarantine` or editing `QUALIFICATION_BLOCKERS` (needs H51 plus user sign-off).
- Native Electron GUI QA (H51).
- KiCad sheet-scoped label semantics (H14).
- Comment-anchor `netId` and dataset-capture `net_id` rows. These are non-electrical and are left untouched.
- Net **aliases** for live resolution. Aliases are H14 report-only (Q4).

---

## 2. Current state (verified at d5547f9)

Identity kernel (foundation, unwired):
- `src/shared/electrical-identity/{types.ts, reconcile.ts, index.ts}` (commit 18d283f).
  - `reconcileElectricalIdentity` (`reconcile.ts:296`) preserves an id **only for one-to-one overlap** (`assignComponents` `:231-267`). It validates that no member belongs to two records: `canonicalRecords` throws `Member belongs to multiple … records` (`:99-104`).
  - `compareText` is a code-unit comparison (`:29-31`), so `"net:10" < "net:9"`.
  - The allocator receives `{componentKey, members}` (`types.ts` `ElectricalNetAllocation`).
  - Tests: `src/core/backend/tests/electrical-identity.test.ts`. There are no production importers.
  - The kernel conflicts with the binding H08 decision (most pins inherits), so S1 changes it.
- `@openpcb/command-pattern` `applyPatch` is lenient: `entity.delete` of a missing entity is a no-op, and `component.set` overwrites (`node_modules/@openpcb/command-pattern/dist/commands/apply.js`).

Net derivation (coordinate-derived ids):
- `backend/projection-world.ts:637` `deriveNetsAndJunctions` is a union-find over `pt:<x>:<y>` and `w:<wireId>:<idx>` nodes, with `id: root`.
- **Every pin becomes a net**, so an unwired pin is a standalone single-pin net (`:884-896`, documented on purpose).
- Unnamed names are `Net_${unnamedIndex++}` in root `localeCompare` order (`:921-959`), so they depend on coordinates.
- Callers:
  - `projection-read.ts:182` (DB rows, parts by `createdAt`)
  - `projectionFromWorld` (`:1032`, parts by id). **The two paths can give different roots.** Legacy copper was captured on the read path, so migration uses it.
- `DesignerDerivedNet` (`sdks/designer/types.ts:1369-1376`).
- Pin id = `createPinId(partId, originPinKey)`. It is stable across rename and move.
- `move_part` drags connected wires.

Persisted net references (raw strings today):
- Copper:
  - `PcbTrace.netId` (`types.ts:983`)
  - `PcbVia.netId` (`:1031`)
  - `PcbFreePad.netId` (`:1280`)
  - `PcbZone.netId/netName` (`:1136-1141`) and `enabled`
- **The UI writes every named-net zone as a name hint, and that includes auto names.**
  - `netRefForPick` (`frontend/pcb/tools/area-tool-options.ts:46-56`) returns `{netId:null, netName: net.name}` whenever the net has a name. `pcbNets` (`usePcbWorkspace.ts:1077-1090`) builds the list from `projection.netNames`, which includes `Net_<n>`.
  - So a zone on an unnamed net is stored as `{netId:null, netName:"Net_3"}`.
  - The default zone net is also a name hint (`:58-71`).
  - `NetSelect` (`PcbSelectionInspector.tsx:379-382`) maps its value by `netName` first.
- Board settings live in one JSON row (`kind:"board_settings"`):
  - `perNetClassAssignments` keys
  - `lengthMatchGroups[].netIds`
  - `diffPairs[].pNetId/nNetId`
  - `drcRules[].scopes[{kind:"net",netIds}]`
  - The single writer is `serializeBoardSettings` (`board-settings-serialize.ts:91`).
- Projection-time name binding:
  - `pcb/pcb-projection.ts:100-123` `bindNetName` does case-insensitive first-match over **all** net names, auto names included, for traces and vias.
  - The zone name binding with the ambiguity warning is at `:125-150`.
  - `command-executor.ts:910-953` `legalityFor.boundTrace/boundVia` (used at `:1419`) depends on this binding.
- Import name binding: `import/kicad-project/commit.ts:478-484` builds a first-match `netIdByName` and calls the raw `loadSchematicProjection` (`:480`).
- Legacy board fill: `pcb-store.ts:3385-3415` `migrateLegacyBoardFill` inserts `{netId:null, netName:gndName}` board zones. It runs lazily from `loadPcbProjection` (`pcb-projection.ts:191`), dispatch and replay.
- Diff pairs: `shared/drc/diff-pair-resolver.ts:115-185` **never checks explicit pairs against `netNames`**. A pair on an inactive id survives into `pairs` (confirmed). Conflicts surface in `checks/signal-integrity.ts:64-86` as `DRC_RULE_INVALID`, and ambiguities as `DRC_RULE_INEFFECTIVE`.
- `DRC_RULE_INEFFECTIVE` severity is `"warning"` (`severity.ts:84`).
- Commands that carry net ids are not validated at the boundary (`command-executor.ts:1197-1300,1647,1714,2017,2059`):
  - `pcb_add_trace` / `pcb_add_via` / `pcb_add_manual_via` / `pcb_add_trace_via` / `pcb_commit_route`
  - autolayout apply
  - free pad add/update
  - zone add/update
  - `pcb_set_design_rules`
  - the zone net HTTP parser (`routes.ts:2272-2287`)

Command / history pipeline:
- `store.ts:752` `dispatchCommand` runs in one tx:
  - idempotency → OCC → `loadSchematicProjection` → legacy fill → PCB rows → `executeDesignerCommand` → merge gate (`:969-975`) → history → command log (`:1054-1067`, logs **every** result including refusals) → session history.
  - Handler error results still commit.
- Undo/redo:
  - `store.ts:348-427` `applyHistoryPatches`: world from current rows → `applyPatches` → `combinedStateFromWorld` → rows rewritten.
  - Patches are full component payloads. `replayHistory` has no recovery when the read-back throws.
- Merge guard: `net-merge-guard.ts`.
  - Gated commands: `upsert_label`, `place_gnd_port`, `place_pwr_port`, `place_net_portal` (`:94-107`).
  - `isNamed` uses the regex `AUTO_NET_NAME = /^Net_\d+$/` (`:16,28`). This is the only consumer of the `Net_<n>` pattern in the tree.
- `backend/results.ts:11` `parseDispatchResultJson` drops unknown fields and codes.
- Raw `loadSchematicProjection` callers outside `store.ts`:
  - `cloud-sync.ts:355` (`linkDesignToCloud` seed) and `:460` (`pushCloudSnapshot`). These push content to the cloud.
  - `command-executor.ts:613`, `arrange-schematic.ts:207`, `batch.ts:163`, `commit.ts:480`, `pcb-projection.ts:184`. These run inside a tx or a projection.

Consumers that already key by `net.id`:
- `padNets` (`pcb/net-pad-correlation.ts`)
- ratsnest and `UNCONNECTED_NET`
- `rule-compile.ts:502-552` (unknown net → `DRC_RULE_INEFFECTIVE`)
- `effectiveNetClassId`
- `checks/length.ts`
- gerber `netNames`
- board snapshot
- dataset capture

Export gating:
- `capability-quarantine.ts:10-23` `assertQualifiedManufacturing` is called at `routes.ts:3427,3443` and `sdk.ts:137`.
- Flag `designer.outputQuarantine` availability `prod` (`src/core/contracts/feature-flags/registry.ts:121-126`).

Storage:
- Migrations up to `0020_operation_receipts.sql`.
- Tables touched: `designHeads`, `schematicParts/Pins/Wires/Labels/Primitives`, `pcbEntities`, `commandLog`, `sessionHistories` (`schema.ts:11-220`).
- `deleteDesign` is at `store.ts:605-655`.
- Design ids are `crypto.randomUUID()` (`store.ts:514`). There is no design-duplication feature.
- SQLite is better-sqlite3 or bun:sqlite with `busy_timeout = 5000` (`core/backend/db/sqlite-client.ts:83,91`).

H13 note: `PcbPlacedPart.footprint` is a per-placement **snapshot** (`types.ts:977`). H13 never rewrites design rows (OPENPCB-61 A5), so library frame rewrites cannot move the pads that migration evidence uses.

---

## 3. Design

### 3.1 Module layout (layering per `OpenPCB/CLAUDE.md`)

```
src/shared/electrical-identity/          (shared; pure; no DB)
  reconcile.ts, types.ts, index.ts        S1: successor policy, comparePredecessors hook, transitions
  references.ts                           S2: enumerate/judge/rewrite persisted net references (pure)
src/shared/drc/checks/net-binding.ts      S9: NET_ORPHANED_COPPER
src/modules/designer/backend/net-identity/
  types.ts          S3  row types, id format + salt helpers
  state-store.ts    S3  state / ledger / quarantine / backup rows, ledger watermark
  bind.ts           S4  pure binder: lone pins, sanitise, fast path, names, override
  migrate.ts        S6  legacy migration + restore
  evidence.ts       S6  per-island contact + pour evidence
  ensure.ts         S5  lazy ensure, transient-vs-deterministic failure, auto-retry
  sync.ts           S5  commit-mode reconcile inside a command tx
  census.ts         S5  lazy dependents census (comparator + events)
  legacy-mode.ts    S5  identity mode resolution + legacy name binding (moved from pcb-projection)
  command-references.ts  S7  boundary validation + name resolution
  rebind.ts         S10 pcb_rebind_net_references
  summary.ts        S9  DesignerNetIdentitySummary
  export-gate.ts    S9  assertNetIdentityExportable / H19 snapshot populator
  index.ts          barrel
```
The designer imports only `src/shared/*`, `src/sdks/*` and `src/core/contracts/*`. Nothing outside the designer imports `backend/net-identity`. H14's importer lives inside the designer.

### 3.2 Data model

**Durable id.** `net:<salt>:<seq>`.
- `salt = designNetSalt(designId)`: lowercase RFC 4648 base32 (no padding) of the first 50 bits of `sha256(designId)`, which gives 10 characters.
- `seq` is a positive integer from a per-design monotonic counter.
- Regex: `^net:[a-z2-7]{10}:[1-9][0-9]*$`.
- The salt is deterministic, so migration stays reproducible, and an id pasted from another design (an MCP multi-design session) fails `isDurableNetIdOf(id, designId)` and is classified as `foreign-design`.
- The display name `Net_<seq>` does not show the salt.

**Lone-pin id.** `nc:<pinId>`.
- A *lone* component is one whose members are exactly one pin and nothing else.
- Allocation: the binder's allocator returns `nc:<pinId>` for a created lone component, and never spends a seq on it.
- Lone records are **never persisted** to `active_json` and are never fed back as `previousActive`.
- A lone component that *inherits* a durable id (the kept fragment of a split) stays durable and persisted.
- Effect: wiring two unconnected pins *creates* a net. There is no merge, no retirement, no ledger row and no event.
- `nc:` ids are active, valid net ids (routing from an unconnected pad still works). They are globally unique because pin ids embed the part UUID.

**Read-mode provisional ids** are `pending:<k>`. They appear only mid-batch for non-lone components created since the last sync. They are never persisted, and the boundary rejects them.

Any other string (`pt:…`, `w:…`) is **legacy/foreign**.

```ts
// backend/net-identity/types.ts
export const NET_IDENTITY_SCHEMA_VERSION = 1;
export const NET_IDENTITY_MIGRATOR_VERSION = 1;   // bump ⇒ failed designs auto-retry (§3.10.1)
export type NetIdentityStatus = "active" | "migration_failed" | "legacy_restored";
export type NetIdentityMode = "durable" | "legacy";   // durable ⇔ state row status "active"
export interface ActiveNetRecord {          // one entry of state.active_json (durable ids only)
  id: string;                               // net:<salt>:<seq>
  name: string;                             // display name at last commit (diagnostics only)
  nameSource: "auto" | "override" | "gnd" | "pwr" | "portal" | "label";
  members: ElectricalMember[];              // canonical: sorted by JSON.stringify([kind,id])
  displayOverride?: string;                 // H14 import name; applies only while the net is auto-named
}
export interface NetIdentityProvenance {
  origin: "native" | "legacy-migration" | "kicad-import";
  createdAt: string;
  migratorVersion: number;
  migration?: NetIdentityMigrationReport;
  restoredAt?: string;
}
export interface NetIdentityState {
  designId: string; schemaVersion: 1; status: NetIdentityStatus; nextSeq: number;
  active: ActiveNetRecord[]; provenance: NetIdentityProvenance; lastError: string | null;
}
export type NetRetirementReason = "removed" | "split" | "merged" | "reconfigured" | "history";
export type QuarantineReason =
  | "root_only" | "conflict" | "short" | "no_evidence" | "stale_root"
  | "unknown_name" | "ambiguous_name" | "assignment_conflict" | "diff_pair_collapsed";
export function designNetSalt(designId: string): string;
export function formatDurableNetId(salt: string, seq: number): string;
export function isDurableNetId(id: string): boolean;                     // any salt
export function isDurableNetIdOf(id: string, designId: string): boolean; // this design's salt
export function isLoneNetId(id: string): boolean;                        // /^nc:.+$/
export function isPendingNetId(id: string): boolean;                     // /^pending:\d+$/
export function seqOf(id: string): number | null;
```

**Migration `src/modules/designer/backend/migrations/0022_net_identity.sql`.** DDL only, with statements separated by `--> statement-breakpoint`. Migration `0021_pin_electrical_intent.sql` already owns the preceding slot; logical backups include its raw pin column.

```sql
CREATE TABLE designer_net_identity_state (
  design_id TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  next_seq INTEGER NOT NULL,
  active_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE designer_net_identity_retired (
  design_id TEXT NOT NULL,
  net_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reason TEXT NOT NULL,
  successor_ids_json TEXT NOT NULL,
  display_name TEXT,
  retired_at_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (design_id, net_id)
);
--> statement-breakpoint
CREATE INDEX designer_net_identity_retired_seq_idx ON designer_net_identity_retired (design_id, seq);
--> statement-breakpoint
CREATE TABLE designer_net_identity_quarantine (
  design_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  legacy_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  suggested_net_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (design_id, ref_kind, ref_id, legacy_value)
);
--> statement-breakpoint
CREATE TABLE designer_net_identity_backups (
  design_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (design_id, schema_version)
);
```
The Drizzle declarations in `schema.ts` are `netIdentityState`, `netIdentityRetired`, `netIdentityQuarantine` and `netIdentityBackups`.

Field semantics:
- `active_json` holds durable records only, sorted by `seqOf`.
- **Ledger watermark:** `seqWatermark = max(state.next_seq, 1 + SELECT MAX(seq) FROM retired WHERE design_id=?)` (indexed). This replaces passing the full ledger to the kernel. Recycling is impossible because the counter only grows, and the watermark defends against a corrupt `next_seq`.
- `ref_kind` ∈ `trace|via|free_pad|zone|net_class_assignment|length_group|diff_pair|drc_rule`.
- A quarantine row is an immutable provenance record. It is *open* iff the reference at `(ref_kind, ref_id)` still holds `legacy_value`. Nothing is flagged, so this is undo-safe.
- Ledger rows are not history-patched. Active wins over the ledger.
- `deleteDesign` deletes rows from all four tables in its existing tx.

`payload_json` of a backup holds everything that restore must put back. Every array is ordered by `id`, and the key order is fixed:
```json
{ "format": "openpcb.net-identity-backup/2", "designId": "...", "revision": 41,
  "schematic": { "parts": [...], "pins": [...], "wires": [...], "labels": [...], "primitives": [...] },
  "pcbEntities": [{"id":"...","kind":"trace","payloadJson":"...","createdAt":"...","updatedAt":"..."}],
  "sessionHistories": [{"id":"...","sessionId":"...","undoStackJson":"...","redoStackJson":"...","updatedAt":"..."}] }
```
Each row is stored with every column as read. `sha256` is the hex SHA-256 of `payload_json`.

### 3.3 Kernel change (S1) — `src/shared/electrical-identity`

```ts
export type ElectricalSuccessorPolicy = "retire" | "inherit-most-pins";
export interface ElectricalIdentityInput {
  readonly previousActive: readonly ActiveElectricalNet[];
  readonly currentComponents: readonly ElectricalComponent[];
  readonly retiredIds?: readonly string[];
  readonly allocateId: ElectricalNetAllocator;
  readonly successorPolicy: ElectricalSuccessorPolicy;            // NEW, required
  /** Higher finite priority wins between different predecessors before overlap counts. */
  readonly predecessorPriority?: (id: string) => number;
  /** NEW. Total preorder over predecessor ids; consulted only between pairs with different predecessors. */
  readonly comparePredecessors?: (firstId: string, secondId: string) => number;
}
export interface ElectricalNetTransition {
  readonly kind: "split" | "merge" | "reconfigure";
  readonly predecessorIds: readonly string[];
  readonly successorIds: readonly string[];
  readonly inherited: readonly { readonly fromId: string; readonly componentKey: string }[];
}
export interface ElectricalIdentityResult {
  /* existing fields unchanged */
  readonly transitions: readonly ElectricalNetTransition[];
}
```

Algorithm. The canonicalisation, validation and overlap graph are unchanged.
1. Partition the overlap graph into clusters.
2. A cluster with one predecessor and one successor preserves the predecessor's id.
3. Other clusters:
   - Under `retire`, the existing behaviour applies.
   - Under `inherit-most-pins`, take the candidate pairs `(p, c)` with `memberOverlap > 0` and sort them by the keys below. Then pick greedily: a pair is taken iff neither `p` nor `c` is taken yet, and `c` inherits `p.id`.

| # | Key | Order |
|---|---|---|
| 0 | `predecessorPriority(p.key)` (absent → 0; different predecessors only) | desc |
| 1 | `pinOverlap(p,c)` | desc |
| 2 | `memberOverlap(p,c)` | desc |
| 3 | `pinCount(c)` | desc |
| 4 | `pinCount(p)` | desc |
| 5 | `comparePredecessors(p.key, q.key)` (absent → 0) | as supplied |
| 6 | `compareText(p.key, q.key)` | asc (pure fallback; ids are opaque) |
| 7 | `compareMembership(c, d)` | asc |

   Successors not taken are allocated in canonical membership order. Predecessors not taken retire with the cluster reason. In a pure split the single predecessor is always taken.
4. `preservedIds` includes inherited ids, and `createdIds` contains only fresh ids.

Key 0 implements the named-net decision in `DECISIONS.md`: the binder ranks a predecessor with explicit naming provenance above an automatic predecessor. The kernel does not inspect display names. Priorities are finite and evaluated once per predecessor in canonical ID order. A user label literally named `Net_5` is explicit. Key 5 exists for remaining ties: "more dependents first, then lower numeric seq". Thus `net:…:10` vs `net:…:9` never sorts by text. Invalid callback results fail before allocation.

Existing tests pass `successorPolicy:"retire"`. New tests:
- split keeper
- merge survivor
- every tie key, in order, with key 5 overriding key 6 (`"…:10"` vs `"…:9"`)
- many-to-many
- permutation invariance over 200 seeds
- an inherited id is never retired
- no reuse

### 3.4 Derivation + binding (S4)

`projection-world.ts` refactor. The union-find code stays byte-identical:
```ts
export interface DerivedNetComponent {
  key: string;                 // union-find root == the LEGACY net id
  derivedName: string | null;  // GND / rail / portal / label name; null = unnamed
  nameSource: "gnd" | "pwr" | "portal" | "label" | "auto";
  legacyName: string;          // the exact name deriveNetsAndJunctions gives (incl. Net_<n>)
  pinIds: string[]; wireIds: string[]; labelIds: string[]; primitiveIds: string[];
}
export function deriveNetComponents(parts, wires, labels, primitives): NetComponentsResult;
/** LEGACY wrapper — byte-identical output. Used by S1 suites, migration and legacy mode. */
export function deriveNetsAndJunctions(parts, wires, labels, primitives): NetDerivationResult;
```

`backend/net-identity/bind.ts` (pure):
```ts
export interface BindInput {
  components: readonly DerivedNetComponent[];
  previousActive: readonly ActiveNetRecord[];
  salt: string;
  seqWatermark: number;                         // commit mode; read mode ignores
  mode: "commit" | "read";
  pinLabel: (pinId: string) => string | undefined;  // "<refdes>-<pinNumber>" from loadSchematicSource parts
  dependentCount?: (netId: string) => number;   // lazy census (§3.5.3); absent ⇒ 0
  priorOwner?: ReadonlyMap<string /*member token*/, string /*net id*/>; // replay only (§3.6)
}
export interface BindResult {
  nets: BoundNet[];                       // durable by seq, then nc by pinId, then pending by k
  nextActive: ActiveNetRecord[];          // durable only
  nextSeq: number;
  inSync: boolean;                        // persisted membership and naming metadata match; no pending identities or sanitisation
  createdIds: string[]; preservedIds: string[];     // durable only
  retirements: ElectricalNetRetirement[]; transitions: ElectricalNetTransition[];
  sanitized: Array<{ token: string; keptId: string; droppedFrom: string[] }>;
}
export function bindNetIdentity(input: BindInput): BindResult;
```
Steps:
1. **Sanitise `previousActive`** (`sanitizePreviousActive`). For each member token claimed by two or more records, choose the owner by these keys, in order:
   1. `priorOwner.get(token)`, when that record is present.
   2. A record whose id is in `priorOwner`'s value set.
   3. The lowest numeric seq.
   4. `compareText`.

   Then remove the token from the other records and drop any record left empty. This is for contested history-world inputs. Stored state requires unique ownership across records; a corrupt persisted row is reported as unavailable and preserved rather than silently discarding an identity and its provenance.
2. **Fast path.** Index the records by their first canonical token. Match every persisted record, including a durable lone-pin record, against exact canonical membership. Unmatched lone components get `nc:` ids. If all records and non-lone components match, bypass the kernel and census; still refresh display names and naming provenance. `inSync` is true only when persisted naming metadata also matches. Removing or renaming a label must not leave stale merge priority.
3. Otherwise call the kernel with:
   - `successorPolicy:"inherit-most-pins"`
   - `predecessorPriority = id => previous[id].nameSource === "auto" ? 0 : 1`
   - `comparePredecessors = (a,b) => (dep(b)-dep(a)) || (seqNum(a)-seqNum(b))`, where `seqNum` of a non-durable id is `+∞`
   - `retiredIds: []`, because the watermark replaces it
   - the allocator: a lone component gets `nc:<pinId>`; otherwise commit mode gives `formatDurableNetId(salt, nextSeq++)` and read mode gives `pending:${k++}`
   - `nextSeq` starts at `max(seqWatermark, 1 + max seq(previousActive))`
4. Filter `nc:` ids out of `nextActive`, `createdIds`, `preservedIds` and the `inSync` computation.

Display names. Sort order is durable by seq, then lone, then pending.
1. A named net (`derivedName !== null`) uses `derivedName`, with `autoNamed:false`.
2. Otherwise, a durable net with `displayOverride` uses the override, with `autoNamed:false` and `nameSource:"override"`. This follows the explicit-name decision in `DECISIONS.md`.
3. Otherwise, a durable net uses `Net_<seq>`, a lone net uses `unconnected-(<pinLabel>)` (fallback `unconnected-(<pinId>)`), and a pending net uses `Net_pending_<k>`. All of these have `autoNamed:true`.
4. Collision rule. Process the names in this order: named, then override, then auto. If `upper(name)` equals any name already taken, append the first free `_1`, `_2`, …. Display names are therefore unique case-insensitively across the projection, so boundary name resolution can never be ambiguous between a label and an auto or override name.

SDK (additive): `DesignerDerivedNet.autoNamed?: boolean`.

`projection-read.ts`:
- `loadSchematicSource(db, designId)` returns the rows in `createdAt` order, as today.
- `loadSchematicProjection(db, designId)` resolves the mode from the state row:
  - **durable** (status active): `bindNetIdentity({mode:"read", previousActive: state.active, dependentCount: lazyCensus(db, designId)})`.
  - **legacy** (no row, `migration_failed`, `legacy_restored`): the `deriveNetsAndJunctions` output unchanged (legacy roots and legacy names). This is exactly the pre-H08 behaviour.
- **It never writes.**
- Outside a batch, a durable design is always in sync after every commit, so the read path hits the fast path and never reads PCB rows.

### 3.5 Commit-mode sync (S5) — `backend/net-identity/sync.ts`

#### 3.5.1 API
```ts
export interface NetIdentitySyncResult { changed: boolean; events: DesignerNetIdentityEvent[] }
export function resolveIdentityMode(tx: DbClient, designId: string): { mode: NetIdentityMode; state: NetIdentityState | null };
export function syncNetIdentity(tx: DbClient, designId: string, revision: number, timestamp: string): NetIdentitySyncResult;
export function initializeNetIdentity(tx: DbClient, designId: string, origin: "native" | "kicad-import", timestamp: string): readonly BoundNet[];
export function setNetDisplayOverride(tx: DbClient, designId: string, netId: string, name: string | null): void;
export function isSchematicNeutralCommand(command: DesignerCommand): boolean;
```

`syncNetIdentity` (durable mode only):
1. Read the state row.
2. Derive from `loadSchematicSource(tx)`.
3. Compute the watermark.
4. `r = bindNetIdentity({mode:"commit", previousActive: state.active, dependentCount: lazyCensus(tx), …})`.
5. If `r.inSync`, return `{changed:false, events:[]}`.
6. Write `active_json` and `next_seq`. Upsert a ledger row per durable retirement, with `seq` and `display_name` from the previous record and `retired_at_revision`.
7. Build events (§3.5.3).

`isSchematicNeutralCommand`:
- True for every `pcb_*` type, and for a batch whose steps are all neutral.
- Dispatch **skips sync** for neutral commands. This covers slider drags and `pcb_set_view_state`.
- Defence: when `NODE_ENV !== "production"`, dispatch also runs the full bind for a neutral command and throws `Error("schematic-neutral command changed membership: <type>")` unless `inSync`. Tests therefore catch any `pcb_*` handler that writes schematic rows, and the implementer must remove that type from the neutral set.

`initializeNetIdentity`:
- Inserts `{status:"active", next_seq:1, active_json:"[]", provenance:{origin, migratorVersion}}`.
- Runs one commit-mode bind and persists it.
- Returns the bound nets.
- Called by `insertDesign` (`"native"`) after `ensurePcbBoardSettings`, and by the KiCad import (S8, later H14) inside its tx after the schematic insert.

`setNetDisplayOverride` (H08-b seam for H14):
- Validates the name: trimmed, 1–128 chars, not matching `^Net_(pending_)?\d+(_\d+)?$` and not starting with `unconnected-(`.
- Requires the id to be active and durable.
- Writes `displayOverride` into that `ActiveNetRecord`. `null` clears it.
- The override travels with the id through splits (the kept fragment keeps it) and through history, because the `designer.net_identity` component payload carries it (§3.6).
- It is ignored while the net is label-named.
- There is no command and no HTTP route in H08. Only the import seam calls it.

#### 3.5.2 SDK additions (additive)
```ts
export interface DesignerNetDependents {
  traces: number; vias: number; zones: number; freePads: number;
  netClassAssignment: boolean; lengthGroupIds: string[]; diffPairIds: string[]; drcRuleIds: string[];
}
export type DesignerNetIdentityEvent =
  | { kind: "split"; netId: string; netName: string; keptPinCount: number; hasDependents: boolean;
      newNets: Array<{ netId: string; netName: string; pinCount: number }>; dependents: DesignerNetDependents }
  | { kind: "merge"; survivorNetId: string; survivorName: string; hasDependents: boolean;
      retired: Array<{ netId: string; netName: string; pinCount: number; dependents: DesignerNetDependents }> }
  | { kind: "reconfigure"; hasDependents: boolean;
      predecessors: Array<{ netId: string; netName: string; retired: boolean; dependents: DesignerNetDependents }>;
      successors: Array<{ netId: string; netName: string }> }
  | { kind: "removed"; netId: string; netName: string; hasDependents: true; dependents: DesignerNetDependents };
export interface DesignerNetIdentityOutcome { events: DesignerNetIdentityEvent[] }
// DesignerCommandOkResult += netIdentity?: DesignerNetIdentityOutcome
// DesignerHistoryActionOkResult += netIdentity?: DesignerNetIdentityOutcome
```
There is **no** `NET_IDENTITY_UNAVAILABLE` result. A non-active design runs in legacy mode instead (§3.5.4), so no refusal is ever written to the command log.

#### 3.5.3 Census, events and visibility
- `census.ts lazyCensus(db, designId)` runs `enumerateNetReferences` once, on first call, over the persisted PCB rows plus the parsed board settings. It returns the per-id counts.
  - It is called only when the kernel needs key 5, or when events are built.
  - During replay, the census reads the **post-patch** PCB state (§3.6).
- Event emission:
  - **Transitions** (split, merge, reconfigure) are emitted whenever they involve a durable predecessor.
  - **`removed`** is emitted only when the retired id has dependents.
  - A split's `hasDependents` reflects the split predecessor. For a merge or reconfigure it is true iff some retired predecessor had dependents.
- Every event goes into the frontend's session **Net changes** activity list (S11): an unread badge on the DRC toolbar button plus a section in `NetIdentityPanel`. That is the always-visible split warning.
- **Toasts** fire only when `hasDependents`.
- Drawing a wire from an unconnected pin is a creation (lone pins, §3.2), so ordinary schematic capture produces neither toasts nor list entries.
- Q2 asks whether every split should also toast.

`results.ts`:
- `parseNetIdentityOutcome(raw)` drops a malformed payload rather than throwing.
- It is wired into `parseDispatchResultJson` and the history-result parser, as P103 requires.

#### 3.5.4 Identity mode and dispatch wiring
- Mode is decided **inside** every tx by `resolveIdentityMode`: durable iff the state row exists with status `active`.
- **Legacy mode** is the degraded mode. It is exactly pre-H08 behaviour:
  - legacy derivation
  - legacy projection-time name binding, moved verbatim into `legacy-mode.ts bindLegacyNetNames`
  - no sync and no identity entities
  - boundary validation off
- Legacy mode applies to unmigrated designs (transient ensure failure), to `migration_failed` and to `legacy_restored`.
- It is editable, and its export is always blocked (`exportBlocked`, §3.9).
- When a later migration succeeds, it consumes legacy-mode edits exactly like any legacy data, and it archives the legacy-mode histories.

`store.ts dispatchCommand`:
1. Before the tx, call `ensureNetIdentity(db, designId, logger)` (§3.10.1). It never throws.
2. Inside the tx, call `resolveIdentityMode`, then pass `identityMode` to `loadPcbProjection`-equivalent assembly and to `executeDesignerCommand` (`legalityFor`).
3. After `executeDesignerCommand` (ok or not), in durable mode and unless the command is neutral, call `syncNetIdentity(tx, designId, result.ok ? result.revision : head.revision, ts)`. Successful command results carry `netIdentity` before the command-log insert. A failed result must not introduce an identity change: if sync detects one, roll back the command transaction rather than committing unreported electrical mutations without a revision or history entry. Bulk placement moves validate every requested ID before their first write.
4. The merge gate, history capture and `nextProjection` stay where they are.

**Batch.** Steps read in read mode. Fragments created mid-batch show as `pending:`, or as `nc:` when lone, until the final sync. The boundary rejects pending ids.

**S5 removes projection-time binding for durable designs.**
- `assemblePcbLegalityInput` takes `identityMode`:
  - durable: traces, vias and zones pass through unchanged, and `ambiguousZoneIds` is empty;
  - legacy: `bindLegacyNetNames`, the old code.
- `legalityFor.boundTrace/boundVia` stay (they return the assembly row, which is identity in durable mode). Their comments are rewritten to say "legacy mode only binds".
- `migrateLegacyBoardFill` gains `mode: "bound" | "name-hint"`:
  - `bound` (dispatch, replay, projection in durable mode) writes `{netId: gndNetId, netName:null}`, or `{null,"GND"}` when there is no GND net, which is fail-closed and flagged.
  - `name-hint` (migration and legacy mode) keeps today's form.
- `net-merge-guard.ts isNamed` becomes `net.autoNamed === undefined ? !AUTO_NET_NAME.test(net.name) : !net.autoNamed`. Collision-suffixed and `unconnected-(…)` names must not count as named.

### 3.6 History integration (S5) — exact undo/redo

`projection-world.ts`:
- `DesignerWorldComponent` += `{ type: "designer.net_identity"; payload: ActiveNetRecord }`. Preserve `name` and `nameSource` as well as membership and `displayOverride`; predecessor priority cannot be reconstructed from display text.
- `projectionEntityComponents` emits the entity `net_identity:<id>` from an explicit active-record snapshot for **durable** ids only. Lone and pending ids are skipped. Pass complete before/after records to both schematic and combined history builders; public projection nets do not contain display overrides.
- `worldEntityComponents` adds the type.
- `projectionFromWorldWithIdentity(designId, revision, world, binder)` reads the identity components as `previousActive` and returns `{projection, bind, previousActive}`. The explicit binder selects read or commit mode. `projectionFromWorld` retains its legacy behavior for callers without identity state; an empty active set cannot determine the mode. Durable replay always supplies a binder.

`store.ts applyHistoryPatches`:
1. `ensureNetIdentity` first. Inside the tx, resolve the mode. Legacy mode replays exactly as today, with no binder.
2. Build the world and apply the patches.
3. Call `combinedStateFromWorld(..., binder)`. The binder runs commit mode with:
   - `previousActive` = the world identity components;
   - `priorOwner` = the token→id map of the **DB state row before replay**;
   - `dependentCount` = the census over the post-patch PCB rows, decoded from the patched world before the binder runs (or persisted earlier in the same transaction). Reading the old DB rows during `combinedStateFromWorld` would use the wrong dependents;
   - the watermark from the state row.
4. `persistReplayIdentity`:
   - It writes `active_json` and `next_seq` and upserts ledger rows for the kernel retirements.
   - It also writes `"history"` ledger rows for every id in the prior DB state that is absent from `nextActive`. That includes records dropped by sanitisation.
   - It returns events.

**Why this is exact.** Undoing a split restores `X{A∪B}` and deletes `Y`, and derivation then matches `X` exactly. Redo recreates `Y`. The counter is never rolled back, so `Y` is never reallocated. While `Y` is inactive its copper is orphaned, which is correct.

**Cross-session contested members (review finding 1).**
- Scenario: session A deletes wire `w1`, splitting `X{p1,p2,w1}` into `X{p1}` and a lone `nc:p2`. Session B draws `w2: p2→p3`, creating `Z{p2,p3,w2}`. Then A undoes.
- The patch restores `X{p1,p2,w1}`, so the world holds both `X…p2` and `Z…p2`.
- Sanitisation gives `p2` to `Z`, its prior DB owner, leaving `X{p1,w1}`.
- Derivation finds `{p1,p2,p3,w1,w2}`, so the kernel sees a merge of `X` (1 pin) and `Z` (2 pins). `Z` survives, and `X` retires as `merged`.
- The history result carries the merge event, which toasts if `X` had copper. **The undo succeeds deterministically.** Without sanitisation the kernel would throw on every attempt.
- This exact scenario is a test in `designer-net-identity-history.test.ts`.

**Legacy history stacks** are archived in the backup and deleted by the migration (§3.10 step 9).

### 3.7 Dependents, inertness and "dropped" assignments

- Consumers ignore inactive ids:
  - `rule-compile` gives `unknown_net`, reported as `DRC_RULE_INEFFECTIVE`.
  - Length groups skip unresolved ids.
  - `effectiveNetClassId` only consults the routed net.
- **Diff pairs (mandatory S9 guard).** `resolveDiffPairsFull` gets a new conflict reason `"unknown-net"` for an explicit row whose `pNetId` or `nNetId` ∉ `netNames`:
  - The row still claims its nets, so the name heuristic does not re-infer the pair.
  - It is excluded from `pairs`.
  - `checkSignalIntegrity` reports it as `DRC_RULE_INEFFECTIVE`, not as INVALID: the row is well-formed but inert. The message is `Diff pair <name> has no effect: net <id> no longer exists. Rebind or remove it.`
  - Test: a diff pair on a retired id yields exactly that violation and no `DIFF_PAIR_*` judgement.
- A merge loser's assignments become inert immediately. The merge event and the summary report them, and they **block export until rebound or dropped** (§3.9).
- Physical pruning happens only through `pcb_rebind_net_references` (§3.13).
- A reference to `nc:<pinId>` that is no longer active has an exact suggestion: the current net containing `pinId`.

### 3.8 Boundaries — names resolve once, at the edge (S7, S8)

`command-references.ts normalizeCommandNetReferences({command, projection, tx, designId, mode})` is called in `executeDesignerCommand` after the `batch_commands` branch. It is a **no-op in legacy mode**.

The active set is `{net.id ∈ projection.nets | isDurableNetIdOf(id, designId) || isLoneNetId(id)}`.

| Command | Field(s) | Rule |
|---|---|---|
| trace/via add, route commit, autolayout apply | `netId` | null is OK; otherwise it must be active |
| free pad add/update | `netId` | same |
| `pcb_add_zone`, `pcb_update_zone` | `net` | `netId` present ⇒ it must be active; normalise to `{netId, netName:null}`. `netId` null + non-empty `netName` ⇒ resolve by unique case-insensitive trimmed **display** name over all nets (overrides and auto names included; unique by construction, §3.4). One match ⇒ `{match, null}`. None ⇒ DANGLING `unknown-name`. More than one (only possible with stale clients) ⇒ AMBIGUOUS |
| `pcb_update_zone` enabling a disabled zone | effective stored `net` when omitted | Validate and normalize the effective reference before enabling it; re-enabling must not introduce orphaned copper through an omitted field |
| `pcb_set_design_rules` | assignments, length groups, diff pairs, rule scopes | Only **newly introduced** refs are validated, so stale stored refs can be re-saved unchanged |

Results:
```ts
| { ok:false; code:"NET_REFERENCE_DANGLING"; field: string; netId: string | null; netName?: string;
    reason: "unknown" | "retired" | "pending" | "foreign" | "foreign-design" | "unknown-name";
    successorIds: string[]; detail: string }
| { ok:false; code:"NET_REFERENCE_AMBIGUOUS"; field: string; netName: string; candidates: string[]; detail: string }
```
Reason classification:

| Id | Reason | `successorIds` |
|---|---|---|
| `pending:` | pending | — |
| durable, other salt | foreign-design | — |
| durable, own salt, in ledger | retired | ledger successors |
| durable, own salt, not in ledger | unknown | — |
| `nc:<pin>` not active | retired | the net containing the pin |
| anything else | foreign | — |

Both codes are added to `results.ts`.

For rule references, “unchanged” means the same owner and net ID: assignment key, length-group ID,
differential-pair ID and member, or DRC-rule ID. Reordering a rule's net scopes does not introduce
a reference, but copying a stale reference to another owner does. Boundary validation preserves
structural errors for the existing strict rule validator instead of normalizing them away.

Post-H08 native write rule:
- Copper written by commands carries `netName:null`.
- **`netId === null && netName` non-empty ⇔ unresolved binding**, and an enabled unresolved zone is copper (§3.9).

S8 import seam (`import/kicad-project/commit.ts`, inside the tx after `insertSchematicEntities`):
1. `nets = initializeNetIdentity(tx, designId, "kicad-import", ts)`.
2. `resolvePerNetClassAssignments` matches **named nets only**, using exact case-sensitive imported names. Generated automatic names are not identity evidence; an explicitly named `Net_5` remains eligible. A duplicate name warns `kicad_netclass_assignment_ambiguous_net` and skips.
3. Settings are written once.
4. `insertPcbEntities`.
5. `resolveImportedNetHints`:
   - A unique exact named match sets `netId` and keeps `netName` as provenance. Import never repairs spelling, case or whitespace by selecting another net. Blank hints remain unassigned.
   - Zero or several matches add a quarantine row (`unknown_name` / `ambiguous_name`), keep the row as is, and add the warning `kicad_net_unresolved` / `kicad_net_ambiguous`.
6. The synthetic command log.

The raw `loadSchematicProjection` at `commit.ts:480` is replaced by `nets`. H14 later replaces this whole block through the same seams.

### 3.9 Read status, summary (S9)

`DesignerPcbProjection` += `netIdentity?: DesignerNetIdentitySummary`:
```ts
export type DesignerNetReferenceSite =
  | { kind: "trace"; traceId: string } | { kind: "via"; viaId: string }
  | { kind: "freePad"; freePadId: string } | { kind: "zone"; zoneId: string }
  | { kind: "netClassAssignment" } | { kind: "lengthGroup"; groupId: string }
  | { kind: "diffPair"; pairId: string; member: "p" | "n" } | { kind: "drcRule"; ruleId: string; scopeIndex: number };
export interface DesignerNetReferenceGroup {
  netId: string | null;
  netName: string | null;
  reason: "retired" | "legacy-quarantine" | "unknown" | "unresolved-name";
  successorNetIds: string[];
  suggestedNetId: string | null;
  candidateNetIds: string[];
  copper: { traceIds: string[]; viaIds: string[]; zoneIds: string[]; freePadIds: string[] };
  disabledZoneIds: string[];              // inert: listed, never blocking
  rules: DesignerNetReferenceSite[];
}
export interface DesignerNetIdentitySummary {
  status: "active" | "migration_failed" | "legacy_restored" | "unmigrated";
  mode: "durable" | "legacy";
  origin: "native" | "legacy-migration" | "kicad-import" | null;
  lastError: string | null;
  historiesArchived: number | null;
  groups: DesignerNetReferenceGroup[];
  orphanedCopperCount: number;            // enabled copper only
  inertRuleReferenceCount: number;        // rule-side refs with verdict inactive (retired, quarantined, unknown)
  exportBlocked: boolean;                 // mode === "legacy" || orphanedCopperCount > 0 || inertRuleReferenceCount > 0
}
```
- `summary.ts` reads the state, the ledger and the quarantine rows, then `enumerateNetReferences` (S2) over the projection rows.
- In legacy mode, `groups` is empty and only the status and error are shown.
- Rule-side inert references block export. Otherwise DRC can pass on looser default clearances while a high-voltage class assignment sits inert. Repair is one click: rebind, or drop with `toNetId:null`.

### 3.10 Legacy migration (S6) — `migrate.ts`, `evidence.ts`; ensure (S5)

```ts
export type MigrationStage = "backup" | "fill" | "derive" | "evidence" | "rewrite" | "quarantine" | "histories" | "state";
export interface NetIdentityMigrationReport {
  schemaVersion: 1; migratorVersion: number; revisionBefore: number; revisionAfter: number; netsAllocated: number;
  references: { total: number;
    bound: { rootAndContact: number; rootAndPour: number; contact: number; nameHint: number; autoNameHint: number };
    quarantined: Partial<Record<QuarantineReason, number>>; };
  historiesArchived: number;
  boardSettings: "migrated" | "absent" | "unparseable";
}
export class NetIdentityMigrationError extends Error { constructor(readonly stage: MigrationStage, message: string) }
export function migrateDesignNetIdentity(tx: DbClient, designId: string,
  opts: { timestamp: string; fault?: (stage: MigrationStage) => void }): NetIdentityMigrationReport;
export function ensureNetIdentity(db: DbClient, designId: string, logger: Logger,
  opts?: { fault?: (stage: MigrationStage) => void }): NetIdentityStatus | "unmigrated";
export function retryNetIdentityMigration(db: DbClient, designId: string, logger: Logger): NetIdentityStatus | "unmigrated";
export function restoreLegacyNetIdentity(db: DbClient, designId: string,
  opts: { timestamp: string; confirmDiscardRevisions: boolean }): { revision: number };
```

#### 3.10.1 `ensureNetIdentity` (never throws)
- **Row `active` or `legacy_restored`:** return the status.
- **Row `migration_failed`:**
  - If `provenance.migratorVersion < NET_IDENTITY_MIGRATOR_VERSION`, migrate again while retaining the row and its allocation watermark until the transaction succeeds. This is the automatic retry after a fixed build.
  - Otherwise return `migration_failed`.
- **No design head:** return `"unmigrated"`.
- **Otherwise:** `db.transaction(tx => migrateDesignNetIdentity(tx, …))`. On error the tx rolls back and nothing changes. Then:
  - **Transient:** `error.code` ∈ {`SQLITE_BUSY`, `SQLITE_LOCKED`, `SQLITE_IOERR*`, `SQLITE_FULL`, `SQLITE_READONLY`, `SQLITE_CANTOPEN`, `SQLITE_INTERRUPT`}. Call `logger.warn` and return `"unmigrated"` **without writing**. The next entry point retries, and meanwhile the design runs in legacy mode.
  - **Concurrent:** `SQLITE_CONSTRAINT` on the state PK. Re-read and return the status.
  - **Anything else is deterministic.** In a separate tx, write `{status:"migration_failed", next_seq:watermark, active_json:"[]", provenance:{origin:"legacy-migration", createdAt, migratorVersion}, last_error: "<stage>: <message>"}`, call `logger.error`, and return `migration_failed`. The watermark is 1 only for a never-migrated design. Invalid or unsupported existing identity state must remain untouched and be reported as unavailable; it must never be mistaken for an absent state.

Call sites:
- the store's `getSchematicProjection`, `getPcbProjection`, `getBomProjection` and `getDesign`
- `dispatchCommand` and `replayHistory` (before the tx)
- `sdk.getManufacturingExportSummary`
- **`cloud-sync.ts` `linkDesignToCloud` and `pushCloudSnapshot`, before compatibility checks and network writes.** The current cloud protocol does not preserve durable identity state: its projection normalizer drops the state envelope, and command handlers preserve stale derived net arrays. Refuse linked writes when identity state or its retirement ledger exists, including an empty active set or a restored allocation watermark. An in-flight historical acknowledgment cannot clear this unsupported-state error. Do not recover a migration revision gap by automatically pushing a snapshot: the peer lacks an expected-base/content-digest comparison and a higher revision can overwrite divergent remote work.
- Cloud import is an explicitly unlinked new copy. Reject durable/pending/lone identity references or identity metadata before creating local rows until a versioned import protocol preserves membership, allocation watermarks, retirement history and overrides. A projection's net array alone cannot reconstruct that state.

Recoverability of a failed migration:
- The design stays fully editable in legacy mode, and export is blocked.
- The panel shows `lastError` and a Retry button (`POST …/migrate`).
- A build with a fixed migrator retries automatically.
- Nothing was written by the failed attempt, so no restore is needed.

#### 3.10.2 `migrateDesignNetIdentity` (caller tx; deterministic; no clock but `opts.timestamp`)
1. **Head.** Read `revisionBefore`, or throw `NetIdentityMigrationError("backup", "no head")`.
2. **Backup** (`fault?.("backup")`):
   - Select the design's schematic parts, pins, wires, labels and primitives, its `designer_pcb_entities` rows and its `designer_session_histories` rows. This happens **before any write, legacy fill included**.
   - Build `payload_json` (§3.2) and its sha256.
   - `INSERT OR REPLACE` into `designer_net_identity_backups (design_id, 1, revisionBefore, …)`.
3. **Legacy fill** (`fault?.("fill")`): call `migrateLegacyBoardFill` in name-hint mode, where `legacyNetNames` comes from `deriveNetsAndJunctions(loadSchematicSource(tx))`. Supply deterministic row IDs derived from the design ID and zone ID; ordinary callers retain their existing UUID allocation. The GND plane therefore arrives as a `"GND"` name hint and binds by name in step 6. Do not normalize or rewrite an unparseable board-settings row.
4. **Derive** (`fault?.("derive")`):
   - First check source fidelity against the backup: dropped or malformed wire vertices, unknown primitive kinds and malformed declared rail/portal text must fail recoverably. A reader's recovery must not become authoritative connectivity. Preserve unknown extension fields without interpreting them.
   - `deriveNetComponents`, then bind in commit mode with `previousActive=[]`, the retained allocation watermark, and the design salt. Raise that watermark above every exact own-design durable ID observed in the raw backup, including object keys and decoded PCB/history JSON. A never-migrated design starts at 1 only when no such IDs exist. Allocation follows canonical membership order. Re-migration must not recycle previously issued durable IDs or allocate an ID that an unproven raw reference already holds.
   - Maps:
     - `R: legacyRoot → id` (durable or `nc:`)
     - `named: upper(name) → id[]` (named nets only)
     - `legacyAuto: upper(legacyName) → legacyRoot[]` (auto-named components only)
5. **Evidence** (`evidence.ts`, `fault?.("evidence")`):
   ```ts
   export interface CopperIsland {
     itemKeys: string[]; refKeys: string[]; legacyIds: Set<string>;
     directPadNets: Set<string>; padNets: Set<string>; pourNetIds: Set<string>; pour: boolean;
   }
   export function legacyContactEvidence(input: {
     board: PcbBoardSettings;
     placements: readonly PcbPlacedPart[]; // Unsynced snapshots, qualified for positive proof.
     padNetIds: ReadonlyMap<string, string>; // Authoritative bound schematic correlation.
     traces: readonly PcbTrace[]; vias: readonly PcbVia[]; freePads: readonly PcbFreePad[];
     freeHoles: readonly PcbFreeHole[]; zones: readonly PcbZone[]; keepouts: readonly PcbKeepout[];
     legacyRootIds: ReadonlyMap<string, string>;
     netNames: ReadonlyMap<string, string>; // Target ID to legacy display name for rule evaluation.
     nameBoundZones: ReadonlyArray<{ zone: PcbZone; netId: string }>;  // enabled zones whose hint matched exactly one NAMED net
     allowPourEvidence: boolean;
   }): LegacyContactEvidence;
   ```
   - `LegacyContactEvidence` includes physical islands, `islandOf` keyed by physical item key,
     `evidenceByRef` keyed by `JSON.stringify([kind, id])`, pooled root evidence and pour-disable
     reasons. A free pad can occupy independent physical islands on different layers; reference
     evidence aggregates them without inventing a plated connection.
   - **Positive contact proof uses the fail-safe connectivity geometry.** Build records from the unsynced placements and authoritative schematic pad map, then `toCopperItems`. Keep schematic labels out of band and give proof items a common temporary net ID for `computeConnectivity`. Reject invalid layers/spans/types and inexact pad geometry as positive evidence. Unplated copper remains separate per layer and is not an authoritative schematic source. `padNets(I)` is the set of valid schematic pad labels touched by the physical component. DRC's layer clamping and `SHORT_EPS_MM` proximity are not positive connection proof.
   - **Pour evidence requires actual pad-connected filled copper.** The evidence input additionally carries board settings, outline/cutouts, free holes, all zones/keepouts, legacy-root mappings and legacy display names for rule evaluation. A candidate island must have at least one legacy ID; every such ID must map to the same target, with no contradicting direct pad evidence. Hypotheses are constructed only in memory. All rules, holes, keepouts, thermal connections, priorities and island pruning go through the existing fill composition. Only independently name-bound zones contribute proof fills; other effective zones still provide exclusions. Parse losses or zone/keepout derivation warnings disable pour proof conservatively.
     - An island gains pour evidence only when a successful filled connectivity component reaches an independently schematic-labelled pad of that target. Region overlap and `attached:true` are insufficient: the candidate via itself can make an otherwise isolated island "attached".
     - Invalid/inexact geometry remains a fill obstacle but cannot supply proof. Failed/empty fills, null-only islands and disconnected copper islands supply no pour proof. Multi-layer free-pad references aggregate their independent item evidence conservatively.
     - The frozen pour-only GND fixture proves four vias. A keepout around one via proves three; a board-spanning keepout proves only the two vias sharing the pads' island; `padConnection:"none"` proves none. These are mandatory regression cases.
   - Rule-side pooled evidence: `Eiso(S) = { x | island I carries S, padNets(I) = {x} }`. Shorted islands (`|padNets| ≥ 2`) are ignored here because they are a copper problem. Pooling per island means a root historically reused on two islands no longer produces a false `short`.
6. **Classify** (`enumerateNetReferences` over copper rows and parsed settings):
   - **Foreign-id references** (`netId = S`): `r = R(S)`. For copper, `e = padNets(island of the item)`. For zones and rule refs, `e = Eiso(S)`.

     | `r` | `e` | Copper ref | Rule ref |
     |---|---|---|---|
     | defined | `{r}` | bind (`rootAndContact`, or `rootAndPour`) | bind |
     | undefined | `{x}` | bind `x` (`contact`) | quarantine `stale_root`, suggest `x` |
     | defined | `∅` | quarantine `root_only`, suggest `r` | same |
     | defined | `{x≠r}` | quarantine `conflict`, suggest `x`, candidates `{r,x}` | quarantine `conflict`, candidates `{r,x}` |
     | any | `≥2` | quarantine `short`, candidates `e ∪ {r}` | quarantine `conflict`, candidates `e ∪ {r}` |
     | undefined | `∅` | `no_evidence` | same |

   - **Name hints** (`netId === null && netName` non-empty; trace, via, zone): `h = upper(trim(netName))`. `N = named[h]`, `A = legacyAuto[h]`.
     - `|N| = 1, |A| = 0`: bind (`nameHint`) and keep `netName`.
     - `|N| = 0, |A| = 1`: this is a UI-written auto-name hint, such as `{null,"Net_3"}` from `netRefForPick`. Pre-H08 it bound to that legacy root at this exact derivation. Classify it as a foreign reference with `S = A[0]` using the table above, counting it as `autoNameHint` when bound. A zone uses `Eiso(S)`.
     - `|N| + |A| ≥ 2`: `ambiguous_name` with candidates. Pre-H08 first-match is never reproduced.
     - `0`: `unknown_name`.
7. **Rewrite** (`fault?.("rewrite")`):
   - Before writing, refuse a migration if a quarantined non-null reference already equals an active result ID. Reserving observed durable sequences prevents the allocation case; a colliding `nc:` reference must fail recoverably rather than appear bound merely because its string matches. Hidden physical rows that failed parsing and ambiguous payload identities also require recoverable failure. Never reinterpret a malformed declared net ID through a parser's null fallback.
   - Copper: set `netId` on bound refs, then **clear `netName` on `autoNameHint` bindings** (the auto name is meaningless). Keep `netName` on `nameHint` bindings as provenance.
   - Copper rows are updated in place (same id and `created_at`, new `updated_at`). Quarantined refs keep their legacy value **unchanged**.
   - Board settings: plan bound-reference changes on parsed `PcbBoardSettings`, then patch only those reference fields into the original raw record and serialize through the shared `serializeRawBoardSettings` migration path. Require exact old-field matches and unique raw row identities for every touched declaration. Unknown scope metadata, malformed unrelated known values and unparsed array entries must survive. A normal typed settings save would normalize unrelated values and lose unknown scope keys when their net IDs change; it is not suitable for this automatic migration.
     - `perNetClassAssignments`: re-key. When two legacy keys map to one id with different classes, bind the key whose legacy string sorts first by `compareText`; retain the losing declaration under its original legacy key and quarantine it as `assignment_conflict`. Deleting that declaration would immediately close its quarantine provenance and hide the unresolved assignment.
     - `lengthMatchGroups[].netIds`: map, dedupe, keep the order.
     - `diffPairs`: if p and n map to the same id, quarantine both as `diff_pair_collapsed` and leave the pair unchanged.
     - `drcRules` net scopes: map and dedupe.
     - Unparseable raw settings: leave them, report `boardSettings:"unparseable"`, and continue. Their canonical in-memory recovery can still expose references; refuse if any skipped recovered reference already equals an active result ID. Otherwise an unproven lone-pin assignment could silently become bound despite never appearing in the migration report.
8. **Quarantine rows** (`fault?.("quarantine")`). Count each declared reference occurrence in the report, but deduplicate identical provenance primary keys before insertion. Reference IDs are entity IDs for copper and length groups, `perNetClassAssignments` for assignments, JSON tuples `[pairId, member]` for differential pairs, and `[ruleId, scopeIndex]` for DRC scopes. Preserve the exact original ID or name hint as `legacyValue`.
9. **Histories:** delete the design's `designer_session_histories` (`fault?.("histories")`).
10. **Head:** `revision = revisionBefore + 1`.
11. **State:** insert `{status:"active", next_seq, active_json, provenance:{origin:"legacy-migration", migratorVersion, migration: report}}` (`fault?.("state")`).

#### 3.10.3 Retry and restore
- **Retry** (`retryNetIdentityMigration`) retries `migration_failed` or `legacy_restored` in a transaction while preserving the allocation watermark. It must not delete the only durable copy of that counter before migration succeeds.
- **Restore** (the downgrade path) runs in one tx:
  1. Require state `active` and a backup row whose sha256 verifies.
  2. If `head.revision > provenance.migration.revisionAfter && !confirmDiscardRevisions`, throw `AppError(…, 409, "https://openpcb.dev/problems/net-identity-restore-discards-edits")`.
  3. **Replace every backed-up table's rows for the design with the backup rows verbatim**: schematic parts, pins, wires, labels and primitives, PCB entities, and session histories. Post-migration schematic edits are therefore really discarded, and the restored pre-migration undo stacks apply to the exact schematic they were recorded against.
  4. Delete quarantine rows. Retain the retirement ledger and add `history` retirements for the previously active durable IDs, with no successors.
  5. Set state `{status:"legacy_restored", active_json:"[]", next_seq:watermark, provenance.restoredAt}`. Compute the watermark before replacing the active set. Restore must not reset allocation history and allow a stale ID to bind different circuitry after re-migration.
  6. Set `head.revision = current + 1`. The revision is monotonic and never rolled back, so DRC goes stale and the cloud shows the design as behind.
  - Restore leaves BOM overrides, comments, capture rows and the command log untouched (they are not net data, documented).
  - Re-migration is deterministic for the complete input state, including its retained watermark. The original fixture migrates identically in fresh copies; restore followed by re-migration deliberately allocates fresh IDs above all previously issued IDs.

Routes (S10):
- `GET /designs/:designId/net-identity`
- `POST …/net-identity/migrate`
- `POST …/net-identity/restore-legacy` with body `{confirmDiscardRevisions?}`

All three are under `/api/modules/designer/…` and are local-only.

### 3.11 Orphan blocker (S9)

**Reference kernel (S2)** — `src/shared/electrical-identity/references.ts`, pure:
```ts
export type NetReferenceClass = "copper" | "inert-copper" | "rule";   // inert-copper = disabled zone
export interface NetReference { netId: string | null; netName: string | null; refClass: NetReferenceClass; site: DesignerNetReferenceSite }
export interface NetReferenceSource {
  board: Pick<PcbBoardSettings, "perNetClassAssignments" | "lengthMatchGroups" | "diffPairs" | "drcRules">;
  traces: readonly Pick<PcbTrace, "id" | "netId" | "netName">[];
  vias: readonly Pick<PcbVia, "id" | "netId" | "netName">[];
  freePads: readonly Pick<PcbFreePad, "id" | "netId">[];
  zones: readonly Pick<PcbZone, "id" | "netId" | "netName" | "enabled">[];
}
export function enumerateNetReferences(src: NetReferenceSource): NetReference[];
export type NetReferenceVerdict = "none" | "bound" | "inactive" | "unresolved-name";
export function judgeNetReference(ref: NetReference, activeIds: ReadonlySet<string>): NetReferenceVerdict;
export function rewriteNetReferences(src: NetReferenceSource, map: (ref: NetReference) => string | null | undefined): NetReferenceSource;
```

**DRC.** `src/shared/drc/checks/net-binding.ts checkNetBinding(ctx)`:
- `activeIds = new Set(Object.keys(ctx.netNames))`.
- For every enabled copper reference whose verdict is `inactive` or `unresolved-name`, emit `NET_ORPHANED_COPPER`.
  - Anchors: trace, via, freePad, zone.
  - `locationMm`: a trace's first point (nm → mm), a via's or free pad's `centerMm`, a zone's first ring vertex (the outline centre for board zones).
  - `layer` is set when the item has a single layer.
  - Message: `Copper is assigned to net "<name|id>" which no longer exists (<reason>). Rebind or delete it before manufacturing.`
- Disabled zones are skipped.
- Not location-hashed. Not part of the live legality set, because the boundary prevents new orphans. Non-overridable.
- Registration:
  - `DrcRuleCode`
  - `severity.ts` (`error`, `NON_OVERRIDABLE`, `connectivity`)
  - `code-registry.ts`
  - the `drc-engine.ts` array after `"connectivity"`
  - `drc-labels.ts` "Orphaned copper"

**Export gate** — `export-gate.ts`:
```ts
export function assertNetIdentityExportable(pcb: DesignerPcbProjection): void
// throws AppError(…, 422, "Net identity unqualified", "https://openpcb.dev/problems/net-identity-unqualified",
//   { code: "NET_IDENTITY_UNQUALIFIED", identityStatus, mode, orphanedCopperCount, inertRuleReferenceCount, groups: first 50 })
export function netIdentityExportSlots(pcb: DesignerPcbProjection): {
  orphanedCopper: Array<{ kind: "trace" | "via" | "zone" | "freePad"; id: string; retiredNetId: string }>;
  netIdentityBlocked: { status: string; mode: NetIdentityMode; inertRuleReferenceCount: number } | null;
}
```
The gate throws when `pcb.netIdentity?.exportBlocked !== false`.
The extension uses `identityStatus` so RFC 7807's numeric HTTP `status` remains 422.
While H19 is absent, only the direct gate is implemented. Before adding the future snapshot
adapter, its copper slot must distinguish an inactive ID from an unresolved authored name;
an unresolved name must not be mislabeled as a retired net ID.

**S9 feature-detects H19.** Whether H19 has landed is the same as whether `DesignerStore.readExportSnapshot` exists.
- **H19 absent:** wire `assertNetIdentityExportable` into `routes.ts` `pnp.csv` and `exports/gerber` right after `getPcbProjection`, and into `sdk.ts getManufacturingExportSummary`. `assertQualifiedManufacturing()` stays first.
- **H19 present:** do **not** add direct throws.
  - Populate `ExportSnapshot.orphanedCopper` inside `readExportSnapshot` from `netIdentityExportSlots`.
  - Add one slot, `netIdentityBlocked`, to `ExportSnapshot`, with the blocker code `EXPORT_NET_IDENTITY_UNQUALIFIED`. The message: `Net identity is not qualified ({reason}). Repair net bindings in the DRC panel before exporting.`
  - **Delete H19's `unresolvedCopperNetBlocker`**: H08's classification is a superset of it (inactive ids plus unresolved names), so the same copper is never reported twice. `EXPORT_UNRESOLVED_COPPER_NET` stays in the code union, unused, for parser compatibility.
- Either way, `designer-net-identity-export.test.ts` asserts a single 422 per orphan cause.

### 3.12 Merge gate (S5 + S12)

- S5: `isNamed` uses `autoNamed` (§3.5.4).
- S12:
  - Naming edits retain the existing protection for two named nets or two anonymous multi-pin nets. This includes the existing label/port commands and the added `update_primitive_text` command. The earlier assumption that `needsConfirm` covered only named nets was incorrect.
  - Geometry changes require confirmation when two or more **named** nets merge: `move_primitive`, `rotate_primitive`, `move_part`, `rotate_part`, `mirror_part`, `update_wire_geometry`, `place_part`, `duplicate_part`, and `auto_arrange_schematic`. Wire-segment dragging uses `update_wire_geometry`; there is no separate command. Ordinary geometry edits involving only unnamed nets do not prompt.
  - Runtime review reproduced an unconfirmed VCC/GND merge through `move_part`, a naming merge through `update_primitive_text`, and a part inserted at an interior wire crossing that joined two previously separate named nets. Rotation and mirroring share the part endpoint-update path. Primitive rotation is currently topology-neutral but retains the geometry policy for consistency.
  - Explicit `create_wire` and `create_wire_junction` keep their existing intentional-connection policy. Footprint refresh changes only the PCB footprint snapshot, not schematic pin positions, so it does not enter this gate.
  - Each command gains `confirmMerge?: boolean` and an HTTP parser.
  - The frontend coordinator retries after confirmation with a fresh command ID and the same base revision. For a batch, confirmation must be applied to its steps; a flag on the batch wrapper is ignored by the backend.
  - The existing batch gate compares the dispatch's before state with its final state. A batch containing any unconfirmed naming step uses the broader naming policy; a geometry-only batch uses the named-net policy. This deliberately preserves conservative behavior for mixed batches rather than introducing a separate per-step topology orchestrator.

### 3.13 Repair command (S10)

```ts
export interface DesignerPcbRebindNetReferencesCommand {
  type: "pcb_rebind_net_references";
  /** 1..500 bindings, distinct `from`. */
  bindings: Array<{ fromNetId: string | null; fromNetName?: string | null; toNetId: string | null }>;
}
// ok result += netRebind?: { traces: number; vias: number; zones: number; freePads: number;
//   assignments: number; lengthGroups: number; diffPairs: number; drcRules: number; removedRules: string[];
//   removedDiffPairs: string[]; removedLengthGroups: string[]; disabledZones: string[] }
```
- Added to the `DesignerCommand` union, to `routes.ts` (parser + switch) and to `NOT_BATCHABLE`.
- It is a `pcb_` command, so it is undoable and schematic-neutral.

Validation:
- `from` is either a non-null `fromNetId` that is **not active** (durable, `nc:` or foreign), or `fromNetId === null` with a non-empty `fromNetName` (an unresolved hint).
- `to` is active or null.
- Errors: `NET_REFERENCE_DANGLING` (`field: "bindings[i].toNetId"`), or `INVALID_PCB_BOARD_SETTINGS` for malformed input.

Apply a simultaneous rewrite planned against the original stored references. Require durable mode;
legacy designs must retry migration before repair. Plan all changes before writing any row.
Ordinary typed copper writers and combined-world history cannot be used here: they discard unknown
stored fields. Patch reference fields into the original raw records and use the shared
`serializeRawBoardSettings` policy for board settings.
- Copper with `to !== null`: set `netId = to` and keep `netName`. This includes disabled zones. A disabled zone is never re-enabled; enabling stays a user action.
- Copper with `to === null`: traces, vias and free pads become `netId = null, netName = null`. Zones become `netId = null, netName = null, enabled = false` (listed in `disabledZones`).
- Assignments: re-key `from → to`. If `to` already has one, the existing assignment wins. Null removes the key. When multiple sources map to an unassigned target, equal classes coalesce; different classes refuse the complete command as ambiguous.
- Length groups: map and dedupe. A group left empty is removed.
- Diff pairs: map. If p equals n, or either is null, the pair is removed.
- Rule net scopes: map and dedupe. A rule whose net scope becomes empty is removed, because an empty scope would mean "everything".
- Every removal is reported.
- The panel's "Drop all inert assignments" sends `{fromNetId, toNetId:null}` for every rule-only group.

Counts report changed physical rows or declarations once; assignments count affected source keys.
`disabledZones` lists every matched zone cleared, including an already disabled zone. An unmatched
source is an accepted no-op: it follows the existing command revision/idempotency policy but creates
no undo entry. Non-null sources match by ID alone; null sources match the exact untrimmed name hint.

Repair history uses one reserved, versioned `component.set` carrier per direction, bound to the
design and repair command. It never enters generic ECS patch replay. Copper deltas record the DB row
ID, kind, payload ID and exact before/after own-field presence and values for `netId`, `netName` and
zone `enabled`. Board deltas record only affected top-level reference sections: assignments, length
groups, differential pairs and DRC rules. Their complete raw sections preserve removed rows, order
and unknown metadata. Undo therefore conservatively conflicts with intervening changes in an
affected board section, while preserving unrelated board settings and current copper geometry.

Replay strictly validates the carrier, design, row identity, allowed fields and every expected value
before writing. A mismatch returns HTTP 409 with `NET_REBIND_HISTORY_CONFLICT`; the transaction keeps
rows, revision and persisted undo/redo stacks unchanged. Valid replay changes only those fields,
advances the current revision once and persists history. Active identity records, retirement history
and allocation counters remain unchanged. Historical inactive references may be restored without
passing the authoring boundary again. Absent fields remain distinct from explicit null.

The status GET is read-only and does not trigger migration or placement synchronization. Explicit
migrate and restore routes use the existing retry and restore coordinators. Invalid restore
provenance or backup returns 422; discarding post-migration edits still requires explicit confirmation
after the existing 409 response.

### 3.14 Frontend (S11)

- `netRefForPick` returns `{netId: net.id, netName: null}` for **every** pick. The name-hint form is no longer written.
- `defaultZoneToolOptions` uses `{netId: groundId, netName: null}`.
- `NetSelect` prefers `value.netId` when it is in `nets`. It falls back to the `netName` match only for an unresolved hint (`netId === null`). A `{netId, netName:"GND"}` zone on a renamed net therefore shows its real net.
- Coordinator: every `netIdentity` event is appended to `net-identity-activity-store.ts` (session-local, max 200, unread count). Events with `hasDependents` also toast (warning).
- `NetIdentityPanel` sits in `DesignerDrcView` above the violations and has these sections:
  - migration status (legacy-mode banner with `lastError` and Retry)
  - orphaned copper and inert rules, with suggestion chips, "Accept all suggestions" and "Drop all inert assignments"
  - "Recent net changes"
  - the archived-history info banner, shown once
- The DRC toolbar button shows the unread badge.

---

## 4. Task breakdown (commit-sized slices)

Tier key: standard / careful / critical. Each slice ends with `npm run typecheck` and its listed tests.

| Slice | Title | Files | ≈Lines | Tests | Tier | Depends | Parallel |
|---|---|---|---|---|---|---|---|
| **S0** | Capture legacy fixtures on the pre-H08 tree. **Runs strictly first, alone** | `scripts/capture-legacy-net-fixtures.ts` (new); `src/core/backend/tests/fixtures/legacy-net-ids/{f1-routed-clean,f2-t132-stale,f3-name-hints,f9-pour-only-gnd}.json` | 280 + data | none | standard | — | none |
| **S1** | Kernel successor policy, `comparePredecessors`, transitions | `src/shared/electrical-identity/{types,reconcile,index}.ts`; `electrical-identity.test.ts` (helper adds `"retire"`); `electrical-identity-inherit.test.ts` | 200 + 320 test | §3.3 list | critical | S0 | ∥ S2, S3 |
| **S2** | Reference kernel (`refClass`, disabled zones) | `references.ts` (not exported from `index.ts`); SDK `DesignerNetReferenceSite`; `electrical-identity-references.test.ts` | 210 + 230 test | order, verdicts per class, rewrite immutability, every site | careful | S0 | ∥ S1, S3 |
| **S3** | Schema, state store, id helpers | `0022_net_identity.sql`; `schema.ts`; `net-identity/{types,state-store}.ts`; `store.ts` (deleteDesign) | 140 + 240 + 170 test | `designer-net-identity-store.test.ts`: round-trips, watermark query, salt/id helpers (regex, cross-design rejection), delete cascade, migration on boot | critical | S0 | ∥ S1, S2 |
| **S4** | Derivation split + pure binder | `projection-world.ts` (`deriveNetComponents`, `legacyName`); `net-identity/bind.ts`; SDK `autoNamed` | 170 + 300 + 320 test | `designer-net-identity-bind.test.ts`: move keeps ids; lone pins → `nc:`, no seq spent; inherited lone stays durable; sanitise (all four keys, empty-record drop); fast path equals the kernel result; collision order named > override > auto; override ignored when named; comparator (dependents, then numeric seq). S1 suites unchanged | critical | S1, S3 | — |
| **S6** | Legacy migration, evidence, restore (functions only) | `net-identity/{migrate,evidence}.ts`; `designer-net-identity-migration.test.ts` calls **`migrateDesignNetIdentity` directly** inside `db.transaction`, never `ensureNetIdentity` | 480 + 520 test | §7 matrix with S0 fixtures + synthetic F4–F8, per-stage fault injection, reproducibility, restore round-trip | critical | S2, S3, S4 | — (merges before S5) |
| **S5** | Wiring: mode, read path, sync, census, history, init, ensure, legacy mode, removal of projection binding | `projection-read.ts`; `net-identity/{sync,census,ensure,legacy-mode,index}.ts`; `projection-world.ts` (component, binder plumbing); `store.ts`; `design-initialization.ts`; `cloud-sync.ts` (2 ensure calls); `results.ts`; `pcb/pcb-projection.ts` (mode split); `pcb/pcb-store.ts` (`migrateLegacyBoardFill` mode); `command-executor.ts` (`identityMode` into `legalityFor`, comments); `net-merge-guard.ts` (`isNamed`); SDK result/event types; **`frontend/lib/designer-recovery-record.ts` `DESIGNER_RECOVERY_EPOCH` bump if the file exists** (otherwise record "P103 starts at epoch ≥ 2" in the commit message); update `designer-pcb-zones-http.test.ts` (Net_1 collision cases → collision suffix + durable binding), `pcb-board-fill-migration.test.ts` (bound mode) | 750 (one merge unit, ≤2 commits) | `designer-net-identity-sync.test.ts` (neutral skip + dev assertion, watermark, events, display overrides); `designer-net-identity-history.test.ts` (undo/redo chains, **finding-1 cross-session scenario**, reboot); `designer-net-identity-legacy-mode.test.ts` (failed state: edits allowed, legacy binding, export blocked, transient error writes no row, migrator-version auto-retry, cloud push after ensure has no `pending:`) | critical | S4, S6 | — |
| **S7** | Command boundary validation | `net-identity/command-references.ts`; `command-executor.ts` (one call); SDK codes; `results.ts` | 280 + 270 test | `designer-net-identity-boundary.test.ts`: every §3.8 row, `foreign-design` (id from a second design), `nc:` accepted, legacy mode = no-op, batch, autolayout apply, stale rules re-save | careful | S5 (same merge train, no release between) | — |
| **S8** | KiCad import seam | `import/kicad-project/commit.ts`; `kicad-project-import*.test.ts`, `kicad-zone-keepout-import.test.ts` | 140 + test edits | hint unique → bound; ambiguous → quarantine + warning; named-only netclass matching | careful | S7 | — |
| **S9** | Orphan DRC, diff-pair guard, summary, export gate (H19 feature-detect) | `shared/drc/checks/net-binding.ts`; `shared/drc/{severity,code-registry,drc-engine,diff-pair-resolver}.ts`; `shared/drc/checks/signal-integrity.ts`; SDK `DrcRuleCode`, summary types; `net-identity/{summary,export-gate}.ts`; `pcb/pcb-projection.ts` (one assignment); `routes.ts` + `sdk.ts`, **or** `store.ts readExportSnapshot` + H19 blocker file when H19 is present; `drc-labels.ts` | 380 + 300 test | `drc-net-binding.test.ts` (per copper kind, disabled zone skipped, non-overridable); `diff-pair-resolver` unknown-net test; `designer-net-identity-export.test.ts` (orphan, inert rule ref, legacy mode → one 422 each); DRC census green | careful | S8 | — |
| **S10** | Rebind command + routes | `net-identity/rebind.ts`; `command-executor.ts`; `commands/batch.ts`; `routes.ts`; SDK; `results.ts` | 400 + 320 test | `designer-net-identity-rebind.test.ts` (each site, `nc:` source, disabled zones, conflicts, null target, undo/redo); routes for status/migrate/restore (restore discards a schematic edit with confirm, 409 without) | careful | S9 | — |
| **S11** | Frontend | §3.14 files: `command-coordinator.ts`; `net-identity/{net-identity-activity-store.ts, net-identity-model.ts, NetIdentityPanel.tsx, *.test.ts}`; `DesignerDrcView.tsx`; DRC toolbar badge; `api.ts`; `area-tool-options.ts` (+spec); `PcbSelectionInspector.tsx` (`NetSelect`) | 480 | Vitest: model, panel, activity store, coordinator (toast iff `hasDependents`, list always), `NetSelect` prefers `netId` | standard | S10 | ∥ S12 |
| **S12** | Merge gate extension | `net-merge-guard.ts`; SDK fields on 10 additional commands; `routes.ts` parsers; coordinator batch confirmation; backend, HTTP and coordinator tests | 120 + 160 test | All 14 gated commands use the naming or geometry policy in §3.12; refusal rolls back identity and history; confirmed batch retries put consent on individual steps | standard | S10 | ∥ S11 |
| **S13** | Regression, property, persistence, e2e | `designer-net-identity-{t132,property,reopen}.test.ts`; `tests/e2e/pcb-net-identity.spec.ts` | 750 | §7 | critical | S11, S12 | — |
| **S14** | Docs | `designer/AGENTS.md`; `docs/designer/net-identity.md`; `docs/pcb-hardening/01-connectivity-contract.md` §2; `CAPABILITY-QUARANTINE.md`; type doc comments | 280 | typecheck | standard | S13 | ∥ S13 tail |

Slice notes:
- **S0** runs first and alone. It guards on `!existsSync("src/modules/designer/backend/net-identity/sync.ts")`, so it stays runnable while S3 adds the directory.
  - It boots `bootDesignerRuntime` on a temp `OPENPCB_DB_PATH` and builds the scenarios through the SDK.
  - **Zones are created the UI way:** the `net` value is `netRefForPick(pcbNets, pickedId)`, imported from `frontend/pcb/tools/area-tool-options.ts`, which is pure. The F1 unnamed-net zone is therefore `{netId:null, netName:"Net_k"}`.
  - Fixtures:
    - **F1:** VCC, GND and an unnamed 2-pin net. Every net is routed, with one via, a UI-shaped zone on the unnamed net, a UI-shaped GND zone, an assignment, a length group, a diff pair and a rule scope.
    - **F2:** F1 plus `move_part`, so the roots go stale.
    - **F3:** imported-style hints `"VCC"`, `"vcc"`, an unknown name, and a name equal to a legacy auto name and also to a label (giving `ambiguous`).
    - **F9:** a pour-only GND plane: a board zone named GND, four stitching vias carrying the GND root, no GND traces.
  - The dump format is unchanged.
- **S6 before S5.** S6 functions are tested directly. `migrateLegacyBoardFill` is called in its current name-hint form, which matches the `"name-hint"` mode S5 adds, so no test churn.
- **S5 and S7 ship in one merge train.** In the window between them, a zone drawn as a name hint persists unresolved. That is fail-closed (it pours nothing, no wrong net), and S9 later flags it as repairable.
- **P103:** the epoch bump lives in S5, the slice that changes what persisted commands mean.

Parallel-safe order: S0 → {S1, S2, S3} → S4 → S6 → S5 → S7 → S8 → S9 → S10 → {S11, S12} → S13 ∥ S14.

---

## 5. Edge cases & failure modes

1. **Move, rotate, mirror, rename, property edit.** These are in sync (fast path), so nothing is written. T-132 is fixed.
2. **A move breaks a T-touch.** The fragment with the most pins keeps the id. A lone fragment gets `nc:`. A split event is recorded.
3. **A move shorts two nets.** This is a merge, and the survivor has the most pins. When both are named, it is gated (S12, Q3). When one is unnamed, it is not gated, and the merge event appears.
4. **Named pour on a merge loser.** See Q1.
5. **Equal pin overlap between two durable predecessors.** The predecessor with more dependents wins, then the lower numeric seq. Deterministic.
6. **Delete the only wire of a routed 2-pin net, then redraw it.** The delete is a split: `X` stays on one pin, and the other pin gets `nc:`. The redraw is a 1:1 overlap with `X`, so `X` is preserved and its copper stays bound. Tested in T-132.
7. **Delete and re-place a part.** The new pins are new members. Wire overlap preserves the id. With no overlap the old id retires `removed`, which toasts only with dependents.
8. **Undo across sessions with contested members.** Sanitised by prior DB ownership. The undo succeeds, and a merge or split is reported if one results (§3.6).
9. **Pending leak.** `pending:3` → DANGLING `pending`.
10. **Id from another design.** DANGLING `foreign-design`.
11. **Corrupt `next_seq`.** The watermark takes the max with the ledger and active seqs.
12. **Corrupt `active_json` (a member in two records).** Stored-state validation refuses it; ensure reports unavailable without changing raw evidence or allocation history. Mode resolution keeps the design in degraded legacy mode. Contested history-world records remain valid binder inputs and are sanitised before persistence.
13. **Empty or schematic-only design.** The state becomes active, the backup holds empty arrays, and the revision bumps.
14. **Unparseable settings.** Skipped and reported. Readers recover usable fields and defaults in memory while retaining the raw row and read diagnostics; they do not overwrite malformed stored evidence on read.
15. **Unknown future board-setting keys.** `serializeBoardSettings` carries them.
16. **Legacy waivers on net-anchored violations.** They lapse. Documented.
17. **Comments and dataset capture.** Untouched.
18. **Cloud-linked designs.** Ensure runs before link or snapshot checks. The current peer cannot preserve durable identity state or allocation history, so cloud writes are refused after initialization or migration, including empty native designs. Existing links retain the preservation error. A future versioned protocol must preserve the complete identity envelope before these writes can resume.
19. **Downgrade without restore.** An older build sees `net:` ids as unknown, so its copper looks stale. The supported path is restore.
20. **PCB-only import.** Every hint is quarantined `unknown_name`, which blocks export.
21. **Same label on two KiCad sheets.** This is an H14 defect (§8).
22. **Auto name equal to a label, or an override equal to a label.** The suffix rule gives `Net_7_1` or `<override>_1`.
23. **Batch split then route on the fragment.** The fragment is pending, so the route is rejected (expected). A lone fragment's `nc:` id is accepted.
24. **Autolayout apply after a split.** DANGLING, so the whole apply is refused.
25. **Concurrent ensure.** Constraint error, then a re-read.
26. **Transient SQLite error during migration.** No row is written, the design runs in legacy mode, and the migration retries on the next access.
27. **Deterministic migration bug.** The status is `migration_failed` and the design is editable in legacy mode with export blocked. It retries automatically after a migrator-version bump, or on manual Retry.
28. **Routed trace from an unconnected pad, then the pin is wired.** `nc:p` becomes inactive, so the copper is orphaned with the exact suggestion "rebind to the net containing p". This is one click.
29. **Disabled zone with an unresolved hint** (H14 import, or after rebind to null). It is inert and listed, but never blocks.
30. **High-voltage class assignment on a merge loser.** It is inert and blocks export until it is rebound or dropped.

---

## 6. Migration / rollback & data safety

- **Versioning:**
  - `schema_version = 1`.
  - `NET_IDENTITY_MIGRATOR_VERSION` is stored in provenance. A bump re-runs migration for `migration_failed` designs only. Active designs never re-migrate.
  - A future data change adds a new backup row (PK `(design_id, schema_version)`).
- **Atomicity:**
  - The migration runs in one tx and rolls back fully.
  - Deterministic failures are recorded in a separate tx. Transient ones are never recorded.
  - Fault injection covers all 8 stages.
- **Backup:** written in the same tx **before any write**. It holds the schematic, PCB and history rows, verified by sha256. The migration itself never modifies schematic rows. The schematic rows are backed up so that restore can discard later schematic edits truthfully.
- **Idempotency:** `ensure` is a no-op once a state row is active. Retry and auto-retry apply only to failed or restored designs. The result is reproducible: same salt, seq from 1, canonical order.
- **Recoverability:** a failed design stays editable in legacy mode with export blocked. There is no read-only dead end.
- **Rollback (downgrade):** restore puts back every backed-up table verbatim and sets the status to `legacy_restored`. The design is then editable in legacy mode, export is blocked, and an older build can open it. Post-migration edits are discarded only with `confirmDiscardRevisions:true`.
- **H46 adoption:** when H46 ships, `ensureNetIdentity` calls its file snapshot once per process before the first migration. The logical backup stays.
- **Undo history:** pre-H08 stacks are archived. The count is shown once in the panel.
- **H13:** no ordering constraint remains. H13 never rewrites design rows, and evidence reads the per-placement footprint snapshot (§2). Any explicit `refresh_part_footprint` is a dispatch, so ensure runs first anyway.
- **Release safety:** `designer.outputQuarantine` stays ON. H08 only adds blockers.

---

## 7. Verification

Commands (from `/Users/andrejvysny/workspace/openpcb/OpenPCB`):
```
bun test src/core/backend/tests/electrical-identity.test.ts src/core/backend/tests/electrical-identity-inherit.test.ts src/core/backend/tests/electrical-identity-references.test.ts
bun test src/core/backend/tests/designer-net-identity-*.test.ts src/core/backend/tests/drc-net-binding.test.ts
bun test src/core/backend/tests/net-derivation.test.ts src/core/backend/tests/designer-net-union.test.ts src/core/backend/tests/designer-net-labels.test.ts src/core/backend/tests/designer-net-merge-guard.test.ts src/core/backend/tests/designer-net-class-management.test.ts src/core/backend/tests/schematic-attach-state.test.ts src/core/backend/tests/erc-engine.test.ts
bun test src/core/backend/tests/pcb-connectivity-*.test.ts src/core/backend/tests/net-path.test.ts src/core/backend/tests/pcb-board-fill-migration.test.ts src/core/backend/tests/designer-pcb-zones-http.test.ts src/core/backend/tests/designer-history-session.test.ts src/core/backend/tests/designer-capability-quarantine.test.ts
npm run test:react -- src/modules/designer/frontend/pcb/net-identity src/modules/designer/frontend/pcb/tools/area-tool-options.spec.ts
npm run typecheck
npm run test:backend && npm run test:react
npm run gen:check && npm run gen:contracts -- --check
OPENPCB_E2E_NO_WEBSERVER= npx playwright test tests/e2e/pcb-net-identity.spec.ts --project=chromium
```
Baseline before S1: the six S1-adjacent suites pass (59 pass / 0 fail at d5547f9, per the review).

Bun suites:
- **`designer-net-identity-t132.test.ts`.** Build a routed native fixture through the SDK. Assert unchanged copper net IDs and settings references after each operation below. Schematic pose and refdes edits that preserve the electrical partition must also preserve the PCB DRC `(code,id)` list and ratsnest. Moving a PCB placement can physically disconnect routed pads: that case checks identity preservation and absence of new orphan-identity errors, not an empty ratsnest or unchanged geometry diagnostics.
  - (a) `move_part`
  - (b) `rotate_part`
  - (c) `mirror_part`
  - (d) refdes rename
  - (e) `pcb_move_placement`
  - (f) undo, (g) redo, (h) undo all, (i) redo all
  - (j) reboot
  - **(k) delete the only wire of a routed 2-pin net, then redraw it.** The same id, and the copper stays bound.
  - **(l) two durable 1-pin nets with equal pins merge, and only one has copper.** The copper-carrying id survives, including when its seq is `…:10` against `…:9`.
- **`designer-net-identity-property.test.ts`.** 100 seeds × 25 steps (move, rotate, mirror, rename, add/delete wire, add/delete label, undo, redo, reboot every 10). Invariants are checked after every step. **No reimplementation of §3.3:**
  1. If the pin partition is unchanged, every prior durable ID per pin set is unchanged and its previously bound references remain bound, except during intentional historical restoration. A fresh lone pin may legitimately move from `nc:` to a durable ID when a label or wire adds another member; that promotion must report old `nc:` copper as unresolved and suggest the current pin owner.
  2. For a simple split, the kept successor has the maximum pin overlap with its predecessor. For a simple merge, the surviving predecessor has the maximum pin overlap among predecessors with the highest naming priority. General many-to-many transitions follow the deterministic greedy contract in §3.3; they do not promise an independent maximum for every predecessor.
  3. No id is both inherited and retired in one result.
  4. Permutation invariance: re-running `bindNetIdentity` on shuffled `components` and `previousActive` gives a deep-equal result.
  5. No ledger id ever appears in `createdIds`, and `next_seq` never decreases.
  6. Persisted active identity records contain only durable IDs. No provisional `pending:` reference is persisted. Valid `nc:` references remain supported in PCB data and transition successors.
  7. Display names are unique case-insensitively.
  8. The set of copper items on inactive ids equals the set of `NET_ORPHANED_COPPER` anchors.
- **`designer-net-identity-history.test.ts`:**
  - split → undo → redo gives a deep-equal `active_json`;
  - schematic undo while PCB copper is on the fragment → orphaned, then redo → bound;
  - **the finding-1 scenario** (§3.6) succeeds and reports a merge, and `active_json` holds no contested member;
  - events appear only on divergence.
- **`designer-net-identity-migration.test.ts`** (calls `migrateDesignNetIdentity` directly):
  - **F1:** everything bound. The unnamed-net zone is bound `autoNameHint` with `netName` cleared, the GND zone is bound `nameHint`, there is no quarantine, and the revision is +1.
  - **F2:** copper is bound `contact`, and the rule refs are `stale_root` with a suggestion.
  - **F3:** `nameHint` binds `VCC` and `vcc` to the same net, the unknown name gives `unknown_name`, and the label/auto collision gives `ambiguous_name`.
  - **F4:** `root_only`.
  - **F5:** `short`, on that island only. Copper elsewhere on the same root binds.
  - **F6:** `assignment_conflict`.
  - **F7:** an empty design.
  - **F8:** unparseable settings.
  - **F9:** the vias are bound `rootAndPour`, and nothing is quarantined.
  - Fault injection at each of the 8 stages leaves the tables byte-identical to the input.
  - Restore round-trip: the schematic, PCB and history rows are byte-equal to the input, including a fixture with legacy fill.
  - Reproducibility: migrating two copies gives identical JSON.
- **`designer-net-identity-legacy-mode.test.ts`.** As listed for S5.
- **`designer-net-identity-boundary.test.ts`**, **`drc-net-binding.test.ts`**, **`designer-net-identity-export.test.ts`**, **`designer-net-identity-rebind.test.ts`.** As listed for S7, S9 and S10. The export suite forces the flag off with `OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE=0`. With the flag on, `UNQUALIFIED_MANUFACTURING` comes first.

Vitest:
- model and panel
- activity store
- coordinator: a toast iff `hasDependents`, the list always
- `NetSelect` prefers `netId`
- `area-tool-options.spec.ts`: `netRefForPick` always gives `{netId, null}`

E2E `tests/e2e/pcb-net-identity.spec.ts`:
1. Seed native drawn two-pin parts, a routed two-pin net and a larger three-pin net with equal naming priority. Assign class, length and scoped DRC references through the API.
2. Drag a part in the UI and verify its acknowledged move, stable net IDs and rules, and no airwire for the routed net. Reload retains those bindings.
3. Rename the routed label to the larger net's name through the Outline UI. Verify merge refusal, explicit confirmation, the acknowledged merge event, toast and unread badge, and the retired source in the identity panel. This scenario exercises the naming merge gate; geometry gates have separate backend regressions.
4. Accept the panel's explicit successor suggestion. Verify the repair receipt, unchanged trace geometry and disappearance of `NET_ORPHANED_COPPER`.
5. PCB-session Undo restores the original references and orphan diagnostic without an identity-change toast; Redo restores the repair. Reload retains the repaired IDs.

---

## 8. Cross-item interfaces

| Item | H08 provides | H08 consumes / constraints |
|---|---|---|
| **H14 OPENPCB-62** (KiCad import) | **(H08-a)** `initializeNetIdentity(tx, designId, "kicad-import", ts): readonly BoundNet[]` (`{id, name, pinIds, wireIds, labelIds, primitiveIds, autoNamed, nameSource, legacyRoot}`). **(H08-b)** `setNetDisplayOverride(tx, designId, netId, name)`. It applies only to auto-named nets, takes part in the uniqueness rule and boundary name resolution, and travels with the id through splits and history. **Aliases are not stored** (Q4); they stay report-only in `net_map_json`, and H14's port `setImportedDisplayName(…, aliases)` drops them. **(H08-c)** holds. `resolveImportedNetHints` and the quarantine table are available | H14 must: (1) scope labels per sheet path before insertion; (2) call `initializeNetIdentity` in its apply tx after the schematic insert, before settings and copper; (3) never use first-match-by-name; (4) **import an unbound zone as `{netId:null, netName:<kicad>, enabled:false}`** (inert for H08, so `zone_net_unbound` can stay acknowledgeable on H14's side), or else mark `zone_net_unbound` non-acknowledgeable, because an *enabled* unresolved zone is non-overridable `NET_ORPHANED_COPPER`; (5) unbound tracks and vias with `netName` are non-overridable blockers, so they must not be acknowledgeable in H14 either |
| **H19 OPENPCB-67** (export gating) | `netIdentityExportSlots` → `ExportSnapshot.orphanedCopper` and the new `netIdentityBlocked` slot (`EXPORT_NET_IDENTITY_UNQUALIFIED`). H08 S9 deletes `unresolvedCopperNetBlocker` (a superset is covered). `NET_ORPHANED_COPPER` is non-overridable, so H19's passing-DRC gate also blocks | S9 feature-detects `readExportSnapshot` (§3.11). H19 owns `migrateLegacyBoardFill` semantics afterwards. H08 only adds the `mode` parameter |
| **H13 OPENPCB-61** (frames) | `ensureNetIdentity` (optional to call) | None. H13 never rewrites design rows and evidence uses the placement snapshots (§6) |
| **H17** (net classes) | Durable assignment keys. Split: kept by the larger fragment. Merge loser: inert, reported and **export-blocking** until resolved | New net-class UI must dispatch through the boundary |
| **H23** (BOM) | Stable ids and `Net_<seq>` / override names, `autoNamed` | — |
| **H46 OPENPCB-94** | Logical backup/restore pattern, `MigrationStage` fault hooks, transient-vs-deterministic error policy | Add the H46 snapshot call in `ensureNetIdentity` |
| **OPENPCB-103** (recovery journal) | Replay-stable results: `netIdentity` events, `NET_REFERENCE_*`, `netRebind` are all parsed by `results.ts`. **No identity-unavailable refusal exists**, so no commandId is ever burned by an identity refusal | Epoch bump in **S5**. Journaled pre-H08 commands with legacy ids get `NET_REFERENCE_DANGLING`, which is terminal and non-retryable, as P103's table classifies it |
| **H51** (qualification) | Evidence for the `electrical-identity` blocker | Flag and blockers unchanged |
| **H01 manifest** | T-132 owner = H08; evidence = S13 tests | — |

---

## 9. Open questions (user must answer)

1. **Named pours on merge losers (§5 #4).** Most pins wins, so a GND pour is orphaned when GND (2 pins) merges into a larger anonymous net, even though the merged net is still displayed as "GND".
   - Default: follow the decision literally, with a one-click rebind.
   - Alternative: an extra binder comparator key, placed *before* pin overlap, that prefers a predecessor named by a GND/PWR/portal symbol.
   - Keep the default?
2. **Split warning form.** The decision says split fragments get "a user-visible warning".
   - Default: every split is listed in the always-visible "Recent net changes" list with an unread badge, and it toasts only when the split net had dependents.
   - Alternative: toast every split, which is noisy during schematic capture.
   - Accept the default?
3. **Geometry merges of named nets (A9).**
   - Default: `move_part`, `update_wire_geometry` and wire-segment drags that merge two or more **named** nets require confirmation, the same as labels.
   - Alternative: leave geometry edits ungated, as rev 1 did.
   - Accept gating?
4. **Aliases.** The Plane OPENPCB-56 text was not verifiable here.
   - Default: H08 stores one display-name override per id (for H14) and **no aliases**. KiCad aliases stay report-only and never resolve at a boundary.
   - Does the acceptance criterion require live alias resolution?

Decided (rationale above; veto if desired):
- Lone unwired pins get non-persisted `nc:<pinId>` ids. Wiring them creates nets without merge events.
- Ids are design-salted (`net:<salt>:<seq>`). The display name stays `Net_<seq>`.
- Legacy copper with unique per-island contact evidence auto-binds (`contact`). A pour-only island binds only when the legacy root and a name-bound pour agree.
- UI-written auto-name hints (`{null,"Net_3"}`) migrate as root references through the evidence table.
- Inert rule-side references (merge losers, quarantined legacy refs) block export until rebound or dropped.
- A failed migration is a degraded legacy mode (editable, export blocked), not read-only.
- Pre-H08 undo history is archived, and the migration is lazy per design.
- Hierarchical-sheet label scoping belongs to H14.

---

## 10. Review resolution (rev 2)

| # | Sev | Disposition | Where |
|---|---|---|---|
| 1 | blocker | Fixed. `sanitizePreviousActive` with prior-DB-owner priority. The exact scenario is a test | §3.4 step 1, §3.6, §7 |
| 2 | major | Fixed differently. Lone pins get non-persisted `nc:` ids, so wiring creates nets with no merge, ledger row, seq or toast. Toasts only on `hasDependents` | §3.2, §3.5.3 |
| 3 | major | Fixed. Kernel key 5 `comparePredecessors` (dependents, then numeric seq). Delete-and-redraw and `:10` vs `:9` tests | §3.3, §3.4, §7 |
| 4 | major | Verified (`netRefForPick` writes auto names). Fixed: auto-name hints migrate through the legacy name→root map and evidence. S0 builds zones via `netRefForPick`. S11 stops writing hints | §3.10.2, §4 S0, §3.14 |
| 5 | major | Fixed. Projection-time binding is removed for durable designs **in S5**, and kept only in legacy mode with legacy names | §3.5.4 |
| 6 | major | Fixed. The backup includes the schematic tables, and restore replaces them | §3.2, §3.10.3 |
| 7 | major | Fixed. Legacy mode (editable, export blocked). Transient errors are never persisted. Auto-retry on a migrator-version bump | §3.5.4, §3.10.1 |
| 8 | major | Fixed. Always-visible activity list plus badge. Also put to the user as Q2 | §3.5.3, §3.14, Q2 |
| 9 | major | Fixed. H08 provides `setNetDisplayOverride` (H08-b), included in the collision rule. Aliases are report-only (Q4) | §3.5.1, §8 |
| 10 | major | Fixed. Design-salted ids, `foreign-design` reason | §3.2, §3.8 |
| 11 | minor | Fixed. Per-island evidence and name-bound pour evidence (`rootAndPour`) | §3.10.2 |
| 12 | minor | Fixed. Inert rule-side references count toward `exportBlocked` | §3.9 |
| 13 | minor | Fixed. Disabled zones are inert. H14 imports unbound zones disabled, or makes the code non-acknowledgeable | §3.11, §8 |
| 14 | minor | Fixed. Neutral-command skip with a dev assertion, the ledger watermark instead of the full ledger, the fast path, and a lazy census | §3.4, §3.5.1 |
| 15 | minor | Fixed. S0 runs strictly first and guards on `net-identity/sync.ts` | §4 |
| 16 | minor | Fixed. S6 tests call `migrateDesignNetIdentity` directly | §4 |
| 17 | minor | Fixed. `registry.ts:121-126` | §2 |
| 18 | minor | Verified. Fixed: ensure in `linkDesignToCloud` and `pushCloudSnapshot` | §3.10.1 |
| 19 | minor | Fixed by removal. There is no `NET_IDENTITY_UNAVAILABLE` result | §3.5.2 |
| 20 | minor | Fixed. Epoch bump in S5 | §4 |
| 21 | minor | Fixed. Backup is taken before the fill, and the fill runs in `"name-hint"` mode during migration | §3.10.2 |
| 22 | minor | Verified. Fixed: a mandatory `unknown-net` conflict reported as `DRC_RULE_INEFFECTIVE` | §3.7 |
| 23 | minor | Fixed. `command-executor.ts` is in S5 (`identityMode` into `legalityFor`, comments). `boundTrace` stays because legacy mode still binds | §3.5.4 |
| 24 | minor | Fixed. `NetSelect` prefers `netId` (S11) | §3.14 |
| 25 | minor | Fixed. The `designer-pcb-zones-http.test.ts` update moves to S5 | §4 |
| 26 | minor | Fixed. Invariant-based property test, no oracle reimplementation | §7 |
| 27 | minor | Fixed. Default is to gate named-net geometry merges, raised as Q3 | §3.12, Q3 |
| 28 | minor | Fixed. S9 feature-detects `readExportSnapshot`, adds a slot, and deletes the duplicate H19 blocker | §3.11, §8 |
| NV | — | H13 "hard dependency" is resolved instead: H13 never rewrites design rows, and evidence uses placement snapshots | §2, §6 |

**Rejected review findings:** none rejected outright. Partial deviations:
- **#2:** the fix is the `nc:` lone-pin model rather than only a toast filter, because a toast filter alone leaves the ledger, seq and `active_json` inflation in place.
- **#7:** the "freeze identity, flag all copper" variant is replaced by legacy mode, which is pre-H08 behaviour with export blocked. That variant would need a third code path, while legacy mode reuses the existing one and stays migration-compatible.
- **#12:** chose blocking over acknowledgement, because H08 has no acknowledgement store and H19 forbids DRC overrides at export.
- **#13:** resolved by making disabled zones inert rather than having H14 strip `netName`, so the KiCad name stays as provenance for the later rebind.
