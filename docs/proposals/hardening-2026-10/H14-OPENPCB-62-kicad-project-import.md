# H14 — KiCad project import: complete, atomic, electrically faithful (OPENPCB-62)

Status: design **rev 2**, 2026-10-15. Revised after an adversarial review (verdict: fix-required, 2 blockers,
17 majors, 14 minors). Every blocker and major is addressed or rejected with rationale (§10). Author:
architect lane. Read-only investigation; nothing in either repo was edited.

Repo HEAD: OpenPCB `d5547f9` (master; since rev 1's `839365e` only keyboard/tooltip/e2e-fixture/ai-core
files changed, so the import line references are still valid). Shared `91c7e7e` (`fix/offline-eda-text`).

Inputs: Plane OPENPCB-62 (description and two comments), audit entry seq 62, QA
`docs/qa/2026-09-ui-qa/areas/designer-import.md` T-244..T-252, `OpenPCB/CLAUDE.md`,
`src/modules/designer/AGENTS.md`, `docs/pcb-hardening/03` §3.2/§8, `05` §12.3, `10` §5.3.

**Sibling designs now exist and are bound** (rev 1 had none):
- H08 = `~/.claude/plans/openpcb-designs/OPENPCB-56.md` (net identity)
- H13 = `OPENPCB-61.md` (KiCad frame)
- H19 = `OPENPCB-67.md` (manufacturing export)
- 103 = `P103.md`

The two port files (§3.4, §3.5) now bind to those docs' actual names. The places where H14 still
assumes something about them are marked `(H08-x)` / `(H13-x)` / `(H19-x)`.

**Path prefixes:** `O/` = `OpenPCB/`, `S/` = `shared/`. Paths without a prefix are relative to `O/`.

---

## 1. Scope and acceptance mapping

In scope: QA T-245..T-252. T-244's geometry belongs to H13; H14 owns the call sites.

Out of scope:
- thickness and stack-up parsing (H50)
- export gate logic (H19); H14 only *provides* a blocker source to it
- the transform maths (H13)
- durable net identity storage (H08)
- footprint preset geometry (H15)
- per-pad manufacturing overrides in the footprint model (filed as a follow-up, see Q2)

| # | Plane acceptance criterion | Design element |
|---|---|---|
| A1 | Owns T-245..T-252; consumes H08 net identity and H13 frame transforms | §3.4 `net-identity-port.ts` → H08 `initializeNetIdentity`; §3.5 `frame-port.ts` → H13 `kicad-frame.ts`; slices S6, S8, S10 |
| A2 | Bind tracks/vias/zones/pads through validated source identity and scoped aliases (`/X`, `Net-(D1-K)`), not leaf-name stripping; no required copper silently netless (T-245) | §3.8. Binding is pad membership first; a scoped alias is used only for pad-less nets and needs a sheet-scope proof. Unbound copper keeps its KiCad name as an H08 *unresolved-name* reference, so H08's live export gate blocks it |
| A3 | Preserve rules and net classes: no synthetic Power/GND merge, minimums consistent with imported vias, fab preset by layer count, inner layers visible (T-248), board graphics (T-249) | §3.9 rules (replace classes, synthesise Default, resolve wildcard patterns and directive labels, KiCad defaults table, consistency pass, board-setup mask/paste/tenting); §3.10 outline loops, cutouts, arcs, graphics |
| A4 | Accept unnumbered NPTH geometry (USB-C J1) without dropping the connector; never invent pin mappings (T-247) | §3.7 pad policy: `allowUnnumberedPads`, classification `mechanical` / `paste_only` / `copper`, and feature-detected drill capability. Without it, J1 is imported and carries a capability blocker until the re-pin |
| A5 | Inspect/dry-run plan with source-versus-result counts, explicit unsupported constructs and persistent warnings; atomic commit with no partial design or library rows on failure or cancel | §3.6 `ImportPlan` plus a unit-based census (§3.6.1); §3.11 `planDigest` (409 `plan_changed`); §3.12 staged library ingestion with compensating discard, one designer transaction, a durable outcome ledger, crash reconciliation |
| A6 | Invalid user files return structured 4xx diagnostics (T-251) | Inspect is already done (`errors.ts`, e64a464). §3.13 extends it to commit: per-part rejection (not 500), `project_too_large` 422, `library_unavailable` 503, `kicad_import_busy` / `plan_changed` / `import_id_conflict` 409. A census mismatch on user data is a blocker, never a 500 |
| A7 | Wizard: commit warnings on a Done stage, correct copy, human warnings (T-247/T-250), kit Dialog a11y (T-252); cancel or failure never looks like success | **P0** ships the Done stage, copy, human warnings and the kit Dialog on the *current* pipeline. §3.15 then adds the plan review, cancel and status machine |
| A8 | Fixtures: hierarchical and duplicate net names, named auto nets, USB-C NPTH, 2/4/6-layer, graphics, imported via rules, multi-unit; supported boards match reference connectivity, counts and rules after reopen | §3.16: one fixture tree shared with H13/H19; H19's parsers; KiCad-generated references required for closure (`OPENPCB_REQUIRE_KICAD_REF=1`); staleness check by source sha256 |
| A9 | Unsupported manufacturing capabilities stay blocked even when import succeeds | §3.14 import-loss blockers. Capability losses are non-acknowledgeable and evaluated **live** inside H19's `readExportSnapshot` (`importLoss` slot, `EXPORT_IMPORT_LOSS`). Only silk/fab cosmetics can be acknowledged. A missing report fails closed. `designer.outputQuarantine` stays on in release |
| A10 | Tests: malformed files, partial failure, repeat import, cancellation, persistent warning details | §7 test matrix (S1, S10, S11, S12, S13) |
| A11 | Out of scope: thickness/stack-up (H50), export gates (H19) | No `boardThicknessMm` parsing. H14 provides a blocker source and does not decide gating |

---

## 2. Current state (verified file:line facts)

### 2.1 Import code

**Commit pipeline** (`src/modules/designer/backend/import/kicad-project/commit.ts`, 608 lines, over the 500-line limit)
- `:59` imports `flattenSheets`. `:78` `assertQualifiedProjectImport()`. `:79-83` re-inspects. `:94-100` re-parses sheets and the PCB. `:98` calls `flattenSheets`.
- `:114-119` library ingestion runs **outside** the design transaction; `:132-137` so does model ingestion. `:153-158` a missing Library SDK throws a plain `Error`, which becomes a 500.
- `:162-169` awaits `resolveComponentForPlacement` per component. `:172-287` is the single Drizzle transaction. Its `commandLog.resultJson` (`:271-278`) stores counts only, **not warnings**.
- `:363-383` `buildBoardSettings` spreads `createDefaultPcbBoardSettings`, which gives 2-layer `visibleLayers`, `fabricator: "jlcpcb_2l"`, `solderMaskExpansionMm: 0.075` and `solderPasteExpansionMm: -0.05` (`pcb/pcb-defaults.ts:111-112`). `:375` `mergeNetClasses` keeps OpenPCB's `power`/`gnd` classes (`:566-592`).
- `:403-462` `applyKicadDesignRules` keeps OpenPCB minimums when the KiCad rule is absent. `:470-517` per-net classes are resolved by **net name**, first match wins.

**PCB insert** (`insert-pcb.ts`, 504 lines)
- `:141-147` copies position and rotation verbatim. `:452-454` `normalize360(Math.round(v))` drops fractional rotation.
- `:162` trace, `:207` via and `:381` zone all write `netId: null` and rely on projection name binding.
- `:447-450` `pickCopperLayer` silently maps any non-copper layer to `F.Cu`.
- `:127-136` skips footprints without a schematic part, so board-only footprints are dropped. No overlay texts or shapes are inserted.

**Projection binding** (`pcb/pcb-projection.ts:100-150`): `bindNetName` binds traces and vias by **case-insensitive** trimmed name, first match wins, with no ambiguity check. Only zones get an ambiguity check (`zone_net_ambiguous`). (Rev 1 said "exact upper-cased"; this is corrected.)

**Schematic insert** (`insert-schematic.ts`)
- `:148` `mirrored = false` always; the parser does not read `(mirror …)`.
- `:150-197` multi-unit symbols become **one part per unit** (`U1`, `U1B` …). Pins are filtered to `unit === symbol.unit || unit === 0`, so unit-0 pins are duplicated onto every unit.
- `:128-135` a missing placement detail warns and skips the part.
- `:437-461` power symbols: `gnd` **or `ground`** (case-insensitive) becomes the `gnd` primitive, everything else a `pwr` rail.
- `:230-250` labels are inserted with raw text.

**Net union** (`projection-world.ts:819-851`): the global named-net union is **case-insensitive** (`EN` == `en`), and the `gnd` primitive is named `GND`.

**Placement sync** (`pcb/pcb-store.ts:2059-2125` `syncPcbPlacementsFromSchematic`): one placement per schematic part. Pad↔pin correlation (`pcb/net-pad-correlation.ts:23-80`) looks up the placement by `pin.partId`. Today, then, a multi-unit import yields one placement per unit.

**Hierarchy** (`flatten-sheets.ts`; `inspect.ts:101-114`)
- Sheets are keyed by **basename**. The root is chosen by file stem, and the rest are sorted with locale-dependent `localeCompare`.
- All sheets overlay one coordinate space, with no instance tree and no per-instance refdes.

**Library ingestion** (`ingest-library.ts`)
- `:19` imports `commitKicadImport` directly, a module-boundary violation.
- `:90-110` keys components by `(symbol libId, footprint libId)`. The tag-based "preexisting" shortcut ignores the footprint.
- `:305-320` first instance wins. `lib_name` (KiCad 7+ embedded symbol variants) is not parsed (`kicad-schematic-parser.ts:213-230`).

**Model ingestion** (`ingest-models.ts:84-130`)
- It writes library tables through `as any`.
- **It deletes** an existing `footprint_models` row before inserting its own.
- STEP bytes are written to a content-addressed file (`writeSourceStep`). No model or blob GC exists anywhere in the library backend; grep finds only the orphan-row cleanup at `queries.ts:1700-1755`.

**Pad validation** (`library/backend/import/commit-kicad.ts:185-191`) calls `validateFootprintPads(preview)` without `allowUnnumberedPads`, so J1 is rejected (T-247).

**Netclass assignment** (`inspect.ts:345-385`): wildcard `netclass_patterns` produce a warning and are skipped. `netclass_flag` directive labels are not handled.

### 2.2 Pinned shared packages

Pinned: `kicad-import@0.1.2` and `kicad-parsers@0.1.3` (real directories, not linked); `S/packages/kicad-import` is `0.2.0`, untagged.

**Parsers** (`node_modules/@openpcb/kicad-parsers/dist/kicad-footprint-parser.js:250-280`)
- `pad.rotation` is copied verbatim from `(at x y θ)`.
- The `(drill oval W H)` form is lost: index 1 is the string `oval`.
- There is no plating field.

**Preview** (`kicad-import/dist/build-preview-models.js:500-524`)
- `rotationDeg: pad.rotation`; `layer: pad.layers[0]`.
- `custom`/`trapezoid` degrade to `rect` with only a library warning.
- There is no `plated` and no `drillSlotMm`.
- `FootprintRenderSourcePad` (`rendering-core/dist/types.d.ts:135-146`) has no mask, paste or zone-connection fields.

**Hidden pins** (`build-preview-models.js:494`): the symbol preview passes `includeHiddenPins: false`. Whether the library's placement pin snapshot comes from this model is **unverified**; S7 verifies it.

**Drill fields** (`src/shared/rendering/pcb/pcb-drills.ts:110-142`): `padDrillFields` reads optional `plated` / `drillSlotMm` / `drillOffsetMm`, and **an absent `plated` means plated**. Shared `e882332` (unreleased) adds them. Unreleased since 0.1.2 are also the breaking `58d3620` (slotted drills, paste-only sub-pads) and `1a15c1e` (all symbol units, courtyard/mask/paste). H13 plans the user-gated publish (SH2: `kicad-import-v0.2.0`, `rendering-core-v0.1.4`) and the re-pin (OP7).

### 2.3 Fixture facts (`data/KiCad_Example_Project_USBtoUART.zip`, KiCad 8, `version 20240108`)

Top-level counts:

| Token | Count |
|---|---|
| segment | 183 |
| arc | 0 |
| via | 44 |
| zone | 1 |
| gr_text | 7 (one `knockout`) |
| gr_line | 4 |
| gr_arc | 4 |
| net | 37 (ordinals 0–36, so 36 real nets) |
| footprint | 19 |

The single zone is `(net 1 "GND") (layers "F&B.Cu")`, solid fill, `connect_pads (clearance 0.5)`. One source zone therefore becomes **two** rows.

**Pad angles already include the footprint angle.**
- D5 is at `(at 145 139.34 -90)`, and its pads are at `(at -0.66 0 270)`.
- R6 is at 180, and its pads are at 180.
- J1 is at −90, and its pegs are at 270.

**J1 (USB-C)**
- 2 `np_thru_hole` pegs with number `""`.
- `S1` shield pads with `(drill oval 0.6 1.7)` / `(drill oval 0.6 1.2)`.

**0201 parts** have paste-only sub-pads: `(pad "" smd roundrect (layers "F.Paste"))`.

**Per-pad manufacturing overrides**
- `(solder_mask_margin 0.102)` on 6 pads (D5, D6 and one more footprint).
- `(zone_connect 2)` on one QFN pad (line 2826).

**Board setup**
- `(setup (pad_to_mask_clearance 0) (allow_soldermask_bridges_in_footprints no) …)`.
- `viasonmask no` sits inside `pcbplotparams`, **not** directly in setup.

**Project file** (`.kicad_pro`): `rules {}` and one Default class (0.6/0.3 via, 0.2 track, 0.2 clearance).

`grbr.zip` holds KiCad's own Gerbers and drill files. `Readme.txt` carries no license.

### 2.4 Other facts

- kicad-cli is **not installed**: there is no `/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli`, and `which kicad-cli` finds nothing.
- `ModuleRouteContext` (`src/core/contracts/modules/backend-module.ts:83-90`) is `{ req, query, params }`; **it has no `signal`**. The disconnect controller is wired into the `Request` (`create-http-server.ts:247-258`), so the signal is `routeCtx.req.signal`.
- `classIdForName` (`src/shared/pcb-areas/net-class-resolver.ts:20-36`): `defaultNetClassId` takes index 0, and the GND/power heuristics apply only if classes with ids `gnd`/`power` exist.
- `PcbOverlayText` (`src/sdks/designer/types.ts:1201-1213`) has `fontSizeMm`, `rotationDeg`, `mirror` and a horizontal `justify` only. There is no thickness, aspect, vertical justify or font face.
- `PcbBoardContour` (arc-aware `segments`) and `PcbBoardCutout` exist (`types.ts:565-587`). The KiCad parser's outline assembly (`kicad-pcb-parser.ts:651-660`) builds **one** loop, falls back to the bbox, and ignores footprint `Edge.Cuts`.
- The schematic symbol transform `transformLocalPointNm` (`commands/place-part.ts:45-63`) **mirrors X first, then rotates**.
- The PCB pad world frame is `padWorldPositionMm` / `padCopperShape` (`src/shared/pcb-geometry/pad-geometry.ts:80-130`). A mirrored placement conjugates the pad rotation.
- Staged-row enumerators that read `library_components` directly:
  - `loadFilterableRows` (`queries.ts:864`)
  - `listTags` (`queries.ts:1774-1782`)
  - `buildUserLibraryPack` (`cloud-pack-builder.ts:116-121`)
  - the mention provider (`providers/mention-provider.ts:32-130`)
  - `GET /status` count (`routes.ts:1227-1232`)
  - `commit-kicad.ts` `findExisting*`
- `library_component_footprints.pinmap_json` exists (`library/migrations/0004_component_footprint_pinmap.sql`). Previews can be rebuilt in place (`builtins/migrate-preview-models.ts:262`).
- **Cloud pull** (`frontend/components/CloudDesignBrowser.tsx:98-130`) creates a native design and replays only `place_part` / `create_wire` / `upsert_label`. **No PCB rows travel.**
- Migrations: designer at `0020`; library at `0011`. H08 adds `0021_net_identity`, H13 `0021_design_frame_status`; all names are distinct, applied in lexicographic order.

---

## 3. Design

### 3.1 Pipeline shape

The pipeline is **plan → stage → resolve → apply → finalize**. Only stage, apply and finalize write.

```
resolveProjectFiles ─► buildImportPlan (pure + read-only LibrarySDK.planKicadProjectComponents)
                         │  ImportPlan + planDigest  (inspect returns its summary)
commit(planDigest?) ─────┤  rebuild plan; digest mismatch → 409 plan_changed
   phase "stage"    ─────┤  LibrarySDK.stageKicadProjectComponents(batchId)  (one library tx)
   phase "resolve"  ─────┤  LibrarySDK.resolveComponentForPlacement × N; any null → 409 plan_changed
   phase "apply"    ─────┤  ONE designer tx: head, schematic, H08 initializeNetIdentity, net invariant,
                         │  PCB (bound nets), settings, report row, outcome-ledger row, commandLog row
   phase "finalize" ─────┘  LibrarySDK.finalizeStagedImport(batchId)  (retried; ledger makes it recoverable)
 any failure / abort before "apply" commits → LibrarySDK.discardStagedImport(batchId)
```

Cancellation is honoured at every phase boundary before the designer transaction starts. Once that
synchronous transaction has begun, the import completes (§3.12).

**P0 pre-slice:** user-visible fixes that do not need the new pipeline land first, on today's
`commit.ts` (§4 P0). They need neither H08 nor the re-pin.

### 3.2 File layout

Designer files live under `src/modules/designer/backend/import/kicad-project/`, each under 500 lines.

| File | Status | Responsibility |
|---|---|---|
| `pipeline.ts` | new (S10) | `runKicadProjectImport()`: phases, mutex, abort, error mapping, discard/finalize |
| `commit.ts` | thinned **in S10** | Thin re-export of `commitKicadProjectImport` / `inspectKicadProjectFromBytes` for `sdk.ts` |
| `plan/types.ts` | new | `ImportPlan` and all plan record types |
| `plan/build-plan.ts` | new | Assembles the plan; computes `planDigest` and reconciles the census |
| `plan/census.ts` | new | Independent token census in source units (§3.6.1) |
| `plan/sheet-instances.ts` | new | Instance tree, offsets, per-instance refdes, label scoping, case-collision suffixing, sheet-pin links, caps |
| `plan/unit-groups.ts` | new | Multi-unit component grouping (§3.6.4) |
| `plan/schematic-plan.ts` | new | Parts, pins, labels, primitives (incl. hidden power pins) and wires as plain rows, plus in-memory derived nets |
| `plan/component-plan.ts` | new | Instance grouping, library-form normalisation, candidates, pad policy |
| `plan/board-items.ts` | new | Placements, tracks, vias, zones, keepouts and board-only decomposition through `frame-port` |
| `plan/board-outline.ts` | new | Edge.Cuts loops → contour plus cutouts (§3.10.1) |
| `plan/board-graphics.ts` | new | `gr_*` → overlays, or explicit loss entries |
| `plan/rules.ts`, `plan/netclass-patterns.ts` | new | Classes, patterns, directive labels, minimums, setup, fabricator, visible layers |
| `plan/kicad-defaults.ts` | new | Transcribed KiCad defaults with source citations |
| `plan/net-binding.ts` | new | Pure KiCad-net ↔ schematic-net binding |
| `frame-port.ts` | new | The H13 seam plus the H14-owned de-rotation and capability probe |
| `net-identity-port.ts` | new | The H08 seam |
| `insert-schematic.ts` | refactor (S10) | Writes `SchematicPlan` rows only |
| `insert-pcb.ts` → `insert-pcb.ts` + `insert-pcb-copper.ts` + `insert-pcb-areas.ts` | refactor (S10) | Writes `BoardPlan` rows with bound `netId` |
| `insert-report.ts` | new | Report row, ledger row, `commandLog` row |
| `report.ts` | new (P0 seed, S0 full) | Warning catalog: code → group, blocker class, live predicate, message builder |
| `import-loss.ts` | new (S11) | Live import-loss evaluation for H19 (§3.14) |
| `import-registry.ts` | new | In-process registry: busy flag, `importId` → phase / AbortController / sha |
| `recover-staging.ts` | new | Startup reconciliation driven by the outcome ledger |
| `ingest-library.ts`, `ingest-models.ts`, `flatten-sheets.ts` | **deleted in S10** | Their logic moves to the library SDK (S1) and the plan (S3, S7) |
| `errors.ts` | extend | New reasons (§3.13) |

The deletions move to S10 (review finding 15): `commit.ts:59,98` still calls `flattenSheets`, and the
new pipeline does not exist until S10.

**Designer model files (S3b, unit groups):**
- `src/sdks/designer/types.ts` (`DesignerPart.unitGroup?`)
- `pcb/pcb-store.ts` (sync)
- `pcb/net-pad-correlation.ts`

**Library files:**

| File | Status | Responsibility |
|---|---|---|
| `src/modules/library/backend/import/project-staging.ts` | new | plan, stage, finalize, discard, list-open, stage-models |
| `src/modules/library/backend/import/staging-visibility.ts` | new | `notInOpenImportBatch(componentIdColumn)`, the one SQL predicate |
| `src/modules/library/backend/migrations/0012_import_staging.sql` | new | Staging tables |
| `src/sdks/library/types.ts`, `index.ts` | extend | Types and SDK methods (additive) |
| `queries.ts`, `cloud-pack-builder.ts`, `providers/mention-provider.ts`, `routes.ts` (`/status`), `import/commit-kicad.ts` | edit | Apply the visibility predicate at every component enumerator |
| `import/unqualified-import.ts` | edit | `ImportSource` gains `"kicad_project"` (or H13 OP3b's successor) |

**Parsers** (`src/modules/library/backend/infrastructure/parsers/kicad/`):

| File | Status | Responsibility |
|---|---|---|
| `kicad-pcb-parser.ts` + new `kicad-pcb-graphics.ts`, `kicad-pcb-footprint.ts`, `kicad-pcb-outline.ts` | edit/split | Graphics; footprint `path`/`uuid`/`attr`/`locked`; pad `pinfunction`; net-name-only tokens; copper counting by name; **all** Edge.Cuts loops including footprint Edge.Cuts with exact arcs; setup and pcbplotparams mask/paste/tenting values |
| `kicad-schematic-parser.ts` | edit | `instances`, `mirror`, `lib_name`, `in_bom`/`on_board`/`dnp`, sheet uuid, `Sheetfile` path, `netclass_flag`, bus/bus_entry counts, `sheet_instances` |

Module boundary: new designer code imports **no** stateful library code. Pure parsers stay imported from the library tree, which is the existing allowed exception (H13 §OP9 relies on it too).

### 3.3 SDK type changes (additive only; `src/sdks/designer/types.ts`)

```ts
export type KicadImportWarningGroup =
  | "components" | "nets" | "rules" | "geometry" | "graphics" | "schematic" | "library" | "source";

/** capability = changes copper / mask / paste / holes / outline / connectivity / rules → non-acknowledgeable.
 *  cosmetic   = silk / fab only → acknowledgeable. */
export type KicadImportBlockerClass = "capability" | "cosmetic";

/** How a capability blocker clears (§3.14.2). Never by acknowledgement. */
export type KicadImportLossPredicate =
  | "permanent"            // clears only by re-importing a fixed source
  | "subject_deleted"      // every subject row is gone
  | "footprint_changed"    // each subject placement deleted, or its footprint snapshot digest differs
  | "zone_deleted"
  | "outline_changed"      // board outline digest differs from import time
  | "netclass_assigned"    // every subject durable net has an explicit perNetClassAssignments entry
  | "copper_reassigned"    // none of the subject copper ids remain on the recorded net id
  | "delegated";           // gate is owned elsewhere (H08 unresolved-name copper, H13 frame, H19 footprints); report only

export interface KicadProjectImportWarning {
  code: string;
  message: string;                 // human sentence; the wizard shows this, never `code`, by default
  severity: "info" | "warning";
  group?: KicadImportWarningGroup;             // absent on old rows → "source"
  blocker?: { class: KicadImportBlockerClass; predicate: KicadImportLossPredicate };
  /** Stable subject. Keys are plan-local at plan time and rewritten to persisted ids at apply time. */
  subject?: { kind: "net" | "footprint" | "placement" | "part" | "graphic" | "zone" | "rule" | "sheet" | "file" | "copper" | "board";
              keys: string[] };
  details?: Record<string, string | number | boolean | string[]>;
}

/** Census in SOURCE UNITS (§3.6.1). Invariant: sourceUnits == plannedUnits + droppedUnits. */
export interface KicadImportCountRow {
  entity: string;            // "pcb.segment", "pcb.zone", "pcb.footprint", "sch.symbol_instance", "pcb.gr_text", …
  sourceUnits: number;       // source tokens (schematic: weighted by sheet-instance count)
  plannedUnits: number;      // source units represented by ≥ 1 written row
  droppedUnits: number;      // source units with a drop warning
  rows: number;              // rows written (expansions: F&B zone → 2, arc → N chords, board-only fp → K items)
  committedRows?: number;    // measured after apply (result / report only)
}

export interface KicadImportComponentOutcome {
  key: string;               // plan-local group key (§3.7)
  symbolLibId: string; symbolLibName: string | null;
  footprintLibId: string;
  references: string[];
  status: "reuse" | "create" | "reject";
  reason?: string;           // human sentence for "reject"
}

export interface KicadImportNetSummary {
  kicadNets: number; boundByPads: number; boundByAlias: number;
  split: number; merged: number; shortedByMerge: number; padless: number; unbound: number;
  caseCollisionsRenamed: number; noNetCopperItems: number;
}

export interface KicadImportPlanSummary {
  planDigest: string;
  frame: "kicad-legacy-unqualified" | "kicad-canonical-v1";
  counts: KicadImportCountRow[];
  components: KicadImportComponentOutcome[];
  nets: KicadImportNetSummary;
  unsupported: Array<{ token: string; count: number; where: "pcb" | "sch" | "footprint" | "pad" | "setup" }>;
  capabilityBlockers: number;
  cosmeticBlockers: number;
}

// KicadProjectInspectReport gains   plan?: KicadImportPlanSummary;
// KicadProjectCommitRequest gains   planDigest?: string; importId?: string; signal?: AbortSignal (in-process only)
// KicadProjectCommitResult gains    importId: string; reportId: string; counts: KicadImportCountRow[];
//                                   capabilityBlockers: number; cosmeticBlockers: number;

export interface KicadImportReport {
  reportId: string; designId: string; importId: string;
  sourceFileName: string; sourceSha256: string; sourceVersion: string | null;
  frame: KicadImportPlanSummary["frame"];
  createdAt: string;
  counts: KicadImportCountRow[];
  warnings: KicadProjectImportWarning[];
  nets: KicadImportNetSummary;
  netMap: Array<{ kicadKey: string; kicadName: string; kind: string; netId: string | null }>;
  blockers: Array<{ blockerKey: string; code: string; class: KicadImportBlockerClass;
                    predicate: KicadImportLossPredicate; open: boolean;      // `open` evaluated live on read
                    acknowledgedAt: string | null }>;
}
```

`DesignerSDK` gains:
- `getKicadImportStatus(importId)`
- `getDesignImportReport(designId)`
- `acknowledgeImportBlocker(designId, blockerKey, expectedRevision)`; cosmetic only

Run `npm run gen` and commit the stubs.

### 3.4 H08 seam: `net-identity-port.ts` (bound to OPENPCB-56.md)

```ts
export interface ImportedNet {            // adapter over H08's BoundNet (OPENPCB-56.md:908)
  readonly id: string;                    // net:<seq>
  readonly pinIds: readonly string[]; readonly labelIds: readonly string[]; readonly primitiveIds: readonly string[];
  readonly displayName: string;           // H08 `name`
  readonly nameSource: "gnd" | "pwr" | "portal" | "label" | "auto";
}
export interface ImportNetIdentityPort {
  /** H08 `initializeNetIdentity(tx, designId, "kicad-import", ts)`; call after schematic rows, before settings/copper. */
  materialize(tx: DbClient, designId: string, timestamp: string): readonly ImportedNet[];
  /** H08 quarantine rows for deliberately unbound copper (reason unknown_name | ambiguous_name). */
  quarantineUnboundCopper(tx: DbClient, designId: string,
    rows: ReadonlyArray<{ refKind: "trace" | "via" | "zone" | "freePad"; refId: string; legacyValue: string;
                          reason: "unknown_name" | "ambiguous_name"; candidates: string[] }>, timestamp: string): void;
}
```

Bindings confirmed by H08:
- **(H08-a)** holds: `initializeNetIdentity` is the seam, run inside the importer's transaction.
- **(H08-c)** holds: copper, zones, free pads and settings refs hold durable ids.
- **(H08-b) is not provided.** There is no display-name override. Consequences:
  - Schematic named nets keep their label text. Auto nets show H08's `Net_<seq>`.
  - The KiCad name lives only in the report's `netMap`, which the import report dialog shows. The projection never reads it.
  - Rev 1's `setImportedDisplayName` is dropped.

**Unbound copper representation (review finding 5).** Deliberately unbound copper is written as
`{netId: null, netName: <exact KiCad name>}`.
- In H08 this is exactly an *unresolved-name* reference (OPENPCB-56.md:503, :686). It yields DRC `NET_ORPHANED_COPPER` and `assertNetIdentityExportable` 422 (`:693`, `:710`). So it is a live, non-acknowledgeable export blocker, cleared only when the user rebinds or deletes the copper.
- H14 also writes the H08 quarantine rows, for provenance and the "Rebind" suggestion.
- H14 **never** calls H08's `resolveImportedNetHints`, which binds by unique name; H14's binding has already decided.
- Bound copper is written as `{netId, netName: null}`.

The projection-time `bindNetName` would re-bind such rows by name (`pcb-projection.ts:107-123`). H08 S8 deletes it. **S10 therefore hard-depends on H08 S3 + S5 + S8**, so the two never coexist. A regression test asserts that an ambiguous-alias trace stays `netId: null` after reopen.

**(H08-d)** assumption: H08's `state-store.ts` exports a quarantine-row insert usable in an arbitrary
transaction. If it does not, the adapter inserts into `designer_net_identity_quarantine` through H08's
row type. Only this file changes.

### 3.5 H13 seam: `frame-port.ts` (bound to OPENPCB-61.md §3.8)

`frame-port.ts` re-exports H13's `kicad-frame.ts` interface **verbatim**: `KicadBoardFrame` with
- `point`
- `pointMm`
- `bboxMm`
- `placementRotationDeg`
- `placementMirrored`
- `textRotationDeg`
- `arcSegmentCw`
- `footprintToLibraryForm`
- `schPoint`
- `schSymbolTransform`
- `boardImportFrameStamp`

Until H13 OP9 lands, H14 ships a stub with the same signatures (legacy plus a y-flip canonical stub for tests). H14 adds three items of its own.

**(a) Frame capability constant (review finding 24).** Selection used to be circular: grouping needed the frame before any candidate existed.
- `KICAD_IMPORT_FRAME_STAMP` is probed **once** at module load. It builds a preview of a fixed 1-pad in-memory footprint with the installed `@openpcb/kicad-import` and reads `(preview as {frame?: unknown}).frame` (assumption H13-a, confirmed by H13 §3.8 / OPENPCB-61.md:1113).
- `selectBoardFrame(KICAD_IMPORT_FRAME_STAMP)` decides the frame for the whole import before planning.
- Reused library rows whose stamp differs are re-planned as `create` (§3.7), so frames never mix.

**(b) Library form with footprint-relative angles (review finding 2, blocker).** In `.kicad_pcb`, pad, `fp_text`, `property` and `fp_text_box` `(at x y α)` angles are **absolute**: they include the footprint angle θ (fixture: D5 θ=−90, pads 270).
- H13's canonical `unplaceBoardFootprint` already maps `α → norm360(α − θ)` (OPENPCB-61.md:803).
- The legacy frame returns the verbatim node. That would double-rotate non-square pads, and each placement angle would yield a different `contentKey`, so a different "(variant N)".
- H14 therefore owns `libraryForm(node, side)`:
  - canonical → `frame.footprintToLibraryForm(node, side)`
  - legacy → `derotateChildAngles(node, θ)` for **both** sides
- `derotateChildAngles` subtracts θ from every child `at` angle, leaves positions unchanged (they are already footprint-local in KiCad) and strips `(net …)`.
- In the legacy frame a back-side node is still not un-flipped, so it stays under H13's `transform_unqualified` / `sourceFrame` gate. But its pad angles are no longer doubled.
- Test (S7): for every lib_id in USBtoUART, all instances (R_0201 at 0/90/180, D5/D6 at −90, C at ±90) produce **one** `contentKey` in both frames.

**(c) Board composition for footprint children (review finding 14).** Board-only footprints and footprint silk/fab need footprint-local → board composition. H14 adds **no new transform maths**:
1. Take the library-form node from (b). Its locals are footprint-relative with relative angles; in the canonical frame they are Y-up, via H13.
2. Build a synthetic `PcbPlacedPart`-shaped value:
   - `positionMm = frame.pointMm(fp.at)`
   - `rotationDeg = frame.placementRotationDeg(θ, side)`
   - `layer` from the side, with mirroring from `frame.placementMirrored(side)`
3. Compose each child with the **same** functions DRC and export use: `padWorldPositionMm` and `padCopperShape` (`src/shared/pcb-geometry/pad-geometry.ts:80-130`), and `transformPadCenterMm` for graphic vertices.
   - Result: a free pad's absolute `rotationDeg` = the composed world rotation that `padCopperShape` computes. It is never a naive sum, and a mirrored placement conjugates.
4. Overlay shapes: `fp_rect` / `gr_rect` under a rotation that is not a multiple of 90° becomes a 4-vertex `polygon`. `fp_circle` maps centre + edge point.
5. Test (S6): J1's two NPTH pegs as a decomposed board-only footprint must equal KiCad's `NPTH.drl` hits in `grbr.zip`, canonical frame only, within 1 µm. Rotation-sensitive pads (0201 roundrect at 90°) must match the `grbr.zip` aperture **size and orientation**.

**Frame stamp persistence (review finding 10, see §10).** H14 writes:
- `boardImportFrameStamp(frame)` into `commandLog.command_json.frame`
- `frame` into `designer_import_reports.frame`

H13's `computeDesignFrameStatus` reads exactly these two (OPENPCB-61.md:704-706, :943). No extra port function is needed.

H13 must not edit `insert-pcb.ts` / `commit.ts` / `pipeline.ts`. It delivers `kicad-frame.ts` and `board-footprint-unplace.ts`.

### 3.6 `ImportPlan` (plan/types.ts)

```ts
export interface ImportPlan {
  version: 2;
  frame: KicadBoardFrame;
  source: { fileName: string; sha256: string; boardVersion: number | null; generatorVersion: string | null };
  census: CensusRow[];                          // §3.6.1
  sheets: SheetInstancePlan[];                  // §3.6.2
  unitGroups: UnitGroupPlan[];                  // §3.6.4
  schematic: SchematicPlan;                     // plan-local keys, no DB ids
  components: ComponentPlan;                    // §3.7
  board: BoardPlan;                             // placements, tracks, vias, zones, keepouts, outline+cutouts, freePads, freeHoles, overlays
  rules: RulesPlan;                             // §3.9
  nets: NetBindingPlan;                         // §3.8
  warnings: KicadProjectImportWarning[];        // catalog-built, stable order
}
```

**Size caps (review finding 26), checked during instance-tree construction before any expansion:**

| Constant | Value |
|---|---|
| `MAX_SHEET_INSTANCES` | 2 048 |
| `MAX_SYMBOL_INSTANCES` | 20 000 |
| `MAX_BOARD_ITEMS` (segments + arcs + vias + footprints + gr_*) | 200 000 |

Exceeding any cap → 422 `project_too_large` with the measured count. The values are a deliberate desktop bound, recorded in §5.

#### 3.6.1 Census (review finding 1, blocker)

`plan/census.ts` walks the raw s-expression independently of the parsers. It counts **source units**: one source token is one unit.

**Board:** every top-level child token of `kicad_pcb`, every child token of each `footprint`, every child token of each `pad`, and pads per type.

**Schematic:** the census walks the **sheet instance tree** (§3.6.2), not the files.
- `sch.symbol_instance` = Σ over instances of that sheet file's symbols. A sheet used twice counts its symbols twice.
- Sheet files no instance references count under `sch.sheet_unreferenced` (info `sheet_unreferenced`). They never enter the symbol counts.

**Per entity**, planners report:
- `plannedUnits`: source units represented by ≥ 1 written row
- `droppedUnits`: source units with a coded drop warning
- `rows`: rows written

**Invariant:** `sourceUnits == plannedUnits + droppedUnits`. Expansions never enter it; they appear only in `rows`:
- an `F&B.Cu` zone is 1 unit and 2 rows
- an arc is 1 unit and N chord rows
- a board-only footprint is 1 unit and K free pads/holes/overlays
- a symbol in a twice-used sheet is 2 units and 2 rows

**Mismatch handling** (A6/T-251; this is user data):
- In production: a capability blocker `import_census_mismatch` (predicate `permanent`), with the per-entity diff in `details`. The import still commits, but the design is not manufacturable.
- In tests: `hooks.strictCensus = true` (set by every test harness) throws `ImportInvariantError`, so bugs fail loudly.

**Token classification**, one exhaustive table:

| Class | Tokens |
|---|---|
| `handled` | segment, arc, via, zone, footprint, gr_line, gr_rect, gr_circle, gr_arc, gr_poly, gr_text, net, layers, setup, symbol, wire, junction, label, global_label, hierarchical_label, netclass_flag, sheet, no_connect, lib_symbols; pad children at/size/drill/layers/net/roundrect_rratio/pinfunction/pintype/uuid/chamfer_ratio/chamfer (when the shape supports it) … |
| `benign` | version, generator, generator_version, general, paper, title_block, uuid, property, sheet_instances, symbol_instances, embedded_fonts, pcbplotparams (except the values read in §3.9), tstamp, … |
| `unsupported` | anything else |

**Blocker trigger rule (review finding 12).** An `unsupported` token, or a handled token whose value OpenPCB cannot represent, becomes:
- a **capability** blocker iff its layers intersect `*.Cu`, `*.Mask`, `*.Paste` or `Edge.Cuts`, **or** it is a manufacturing modifier. Modifiers:
  - `clearance`
  - `solder_mask_margin`
  - `solder_paste_margin`
  - `solder_paste_margin_ratio`
  - `zone_connect`
  - `thermal_width`, `thermal_gap`, `thermal_bridge_angle`
  - `net_tie_pad_groups`
  - `private_layers`
  - custom-pad `primitives`
  - `fp_*` on `*.Cu` (net ties, antennas)
  - footprint `zone`
- a **cosmetic** blocker iff it is on silk/fab only
- info otherwise

A modifier whose value equals what OpenPCB will produce raises nothing. For example, a pad `solder_mask_margin` equal to the imported board mask expansion, or `zone_connect` equal to the zone's own pad connection, is silent.

Codes:
- `footprint_manufacturing_token_unsupported`: subject is the placement; predicate `footprint_changed`; details list the tokens and values.
- `source_construct_unsupported`: top-level tokens.

**USBtoUART consequence:** 6 pads with `solder_mask_margin 0.102` (board expansion 0) and 1 pad with `zone_connect 2` (solid, while the zone is thermal) raise capability blockers. See Q2.

#### 3.6.2 Sheet instances (plan/sheet-instances.ts)

Replaces `flatten-sheets.ts`, which is deleted in S10.

1. **Files and root (review finding 25).**
   - Sheets are keyed by their **archive-relative path** (POSIX, normalised, no `..`), never by basename.
   - `Sheetfile` values resolve relative to the project directory.
   - Root:
     1. the sheet whose path equals `<project dir>/<project stem>.kicad_sch`
     2. else the unique sheet that no other sheet references
     3. else 422 `unreadable_file` ("cannot determine the root sheet")
   - All ordering uses **code-unit comparison** (`a < b`), never `localeCompare`.
2. **Instance tree.**
   - For each `(sheet …)` node in an instance, child path = `parentPath + sheetUuid + "/"`.
   - A missing file gives `sheet_file_missing` (capability, permanent) and the instance is skipped.
   - Recursion cycle or depth > 32 → 422 `unreadable_file`.
   - The caps of §3.6 apply as the tree is built.
3. **Refdes per instance.**
   - Primary: `(instances (project … (path "/<rootUuid><instancePath>" (reference …) (unit …))))` (KiCad 7+).
   - Fallback: root `(symbol_instances …)` (KiCad 6), then the `Reference` property.
   - An unresolved or duplicate refdes is renamed `_S<n>` (`refdes_collision_renamed`). PCB matching still uses footprint `path` (§3.6.3).
4. **Offsets.**
   - Root at (0, 0).
   - Each further instance, depth-first: `x = rootBBox.maxX + k·gap`, `y = 0`.
   - `gap = 2 × max instance width`, snapped up to a 1.27 mm multiple.
   - Offsets are applied in KiCad mm before `frame.schPoint`.
5. **Label scoping** (KiCad: local labels are sheet-instance scoped; global labels and power symbols are global).
   - A local label T in instance P keeps T verbatim **iff** no other instance has a local label whose text equals T **case-insensitively**, and no global label or power net equals T case-insensitively (review finding 6). The comparison is case-insensitive because OpenPCB's union is.
   - Otherwise it is rewritten to KiCad's own name, `P == "/" ? "/" + T : P' + T` (P' = sheet-name path). Warning `label_scoped` (info).
6. **Case-only collisions in the global namespace (review finding 6).**
   - After scoping, group every global-namespace name by upper case: global labels, power names, root-verbatim local labels, scoped names.
   - A group with ≥ 2 distinct exact texts (KiCad: different nets, e.g. `EN` / `en`, or power `GND` / `gnd`):
     - the first exact text in code-unit order keeps its text
     - each other text T becomes `T_2`, `T_3`, …, the first suffix whose upper case is unused
   - Warning `net_name_case_collision_renamed` (warning, lists the rename). The exact KiCad name stays in `netMap`.
   - They are never merged and then blocked afterwards.
7. **Power symbols (review finding 6).**
   - Only the exact text `GND` becomes the `gnd` primitive.
   - `Ground`, `gnd` and `GNDA` become `pwr` rails with their exact (possibly suffixed) text. This changes `insert-schematic.ts:444-446`, which today also maps `ground` and is case-insensitive.
8. **Hierarchical connectivity.**
   - A child `hierarchical_label` H in instance C becomes the scoped label `C.namePath + H`.
   - The matching parent `sheet (pin "H")` at its pin position (plus the parent offset) becomes a label with the same text.
   - Unmatched → `hierarchical_pin_unmatched` (warning).
9. **Symbol transform (review finding 18).**
   - `(rotationDeg, mirrored) = frame.schSymbolTransform(θ, mirror)`. H13 owns the maths (KiCad `SCH_SYMBOL::SetOrientation`). OpenPCB applies mirror-X **then** rotation (`place-part.ts:45-63`).
   - **S3 owns the oracle:** fixture `sym-transform` places one asymmetric 3-pin symbol at each of the 12 combinations (θ ∈ {0, 90, 180, 270} × mirror ∈ {none, x, y}). Each pin is wired to a distinct global label `P<θ><m><pin>`.
   - The test asserts that OpenPCB's derived pin→net partition equals KiCad's netlist partition from `kicad-ref/netlist.net`.
   - It also asserts the 12-entry table `(θ, mirror) → (rotationDeg, mirrored)` as a snapshot. Its comment cites the KiCad source lines.
   - Without `kicad-ref` the test **fails** under `OPENPCB_REQUIRE_KICAD_REF=1` (§3.16).
10. **Classification.**
    - `#PWR`/`power:` → primitives (rule 7).
    - `#FLG` / `power:PWR_FLAG` → skipped (`erc_flag_skipped`, info).
    - `(on_board no)` → skipped (`schematic_symbol_not_on_board`).
    - `(dnp yes)` → `dnp_not_imported` (H23).
    - bus / bus_entry → unsupported (warning; label names carry their connectivity).
11. **Hidden power pins (review finding 20).**
    - KiCad connects a hidden `power_in` pin to the global net named by the pin name.
    - The plan reads hidden `power_in` pins from the embedded `lib_symbols` node with the pure parser (`hidden` is available, `kicad-symbol-parser.js:223`).
    - For each placed unit that owns such a pin, it adds a `pwr` primitive (railText = pin name, after rule 6) at the pin's world position.
    - This requires the OpenPCB part to carry the pin. S7 verifies whether `LibrarySymbolPinSnapshot` includes hidden pins:
      - if it does not, S1's stager stores them (`hidden: true`)
      - if neither is possible, capability blocker `kicad_hidden_power_pin_unsupported` (`footprint_changed`)
    - Fixture `hidden-power` with a `kicad-ref` netlist.

#### 3.6.3 PCB ↔ schematic matching

- Footprint `(path "/<sheet uuids…>/<symbol uuid>")` is matched against instance path + symbol uuid. Refdes is the fallback only when `path` is absent (`footprint_matched_by_refdes`).
- Footprints with no matching symbol, with `attr board_only`, or whose path points at an `on_board no` / `#FLG` symbol become **board-only footprints** (§3.10.3).
- A multi-unit footprint's `path` names one unit's symbol. It matches the **unit group** containing that unit (§3.6.4), never only that unit.
- On-board symbols with no footprint → `schematic_part_without_footprint` (warning, predicate `delegated`). The part is imported symbol-only through the library placeholder path. H19's `unresolvedFootprintBlocker` already blocks a placement with no pads.

#### 3.6.4 Multi-unit components (plan/unit-groups.ts + S3b; review finding 4)

**Definition.** A component is every on-board symbol instance sharing one per-instance refdes, across all sheets, whatever its unit number. Different `lib_id` / `lib_name` under one refdes → `refdes_conflicting_symbols` (capability, permanent); they are not grouped.

**Schematic.** One OpenPCB part per unit is kept, as today's visual model with the `B`/`C` suffix display. Each part gets `unitGroup = { groupId, unit }`; `groupId` is a fresh UUID per component.

**Unit-0 (common) pins** go on the owner part only, never duplicated (today `insert-schematic.ts:157-161` duplicates them). A unit-0 pin that KiCad wires on a non-owner unit raises `common_pin_wired_on_secondary_unit` (warning). The binding then shows the effect as a split/unbound warning.

**Owner** = the live part in the group with the lowest unit number (ties: part id in code-unit order), computed at read time.

**Designer model (S3b, additive):**
- `DesignerPart.unitGroup?: { groupId: string; unit: number }` (SDK type plus the persisted payload).
- `syncPcbPlacementsFromSchematic` creates **one placement per group**, owned by the owner part's id.
  - When the owner part is deleted and another group part survives, the placement is **re-keyed** to the new owner (UPDATE of `partId`), not deleted and re-staged. Its position and copper stay.
- `correlateNetPads` maps `pin.partId → ownerPartId(group)` before the placement lookup. The pins of every unit then correlate to the one footprint.
- The BOM counts one line per group (note for H23).
- Native designs never set `unitGroup`, so their behaviour is unchanged.

**Plan.** `pinOfPad(refdes, padNumber)` searches the union of all unit parts' pins in the group.

**Fixture `multi-unit`:** an LM358 with unit A on the root, unit B on a sub-sheet instance and unit C (power) on the root. It asserts one placement, 8 pads correlated, and a `kicad-ref` netlist partition match.

### 3.7 Components and pads (plan/component-plan.ts + library SDK)

**Grouping key (review finding 3).** For each board footprint instance matched to a component:

```
symbolKey    = lib_name ?? lib_id                       (lib_name parsed in S2)
symbolCK     = sha256(canonical(embedded lib_symbols node for symbolKey, in the sheet that holds the instance))
footprintCK  = sha256(canonical(normalise(libraryForm(node, side))))         (§3.5 b)
groupKey     = (symbolKey, symbolCK, footprintLibId, footprintCK)
```

`normalise` drops `at` (footprint level), `uuid`, `tstamp`, `path`, `sheetname`, `sheetfile`, `locked`, reference/value text values, property values and pad `net`.
- Two symbols sharing one footprint (R / R_Small on R_0603, or two SOT-23 pinouts) are different groups.
- Two sheets embedding different versions of one symbol are different groups.
- Variants of one name are named `<fpName> (variant N)` (`footprint_instance_variants`, info).

The tag-based "preexisting" shortcut is removed from commit. Reuse is content-based only.

**Library SDK additions** (`src/sdks/library/index.ts`; implementation in `project-staging.ts`):

```ts
export interface LibraryKicadComponentCandidate {
  key: string;
  symbol: { libId: string; libName: string | null; fileName: string; content: string };
  footprint: { libId: string; fileName: string; content: string };
  componentName: string; description: string;
  tags: string[];                      // "imported-from-kicad", "kicad-lib-id:…", "kicad-footprint-id:…"
}
export type LibraryKicadRejectReason =
  | "unreadable_symbol" | "unreadable_footprint" | "no_pads"
  | "pin_without_number" | "pin_not_on_footprint" | "intake_unqualified";
export interface LibraryPadClassification {
  index: number; number: string;
  kind: "copper" | "mechanical" | "paste_only";   // review finding 31
  degraded: Array<"plating_unrepresented" | "slot_unrepresented" | "shape_degraded">;  // review finding 11
}
export type LibraryKicadCandidateOutcome =
  | { key: string; status: "reuse" | "create"; componentId?: string; frame: string | null;
      symbolPins: LibrarySymbolPinSnapshot[]; pads: LibraryPadClassification[] }
  | { key: string; status: "reject"; reason: LibraryKicadRejectReason; detail: string };

planKicadProjectComponents(c: readonly LibraryKicadComponentCandidate[]): Promise<LibraryKicadCandidateOutcome[]>;
stageKicadProjectComponents(input: { batchId: string; owner: "designer.kicad_project";
  candidates: readonly LibraryKicadComponentCandidate[] }): Promise<LibraryKicadCandidateOutcome[]>;
stageKicadProjectModels(input: { batchId: string; models: ReadonlyArray<{ componentId: string;
  fileName: string; bytes: Uint8Array; modelRef: string }> }): Promise<{ queued: number; skippedExisting: number }>;
finalizeStagedImport(batchId: string): Promise<void>;
discardStagedImport(batchId: string): Promise<{ components: number; symbols: number; footprints: number; models: number; blobs: number }>;
listOpenStagedImports(): Promise<Array<{ batchId: string; owner: string; createdAt: string }>>;
```

**Pad policy (T-247, A4; review findings 11 and 31).**
- `validateFootprintPads(preview, { allowUnnumberedPads: true })`.
- `validateSymbolPinsCoverFootprintPads` stays strict. No pin is ever synthesised.

Classification uses the raw pad:

| Class | Rule |
|---|---|
| `paste_only` | layers ⊆ `{*.Paste}` |
| `mechanical` | `np_thru_hole`, or no `*.Cu` layer and not paste-only |
| `copper` | otherwise |

Paste-only pads produce **no copper record and no drill**. An S7 test pins this for the 0201 sub-pads. The pinned `layer = layers[0] = "F.Paste"` flows into copper records only if the copper predicate admits it; S7 asserts that it does not.

**Drill capability** is feature-detected once from the installed kicad-import, by building a preview of a fixed NPTH oval-drill pad:
- `HAS_PLATING = "plated" in pad`
- `HAS_SLOTS = "drillSlotMm" in pad`
- custom-shape support = the preview keeps `shape: "custom"` with primitives

**Degraded pads:** if the raw pad is NPTH and `!HAS_PLATING`, `(drill oval …)` and `!HAS_SLOTS`, or custom/trapezoid and degraded, the pad gets a `degraded` entry. The component is **accepted**: J1 is never dropped. Each placement of it gets the capability blocker `pad_geometry_degraded` (`footprint_changed`; details list pads and reasons).

**After the H13 SH2/OP7 re-pin** (kicad-import 0.2.0 carries `e882332`/`58d3620`), plating and slots are represented and the blocker disappears for new imports. Existing imports clear it by footprint refresh (H13 OP8 re-derives previews from raw), which the `footprint_changed` predicate observes.

**J1 acceptance (S7):**
- Pinned packages: J1 imported, with 2 mechanical pads, 2 `S1`-numbered oval-slot copper pads and the `pad_geometry_degraded` blocker.
- Re-pinned packages: no blocker; the NPTH and slot drills match `grbr.zip` (S13).

Designer warnings from the classification:
- `unnumbered_mechanical_pads` (info)
- `unnumbered_copper_pads` (warning)
- `unnumbered_pad_has_board_net`: capability, predicate `footprint_changed`. The pad stays netless, which changes pour connection.

**Reuse rule** (inside the library; all must hold; review finding 33):
1. Existing symbol and footprint rows match `provenance.sourceHash` and `normalized.id`.
2. `provenance.frame` (H13 stamp; missing means legacy) equals the import frame.
3. `provenance.intakeDigest == sha256(canonical({normalized, preview}))`, written at intake by S1. This detects in-place edits and preview rebuilds (`migrate-preview-models.ts:262`).
4. The component-footprint row has `pinmap_json IS NULL`, the identity pin map that §3.8 assumes.

Rows without `intakeDigest` (pre-H14) are never reused.

**Intake policy.** The stager calls H13 OP3b's `qualifyKicadFootprintIntake("kicad_project", …)`, or `rejectKicadFootprints` until OP3b lands; H13 asks that OP3b land first. Any `intake_unqualified` → whole-import 422 `UNQUALIFIED_IMPORT` (fail closed).

**Models (review finding 27).**
- STEP files are matched by basename.
- `stageKicadProjectModels` inserts a `footprint_models` row only when the footprint has none. It never deletes or replaces one.
- When `writeSourceStep` creates a **new** file, its relative path is recorded in the batch as `model_blob`.
- On discard, after the DB transaction commits, each recorded blob is deleted iff no `footprint_models.source_step_sha256` still references it. This is best effort and logged; a leaked blob is harmless.

### 3.8 Net binding (plan/net-binding.ts) — the core of T-245

Inputs, all plan-local and deterministic:
- `kicadNets: Map<KicadNetKey, { ordinal: number|null; name: string }>`, where `KicadNetKey = ordinal !== null ? "#"+ordinal : "n:"+name`.
  - The parser accepts `(net N)`, `(net N "name")` and `(net "name")`. The last is a tolerant name-only form, still to be verified against a KiCad 9/10 file.
  - Ordinal 0 or an empty name means no net.
- `pads: PlannedPad[]`: `{ refdes, unitGroupKey, padIndex, padNumber, kind, kicadNet, unnumbered, boardOnly }`. Paste-only pads are excluded.
- `pinOfPad(groupKey, padNumber)`: the identity map over the union of the group's unit pins (§3.6.4).
- `schematicNets`: computed with `deriveNetsAndJunctions` **in memory** on the plan rows. This is the pure function that H08's `deriveNetComponents` keeps byte-identical (OPENPCB-56.md:34).

Algorithm (all iteration in sorted code-unit order):

1. **By pads.** For KiCad net n with ≥ 1 pad mapped to a pin, `count[s]` = n's pads whose pin lies in schematic net s.
   - One s → `{kind:"pads", s}`.
   - More than one → `{kind:"split", chosen}`. **Order (review finding 7; H08 binding decision "the fragment with the most pins keeps", OPENPCB-56.md:9):**
     - (a) most total pins in fragment s
     - (b) then most of n's pads in s
     - (c) then the smallest planNetKey
   - Warning `kicad_net_split_in_schematic`, listing each fragment's pads. **Not a blocker:** the board copper equals KiCad's, and the pads of the non-chosen fragments touch copper of another net, which DRC reports as shorts.
2. **Pads without a pin.** A pad on net n with `pinOfPad` null → `kicad_pad_net_without_pin`: capability, `footprint_changed`. The pad is netless in OpenPCB, so its pour connection differs from KiCad's. n's copper still binds through step 1.
3. **Pad-less nets.** These are copper only, or every pad is unnumbered, board-only or paste-only. Scoped alias:
   - Candidates are schematic nets with a label whose **final** text (after §3.6.2 rules 5–6) equals n.name **exactly**.
   - `/X` also matches a root-instance label `X` kept verbatim.
   - Sub-sheet `/A/B/X` matches only that scoped text.
   - Global/power names match only global labels or power primitives with that exact text.
   - `Net-(…)` / `unconnected-(…)` never alias.
   - One candidate → `{kind:"alias"}`.
   - Zero → `{kind:"unbound", reason:"padless_no_alias"}`, `kicad_net_unbound`.
   - More than one → unbound, `kicad_net_alias_ambiguous`.
   - Both are predicate `delegated`. The copper is written as an H08 unresolved-name reference (§3.4), so H08's live gate blocks it.
4. **Merges.** A schematic net chosen by ≥ 2 KiCad nets:
   - **Survivor for assignments (review finding 7):** the KiCad net with the most pads (then the smallest key) keeps its class assignment. The others' assignments are dropped with `kicad_netclass_dropped_by_merge` (warning, lists them), matching H08's "losers' assignments stop applying, reported".
   - Plan-time short check, using the S13 copper connectivity kernel (`src/shared/pcb-connectivity`) on the planned tracks, vias and pads (zone fills excluded, since they are derived): if copper of two merged KiCad nets touches → `kicad_nets_shorted_by_merge`. That is a short KiCad's DRC would flag, and OpenPCB's DRC cannot see it once the nets are one. Capability, predicate `copper_reassigned`; subject = the minority net's copper ids.
   - Otherwise `kicad_nets_merged_in_schematic` (warning): the board copper equals KiCad's, and the missing connection appears as ratsnest/unrouted.
5. **Out of sync.** A pin whose schematic net has ≥ 2 pins while its pad has no KiCad net → `board_pad_unassigned` (warning, aggregated). DRC and ratsnest show it.
6. **Copper binding.** Each track, via, zone and board-only free pad on KiCad net n takes `binding(n).planNetKey`.
   - Net 0 → `{netId:null, netName:null}`, counted in `noNetCopperItems` (info).
   - Unbound → `{netId:null, netName:<KiCad name>}` plus an H08 quarantine row (§3.4).
   - An unbound zone also hits H19's `zoneNotPouredBlocker` (`zone_net_unresolved`).
7. **Names.** Display names are H08's (§3.4). `netMap` records `kicadKey → (kicadName, kind, durable id | null)` for the report.
8. **Net classes** (§3.9): resolved per KiCad net through the binding to planNetKey, and at apply time to the durable id. There is no first-match by display name.

**Apply-time invariant.** After schematic insert and `port.materialize()`, every plan net must map to exactly one H08 net with an **identical pin set** (pin keys after planPartKey → partId).
- A difference is a **code bug**, not user data: both sides run the same pure derivation.
- It throws `ImportInvariantError`. The transaction rolls back, the batch is discarded, and the response is 500 `import_invariant_failed` with the diff in `extras`.
- This is the only 500 left, and it is deliberate. The user-data reconciliation (census) never throws (§3.6.1).

### 3.9 Rules (plan/rules.ts, plan/netclass-patterns.ts, plan/kicad-defaults.ts) — T-246/T-248

**Net classes are replaced, not merged.**
- `netClasses = [Default, …others in project order]`. KiCad `Default` → id `"default"`, first.
- **If the project declares no `Default` (review finding 30)**, one is synthesised from the KiCad netclass defaults (table below), with info `kicad_default_class_synthesised`.
- Other classes → `"kicad-" + slugify(name)`, deduplicated with a `-2` suffix. This avoids the `gnd`/`power` heuristic ids, so `classIdForName` never reclassifies a net named GND.
- A null class field takes the KiCad netclass default (`kicad_netclass_field_defaulted`).
- `color` `#d4d4d8` (display default).
- `defaultViaProtection` comes from the board setup (below), not a constant.
- `unknownRules`: `net_class_unknown_rules` with human copy.

**Assignments (review finding 19).** Precedence follows `inspect.ts:356-385`: v6 `classes[].nets`, then v7/8 `netclass_patterns`, then v9 `netclass_assignments`, then directive labels.

Patterns:
- `*` and `?` are matched against **every KiCad net name in the board net table**, with KiCad's wildcard semantics (`WildCompareString`, case-sensitive). Matching must be re-verified against KiCad source at the pinned tag and cited.
- Every net matching a pattern takes that pattern's class. Among patterns of one format, **the first matching pattern in file order wins**. Needs verification against KiCad 8 `NET_SETTINGS::GetEffectiveNetClass`, which S13 records; if it is wrong, flip it and cite.
- `[` is treated literally unless KiCad source shows otherwise.

Directive labels (`netclass_flag` with a `Netclass` property):
- The flag's connection point joins the schematic net it touches in the in-memory derivation.
- The class goes to every KiCad net bound to that schematic net.

Still unresolved: a pattern with an unknown class, a directive label touching no wire, or a class name the project does not declare.
- Code `kicad_netclass_unresolved`: capability, predicate `netclass_assigned`.
- Subject: the affected durable nets. With no subject → `permanent`.
- It is capability because the clearance and width DRC uses would be the Default class's, not the intended one.

Oracle: `kicad-ref/netlist.net` (kicadsexpr) carries `(class …)` per net. This needs verification for kicad-cli 8; S13 compares classes when the field is present.

**Minimums.** As rev 1:
- File value, else `KICAD_BOARD_RULE_DEFAULTS` (`kicad_rule_defaulted`).
- Consistency pass: a **defaulted** minimum stricter than an imported class value is relaxed (`kicad_default_rule_relaxed`). A file minimum is never relaxed (`kicad_class_below_board_minimum`).

**Board setup: mask, paste, tenting (review finding 12).**

| KiCad (location) | OpenPCB | Absent → |
|---|---|---|
| `setup.pad_to_mask_clearance` | `solderMaskExpansionMm` | KiCad default 0 (**not** OpenPCB's 0.075) |
| `setup.pad_to_paste_clearance` | `solderPasteExpansionMm` | KiCad default 0 (**not** −0.05) |
| `setup.pad_to_paste_clearance_ratio` ≠ 0 | none | capability `board_setup_unsupported` (`permanent`) |
| `setup.solder_mask_min_width` > 0 | none: KiCad merges mask apertures in output | capability `board_setup_unsupported` (`permanent`) |
| `setup.tenting` (newer KiCad, both sides), else `pcbplotparams.viasonmask` (`no` ⇒ tented) | every class `defaultViaProtection` = `"tented"` / `"none"` | `"tented"` |
| `setup.allow_soldermask_bridges_in_footprints` | none (DRC behaviour) | info `kicad_setup_drc_only` |

Every setup token value the importer reads gets a `kicad-defaults.ts` citation, and the token location needs verification against KiCad 8 source. For USBtoUART: mask expansion 0, paste 0, tented. KiCad defaults table: as rev 1, re-verify before commit.

| Field (JSON key) | KiCad identifier | Value read (mm) |
|---|---|---|
| min_clearance | `DEFAULT_MINCLEARANCE` (include/board_design_settings.h) | 0.0 |
| min_track_width | `DEFAULT_TRACKMINWIDTH` | 0.0 |
| min_via_diameter | `DEFAULT_VIASMINSIZE` | 0.5 |
| min_through_hole_diameter | `DEFAULT_MINTHROUGHDRILL` | 0.3 |
| min_hole_to_hole | `DEFAULT_HOLETOHOLEMIN` | 0.25 |
| min_hole_clearance | `DEFAULT_HOLECLEARANCE` | 0.25 |
| min_copper_edge_clearance | `DEFAULT_COPPEREDGECLEARANCE` | 0.5 |
| min_via_annular_width | JSON default `mmToIU(DEFAULT_VIASMINSIZE)` vs constructor `(VIASMINSIZE − MINTHROUGHDRILL)/2` | **needs verification**: 0.5 vs 0.1; ship the constructor value, `needsVerification: true`, relaxed by the consistency pass |
| netclass clearance / track / via dia / via drill | `DEFAULT_CLEARANCE` / `DEFAULT_TRACK_WIDTH` / `DEFAULT_VIA_DIAMETER` / `DEFAULT_VIA_DRILL` | 0.2 / 0.2 / 0.6 / 0.3 |

When kicad-cli exists, S13 runs `kicad-cli pcb drc` on fixture `layers-4l` (`"rules": {}`, 0.6/0.3 vias) to fix the annular value. Only the 8.0 table ships. `generator_version` ≠ 8.0 → info `kicad_defaults_version_assumed`.

**Fabricator:**
- `layerCount 2` → `jlcpcb_2l`
- `4` → `jlcpcb_4l`
- otherwise `"custom"` (info). The S15 6+-layer 422 remains.

**Layer count:** counted by canonical name `/^(F|B|In\d+)\.Cu$/`.

**Visible layers (T-248):** `base ∪ copperLayersForCount(n) ∪ {B.SilkS if any back overlay or back footprint silk}`. A track or via on a copper layer outside the stack → **dropped**, capability `copper_layer_out_of_stack` (`permanent`). `pickCopperLayer`'s remap is removed.

**Settings write:** `serializePcbBoardSettings(undefined, settings)` once, after `materialize()`, with `perNetClassAssignments` keyed by durable ids.

### 3.10 Board items and graphics

#### 3.10.1 Outline (plan/board-outline.ts; review finding 13)

The parser (S2, `kicad-pcb-outline.ts`) returns **all** Edge.Cuts primitives, keeping exact arcs and circles:
- top-level `gr_*`
- footprint `fp_*` on Edge.Cuts, composed with §3.5(c)

The planner chains them into closed loops (endpoint tolerance 1 µm, deterministic code-unit tie-break).
- Outer contour = the loop with the largest absolute area → `PcbBoardContour` with `line`/`arc` `segments`. Arcs are kept as arcs, mapped through `frame.pointMm` and `frame.arcSegmentCw`.
- Every other loop strictly inside the outer one → `PcbBoardCutout` (`shape: contour`). This covers internal slots, windows and footprint Edge.Cuts slots.
- A loop outside the outer, overlapping loops, or open chains → capability `board_outline_approximated` (`outline_changed`).
  - The outline then falls back to the largest closed loop, else the bbox, as today.
  - Details list the open endpoints and the dropped loops.
- `adjustBoardCenter` runs after the contour is built.

#### 3.10.2 Items (plan/board-items.ts)

Every coordinate goes through `frame`:
- placement position, exact rotation, side
- track endpoints (arc chords, info `arc_tessellated`)
- via centre
- zone, hole and keepout rings
- the outline (§3.10.1)

Segments, arcs and vias without a net token are kept as no-net copper.

Unchanged from today, re-coded through `report.ts`:
- zero-length segments dropped (warning)
- zone policy, keepout policy, `resolveImportedViaType`

`zone_hatched_fill_as_solid` and `zone_extra_contour_dropped` are capability blockers with predicate `zone_deleted`.

#### 3.10.3 Graphics (plan/board-graphics.ts, T-249)

Parser output: `ParsedKicadPcbGraphic` = `{ kind: "text" | "line" | "rect" | "circle" | "arc" | "poly"; layer; strokeWidthMm; fill; points…; text?: { value, sizeMm: {h,w}, thicknessMm, justifyH, justifyV, mirror, knockout, hidden, rotationDeg, font? } }`.

Mapping:
- `F/B.SilkS`, `F/B.Fab`, `F/B.CrtYd` → `PcbOverlayText` / `PcbOverlayShape`.
  - `fontSizeMm = size.h`, `justify` from the horizontal justification, `mirror` from the file, `rotationDeg = frame.textRotationDeg(θ)`.
  - Arc → polyline chords. Rect → `[bottomLeft, topRight]` after the transform if axis-aligned, else a 4-vertex `polygon`. Circle → `[centre, edgePoint]`.
- **Text style (review finding 29).** `PcbOverlayText` has no thickness, aspect or face. Any of these yields cosmetic `board_text_style_approximated`, with details for the dropped attributes:
  - thickness ≠ the OpenPCB stroke for that size
  - `size.w ≠ size.h`
  - a font face or TrueType text
  - a bold or italic flag
- Vertical justification other than centre: S5 reads the Gerber silk writer's anchor convention and shifts by ±h/2 along the text up-axis. If that cannot be exact, cosmetic `board_text_anchor_approximated`.
- `knockout` text is skipped, cosmetic `board_text_knockout_unsupported`.
- Hidden text is skipped (info).
- `Edge.Cuts` graphics are consumed by §3.10.1.
- `*.Cu` graphics → capability `board_copper_graphic_unsupported` (`permanent`).
- `*.Mask` / `*.Paste` graphics → capability `board_mask_graphic_unsupported` (`permanent`).
- `User.*`, `Dwgs.User`, `Cmts.User`, `Eco*.User`, `Margin` → info `board_graphic_layer_ignored`.

#### 3.10.4 Board-only footprints

These are decomposed through §3.5(c): `board_only_footprint_decomposed` (info, lists refdes).
- Mechanical pads → `PcbFreeHole`.
- Copper pads → `PcbFreePad` with `padType`, shape, drill, plating and slot (where the capability allows), plus `netId` from the binding of the pad's KiCad net.
- Paste-only pads are dropped (info).
- Custom/trapezoid shapes → capability `board_only_pad_shape_unsupported` (`permanent`); that pad is skipped.
- Silk/fab children → overlays (§3.10.3).
- Footprint Edge.Cuts children → outline (§3.10.1).
- A footprint with no representable item → capability `board_only_footprint_dropped` (`permanent`).

### 3.11 Plan digest and dry-run parity

`planDigest = sha256(canonicalJson(summaryForDigest))`, covering:
- frame id, source sha256, `KICAD_IMPORT_FRAME_STAMP`, drill capability flags
- census rows
- component outcomes (status, reason, pad classifications)
- unit groups
- bindings (kind and member pads)
- rules plan
- warning `code + subject.keys`, sorted

There are no random ids or timestamps.

- Commit with `planDigest`: mismatch → 409 `https://openpcb.dev/problems/kicad-import-plan-changed`, reason `plan_changed`, `extras.plan`.
- Commit without it proceeds.

### 3.12 Atomicity, cancellation, idempotency, crash safety

**Mutex.** `activeImportId`; a second commit → 409 `kicad_import_busy`. Inspect is never blocked.

**`importId` (review finding 28).** Client UUID v4, server-generated when absent. The registry and the report store `(importId, sourceSha256)`.
- Committed report with the same id **and** the same `sourceSha256` → 200 replay of the stored result.
- Same id, different sha → 409 `import_id_conflict`.
- In progress → 409 `kicad_import_busy` with `extras.importId`.
- The status route takes only `importId`. It returns at most `{status, phase, result}` for the caller's own import. The id is a 122-bit client secret on a loopback, single-user backend, so binding it to a session is unnecessary. Rev 1's "mirrors 103" claim is removed: 103's lookup binds design and session; this one deliberately does not.

**Abort (review finding 23).** `signal = mergeSignals(routeCtx.req.signal, sdkRequest.signal)`. `throwIfAborted()` runs:
- before plan
- after plan
- after stage
- after resolve
- immediately before the designer transaction

An abort discards the batch and returns 409 `kicad_import_cancelled`; the registry records `not_found`.

**Resolve.** `resolveComponentForPlacement` returning null for a just-staged component means the library changed underneath: 409 `plan_changed` plus discard (review finding 1). Never warn-and-skip.

**Apply.** One synchronous `ctx.db.transaction`. Once it returns, the import is committed regardless of the signal.

**Finalize (review finding 22).**
- `finalizeStagedImport` runs up to 3 times in the request (immediate, +100 ms, +500 ms).
- On success, the ledger row is deleted.
- On final failure: log an error, keep the row, and still return 201. The import *is* committed, and staged rows stay hidden until recovery finalizes them on next boot.

**Outcome ledger.** `designer_import_batch_outcomes(batch_id PK, outcome 'committed', import_id, created_at)` is written **inside** the apply transaction. Recovery uses it instead of the report: `store.deleteDesign` deletes reports but never ledger rows, so deleting the design before the next boot cannot cause a wrong discard.

**Status route.** `GET /imports/kicad-project/:importId` →
- `{status:"in_progress", phase}` from the registry
- `{status:"committed", result}` from the report
- 404 `not_found`

**Failure inside the transaction.** Rollback, discard. A discard failure is logged; recovery discards on boot, since there is no ledger row.

**Crash recovery** (`recover-staging.ts`, from designer `onActivate`, after the library by topological order). For each open batch with owner `designer.kicad_project`:
- ledger row exists → finalize, then delete the ledger row
- no ledger row → discard

Errors are logged, never thrown.

**Staged rows are invisible (review finding 21).** One predicate, `notInOpenImportBatch(components.id)`:

```sql
NOT EXISTS (SELECT 1 FROM library_import_batch_rows r WHERE r.row_kind='component' AND r.row_id=<col>)
```

It applies at every component enumerator:
- `loadFilterableRows`
- `listTags`
- `buildUserLibraryPack`
- the mention provider
- `/status` count
- `findExistingSymbolId` / `findExistingFootprintId` / the component reuse in `commit-kicad.ts`
- `resolveComponentForPlacement`, **except** for the batch's own designer import, which passes `batchId`

Guard test (S1): it scans `src/modules/library/backend/**/*.ts` for `.from(components)` and `FROM library_components`, and fails for any file not on a reviewed allowlist. Each allowlist entry carries a one-line reason. New enumerators therefore cannot leak staged rows.

### 3.13 Migrations (exact SQL)

`src/modules/library/backend/migrations/0012_import_staging.sql`:

```sql
CREATE TABLE library_import_batches (
  batch_id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE library_import_batch_rows (
  batch_id TEXT NOT NULL REFERENCES library_import_batches(batch_id) ON DELETE CASCADE,
  row_kind TEXT NOT NULL CHECK (row_kind IN ('component','symbol','footprint','component_footprint','footprint_model','model_blob')),
  row_id TEXT NOT NULL,
  PRIMARY KEY (batch_id, row_kind, row_id)
);
--> statement-breakpoint
CREATE INDEX library_import_batch_rows_row_idx ON library_import_batch_rows(row_kind, row_id);
```

Row ids:

| `row_kind` | `row_id` |
|---|---|
| `component_footprint` | `componentId\|footprintId` |
| `footprint_model` | `footprintId` |
| `model_blob` | the relative STEP path; recorded only when the file was newly created |

Only inserted rows are recorded.

- **Finalize:** delete the batch (cascades).
- **Discard,** in one library transaction:
  1. delete the recorded `component_footprint` and `component` rows
  2. delete the recorded `symbol`/`footprint` rows iff unreferenced (orphan logic of `deleteComponents`, `queries.ts:1646-1755`; never `PLACEHOLDER_FOOTPRINT_ID`)
  3. delete the recorded `footprint_model` rows
  4. collect the `model_blob` paths
  5. delete the batch
  6. after commit, unlink each blob iff no `footprint_models.source_step_sha256` references it (§3.7)

`src/modules/designer/backend/migrations/0021_kicad_import_reports.sql`:

```sql
CREATE TABLE designer_import_reports (
  report_id TEXT PRIMARY KEY NOT NULL,
  import_id TEXT NOT NULL UNIQUE,
  design_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('kicad_project')),
  source_file_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_version TEXT,
  report_version INTEGER NOT NULL,
  frame TEXT NOT NULL,
  library_batch_id TEXT,
  plan_digest TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  nets_json TEXT NOT NULL,
  net_map_json TEXT NOT NULL,
  blockers_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX designer_import_reports_design_idx ON designer_import_reports(design_id);
--> statement-breakpoint
CREATE TABLE designer_import_report_acks (
  report_id TEXT NOT NULL REFERENCES designer_import_reports(report_id) ON DELETE CASCADE,
  blocker_key TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  design_revision INTEGER NOT NULL,
  PRIMARY KEY (report_id, blocker_key)
);
--> statement-breakpoint
CREATE TABLE designer_import_batch_outcomes (
  batch_id TEXT PRIMARY KEY NOT NULL,
  import_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('committed')),
  created_at TEXT NOT NULL
);
```

**`blockers_json`** is an array of `{ blockerKey, code, class, predicate, subject: {kind, keys}, baseline }`.
- `subject.keys` are **persisted** ids: placementId, zoneId, trace/via ids, durable net ids.
- `baseline` holds the import-time digests that the predicates compare: the footprint snapshot digest per placement, and the outline digest.
- `blockerKey = code + ":" + subject.keys.join(",")`.

Other details:
- `report_version = 2`.
- `store.deleteDesign` deletes the reports; acks cascade. Ledger rows are not deleted.
- The synthetic `commandLog.command_json` gains `importId`, `reportId` and `frame: boardImportFrameStamp(frame)`.

### 3.14 Import-loss blockers (review findings 8, 9)

#### 3.14.1 Classes and policy

- **capability** (non-acknowledgeable): any loss that changes copper, mask, paste, holes, the outline, connectivity or the rules DRC applies. This follows H19 A11 ("missing copper/nets … non-overrideable", OPENPCB-67.md:29). It clears only when its predicate stops holding.
- **cosmetic** (acknowledgeable): silk/fab only, e.g. knockout text, an approximated text anchor or style, unsupported silk constructs. An acknowledgement is revision-stamped. Unacknowledged cosmetic blockers still block export.
- **Delegated:** H14 raises no blocker of its own where another gate already sees the condition; the report still lists it.

| Condition | Owning gate |
|---|---|
| Unbound or ambiguous copper | H08 `NET_ORPHANED_COPPER` / `assertNetIdentityExportable` |
| Unqualified transform | H13 `sourceFrame` |
| Footprintless parts | H19 `unresolvedFootprintBlocker` |
| Unpoured zones | H19 `zoneNotPouredBlocker` |
| Split nets | DRC shorts |

#### 3.14.2 Predicates (`import-loss.ts`)

```ts
export interface ImportLossBlocker { blockerKey: string; code: string; class: KicadImportBlockerClass; message: string;
  subject: { kind: string; keys: string[] } }
/** SYNCHRONOUS — runs inside H19's readExportSnapshot transaction (no await). */
export function evaluateImportLoss(tx: DbClient, designId: string,
  pcb: DesignerPcbProjection, schematic: DesignerSchematicProjection | null): ImportLossBlocker[];
```

`evaluateImportLoss` reads the report row and the acks, then evaluates each stored blocker:

| Predicate | Open while |
|---|---|
| `permanent` | always |
| `subject_deleted` | any subject row still exists |
| `footprint_changed` | any subject placement exists and its footprint snapshot digest equals the import baseline |
| `zone_deleted` | the subject zone row exists |
| `outline_changed` | the board outline digest equals the baseline |
| `netclass_assigned` | any subject durable net lacks an explicit `perNetClassAssignments` entry |
| `copper_reassigned` | any subject copper id still exists with `netId` equal to the recorded net |
| cosmetic | open while unacknowledged |
| `delegated` | never emitted (report display only) |

**Fail closed when the report is missing (review finding 9).** If the design has a `designer_command_log` row with `command_type = 'import_kicad_project'` but no report with `report_version ≥ 2`, the function returns one blocker `import_report_missing`.
- Message: "This design was imported from KiCad before import checks existed, or its import record is missing. Re-import the project."
- This covers pre-H14 imports, so rev 1's "no report ⇒ no blockers" is reversed. Those imports are also caught by H13's `legacy-project-import` finding.
- Cloud-pulled copies are **native** designs: `CloudDesignBrowser.tsx` replays only schematic commands, and no import row or board copper travels. They therefore carry no import loss and no import marker. **Invariant recorded for the cloud-sync owner:** if cloud pull ever rehydrates board copper or overlays, it must also carry `blockers_json`, or mark the copy as import-derived so that this function fails closed.

#### 3.14.3 H19 integration (an ask of H19, §8)

- `ExportSnapshot` gains the slot `importLoss?: readonly ImportLossBlocker[]`.
- H14 populates it inside `readExportSnapshot`'s synchronous transaction by calling `evaluateImportLoss(tx, designId, pcb, schematic)`.
- New source `importLossBlocker`, **appended** after `unqualifiedFootprintBlocker`. Code `EXPORT_IMPORT_LOSS`. Message:
  > `{k} problem(s) from the KiCad import change copper, mask, holes or rules: {first 3 messages}. Fix them in the design or re-import a corrected project.`
- Targets: `placementIds` / `zoneIds` / copper ids from the subjects. `detail.blockerKeys`.

**Interim (H19 S6a not landed):** `assertImportLossFree(store, db, designId)` throws a 422 at the three export call sites (`routes.ts:3427,3443`, `sdk.ts:137`), alongside H13's interim guard. H19 S6a removes it.

#### 3.14.4 Catalog and routes

`report.ts` is the single catalog: `Record<code, { group; severity; blocker?: { class; predicate }; render(details) }>`. A unit test asserts:
- codes are unique
- every blocker has a subject (or a `permanent` / `board` subject)
- no capability code uses ack
- no message contains a raw code

Routes:
- `GET /designs/:designId/import-report` → the report, with each blocker's `open` evaluated live.
- `POST /designs/:designId/import-report/acks` with body `{ blockerKey, expectedRevision }`:
  - 404 for an unknown key
  - 422 `blocker_not_acknowledgeable` for capability
  - 409 on a revision mismatch
  - otherwise the report

An acknowledgement is never a DRC override.

### 3.15 Wizard and UI (T-247/T-250/T-252)

Files live under `src/modules/designer/frontend/components/kicad-import/`, each < 300 lines.

| File | Slice | Contents |
|---|---|---|
| `KicadProjectImportWizard.tsx` | P0 | Shell plus state machine; the old path re-exports it |
| `PickStage.tsx` | P0 | |
| `ReviewStage.tsx` | P0 | Plan table added in S12 |
| `ProgressStage.tsx` | P0 | |
| `DoneStage.tsx` | P0 | |
| `ImportWarningsList.tsx` | P0 | Grouped and human; codes inside `<details>` |
| `warning-copy.ts` | P0 | Human copy for **today's** codes; S0 replaces it with `report.ts` messages |
| `ImportReportDialog.tsx` | S12 | Persisted report, live blocker state, cosmetic acknowledgement, KiCad↔OpenPCB net map |
| `ImportReportBanner.tsx` | S12 | Shown when open blockers exist. Dismissal per viewer in try/catch `localStorage`; capability blockers always reappear |

**Shell (P0).** Kit `Dialog` / `DialogContent size="lg"`. `onOpenAutoFocus` → "Choose ZIP…". Kit `Button`, `Field` + `Input`, `Banner`, `Badge`/`StatusPill`. No slate/violet/amber/emerald classes. Remove the wizard from `ui-discipline.baseline.json`.

**States.**
- P0: `pick → inspecting → review → committing → (done | failed)`.
- S12 adds `cancelling → cancelled | completedDespiteCancel` and `plan_changed → review`.
- Quarantine branch is unchanged.

**Commit (S12).**
1. `importId = crypto.randomUUID()`, `controller = new AbortController()`.
2. `api.commitKicadProject(file, name, { planDigest, importId, signal })`.
3. Cancel:
   - Esc, × or the button, routed to `requestCancel` while committing, `preventDefault` on dismiss → `abort()` → `cancelling` → poll status every 500 ms for up to 10 s.
   - `not_found` → "Import cancelled. Nothing was added to your designs or library."
   - `committed` → "The import finished before it could be cancelled." Actions: Open design / Delete design. Library parts stay, as the copy says.
   - Unknown → failed: "Status unknown; check your designs list."
4. 409 `plan_changed` → back to review with the new plan.

**Done (P0).**
- Stays open.
- Shows counts, grouped warnings, and capability/cosmetic blocker counts with the copy "This design can't be sent to manufacturing until these are fixed."
- Primary **Open design** → `onOpenDesign(designId)`. Secondary **Close**.
- `Space.tsx`: `onImported` only refreshes; the new `onOpenDesign` opens the tab, navigates and closes.

**Copy (T-250, P0).**
- Pick footnote: "Imports every schematic sheet, PCB placements, tracks, vias, zones, keepouts, board graphics, net classes and design rules. Parts are added to your library."
- Status labels: `reuse` "In library", `create` "New — added to library", `reject` "Can't import — {reason}".

**API.**
- `commitKicadProject(file, name?, opts?)`
- `getKicadImportStatus`
- `getDesignImportReport`
- `acknowledgeImportBlocker`
- `ApiProblemError { status, type, reason, extras }` when `fetchData` throws a plain `Error` (check `api.ts:86`)

### 3.16 Fixtures and oracle (S13; review findings 17, 32)

**One fixture tree, one set of parsers** (agreed with H13 OPENPCB-61.md:1114; asked of H19, §8):

| Item | Location and owner |
|---|---|
| Projects | `src/core/backend/tests/fixtures/kicad/<case>/`. H14 owns every case except `sides`, which is H13's |
| References | `<case>/kicad-ref/`, from H19's single kicad-cli driver `scripts/kicad-reference/generate.ts`. H14 extends it with `--netlist` (`sch export netlist --format kicadsexpr`), `--pos`, `--drc` (`pcb drc --format json --schematic-parity`). H19 owns the driver |
| Parsers | H19's `tests/helpers/gerber-parse.ts` (with `%TO` support) and `excellon-parse.ts`. H14 drops its planned `gerber-x2-pads.ts` and `scripts/kicad-fixtures/oracle.ts`. Whichever of H13/H14/H19 lands first creates them, to H19's spec |
| Parity test | One `kicad-reference-parity.test.ts` (H19's), reading `fixtures/kicad/`. H14 adds the import-side assertions in `kicad-project-reference-parity.test.ts` |

**Synthetic fixtures.** The generator `scripts/kicad-fixtures/generate.ts` (Bun) writes deterministic KiCad 8 text.

| Fixture | Contents |
|---|---|
| `hier-dup` | Root plus two instances of one sub-sheet; local `SIG` in each; hierarchical label ↔ sheet pin; global `VCC`; local `EN` and global `en` (case collision) |
| `auto-nets` | `Net-(D1-K)` chains; `unconnected-(U1-NC-Pad3)` |
| `usbc-npth` | 2 unnumbered NPTH pegs, numbered pads, `S1` with `(drill oval …)`, paste-only sub-pads |
| `multi-unit` | LM358, units across two sheets (§3.6.4) |
| `sym-transform` | 12 rotation × mirror combinations (§3.6.2 rule 9) |
| `hidden-power` | A symbol with hidden `power_in` pins |
| `layers-4l` | In1/In2 tracks, GND zone on In2, Default 0.6/0.3, `"rules": {}` |
| `layers-6l` | |
| `graphics` | gr_text (knockout, justify top/bottom, mirrored B.SilkS, thick/stretched), silk/fab shapes, rotated gr_rect, one F.Cu gr_poly |
| `outline` | Outer contour with arcs, an internal cutout, a footprint Edge.Cuts slot, one open chain |
| `rules-explicit` | Full rules block, 3 classes, wildcard patterns, a `netclass_flag`, setup paste/mask/tenting values |
| `pad-overrides` | `solder_mask_margin`, `zone_connect`, `clearance` on pads |
| `sides` | H13's |
| `board-only` | MountingHole NPTH, plated hole on GND, fiducial, J1-style pegs as board-only |
| `malformed/*` | Truncated pcb, sheet cycle, missing Sheetfile, bad pad block, KiCad 5 board, an over-cap instance tree |

**Independence and closure (review finding 17).**
- `expected.json` comes from the generator's model. It is a **regression** oracle only and is not accepted as correctness evidence for scoping, mirroring, hierarchy or refdes.
- **Correctness oracles:**
  1. **USBtoUART:** pad net tokens and `grbr.zip`, both written by KiCad.
  2. **`kicad-ref/`**, generated by KiCad from the synthetic fixtures.
- **H14 is not closed** until this passes with `kicad-ref/` present for **hier-dup, sym-transform, multi-unit, hidden-power, auto-nets, usbc-npth, outline, rules-explicit and sides**:
  ```
  OPENPCB_REQUIRE_KICAD_REF=1 bun test src/core/backend/tests/kicad-project-reference-parity.test.ts
  ```
  The parity checks:
  - netlist pin→net partition equals the OpenPCB schematic partition after reopen
  - netlist `(class …)` per net equals OpenPCB's class, when present
  - pad flash **centres and aperture size and rotation** (H19's parser) equal OpenPCB's export
  - drill hits by plating, with slots as G85
  - `.pos` placement positions and rotations
- Without the variable, a missing `kicad-ref` logs `SKIP` and passes (local convenience only).
- **Staleness:** `kicad-ref/VERSION` records the kicad-cli version **and** the sha256 of every source file of the case. The parity test recomputes the source shas and **fails** on any mismatch ("fixture changed; regenerate kicad-ref"). `generate.ts --check` also fails when the committed fixture text differs from the generator output.

**USBtoUART exact-count assertions:**
- 19 footprints matched (incl. J1)
- 183 segments, 44 vias
- 36 KiCad nets
- `pcb.zone` 1 unit / 2 rows
- 7 gr_text: 6 imported, 1 knockout with a cosmetic blocker
- paste-only pads produce 0 copper records
- the capability blockers for the 6 mask-margin pads and the `zone_connect` pad are present (Q2)
- pad angles: every instance of one lib_id has one `contentKey`

Its `grbr.zip` (flash centres, aperture size and rotation, NPTH/PTH hits) is the geometry oracle in the canonical frame.

---

## 4. Task breakdown (commit-sized slices)

Tiers: standard / careful / critical.

| Slice | Title | Files | Est. lines | Tier | Depends on | Tests |
|---|---|---|---|---|---|---|
| **P0** | Wizard and visibility fixes on the current pipeline (T-247/T-250/T-252) | `frontend/components/kicad-import/{KicadProjectImportWizard,PickStage,ReviewStage,ProgressStage,DoneStage,ImportWarningsList}.tsx`, `warning-copy.ts`; old wizard path re-export; `Space.tsx` (`onOpenDesign`); `ui-discipline.baseline.json`; `library/backend/import/commit-kicad.ts` (`allowUnnumberedPads` **only when** `HAS_PLATING && HAS_SLOTS`; else keep the reject with the human reason "has non-plated or slotted holes this version can't represent yet") | 650 | careful | — | Vitest: focus on Choose ZIP; label bound; Done stays open; `onImported` doesn't navigate; Open design calls `onOpenDesign`; warnings human with codes hidden; J1 rejection shown with human reason; no slate/violet classes. Bun: `kicad-project-import.test.ts` J1 path under both capability states (stubbed probe) |
| **S0** | Warning catalog plus additive SDK types | `src/sdks/designer/{types,index}.ts`; `report.ts`; generated stubs | 350 | careful | — | `kicad-import-report-catalog.test.ts`: codes unique; blocker class and predicate valid; capability never ack; no raw code; P0 copy codes mapped |
| **S1** | Library staging SDK | `0012_import_staging.sql`; `project-staging.ts` (≤450); `staging-visibility.ts`; `src/sdks/library/{types,index}.ts`; `queries.ts`, `cloud-pack-builder.ts`, `mention-provider.ts`, `routes.ts` (`/status`), `commit-kicad.ts` (visibility, `intakeDigest` over normalized+preview, pinmap-null reuse, frame passthrough); `unqualified-import.ts` | 650 | **critical** | H13 OP3b first (shared files) | `library-import-staging.test.ts`: plan has no writes; stage+finalize; stage+discard removes only created rows **and new blobs**; a shared symbol survives discard; staged rows invisible to search, facets, **tags, pack builder, mentions, /status** and reuse; enumerator guard test; reused-footprint model row untouched; unnumbered NPTH accepted with `mechanical`, paste-only → `paste_only`; capability flags → `degraded`; pin-without-pad rejected; `intakeDigest` mismatch or preview rebuild → create; non-null pinmap → create; quarantine → `intake_unqualified` |
| **S2** | Parser extensions plus census | `kicad-pcb-parser.ts` (+ `kicad-pcb-graphics.ts`, `kicad-pcb-footprint.ts`, `kicad-pcb-outline.ts`); `kicad-schematic-parser.ts` (`lib_name`, instances, mirror, on_board/dnp, `Sheetfile` path, `netclass_flag`); `plan/census.ts` | 650 | careful | — | Parser tests: graphics, text style fields, footprint path/attr, net-name-only token, no-net segment kept, copper-by-name count, all Edge.Cuts loops with arcs + footprint Edge.Cuts, setup/plot mask/paste/tenting, `lib_name`, instances/mirror. Census: source units; F&B zone 1 unit; instance-weighted symbols; unreferenced sheet; unknown token; pad-child tokens; trigger rule (Cu/Mask/Paste/Edge or modifier → capability; silk → cosmetic) |
| **S3** | Sheet instances, scoping, transforms | `plan/sheet-instances.ts`, `plan/schematic-plan.ts` (**`flatten-sheets.ts` NOT deleted here**) | 600 | **critical** | S2; H13 OP9 `schSymbolTransform` (stub allowed) | `kicad-sheet-instances.test.ts`: archive-relative paths, root rule, code-unit order; two instances → two copies with KiCad refdes; caps → 422; offsets on 1.27 mm grid; duplicate locals separate; hierarchical pin pair joins; case-insensitive collision test; `EN`/`en` and `GND`/`gnd` suffixed, not merged; only exact `GND` → gnd primitive; hidden power pins → pwr primitives; 12-combination transform table snapshot (KiCad-ref partition when present); cycle → 422 |
| **S3b** | Unit groups (multi-unit) | `plan/unit-groups.ts`; `src/sdks/designer/types.ts` (`DesignerPart.unitGroup?`); `pcb/pcb-store.ts` (one placement per group, re-key on owner delete); `pcb/net-pad-correlation.ts` (owner mapping) | 350 | **critical** | S3 | `designer-unit-groups.test.ts`: one placement per group; all units' pins correlate; owner delete re-keys and keeps position and copper; native parts unchanged (regression); unit-0 pins only on owner; undo/redo of owner delete restores placement |
| **S4** | Rules, setup, fab, layers | `plan/rules.ts`, `plan/netclass-patterns.ts`, `plan/kicad-defaults.ts` | 450 | careful | S0 | `kicad-project-rules.test.ts`: replace not merge; Default first; Default synthesised when absent; GND not heuristically classed; wildcard `*`/`?` resolution against the net table with first-match order; directive label assignment; unresolved → capability blocker; merge-loser class dropped with warning; defaults with a warning each; relax rule; mask/paste from setup (0, not 0.075/−0.05); paste ratio / mask min width → capability; viasonmask → tented; 4L → `jlcpcb_4l` + In1/In2 visible; 6L → custom; defaults snapshot |
| **S5** | Board graphics | `plan/board-graphics.ts` | 320 | careful | S2, S6 | Silk/fab mapping; rotated rect → polygon; text style → cosmetic; knockout/anchor → cosmetic; copper/mask → capability; user layers info; unit/row reconciliation |
| **S6** | Frame port, board items, outline, composition | `frame-port.ts` (H13 re-export + `libraryForm`/`derotateChildAngles` + capability probe), `plan/board-items.ts`, `plan/board-outline.ts` | 600 | **critical** | S2; H13 OP9 (stub allowed) | Legacy frame byte-equal to today's coordinates except fractional rotation; out-of-stack dropped + capability; no-net copper kept; outline: arcs kept, cutouts mapped, footprint Edge.Cuts slot → cutout, open chain → capability + fallback; board-only composition via `padWorldPositionMm`/`padCopperShape` (mirrored back footprint conjugates); canonical stub applied to every item kind; **canonical frame only:** J1 pegs vs `NPTH.drl`, 0201 aperture orientation vs `grbr.zip` |
| **S7** | Component plan | `plan/component-plan.ts` | 400 | **critical** | S1, S2, S3, S3b, S6 | Grouping key (R vs R_Small on one footprint → 2 groups; two sheet versions → 2 groups); **USBtoUART: one `contentKey` per lib_id across all rotations, both frames**; J1 accepted + `pad_geometry_degraded` (pinned) / none (stub capability on); paste-only pads produce no copper and no drill; two unnumbered pegs → two drill hits with distinct `padItemKey`; hidden-pin snapshot verification; reject reasons; `intake_unqualified` → 422 |
| **S8** | Net binding | `plan/net-binding.ts` | 450 | **critical** | S3, S3b, S7 | Pads; split order (pins, then pads, then key); merge survivor by pads + dropped classes; merge short via the connectivity kernel → capability; root `/X` alias; scoped alias; global; `Net-(…)` never aliases; ambiguous/unbound → H08 unresolved-name representation; net 0; determinism (shuffled input) |
| **S9** | Plan assembly, inspect, digest | `plan/build-plan.ts`, `plan/types.ts`; `inspect.ts` (attach plan summary). **`commit.ts` untouched** | 380 | **critical** | S3–S8 | USBtoUART plan counts (§3.16); census invariant holds (units); `strictCensus` mismatch throws in tests, becomes a capability blocker in production mode; digest stable and changed by library state and by the capability flags |
| **S10** | Atomic pipeline and apply | `pipeline.ts`, `import-registry.ts`, `recover-staging.ts`, `insert-report.ts`, `net-identity-port.ts`; `insert-schematic.ts`, `insert-pcb*.ts`; **delete** `flatten-sheets.ts`, `ingest-library.ts`, `ingest-models.ts`; **thin** `commit.ts`; `0021_kicad_import_reports.sql`; `schema.ts`; `store.ts` (deleteDesign); `backend/index.ts`; `routes.ts`; `sdk.ts` | 1000 (≤450/file) | **critical** | S0, S1, S9, **H08 S3 + S5 + S8** | `kicad-project-import-atomic.test.ts`: fault per phase → zero designer rows and zero batch rows; abort per boundary → 409 + not_found; abort after tx → committed; replay same id+sha; same id, other sha → 409 `import_id_conflict`; concurrent → busy; digest mismatch → 409; null placement detail → 409 `plan_changed` + discard; finalize failure ×3 → 201 + ledger row; reboot → finalize via ledger **even after deleteDesign**; no ledger → discard; repeat import → library counts unchanged; net invariant (stub port) → 500 + rollback; ambiguous-alias trace stays `netId:null, netName` after reopen + quarantine row; `command_json.frame` written |
| **S11** | Import-loss evaluation and H19 hook | `import-loss.ts`; `routes.ts` (GET report, POST ack); `sdk.ts`; interim `assertImportLossFree` at the 3 export sites (if H19 S6a absent) or the H19 slot wiring | 350 | **critical** | S10; H19 S6a (else interim) | `kicad-import-loss.test.ts`: each predicate opens and closes on the right design change (delete placement, refresh footprint, delete zone, redraw outline, assign class, reassign copper); `permanent` never closes; capability ack → 422; cosmetic ack → closed; missing report on an `import_kicad_project` design → `import_report_missing`; native design → none; synchronous (no Promise returned); persistence across reboot |
| **S12** | Wizard plan, cancel, report UI | `ReviewStage` plan table, cancel machine, `ImportReportDialog.tsx`, `ImportReportBanner.tsx`; `api.ts`; `capability-quarantine.fixture.tsx` | 700 (≤300/file) | careful | P0; S10/S11 routes (mocked) | cancel → not_found → cancelled; committed → "finished before it could be cancelled"; plan_changed → review; report dialog shows live `open`; capability has no ack control; cosmetic ack; banner reappears for capability |
| **S13** | Fixtures, references, parity | `scripts/kicad-fixtures/generate.ts`, fixture tree, `kicad-ref/VERSION` (version + source shas), extensions to H19's `scripts/kicad-reference/generate.ts`, `kicad-project-reference-parity.test.ts`, `kicad-project-import-real.test.ts` | 900 + fixtures | **critical** | Generator: none. Parity: S10, S11, H19 S7/S7b parsers (or create them to H19's spec) | Parity after **reopen** per §3.16; staleness check; apertures and orientation compared; closure gate `OPENPCB_REQUIRE_KICAD_REF=1` |
| **S14** | E2E and docs | `tests/e2e/kicad-project-import.spec.ts`; `src/modules/designer/AGENTS.md`; `docs/pcb-hardening/05` §12.3; `CAPABILITY-QUARANTINE.md` | 300 | standard | S12, S13 | Playwright (§7) |

**Parallelism (no file overlap):**
- **P0 ∥ S0 ∥ S2 ∥ S13-generator** first. S1 waits for H13 OP3b (shared files).
- After S0: S4. After S2: **S3 ∥ S6**. Then **S3b**, then **S5 ∥ S7**, then S8, then S9.
- S10 waits on S9, S1 and H08 S3/S5/S8.
- Then S11 → S12 → S14. S13 parity runs after S11.
- H13 owns `kicad-frame.ts` / `board-footprint-unplace.ts` only. H14 slices import them; S3/S6 may land on the stub first.

**Re-pin dependencies:**
- All H14 code typechecks against `kicad-import@0.1.2`, `kicad-parsers@0.1.3` and `rendering-core@0.1.3`: capabilities and the frame stamp are feature-detected.
- **J1 drill fidelity, slot/NPTH parity and the canonical-frame geometry tests require H13's SH2 publish + OP7 re-pin** (kicad-import 0.2.0, rendering-core 0.1.4; user-gated in H13). Until then, `pad_geometry_degraded` and `transform_unqualified` keep the design blocked, which is correct and fail-closed.
- 0.2.0 is breaking (`58d3620` paste-only sub-pads, `1a15c1e` all units). Count assertions use "numbered copper pads", and the `paste_only` classification is already in place.

---

## 5. Edge cases and failure modes

**Source files**
1. Several `.kicad_pro` in one ZIP → the first by code-unit path order, plus `multiple_projects_in_archive`.
2. Autosave, backups and `__MACOSX` are filtered (today's behaviour).
3. Two sheet files with the same basename in different directories are distinct (archive-relative keys).
4. Over-cap projects → 422 `project_too_large` before expansion. This is a recorded desktop limit.

**Nets**
5. The `(net "X")` name-only token is tolerated. Mixed forms key by ordinal when present.
6. Escaped names (`{slash}`, `~{RST}`) are kept verbatim in `netMap` and labels.
7. Same pad number with different board nets inside one footprint → `pad_number_net_conflict` (capability, `footprint_changed`). The majority net binds.
8. A footprint path to an `on_board no` or `#FLG` symbol → board-only.
9. Multi-unit components: §3.6.4. One placement per group. A refdes with conflicting symbols → capability.
10. `EN`/`en` labels and `GND`/`gnd` power names stay distinct nets through suffixing (§3.6.2 rule 6).
11. `unconnected-(…)` single-pad nets bind normally.
12. A copper item referencing an unknown ordinal → `net_ordinal_unknown`. Netless, counted, never dropped.
13. Hidden `power_in` pins → explicit `pwr` primitives (§3.6.2 rule 11).

**Geometry and pads**
14. Zero-radius arc → one chord. Degenerate arcs are counted as dropped with a warning.
15. `*.Cu` zones on 6L expand per layer. Layers outside the stack → §3.9 out-of-stack rule.
16. Legacy-frame back-side parts keep known-wrong mirroring under `transform_unqualified`, but pad angles are de-rotated (§3.5 b).
17. Unnumbered pads share address `placement|""` with distinct `occurrence` (`src/shared/pcb-connectivity/copper-items.ts:33-43`); S7 tests it.
18. Paste-only sub-pads produce no copper and no drill.
19. Fractional rotation is kept (`norm360`).

**Library**
20. A library change between inspect and commit, or between stage and resolve → 409 `plan_changed`.
21. Library SDK missing → 503 `library_unavailable`.
22. A pre-H14 or edited library row is never reused (`intakeDigest`, pinmap rule).

**Atomicity, cancellation and failures**
23. Stage SQLite error → the library transaction rolls back → 500 `import_stage_failed`; nothing to discard.
24. Discard failure → logged; recovered on boot (no ledger row).
25. Finalize failure → 201; the ledger row persists; recovery finalizes, even if the design is deleted first.
26. Disconnect during the synchronous transaction → committed; the wizard says "finished before it could be cancelled".
27. A large board blocks the event loop inside the transaction. Bounded by the §3.6 caps; recorded limit.
28. Dataset-capture hook failure stays fail-isolated, outside the transaction.
29. Re-import into an existing design is unsupported; every import creates a new design.
30. A blob unlink failure after discard leaves a harmless leaked file (logged).

**Downstream**
31. User edits after import: capability predicates follow the design live. A net rename leaves `netMap` as history only.
32. Cloud pull creates a native schematic-only design; no import loss or marker travels (§3.14.2 invariant). Cloud push mirrors only native commands.
33. MCP/assistant callers without `planDigest` keep working.
34. USBtoUART is **not exportable** after import, because of the per-pad mask margins and `zone_connect` (Q2) and, until the re-pin, the J1 drill degradation and `transform_unqualified`. This is fail-closed by design.

---

## 6. Migration, rollback and data safety

**Forward-only additive migrations** (library `0012`, designer `0021_kicad_import_reports`). No data rewrite.
- Pre-H14 imported designs have no report. `evaluateImportLoss` returns `import_report_missing` for them (fail closed; also caught by H13's legacy finding). Remedy: re-import. Their name-bound copper is H08's migration and quarantine concern.

**Destructive behaviour removed:**
- `ingest-models.ts` row deletion
- tag-based reuse across unrelated footprints

**Discard deletes only batch-inserted rows and newly created blobs, with reference checks.** `PLACEHOLDER_FOOTPRINT_ID` is excluded. Built-in rows can never enter a batch (the stager writes `sourceId: "user.local"` only).

**Rollback by git revert** leaves 2 + 4 unused tables. Open batches from a crash coinciding with a revert become ordinary visible components. Acceptable.

**Release builds:** `designer.outputQuarantine` stays on. Nothing in H14 flips a flag.

**Backups:** H14 rewrites no existing rows. The S3b placement re-key only acts on designs that carry `unitGroup`, i.e. new imports.

---

## 7. Verification commands

Run from `/Users/andrejvysny/workspace/openpcb/OpenPCB`.

```sh
# Bun (backend/domain)
bun test src/core/backend/tests/kicad-import-report-catalog.test.ts \
         src/core/backend/tests/library-import-staging.test.ts \
         src/core/backend/tests/kicad-sheet-instances.test.ts \
         src/core/backend/tests/designer-unit-groups.test.ts \
         src/core/backend/tests/kicad-project-rules.test.ts \
         src/core/backend/tests/kicad-board-graphics.test.ts \
         src/core/backend/tests/kicad-board-items.test.ts \
         src/core/backend/tests/kicad-component-plan.test.ts \
         src/core/backend/tests/kicad-net-binding.test.ts \
         src/core/backend/tests/kicad-import-plan.test.ts \
         src/core/backend/tests/kicad-project-import-atomic.test.ts \
         src/core/backend/tests/kicad-import-loss.test.ts \
         src/core/backend/tests/kicad-project-reference-parity.test.ts
bun test src/core/backend/tests/kicad-project-import.test.ts src/core/backend/tests/kicad-project-import-real.test.ts \
         src/core/backend/tests/designer-kicad-project-errors.test.ts src/core/backend/tests/kicad-zone-keepout-import.test.ts \
         src/core/backend/tests/kicad-pcb-via-types.test.ts src/core/backend/tests/kicad-project-ingest-refdes.test.ts \
         src/core/backend/tests/designer-capability-quarantine.test.ts \
         src/core/backend/tests/library-import-quarantine.test.ts
bun test src/modules/library/backend/infrastructure/parsers/kicad/
npm run test:backend                      # full Bun suite; no regressions (gerber parity, DRC goldens, H08 suites)

# Frontend (Vitest)
npm run test:react -- KicadProjectImportWizard ImportReportDialog capability-quarantine

# Types and codegen
npm run typecheck
npm run gen && npm run gen:check
npm run gen:contracts -- --check

# Release-build behaviour (quarantine still blocks commit)
OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE=1 bun test src/core/backend/tests/designer-capability-quarantine.test.ts

# Fixtures and KiCad references (closure gate needs kicad-cli, see Q3)
bun scripts/kicad-fixtures/generate.ts --check
bun scripts/kicad-reference/generate.ts --all --netlist --pos --drc      # H19's driver, H14 flags
OPENPCB_REQUIRE_KICAD_REF=1 bun test src/core/backend/tests/kicad-project-reference-parity.test.ts

# E2E
npm run test:e2e -- tests/e2e/kicad-project-import.spec.ts
```

**E2E specs** (`tests/e2e/kicad-project-import.spec.ts`):
1. Happy path: Done stage → Open design → PCB has J1.
2. 4L inner layers visible.
3. Report and banner persist across reload. A capability blocker shows no ack button.
4. Cancel with a held response → "cancelled", and no new design.
5. Invalid ZIP → 422 human message; focus stays in the dialog.
6. Keyboard-only: Tab trap, Esc closes in pick/review, Esc while committing → cancel.

---

## 8. Cross-item interfaces

| Item | H14 consumes | H14 provides / asks |
|---|---|---|
| **H08** (OPENPCB-56) | `initializeNetIdentity(tx, designId, "kicad-import", ts)` (H08-a ✔); durable ids on copper and settings (H08-c ✔); unresolved-name semantics, export gate and DRC `NET_ORPHANED_COPPER` (`:503`, `:686-712`); quarantine table (H08-d: insert callable in a tx); **S8 removal of `bindNetName` before H14 S10** | Per-sheet label scoping and case-collision handling (H08's A9 import half); never first-match by name; split keeper by most pins and merge survivor by pads (H08 rule); unbound copper written as unresolved-name, never silently netless. (H08-b) not needed: KiCad names live in `netMap` |
| **H13** (OPENPCB-61) | `kicad-frame.ts` (full interface incl. `schSymbolTransform`, `placementMirrored`, `arcSegmentCw`, `boardImportFrameStamp`); `board-footprint-unplace.ts` (canonical angle de-rotation); `preview.frame` stamp; OP3b intake (land before H14 S1); SH2/OP7 re-pin | Every call site via `frame-port.ts`; legacy-frame angle de-rotation; `designer_import_reports.frame` + `command_json.frame` (read by `computeDesignFrameStatus`); `sides` fixture in the shared tree; S3 12-combination transform oracle |
| **H19** (OPENPCB-67) | `readExportSnapshot` synchronous tx; parsers `gerber-parse.ts` (%TO) + `excellon-parse.ts`; the kicad-cli driver | **Asks:** (1) slot `importLoss?: readonly ImportLossBlocker[]` populated by `evaluateImportLoss` inside `readExportSnapshot`; source `importLossBlocker` appended, code `EXPORT_IMPORT_LOSS`; (2) read KiCad references from `fixtures/kicad/<case>/kicad-ref/` instead of `fixtures/manufacturing/kicad/`; (3) accept H14's driver flags `--netlist --pos --drc`. Interim guard until S6a |
| **H15** | — | Content-hash reuse never reuses generated-preset footprints |
| **H50** | — | Thickness and stack-up untouched |
| **H23** | — | `dnp_not_imported`; one BOM line per unit group |
| **OPENPCB-103** | — | The import is not a journaled command. Its status route is keyed by `importId` + `sourceSha256` and is **not** modelled on 103's lookup. The synthetic `commandLog` session `import-kicad-project` is read-only history for 103 |
| **Cloud sync owner** | — | Invariant (§3.14.2): if cloud pull ever rehydrates board copper or overlays, it must carry `blockers_json` or mark the copy import-derived |
| **H46** | — | No shared migration infrastructure needed |

---

## 9. Open questions (only these need the user)

**Q1. May `data/KiCad_Example_Project_USBtoUART.zip` (tracked, no license in its Readme) remain a committed fixture? May derived variants be committed?**
- *Default implemented:* keep it; commit no derived variants. New coverage is synthetic.
- If "no": S13 replaces it with a synthetic equivalent and loses the KiCad-written `grbr.zip` oracle until `kicad-ref` exists.

**Q2. Per-pad manufacturing overrides.** USBtoUART has 6 pads with `solder_mask_margin 0.102` and one pad with `zone_connect 2`. OpenPCB's footprint model has no per-pad mask, paste or zone-connection fields (`rendering-core` `FootprintRenderSourcePad`).
- *Default implemented:* a capability blocker per placement (`footprint_manufacturing_token_unsupported`). The imported reference board is then not exportable until per-pad overrides exist. A follow-up Plane item "per-pad mask/paste/zone-connect overrides in shared + DRC + Gerber" is proposed.
- *Alternative A:* implement the overrides inside H14 (shared release plus DRC and export work, roughly +1 500 lines across shared and OpenPCB).
- *Alternative B:* classify them as cosmetic and acknowledgeable. Not recommended: it contradicts H19 A11 and changes mask and pour copper.

**Q3. KiCad reference generation.** H14 cannot close until `OPENPCB_REQUIRE_KICAD_REF=1` passes (§3.16), and kicad-cli is not installed here.
- Will you install KiCad **8.0.x** (matching the fixture's `version 20240108`) at `/Applications/KiCad/KiCad.app`, or point `OPENPCB_KICAD_CLI` at one?
- Which exact version should be pinned in `kicad-ref/VERSION`?
- *Default:* KiCad 8.0.x, latest patch.

Decided here without asking (rationale in the sections):

| Decision | Where |
|---|---|
| Capability losses non-acknowledgeable, live predicates; only silk/fab acknowledgeable (H19 A11) | §3.14 |
| Missing report on an imported design fails closed | §3.14.2 |
| Split/merge-without-short are warnings (DRC-visible); merge with physical short is a blocker | §3.8 |
| Multi-unit = one placement per unit group, with a minimal designer model addition | §3.6.4 |
| Case-only name collisions suffixed, not merged; only exact `GND` → gnd primitive | §3.6.2 |
| KiCad mask/paste defaults (0) replace OpenPCB's 0.075/−0.05 on import | §3.9 |
| J1 imported with a degraded-geometry blocker before the re-pin (never dropped) | §3.7 |
| Size caps 2 048 instances / 20 000 symbols / 200 000 board items | §3.6 |
| Outcome ledger for finalize recovery | §3.12 |
| Staged ingestion with compensating discard | §3.12, user decision |
| KiCad defaults + consistency pass; annular-width default flagged | §3.9 |
| `kicad-*` class ids; exact rotation; board-only decomposition; concurrent imports refused | §3.9, §3.10, §3.12 |
| Parser relocation to `src/shared` deferred | §3.2 |

---

## 10. Review disposition and rejected findings

| # | Sev | Disposition | Where |
|---|---|---|---|
| 1 | blocker | Accepted: unit-based census, instance-weighted, unreferenced sheets as info, mismatch = capability blocker (throws only with `strictCensus` in tests), null detail = 409 `plan_changed` | §3.6.1, §3.12 |
| 2 | blocker | Accepted (verified: D5 θ −90 / pads 270; parser and preview copy verbatim): legacy de-rotation in `libraryForm`, canonical via H13 unplace; contentKey test; aperture size/rotation in the oracle | §3.5 b, §3.16 |
| 3 | major | Accepted: key (lib_name ?? lib_id, symbol CK, footprint lib_id, footprint CK); `lib_name` parsed | §3.7, S2 |
| 4 | major | Accepted: unit groups, one placement, owner mapping in correlation, re-key on owner delete, multi-unit fixture | §3.6.4, S3b |
| 5 | major | Accepted, with a different fix (see below) | §3.4 |
| 6 | major | Accepted: case-insensitive collision test, case-only suffixing, exact `GND` only | §3.6.2 |
| 7 | major | Accepted: split order pins → pads → key; merge survivor by pads, losers' classes dropped + warning | §3.8 |
| 8 | major | Accepted: capability non-ack with live predicates; ack for cosmetic only; H19 `importLoss` slot + `EXPORT_IMPORT_LOSS` inside `readExportSnapshot`; Q1 removed | §3.14 |
| 9 | major | Partly rejected (see below); fail-closed rule for missing reports added | §3.14.2 |
| 10 | major | Rejected (see below); `command_json.frame` write made explicit | §3.5 |
| 11 | major | Accepted: feature-detected capability, `pad_geometry_degraded` blocker, J1 acceptance tied to the re-pin | §3.7 |
| 12 | major | Accepted: setup mask/paste/tenting mapped; generic Cu/Mask/Paste/Edge/modifier trigger rule | §3.6.1, §3.9 |
| 13 | major | Accepted: all loops, cutouts, arcs, footprint Edge.Cuts, `board_outline_approximated` | §3.10.1 |
| 14 | major | Accepted, implemented by reusing `padWorldPositionMm`/`padCopperShape` rather than a new port function; J1 pegs vs `NPTH.drl`; rotated rect → polygon | §3.5 c |
| 15 | major | Accepted: deletions and the commit.ts thinning moved to S10 | §3.2, §4 |
| 16 | major | Accepted: slice P0 on the current pipeline | §4 |
| 17 | major | Accepted: closure gate, `VERSION` with source shas, aperture comparison, expected.json downgraded to regression | §3.16 |
| 18 | major | Accepted: H13 `schSymbolTransform` + H14 12-combination oracle (rotation × {none, x, y}; 12, not 8) | §3.6.2 rule 9 |
| 19 | major | Accepted: wildcard resolution, directive labels, unresolved → capability `netclass_assigned` | §3.9 |
| 20 | minor | Accepted with a verification step in S7 | §3.6.2 rule 11 |
| 21 | minor | Accepted: one predicate at every enumerator, plus a guard test (verified: `listTags`, pack builder, mentions, `/status` read directly) | §3.12 |
| 22 | minor | Accepted with an outcome ledger instead of a `component_id` scan (survives `deleteDesign`, no cross-module scan) | §3.12 |
| 23 | minor | Accepted (verified `backend-module.ts:83-90`) | §3.12 |
| 24 | minor | Accepted: capability constant | §3.5 a |
| 25 | minor | Accepted | §3.6.2 rule 1 |
| 26 | minor | Accepted: caps → 422 | §3.6 |
| 27 | minor | Accepted (verified: no model GC): `model_blob` rows + post-commit unlink | §3.7, §3.13 |
| 28 | minor | Accepted: sha-bound replay, `import_id_conflict`, "mirrors 103" removed | §3.12, §8 |
| 29 | minor | Accepted: cosmetic `board_text_style_approximated` | §3.10.3 |
| 30 | minor | Accepted | §3.9 |
| 31 | minor | Accepted: `paste_only` class + test | §3.7 |
| 32 | minor | Accepted: one tree, H19 driver and parsers, ownership stated | §3.16, §8 |
| 33 | minor | Accepted: digest over normalized+preview; pinmap must be null | §3.7 |

### Rejected or modified findings

**Finding 5: fix modified.** The review proposed persisting `netName: null` on deliberately unbound copper. That would make the copper *silently* netless: H08's gate is keyed on exactly the opposite state, `netId === null && netName` non-empty ⇔ unresolved binding (OPENPCB-56.md:503, :686). That state yields `NET_ORPHANED_COPPER` and a 422 export, live and non-acknowledgeable.

The real defect is the projection's name re-binding (`pcb-projection.ts:107-123`). H08 S8 deletes it. H14 therefore keeps the KiCad name, hard-orders S10 after H08 S8, and adds a reopen regression test plus H08 quarantine rows.

**Finding 9: partly rejected.**
- The claim that a cloud-pulled copy "can be exported" with silently lost import data does not hold in today's code. Cloud pull (`CloudDesignBrowser.tsx:98-130`) builds a **native** design by replaying only `place_part` / `create_wire` / `upsert_label`. No imported copper, graphics or zones travel, so there is no import loss to carry. The copy's board is produced by OpenPCB itself and is gated by DRC/H19 like any native board.
- Storing blockers in synced design state would add sync surface without protecting anything today.
- Accepted parts:
  1. A missing report on a design with an `import_kicad_project` command-log row fails closed (`import_report_missing`).
  2. An invariant is recorded for the cloud-sync owner, should board rehydration ever be added.

**Finding 10: rejected.** H13's design reads the frame from H14's persistence directly. `computeDesignFrameStatus` step 3 reads `designer_import_reports.frame`, else `designer_command_log.command_json.frame.kicadBoardTransformVersion` (OPENPCB-61.md:704-706). H13 records that H14 writes `boardImportFrameStamp` into both (`:943`). H13 then feeds H19's `sourceFrame` slot (`:739`).

A `persistBoardFrame` port function would duplicate H13's own classifier input. This revision makes the `command_json.frame` write explicit (§3.5, §3.13) and tests it (S10).
