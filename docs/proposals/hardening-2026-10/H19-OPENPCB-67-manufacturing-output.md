# OPENPCB-67 (H19/P1) — Fail-closed manufacturing output + physical pour semantics

Status: design rev 2 (adversarial review addressed — see §10 for the disposition of all 33 findings), ready for implementation once §9 is answered. Author: architect pass 2026-10-15 at OpenPCB `master` 839365e; facts re-verified at d5547f9 (the intervening commits touch keyboard/tooltip/e2e fixture code only; every cited line still matches). `H19.md` in this directory is a symlink to this file.
Scope repos: OpenPCB only. **No `../shared` change and no re-pin is needed**: the copper-fill kernel,
pour params, Gerber/Excellon writers, ZIP writer and DRC are all in-tree (`src/shared/rendering/copper-fill/*`
is NOT a shim). Every slice must typecheck against the currently pinned `@openpcb/*` tags. (S7b's KiCad comparisons become meaningful only once H13 pins the `@openpcb/kicad-import` tag containing SH1; until then the harness skips. H19 itself does not re-pin anything.)

Release behaviour is unchanged by this item: `designer.outputQuarantine` (registry.ts:121-126,
availability `prod`) stays ON in packaged builds and `assertQualifiedManufacturing()` stays the FIRST
statement of every manufacturing entry point. Everything below is active in dev/test builds (and in
release only after the user signs off and flips the flag — not part of this item).

---

## 1. Scope & acceptance mapping

| # | Acceptance criterion (Plane / audit) | Design element (section / slice) |
|---|---|---|
| A1 | T-140 droplet = display-only visibility; pour creation / padConnection = explicit physical command; never silently override an existing thermal zone; aria-label / aria-pressed | §3.9 view-only `hiddenFillLayers`, Add-board-pour dialog inheriting padConnection **and** `thermal`, explicit Enabled switch, inline conflict warnings on every picker change; §3.9.1 `EXPORT_POUR_CONNECTION_CONFLICT` non-waivable capability blocker for same-net overlapping pours whose resolved pad connection differs (covers legacy rows, MCP, import); disabled board zones listed as warnings; contract 03 §5/§12.3 amendment — **S3b**, **S4**, **S6a** |
| A2 | T-140 canvas, DRC and Gerber consume the same physical pour result; no canvas-only clearance rings around same-net vias | §3.8 `buildProjectionPours` / `pourBaseParams` (one argument builder, all traces/vias, full `PcbBoardSettings`, required keepouts and nets), all six hand-built fill sites routed through it, delete the ViaLayer board-colour separator ring — **S3** |
| A3 | T-152 no "Include inner copper layers" toggle; 4L always exports all copper | §3.10 option removed end-to-end; completeness check C1 — **S2**, **S6a** |
| A4 | T-164 bundle / ZIP / member / `.gbrjob` ProjectId from a safe slug; client and server agree | backend already done (e64a464); frontend reads `X-OpenPCB-Bundle-Name` (now CORS-exposed) or `summary.bundleName`; BOM view uses `bomExportFileName(exportBundleName(id, name), kind)` — **S8a** |
| A5 | T-171 >4-layer and blind/buried/micro refusals = blocking panel with count/span + Show-on-board, no DRC gate/override shown | typed `ManufacturingBlocker` (§3.2), `ProblemError` (§3.11), capability panel skips DRC — **S6a**, **S8a**, **S8b** |
| A6 | T-195 export dialog checkboxes use kit/token styling | dialog ported to kit `Dialog` + `Checkbox` — **S8b** |
| A7 | T-201 empty board is not promoted to green | `EXPORT_EMPTY_BOARD` capability blocker (§3.3) — **S6a** |
| A8 | T-205 microvia preset must not silently create a through via; no "Phase C" copy | preset removed, copy removed, test — **S1** |
| A9 | S15-2 retain >4-copper-layer refusal | `EXPORT_UNSUPPORTED_LAYER_COUNT` blocker + builder throw kept (defence in depth) — **S6a** |
| A10 | Output built from ONE validated revision; every copper layer, PTH/NPTH, outline, declared attributes accounted for | `readExportSnapshot` single synchronous read (§3.4) + one async library pre-read keyed by the snapshot's `(footprintId, sourceHash)` (§3.4.1), completeness assertion C1–C7 over the EMITTED text (§3.6) — **S6a**, **S6b** |
| A11 | Unsupported via spans, missing copper/nets, ambiguous transform provenance, omitted layers = non-overrideable capability errors | capability blocker sources (§3.3) incl. unsupported-aperture / off-stackup copper pre-check and hook slots for H08 / H13 / H15 fed by the library pre-read — **S6a** |
| A12 | Not-run/failed/incomplete DRC not promoted to green; no DRC ack bypass; OPENPCB-34 authorises nothing | server DRC gate at pinned revision + one provenance stamp (content, options, engine version, raw-footprint digest; §3.5), `*_UNCHECKED` → `EXPORT_DRC_INCOMPLETE`, suppressions recorded and gated (§3.5, Q1), dialog has no override control — **S5**, **S6b**, **S8b** |
| A13 | Tests parse emitted Gerber AND Excellon; compare geometry, layer manifest, thermal connections, units, net attributes against independent expected fixtures | `excellon-parse.ts`, extended `gerber-parse.ts` (incl. KiCad `%AMRoundRect` macros), 5 hand-authored fixtures incl. B-side/rotated/mirrored-thermal case + kicad-cli oracle harness with a declared (never fitted) frame map (§3.13) — **S7**, **S7b** |
| A14 | Atomic publication with snapshot provenance + per-file checksums; failed/cancelled export preserves previous files; real native writes tested | in-ZIP `-manifest.json` with SHA-256 per member (§3.7), Electron main fetch → save dialog → temp+fsync+verify+rename (§3.12), Bun fs tests + Electron Playwright spec — **S6b**, **S9a**, **S9b** |
| A15 | Prereqs H13/H14/H15/H16; H23 supplies BOM/CPL consistency; OPENPCB-103 settle/once primitives | §8 interface table; blocker hook slots; H16 digest reuse rule; S4/S8b consume `coordinator.isSettled` + `dispatchOnce` |
| — | Manual native GUI QA of save dialog / cancel / overwrite on macOS (needs_user) | §7.4 checklist for the user |
| — | Lifting `designer.outputQuarantine` (needs_user) | out of scope; §6 |

---

## 2. Current state (verified at 839365e)

Export core
- `src/modules/designer/backend/export/index.ts:42-223` `buildExportBundle(pcb, schematic, options, bomOverrides, createdAt, designName)` — pure. Refuses non-through vias (`:60-69`, 422 `export-unsupported-via-type`, extras `{viaIds}`) and `layerCount > 4` (`:76-84`, 422 `export-unsupported-layer-count`). `:87-88` `includeInner = options.includeInnerLayers !== false && layerCount === 4` → 4L can ship F/B only while `.gbrjob` (`:192-196`) claims `LayerNumber: 4`.
- `export/preflight.ts:20-83` advisory strings only; `"Error: N part(s) have no footprint pads"` (`:29-34`) and missing outline (`:36-40`) never block.
- `export/gerber/writer.ts:437-498` `emitCopperPour` builds `common` itself (records = `ctx.records`, ALL traces, ALL vias) + `pourParamsForZone(zone, dr, ctx.keepouts, zones, nets)`; throws 422 `copper-pour-failed` on a failed fill. `:363-370` a pad whose aperture cannot be resolved is only a warning and is dropped from copper. `:857-865` `resolveNetName` → a stale `netId` with no fallback name emits copper with no `%TO.N`.
- `export/gerber/job-file.ts:33-65` `.gbrjob`, `ProjectId.Revision = String(pcb.revision)`.
- `export/excellon/writer.ts:80-155` PTH/NPTH split; METRIC, explicit decimal; slots via `G85`.
- `export/zip.ts:36` ZIP DOS time = `new Date()` (non-deterministic bytes).
- `capability-quarantine.ts:10-23` `assertQualifiedManufacturing()` 422 `UNQUALIFIED_MANUFACTURING` when flag on.
- `routes.ts:354-366` `parseExportOptions` (incl. `includeInnerLayers`); `:3426-3438` `pnp.csv`; `:3440-3497` `POST /exports/gerber` reads pcb / schematic / overrides / name in **four separate awaits** with no revision pin; no DRC check; `?format=zip|summary|json`.
- `sdk.ts:136-161` `getManufacturingExportSummary` — same unpinned path.
- `assistant/backend/tools/read-tools.ts:296-345` `designer_export_manufacturing` forwards `includeInnerLayers`; `:35-39` maps any 422 to `ok:false` with `error.message`.
- `core/backend/tests/assistant-parity-catalog.test.ts:19-26` preserves historical input schemas of **`inAppTools` only**. `designer_export_manufacturing` is MCP-only (it appears only under `mcpReadOnly`/`mcpWithWrites` in both catalogs), so that loop does not cover it; the schema has no `additionalProperties:false`, so dropping the property keeps old clients working. Its description references `openpcb://design/{id}/export/gerber` (`read-tools.ts:303`), a resource kind that does not exist (`mcp/resources.ts` `KIND_LABELS`).
- `routes.ts:3450-3452` an unparsable JSON body silently becomes `{}`. `:3466` `capture.onExport` fires for every format, including `summary`.
- `core/backend/http/cors.ts:24-25` base `Access-Control-Expose-Headers` = `Content-Disposition, X-OpenPCB-Bundle-Name, X-OpenPCB-Warnings, X-Request-Id, Mcp-Session-Id`; `:72-79` `withCorsHeaders` `set`s over the route's own headers, so a route-level expose list is overwritten.
- Tests that assume today's ungated export: `designer-export-naming.test.ts:33-63` (200 for `pnp.csv` and `?format=summary` on an EMPTY new design), `designer-capture-outcomes.test.ts:214,270,316` (200 from `POST exports/gerber` with no DRC run).

Pours / zones
- `shared/pcb-areas/pour-params.ts:122-131` `zonePourNets(board: PcbBoardSettings, netNames)` → `createRuleResolver(board, …)` (needs net classes, drcRules). `:170` `if (other.netId === zone.netId) continue;` — same-net zones never carve each other; contract 03 §5 (line 278): "a same-net explicit zone merges into it". Gerber unions per net (`writer.ts:470-497`). A solid board zone therefore floods the relief gaps of a same-net thermal polygon zone (and vice versa: any disagreement resolves to "most copper").
- `PcbZone.thermal?: {gapMm, spokeWidthMm} | null` (`types.ts:1152`); kernel defaults gap 0.4 / spoke 0.4 / 4 spokes (`copper-fill-geometry.ts:107-109`); `resolvePadConnection` (`:206-221`) and `ThermalConfig` are module-private.
- Hand-built kernel argument sets (contract 03 §13.3 lists them): `writer.ts:441-456`, `drc-context.ts:1207-1250`, `board-snapshot-pours.ts:55-90`, `CopperPour.tsx:100-160`, `shared/pcb-connectivity/board-connectivity.ts:133-150` (`buildBoardPourFills`), `backend/command-executor.ts:~1549` (coverage check with `fillTraces`).
- Board zones are created by `pcb_add_zone` (layers-panel toggle, MCP, KiCad import) AND by the lazy legacy migration `migrateLegacyBoardFill` (`pcb/pcb-projection.ts:186-195`, which also runs inside any projection load). Contract 03 lines 26, 99 and 467 still describe "the layers-panel toggle".
- The old droplet toggled `enabled` (`PcbCanvas.tsx:6604-6631`, `board-zone-controls.ts:26-33`), so existing `enabled=false` board zones may mean "hidden" rather than "no plane".

Footprints / library
- `unresolvedFootprintReason` (`shared/pcb-geometry/pad-geometry.ts:20-40`): `mountType==="virtual"`, placeholder `sourceHash`, or no preview → `no-footprint`; empty `preview.pads` → `no-pads`. Schematic parts carry `pins: DesignerPin[]` (`types.ts:~1429`).
- A placement snapshot (`LibraryFootprintPlacementSnapshot`, `sdks/library/types.ts:178-187`) carries `footprintId, sourceHash, preview` only — no frame/generator provenance; that lives in library rows (`LibrarySourceProvenance`, `:77-83`). `LibrarySDK.getFootprint` is async.
- DRC courtyards come from LIVE library rows: `drc/run-service.ts:344` `buildRawFootprintEntries(ctx, run.projection)` (`pcb/raw-footprint-lookup.ts:15-38`, read errors swallowed). Neither the revision nor `computeBoardContentDigest` covers those rows.
- `board-content-digest.ts:47-49` sorts with `localeCompare` (locale-dependent order). Consumers: autolayout snapshot digest (transient, per job) only.
- `drc-results.ts:26-58` upsert `.set(next)` rewrites every column it knows; an older binary would leave new columns untouched. `run-service.ts:446-450` run join key = `(revision, optionsDigest)`. No DRC engine version constant exists.
- DRC suppression routes besides waivers: per-code `board.drcSeverityOverrides` (`types.ts:893-895`, may be `"ignore"` or a downgrade) and `viewState.drcIgnoredRuleClasses`; both drop violations before counting (`drc-engine.ts:255-261`), never as "waived". `NON_OVERRIDABLE` (`severity.ts:125-140`) is immune to both. `*_UNCHECKED` codes are `info` (`severity.ts:102,107`).

Importer / drills
- `pcb-drills.ts:180-189`: native convention = copper at pad centre, hole at `centre + R·drillOffsetMm`. Sibling `kicad-import/src/build-preview-models.ts:669-682` maps KiCad `at` → `centerMm` and `offset` → `drillOffsetMm` unchanged; in KiCad `at` is the HOLE position and copper sits at `at + offset` (KiCad `pad.h` `m_offset` — from source knowledge, kicad-cli absent so not checked against output). `drillOffsetMm`/`plated`/`drillSlotMm` are not in the pinned rendering-core pad type (`pcb-drills.ts:92-99`, read via `padDrillFields`).
- `insert-pcb.ts:143,210` copies raw KiCad `fp.at` / via `at` (Y-down) — the H13 bug.
- `helpers/gerber-parse.ts:149-183` macro primitives 1 and 21 only, numeric literals only (KiCad's `%AMRoundRect` with `$n` variables and primitives 4/20 throws).

DRC persistence
- Migration `0013_drc_results.sql`: one row per design: `ran_at_revision, error_count, warning_count, info_count, violations_json, options_json` (no digest). Last migration file is `0020_operation_receipts.sql`; the migrator applies by unapplied-name set (`core/backend/migrations/module-migrator.ts:50,114`), so a duplicate numeric prefix is legal (precedent: two `0009_*`).
- `drc-results.ts:26-58` `saveDrcResult`, `:74-107` `getDrcResult`.
- `drc/run-service.ts:138-146` `computeOptionsDigest` (module-private, sha1 of `drcOptionsFromProjection + severityOverrides`); `:303-334` `persistAndComplete` → `saveDrcResult` sync; runs carry `revision` + `projection`.
- `summary.errors` excludes waived (`shared/drc/drc-engine.ts:337`); safety-critical codes cannot be waived (`:276-278`) and `NON_OVERRIDABLE` (`shared/drc/severity.ts:125`). `COPPER_SHAPE_UNCHECKED`/`OUTLINE_WEB_UNCHECKED` are `info` (`severity.ts:102,107`).
- `pcb/board-content-digest.ts` `computeBoardContentDigest(projection)` — sha256 of persisted content (excludes view state, overlays, revision). View-state commands bump the revision (doc comment in that file).
- `store.ts:676-688` `getPcbProjection` = head revision + `loadPcbProjection`, which performs lazy NON-revisioned writes (`pcb-projection.ts:184-219`: `migrateLegacyBoardFill`, `ensurePcbBoardSettings`, `syncPcbPlacementsFromSchematic`). `store.ts:433` shows the sync `ctx.db.transaction(() => …)` pattern.

Frontend
- `frontend/pcb/PcbExportDialog.tsx:79-109` runs DRC on open; `:211-216` "DRC could not run … Export is allowed but unverified"; `:226-243` "Export anyway (ignore DRC errors)" checkbox; `:246-269` native checkboxes incl. inner-layer toggle; `:142-169` blob download; `:355-396` quarantine stub.
- `frontend/api.ts:86-102` `fetchData` drops problem type/extensions; `:654-692` `downloadGerberZip` uses `exportBundleName(designId)` (no name) → ZIP named `openpcb-<id>.zip`; `:715-742` `downloadBomArtifact` names `<id>-csv.csv`.
- `frontend/components/DesignerBomView.tsx:258-263` calls `downloadBomArtifact(designId, kind)`; `Space.tsx:1538` mounts it (`activeDesign?.name` available at `:1626`).
- `pcb/PcbLayersPanel.tsx:517-535` droplet → `onToggleBoardZone`; title only, no aria; `:580-621` pour row (net + pad connection) only when a board zone exists.
- `pcb/PcbCanvas.tsx:6604-6631` toggle = `pcb_add_zone` (board region, `padConnection: "solid"`) or `pcb_update_zone {enabled}`.
- `pcb/tools/board-zone-controls.ts:21-33` `boardZoneToggleAction`.
- `pcb/PcbScene.tsx:1934-1972` effective zones + `pourParamsForZone`; `:1977-1985` `tracesByLayer`; `:2191-2213` `<CopperFillLayer traces={tracesByLayer[layer]} …>` (per-layer traces only; backend passes all traces → tier-net / records differ); `:1988-2017,2271` `samePourViaIds` → `layers/ViaLayer.tsx:10-21,91-92` presentation-only board-colour separator ring `VIA_SEPARATOR_GAP_MM = 0.15` (the canvas-only "clearance ring" around same-net vias that Gerber does not have).
- `pcb/layers/CopperFillLayer.tsx:127-160` calls `buildCopperFillIslands` itself without `records`.
- `three-d/primitives/CopperPour.tsx:100-160`, `backend/pcb/board-snapshot-pours.ts:55-90`, `shared/drc/drc-context.ts:1207-1250` each rebuild the same `common` object by hand.
- `backend/pcb/via-presets.ts:67-74` `microvia` preset "(Phase C)"; `PcbTopToolbar.tsx:328-375` picker; route tool always commits `viaType: "through"` (`PcbCanvas.tsx:2621`). `sdks/designer/types.ts:1016` "Phase C" comment.

Electron / security
- Backend in-process; renderer trust = `rendererTrust` (`electron/src/main/index.ts:309-313`) + `requireTrustedCredentialSender` (`credential-ipc.ts:32-43`). Narrow-IPC precedent: `draft-journal-ipc.ts`, `local-api-ipc.ts`; preload `electron/src/preload/index.ts:53-120`; renderer types `src/core/frontend/src/vite-env.d.ts:41+`; module-side detection pattern `knowledge/frontend/lib/native-draft-journal.ts`. Electron tests are Bun (`ci.yml:130 bun test electron/tests`). Electron Playwright project `electron-desktop` matches a regex in `playwright.config.ts:35-38`.
- No `showSaveDialog` anywhere. `backend-server.ts:80` sets `OPENPCB_SENTRY_RELEASE=openpcb@<version>` (no plain version env).

Test helpers
- `core/backend/tests/helpers/gerber-parse.ts` (404 lines): apertures, flashes, strokes, regions(+polarity), arcs, `strict`. Assumes FSLAX46/MOMM (`COORD_SCALE` const), does NOT read `%TF`, `%FS`, `%MO`, `%TO`. No Excellon parser exists. `helpers/designer-runtime.ts` `bootDesignerRuntime` gives `{sdk, server}` for HTTP tests.
- `kicad-cli` is NOT installed (`/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli` missing).

---

## 3. Design

### 3.1 Module boundaries (per OpenPCB/CLAUDE.md)

| New / changed code | Layer | Imports allowed |
|---|---|---|
| `src/shared/rendering/copper-fill/projection-pours.ts` | shared | `shared/pcb-areas`, `shared/pcb-connectivity`, `shared/drc/rule-resolver`, `sdks` types |
| `src/shared/pcb-areas/pour-connection-conflicts.ts` | shared | `shared/pcb-areas`, `shared/pcb-geometry`, `shared/rendering/copper-fill` (exported resolver), `sdks` types |
| `src/shared/drc/engine-version.ts` | shared | nothing |
| `modules/designer/backend/export/{blockers,completeness,manifest,prepare,drc-gate,library-inputs,prepared-cache}.ts` | module | own module, `sdks`, `shared`, `core/contracts/errors` |
| `src/core/contracts/app/manufacturing-publisher.ts` | core contract (types only) | nothing |
| `electron/src/main/{atomic-file-publish,manufacturing-publish-ipc}.ts` | electron | node, electron, `core/contracts` |
| `modules/designer/frontend/pcb/export/*` | module frontend | `@shared/frontend/ui`, `sdks`, `core/contracts` types |

Electron never imports `src/modules/*`. The route path is a core contract: `src/core/contracts/app/manufacturing-publisher.ts` exports `manufacturingExportZipPath(designId: string): string` (= `/api/modules/designer/designs/${encodeURIComponent(designId)}/exports/gerber?format=zip`); the designer route registration and Electron main both import it, and an S9a test asserts the designer router resolves that path.

### 3.2 Public types (`src/sdks/designer/types.ts`, additive)

```ts
export type ManufacturingBlockerCode =
  // capability — the design cannot be manufactured faithfully by this exporter
  | "EXPORT_UNSUPPORTED_LAYER_COUNT"   // layerCount > 4 (S15-2)
  | "EXPORT_UNSUPPORTED_VIA_SPAN"      // viaType !== "through"
  | "EXPORT_EMPTY_BOARD"               // T-201
  | "EXPORT_UNRESOLVED_FOOTPRINTS"
  | "EXPORT_UNRESOLVED_COPPER_NET"     // copper whose netId is not a current net (pre-H08 orphan)
  | "EXPORT_ZONE_NOT_POURED"           // enabled zone dropped by the derivation
  | "EXPORT_POUR_CONNECTION_CONFLICT"  // same-net overlapping pours disagree on a pad's connection (A1)
  | "EXPORT_COPPER_POUR_FAILED"        // kernel failure (was 422 copper-pour-failed)
  | "EXPORT_COPPER_INCOMPLETE"         // pad aperture unsupported, or copper on no emitted layer
  | "EXPORT_ORPHANED_NET_COPPER"       // slot: H08
  | "EXPORT_AMBIGUOUS_SOURCE_FRAME"    // slot: H13
  | "EXPORT_UNQUALIFIED_FOOTPRINT"     // slot: H15
  // drc gate
  | "EXPORT_DRC_NOT_RUN"
  | "EXPORT_DRC_STALE"
  | "EXPORT_DRC_INCOMPLETE"            // a check did not answer (*_UNCHECKED > 0) — Q2
  | "EXPORT_DRC_SUPPRESSED"            // an error-class check was ignored/downgraded — Q1
  | "EXPORT_DRC_ERRORS"
  // integrity — exporter self-check failed (a bug, never user-fixable)
  | "EXPORT_BUNDLE_INCONSISTENT";
// EXPORT_NO_OUTLINE is deliberately absent: `board.outline` is non-nullable (`types.ts:870`) and a
// degenerate outline is BOARD_OUTLINE_INVALID (error, NON_OVERRIDABLE), which the DRC gate blocks.

export type ManufacturingBlockerCategory = "capability" | "drc" | "integrity";

export interface ManufacturingBlockerTargets {
  placementIds?: string[];
  traceIds?: string[];
  viaIds?: string[];
  zoneIds?: string[];       // polygon zones only; board zones are never selectable (contract 03 §12.3)
  freePadIds?: string[];
  freeHoleIds?: string[];
  layer?: PcbCopperLayerId; // board-zone / layer-level blockers carry the layer instead of a zone id
}

export interface ManufacturingBlocker {
  code: ManufacturingBlockerCode;
  category: ManufacturingBlockerCategory;
  /** Final user-facing sentence(s); the UI renders it verbatim. */
  message: string;
  /** Number of offending items (1 for board-level blockers). */
  count: number;
  targets?: ManufacturingBlockerTargets;
  /** Code-specific facts, JSON-scalar only (e.g. layerCount, maxLayerCount, spans). */
  detail?: Record<string, string | number | boolean | null | string[]>;
}

/** Extras of the 422 `https://openpcb.dev/problems/export-blocked` problem. */
export interface ManufacturingExportBlockedExtras {
  code: "EXPORT_BLOCKED";
  designId: string;
  revision: number;
  blockers: ManufacturingBlocker[];
}

export interface ManufacturingDrcEvidence {
  ranAtRevision: number;
  ranAt: string;
  errors: number; warnings: number; infos: number;
  waived: number;
  /** Non-waived `*_UNCHECKED` violations ("the engine did not answer"). */
  unchecked: number;
  /** Every suppression route besides per-violation waivers (Q1). */
  ignoredRuleClasses: DrcRuleClass[];
  /** `board.drcSeverityOverrides`, sorted by code; `defaultSeverity` from the severity table. */
  severityOverrides: Array<{ code: DrcRuleCode; severity: DrcSeverity | "ignore"; defaultSeverity: DrcSeverity }>;
  /** `board.drcRules` entries with an explicit `severity`, sorted by rule id. */
  ruleSeverities: Array<{ ruleId: string; severity: DrcSeverity }>;
  engineVersion: string;
}
```

Changes to existing types:
- `GerberExportOptions` → `{ includeBom?: boolean; includePickAndPlace?: boolean; expectedRevision?: number }` (**`includeInnerLayers` removed**).
- `GerberArtifactKind` += `"json.manifest"`.
- `DesignerExportSummary` (`sdks/designer/index.ts:401`) += `revision: number; drc: ManufacturingDrcEvidence`.
- `DesignerStore` (backend-internal) += `readExportSnapshot(designId): Promise<ExportSnapshot | null>`; `saveDrcResult(designId, report, options, provenance?)`.
- `src/shared/rendering/copper-fill/copper-fill-geometry.ts` (in-tree, not a shim): export `resolvePadConnection` and a new `resolveThermalConfig(zoneThermal): ThermalConfig` that applies the existing defaults (no value changes), so the conflict check cannot drift from the kernel.

Run `npm run gen` after changing `sdks/designer/*` and commit generated stubs (`gen:check` in CI).

### 3.3 Capability blockers (`export/blockers.ts`)

```ts
export interface ExportSnapshot {
  designId: string;
  revision: number;
  designName: string | null;
  pcb: DesignerPcbProjection;
  schematic: DesignerSchematicProjection | null;
  bomOverrides: BomOverride[];
  drc: StoredDrcGateEvidence | null;     // §3.5
  // Hook slot populated by H08 inside readExportSnapshot (its ledger is a designer table → sync read).
  orphanedCopper?: ReadonlyArray<{ kind: "trace" | "via" | "zone" | "freePad"; id: string; retiredNetId: string }>; // H08
  // Designer-side H13 input read in the same transaction (H13 §3.6.3 step 3 `importStamp`).
  frameImportStamp?: "canonical-v1" | "legacy" | "none";                                                            // H13
}
// No timestamp lives on the snapshot: the ONE bundle timestamp is the injected `env.createdAt` (§3.11).

/** Async, library-backed inputs read AFTER the snapshot, keyed by the snapshot's placements (§3.4.1). */
export interface ExportLibraryInputs {
  rawFootprintEntries: Array<[string, Record<string, unknown>]> | null; // exactly what DRC sends the worker
  rawFootprintDigest: string;                                          // digestRawFootprintEntries(entries)
  // Hook slots — derived by H13 / H15 pure classifiers from library rows read here; undefined until those land.
  sourceFrame?: { status: "native" | "qualified" | "legacy-mirrored" | "ambiguous"; placementIds: string[];
                  resolution: "reimport-project" | "refresh-footprint" };                                // H13
  unqualifiedFootprints?: ReadonlyArray<{ placementId: string; reference: string; generator: string | null; reason: string }>; // H15
}

export interface CapabilityInput { snapshot: ExportSnapshot; library: ExportLibraryInputs }
/** `claimed` = `kind:id` keys already reported by earlier sources (dedupe precedence, §3.3); a source adds what it reports. */
export type CapabilityBlockerSource = (i: CapabilityInput, claimed: Set<string>) => ManufacturingBlocker[];

/** Order = display AND dedupe-precedence order. Fixed by this item; H08/H13/H15 fill their slots, never reorder. */
export const CAPABILITY_BLOCKER_SOURCES: readonly CapabilityBlockerSource[] = [
  layerCountBlocker, viaSpanBlocker, emptyBoardBlocker,
  unresolvedFootprintBlocker, unsupportedCopperBlocker,
  orphanedCopperBlocker, zoneNotPouredBlocker, unresolvedCopperNetBlocker,   // dedupe precedence order
  pourConnectionConflictBlocker,
  sourceFrameBlocker, unqualifiedFootprintBlocker,
];

export function collectCapabilityBlockers(i: CapabilityInput): ManufacturingBlocker[];
export class ExportBlockedError extends AppError { /* 422, type export-blocked, extras ManufacturingExportBlockedExtras */ }
export function exportBlocked(s: ExportSnapshot, blockers: ManufacturingBlocker[]): ExportBlockedError;
```

`ExportBlockedError.message` = `"Manufacturing export blocked: " + first 3 messages joined by " " + (n>3 ? ` (+${n-3} more)` : "")` — this is what the assistant tool returns (it maps 422 → `ok:false`, unchanged).

Rules (each pure, deterministic order: ids sorted by code unit):

| Source | Predicate | Message (verbatim) | targets / detail |
|---|---|---|---|
| layerCountBlocker | `pcb.board.layerCount > 4` | `This board has {n} copper layers. OpenPCB exports at most 4 copper layers, so it cannot be manufactured from this export.` | `detail {layerCount:n, maxLayerCount:4}` |
| viaSpanBlocker | `vias.filter(v => v.viaType !== "through")` non-empty | `{k} via(s) are blind, buried or micro vias. The drill export writes through-board drills only.` | `viaIds`; `detail.spans = ["<viaId>:<viaType>:<fromLayer>-<toLayer>", …]` (max 50) |
| emptyBoardBlocker | no copper pad records (`buildCopperRecords(...).pads/traces/vias` all empty) AND no ENABLED zone row AND no drill source (via drill>0, `footprintPadDrill`, `freeHoleDrill`, `freePadDrill`) | `The board has no parts, copper or holes. There is nothing to manufacture.` | — |
| unresolvedFootprintBlocker | `collectUnresolvedFootprints(pcb.placements)` filtered: `no-footprint` blocks unless `footprint.mountType === "virtual"` (intentionally copper-less); `no-pads` blocks only when the placement's schematic part (`schematic.parts` by `partId`) has ≥1 pin — a pad-less logo/board-art footprint whose part has no pins (or no schematic part) passes and is listed as a manifest/dialog warning `"{ref} has a footprint without pads (no copper exported)"` | `{k} part(s) have no usable footprint: {refs≤8}. Assign footprints with pads before exporting.` | `placementIds`; `detail.reasons = ["<ref>:no-footprint" \| "<ref>:no-pads", …]` |
| unsupportedCopperBlocker (pre-check, so the user learns it before DRC) | (a) a pad record (`buildCopperRecords`) for which the writer's ctx-free `padApertureShape(record)` (extracted from `apertureFromRecord`, `writer.ts:596`) returns null; (b) a pad record whose `resolvedLayers ∩ copperLayersForCount(layerCount)` is empty; (c) a trace whose `layer` is off the stackup | `{k} copper item(s) cannot be written: {refs/ids ≤8}. Their pad shape is not supported or they sit on no exported copper layer.` | `placementIds, freePadIds, traceIds`; `detail.reasons` |
| orphanedCopperBlocker | `snapshot.orphanedCopper?.length` | `{k} copper item(s) are on a net that was split or merged away. Re-assign them before exporting.` | ids by kind |
| zoneNotPouredBlocker | `collectCopperZones({zones, layerCount, knownNetIds}).warnings` with code ∈ {zone_net_unresolved, zone_net_stale, board_zone_no_net, zone_ring_invalid, zone_hole_invalid, zone_layer_off_stackup, zone_id_duplicate, zone_board_id_mismatch, zone_id_reserved} whose row (by payload id) has `enabled === true`, minus ids already reported by orphanedCopperBlocker | `{k} enabled copper pour(s) would produce no copper: {name or layer ≤5}. Pick a valid net, fix the outline, or disable the pour.` | polygon rows → `zoneIds`; board rows → `layer` (one blocker per board layer is not needed; `detail.boardLayers`) |
| unresolvedCopperNetBlocker | trace/via/freePad/zone with `netId !== null && !(netId in pcb.netNames)` (after projection re-binding), minus ids already reported by the two rows above | `{k} copper item(s) belong to a net that no longer exists. Re-assign or delete them before exporting.` | `traceIds, viaIds, freePadIds, zoneIds` |
| pourConnectionConflictBlocker | `findPourConnectionConflicts(...)` (§3.9.1) non-empty | `{k} pad(s) are covered by overlapping {net} pours that disagree on how the pad connects (e.g. thermal vs solid). Make the pours' pad connection and thermal settings match, or move one pour.` | `placementIds, freePadIds, zoneIds` (polygon), `layer`; `detail.conflicts = ["<ref>.<pad>@<layer>:<zoneA>=<mode/gap/spoke>|<zoneB>=…", …]` (max 50) |
| sourceFrameBlocker | `library.sourceFrame?.status` ∈ {legacy-mirrored, ambiguous} | `resolution==="reimport-project"`: `{k} part(s) come from a KiCad project imported in the old coordinate frame. Re-import the KiCad project before exporting.`; else `{k} part(s) use footprint geometry with an unverified KiCad coordinate frame. Refresh their footprints before exporting.` | `placementIds` |
| unqualifiedFootprintBlocker | `library.unqualifiedFootprints?.length` | `{k} part(s) use a footprint generator preset that is not qualified for fabrication: {refs}.` | `placementIds` |

Dedupe precedence (finding 21): orphaned > zone-not-poured > unresolved-net. Each source receives the ids already claimed by earlier sources in a `claimed: Set<string>` (key `kind:id`) through `collectCapabilityBlockers`; an item is reported once, by the highest-precedence source. After H08 the H08 orphan ledger absorbs most unresolved-net cases; the order stays.

Disabled board zones (finding 10): not a blocker, but every `enabled === false` board-zone row is listed as a warning `"Board pour on {layer} is disabled — that layer is exported without a plane."` in `summary.warnings`, the manifest and the dialog (the old droplet toggled `enabled`, so such rows may mean "hidden"). Contract 03 amendment records the reinterpretation (§3.9).

Implementer note for zoneNotPouredBlocker: confirm in `shared/pcb-areas/copper-zones.ts:176-320` whether disabled rows already skip warning emission; filter by row `enabled` either way (a disabled zone is intentional).

Unresolved-copper-net before H08: whether this blocks existing dev boards before H08 lands is **open question Q3** (default: ship the blocker in S6a — release builds stay quarantined, so only dev builds see it).

`preflight.ts`: delete the `"Error: … no footprint pads"` item (now a blocker). The missing-outline advisory item stays as-is (outline validity is the DRC gate's BOARD_OUTLINE_INVALID). Fab-minimum drill/trace and unsourced-BOM items stay advisory warnings. Update `designer-export.test.ts:1983-1999` to assert the blocker instead.

`buildExportBundle` keeps its own via/layer-count throws (defence in depth for direct callers/tests). `prepare` evaluates blockers first so HTTP/SDK callers always see `export-blocked`.

### 3.4 Single validated revision (`store.readExportSnapshot`)

```ts
async readExportSnapshot(designId: string): Promise<ExportSnapshot | null> {
  return ctx.db.transaction(() => {                 // synchronous body; NO await inside
    const head = db.select().from(designHeads).where(eq(designHeads.id, designId)).get();
    if (!head) return null;
    // `timestamp` only stamps lazy-migration rows; it is NOT the bundle timestamp.
    const pcb = loadPcbProjection({ db, designId, revision: head.revision, timestamp: nowIso() });
    const schematic = loadSchematicProjection(db, designId);   // footprintStale NOT needed by export
    const bomOverrides = listBomOverrides(db, designId);
    const drc = getDrcGateEvidence(db, designId);
    const after = db.select({ revision: designHeads.revision }).from(designHeads)
      .where(eq(designHeads.id, designId)).get();
    if (after?.revision !== head.revision)
      throw new Error("export snapshot: design revision moved during a synchronous read");
    return { designId, revision: head.revision, designName: head.name ?? null,
             pcb, schematic, bomOverrides, drc };
  });
}
```
If the module `db.transaction` typing does not accept the closure returning a value, mirror `store.ts:433`. Rationale: better-sqlite3 + one connection + no await = no interleaving writer; the transaction additionally isolates lazy writes in `loadPcbProjection` into one atomic unit.

#### 3.4.1 Library pre-read (`export/library-inputs.ts`) — findings 3 and 4

`readExportSnapshot` cannot call the async LibrarySDK of another module. `prepare` therefore runs ONE async stage after the snapshot and before any blocker:
```ts
export async function readExportLibraryInputs(
  ctx: CoreBackendModuleContext, snapshot: ExportSnapshot,
  hooks?: ExportLibraryHooks,        // H13 / H15 register here; absent → slots undefined
): Promise<ExportLibraryInputs>;
export interface ExportLibraryHooks {
  sourceFrame?(pcb: DesignerPcbProjection, importStamp: ExportSnapshot["frameImportStamp"],
               rows: ReadonlyMap<string, LibraryFootprintRowEvidence>): ExportLibraryInputs["sourceFrame"]; // pure
  unqualifiedFootprints?(pcb: DesignerPcbProjection,
               rows: ReadonlyMap<string, LibraryFootprintRowEvidence>): ExportLibraryInputs["unqualifiedFootprints"]; // pure
}
export interface LibraryFootprintRowEvidence {
  footprintId: string; placementSourceHash: string | null;
  row: Record<string, unknown> | null;   // library row as read (null = missing or read error)
  rowSourceHash: string | null;          // row provenance.sourceHash
  readError: boolean;
}
```
- Keyed by `(footprintId, sourceHash)` from `snapshot.pcb.placements[].footprint`. The library is read once per distinct `footprintId`. `sourceHash` is already in the content digest, so the DRC gate stays bound to the placement geometry.
- `rawFootprintEntries` = the SAME `buildRawFootprintEntries(ctx, snapshot.pcb)` DRC uses (no second implementation), and `rawFootprintDigest = digestRawFootprintEntries(entries)` (new export in `raw-footprint-lookup.ts`: sha256 of canonical JSON of entries sorted by id, code-unit order; `null` → digest of `"none"`). `run-service.ts:execute` computes the same digest from the entries it sends the worker and stores it in the run provenance (§3.5). A library change between DRC and export → digest mismatch → STALE.
- Provenance rule for H13/H15 (fail closed): when `row` is null, `readError`, or `rowSourceHash !== placementSourceHash` (library re-imported but placement not refreshed), the hook must classify that placement as unverified (H13 → `ambiguous` with `resolution:"refresh-footprint"`; H15 → `reason:"library row does not match placed footprint"`). H13's `computeDesignFrameStatus` and H15's `collectUnqualifiedPlacements` each load their own projection today; H19 asks both to expose the pure classifier above over the snapshot's projection (H13 keeps its own `designer_frame_status` upsert on its own routes; the export path never writes it).
- Ordering: snapshot (sync) → library pre-read (async) → blockers. A designer edit during the await changes nothing (the snapshot is fixed); a library edit during the await surfaces as a raw-footprint digest mismatch (STALE) or as a hash mismatch (unverified) — never as silently mixed inputs.

### 3.5 DRC gate (`export/drc-gate.ts`, `drc-results.ts`, `drc/run-digest.ts`, `shared/drc/engine-version.ts`)

Migration `src/modules/designer/backend/migrations/0021_drc_result_provenance.sql` (name-set migrator; coexists with H08's / H13's other `0021_*` files):
```sql
ALTER TABLE designer_drc_results ADD COLUMN provenance_json TEXT;
```
Drizzle `schema.ts:289-300` += `provenanceJson: text("provenance_json")` (nullable). ONE column, not several, because the stamp must be written atomically with the counts it describes:
```ts
export interface DrcResultProvenance {
  v: 1;
  /** Copies of the row's own ran_at / ran_at_revision. An older binary's upsert (`.set(next)`, drc-results.ts:44-48)
   *  rewrites ran_at but not this column → mismatch → STALE (downgrade/upgrade safety, finding 4). */
  ranAt: string; ranAtRevision: number;
  contentDigest: string;      // computeBoardContentDigest(run.projection)
  optionsDigest: string;      // computeDrcOptionsDigest(run.projection)
  engineVersion: string;      // `${DRC_ENGINE_VERSION}+${appVersion}`
  rawFootprintDigest: string; // digestRawFootprintEntries(entries actually sent to the worker)
}
```
`src/shared/drc/engine-version.ts`: `export const DRC_ENGINE_VERSION = 1;` with a doc comment: bump on any change to the check set, a default severity, `NON_OVERRIDABLE`, or a check's semantics. Combining it with `appVersion` (`process.env.OPENPCB_APP_VERSION ?? "dev"`) means any packaged upgrade invalidates old evidence even if a bump is forgotten; in dev the constant is what counts. CI guard (S5): a test snapshots `Object.keys(DEFAULT_SEVERITY)` + `NON_OVERRIDABLE` + `DRC_ENGINE_VERSION` into a committed fixture, so changing the tables without touching the fixture fails and the reviewer sees the version line next to it.

`drc/run-digest.ts` (new): move `computeOptionsDigest` out of `run-service.ts` as `export function computeDrcOptionsDigest(p: DesignerPcbProjection): string` (byte-identical algorithm). `run-service.ts`:
- `RunRecord` += `contentDigest: string` (computed in `start` right after `computeOptionsDigest`, same tick, no new await) and `rawFootprintDigest: string | null` (set in `execute` from the entries passed to `runDrcOnWorker`).
- The join key at `:446-450` becomes `revision && optionsDigest && contentDigest` (finding 27): a lazy non-revisioned write between two starts no longer joins a run whose digest is stale.
- `persistAndComplete` passes the provenance (still synchronous — no await added).

`board-content-digest.ts:47-49` `byKey` sorts by code unit (`a < b ? -1 : a > b ? 1 : 0`) instead of `localeCompare` (finding 28), so the manifest digest is OS-locale independent. Only transient autolayout job digests consume it today; jobs in flight across the upgrade see a digest mismatch and re-snapshot (acceptable, dev only). S5 adds a test with ids whose `localeCompare` and code-unit orders differ (`"a"`, `"B"`, `"_x"`).

`drc-results.ts`:
```ts
export function saveDrcResult(db, designId, report, options, timestamp, provenance: Omit<DrcResultProvenance, "v"|"ranAt"|"ranAtRevision"> | null = null): void;
// writes provenance_json = JSON.stringify({ v:1, ranAt: timestamp, ranAtRevision: report.revision, ...provenance }) or null
export interface StoredDrcGateEvidence extends ManufacturingDrcEvidence {
  provenance: DrcResultProvenance | null;   // null = legacy row, unparsable, or stamp/row mismatch
}
export function getDrcGateEvidence(db, designId): StoredDrcGateEvidence | null;
// waived = violations.filter(v => v.waived).length
// unchecked = violations.filter(v => !v.waived && v.code.endsWith("_UNCHECKED")).length
// ignoredRuleClasses = JSON.parse(options_json).ignoredRuleClasses ?? []
// severityOverrides / ruleSeverities: from options_json when present, else [] — the gate re-derives them from the
//   snapshot (below), so evidence is display data and the digest is the binding
// provenance = parsed stamp iff stamp.ranAt === row.ran_at && stamp.ranAtRevision === row.ran_at_revision, else null
// corrupt violations_json → null (same as getDrcResult)
```

Gate:
```ts
export type DrcGateResult =
  | { pass: true; evidence: StoredDrcGateEvidence }
  | { pass: false; blocker: ManufacturingBlocker };
export function evaluateDrcGate(s: ExportSnapshot, lib: ExportLibraryInputs, env: { appVersion: string }): DrcGateResult;
```
Evaluated in order (first failure wins; every STALE uses the same copy `The last design rule check does not match the design as it is now ({reason}). Run DRC again.` with `detail {ranAtRevision, revision, reason}`):
1. `s.drc === null` → `EXPORT_DRC_NOT_RUN`: `Design rule check has not been run on this revision. Run DRC before exporting.`
2. `drc.ranAtRevision !== s.revision` → STALE `reason:"revision"` (copy names both revisions).
3. `drc.provenance === null` → STALE `reason:"legacy-result"` (pre-0021 row, or a row last written by a binary that does not stamp).
4. `provenance.engineVersion !== `${DRC_ENGINE_VERSION}+${env.appVersion}`` → STALE `reason:"engine-changed"`.
5. `provenance.contentDigest !== computeBoardContentDigest(s.pcb)` → `reason:"content-changed"`; `optionsDigest !== computeDrcOptionsDigest(s.pcb)` → `reason:"options-changed"`; `rawFootprintDigest !== lib.rawFootprintDigest` → `reason:"library-changed"`.
6. `drc.unchecked > 0` → `EXPORT_DRC_INCOMPLETE`: `Design rule check could not finish {k} check(s) on this board, so the result is incomplete. Simplify the affected copper or outline, or contact support.` `targets` from the unchecked violations' anchors (Q2 — default block).
7. Suppression (Q1, default strict): `EXPORT_DRC_SUPPRESSED` when, derived from the SNAPSHOT (the projection's view-state `drcIgnoredRuleClasses`, `board.drcSeverityOverrides`, `board.drcRules[].severity`), any of: an ignored rule class ∈ `GATED_RULE_CLASSES = {clearance, connectivity, electrical, structural}`; a severity override of a code whose default is `error` to `ignore`/`warning`/`info`; any `drcRules` entry with an explicit `severity` other than `"error"` (rules are scoped clearances/constraints; downgrading one is treated as suppressing an error check — simpler and fail-closed). Copy: `Design rule checking is switched off or downgraded for: {list ≤6}. Re-enable these checks (DRC panel → rules) to export.` Suppressions outside the gated set pass and are recorded.
8. `drc.errors > 0` → `EXPORT_DRC_ERRORS`: `Design rule check found {k} error(s). Fix them, or waive individual non-safety violations in the DRC panel, then export.` `count = errors`.
9. else pass. Warnings / infos never block; everything in `ManufacturingDrcEvidence` (waived count, ignored classes, severity overrides, rule severities, engine version) goes into the summary, the manifest and the dialog.

No export parameter, header, env var or flag influences the gate. Request fields such as `allowDrcViolations`, `qualification`, `ackDrc` are ignored (tolerant parser) and a test proves they change nothing. Per-violation waivers (individual, auditable, never on `NON_OVERRIDABLE`/safety-critical codes) count as part of the verdict.

If H16 lands first with its own "rules fingerprint", the gate uses it in place of `optionsDigest` inside the same stamp (one fingerprint, owned by H16). If H16 adds explicit report states (`incomplete`, `failed`, …), step 6 maps `incomplete` → `EXPORT_DRC_INCOMPLETE` and any other non-`clean`/non-`errors` state → STALE `reason:<state>`; H16's `incomplete` replaces the `*_UNCHECKED` count when present.

### 3.6 Completeness assertion (`export/completeness.ts`)

Finding 19: the observed side is the EMITTED TEXT, never the writer's report about itself. The writers are not given stats out-parameters. `completeness.ts` contains a minimal, production-side text scanner (counts and keys only — not geometry; written from the Gerber X2 / Excellon specs, not from the writer):
```ts
interface ScannedGerber {
  fileAttributes: Map<string, string>;                 // %TF.<name>,<value>*%
  lastLine: string;
  /** D-code → %TA.AperFunction value in force when the aperture was defined (%ADD). */
  aperFunctionByDcode: Map<number, string>;
  flashes: Array<{ dcode: number; aperFunction: string | null; pinKey: string | null }>; // pinKey from %TO.P,<ref>,<pad>*%
  conductorStrokes: number;                            // D02…D01 runs drawn with an aperture whose function is Conductor
}
export function scanGerber(text: string): ScannedGerber;
export function scanExcellon(text: string): { fileFunction: string | null; hits: number; slots: number; firstLine: string; lastCommand: string };
export function assertBundleComplete(input: {
  bundle: GerberExportResult; pcb: DesignerPcbProjection; revision: number;
  options: { includeBom: boolean; includePickAndPlace: boolean };
}): ManufacturingBlocker[];   // empty = complete
```
Checks (every failure is `EXPORT_BUNDLE_INCONSISTENT`/integrity — capability problems were already refused by `unsupportedCopperBlocker` before DRC; `detail.check = "C1".."C7"`):
- **C1 copper set**: expected copper layers = stackup of `layerCount` (2 → F.Cu,B.Cu; 4 → F.Cu,In1.Cu,In2.Cu,B.Cu). Exactly one artifact per layer; its `%TF.FileFunction` equals `gerberFileFunctionAttr(kind, layerCount)`; last non-empty line `M02*`.
- **C2 non-copper set**: exactly one each of top/bottom mask, paste, silk and edge_cuts with the expected FileFunction/FilePolarity.
- **C3 drills**: exactly one PTH and one NPTH artifact (`M48` first line, `M30` last command). Expected counts from the projection (plated = vias with `drillMm > 0` + `footprintPadDrill(...)?.plated === true` + `freePadDrill(...)?.plated === true`; unplated = the rest + every `freeHoleDrill`; a slotted pad/hole counts once, as a slot) must equal `scanExcellon(...).hits + .slots` per file.
- **C4 copper objects** per layer L: expected component-pad keys = `buildCopperRecords(...)` pad records with `anchor.kind==="pad"`, `resolvedLayers.includes(L)` and a non-washer function → must equal the multiset of observed `pinKey`s on L; expected via flashes = `vias.filter(v => viaTouchesLayer(v, L))` (export from `shared/rendering/pcb/artwork/mask-artwork.ts:449`) = observed flashes with `aperFunction === "ViaPad"`; expected free-pad flashes = free-pad records on L = observed flashes without `pinKey` and not `ViaPad`; expected strokes = traces with `layer === L && pointsNm.length >= 2` = `conductorStrokes`.
- **C4b every copper item lands somewhere**: every pad record has ≥1 resolved layer in the stackup, every trace's layer is in the stackup, every via touches ≥1 stackup layer (belt-and-braces for `unsupportedCopperBlocker`).
- **C5 job file**: parse `.gbrjob` JSON; `GeneralSpecs.LayerNumber === layerCount`; `ProjectId.Revision === String(revision)`; `FilesAttributes[].Path` set == set of gerber + drill artifact names (no extra, no missing, no duplicate); for each, `FileFunction`/`FilePolarity` equal the file's own scanned header attributes (drills: the `; #@! TF.FileFunction,…*` comment).
- **C6 options**: `csv.bom` present iff `includeBom`; `csv.pnp` iff `includePickAndPlace`.
- **C7 names**: unique; each `=== bundleName + ".gbrjob"` or starts with `bundleName + "-"`; matches `/^[A-Za-z0-9_.-]+$/`.

Implementer must confirm against `writer.ts` that via flashes use `AperFunction ViaPad` and that free pads / washer pads emit no `%TO.P` (`writer.ts:374-383` says washer pads do not); if a writer attribute differs, fix the expectation table here, never the scanner to match whatever the writer emits.

### 3.7 Provenance manifest (`export/manifest.ts`) + deterministic ZIP

```ts
export interface ManufacturingManifest {
  schema: "openpcb.manufacturing-manifest/1";
  generator: { vendor: "OpenPCB"; application: "OpenPCB Manufacturing Export"; appVersion: string };
  createdAt: string;                                   // = env.createdAt (§3.11), the ONE timestamp
  design: { id: string; name: string | null; revision: number; contentDigest: string;
            bomOverridesDigest: string; rawFootprintDigest: string };
  board: { layerCount: number; copperLayers: PcbCopperLayerId[]; thicknessMm: number; fabricator: string };
  drc: ManufacturingDrcEvidence & { optionsDigest: string };   // incl. waived / ignored classes / severity overrides / engineVersion
  options: { includeBom: boolean; includePickAndPlace: boolean };
  files: Array<{ path: string; kind: GerberArtifactKind; fileFunction: string | null; bytes: number; sha256: string }>;
  warnings: string[];                                  // preflight advisories + disabled board pours + pad-less footprints
}
export function buildExportManifest(...): { manifest: ManufacturingManifest; artifact: GerberArtifact };
```
- Artifact: `{ kind: "json.manifest", fileName: `${bundleName}-manifest.json`, text: JSON.stringify(manifest, null, 1) + "\n" }`, appended LAST; it is not listed in itself and not in `.gbrjob`.
- `bytes`/`sha256` over `new TextEncoder().encode(artifact.text)` — the exact bytes `packZip` stores. `files` sorted by `path` (code-unit).
- `bomOverridesDigest` = sha256 of canonical JSON of overrides sorted by refdes (overrides are not revisioned).
- `appVersion` = `process.env.OPENPCB_APP_VERSION ?? "dev"`; Electron sets `OPENPCB_APP_VERSION = app.getVersion()` in `backend-server.ts` next to `:80`.
- Decision: manifest INSIDE the ZIP (one file → one atomic rename; KiCad bundles already carry a JSON `.gbrjob`, fabs ignore unknown members). A loose directory of files cannot be published atomically.

`zip.ts`: `packZip(artifacts, createdAt: string)` — DOS date/time from `new Date(createdAt)` (UTC fields) instead of `new Date()`, so identical inputs → identical bytes. Update callers.

### 3.8 One physical pour result (`src/shared/rendering/copper-fill/projection-pours.ts`)

Finding 2: no `Pick<>`, no optional keepouts, no defaulted nets — contract 03 §13.3 forbids defaults, and `zonePourNets` needs the full board (net classes, `drcRules`, `perNetClassAssignments`) for its resolver.
```ts
/** Everything the kernel's shared argument set is built from. Structural, so non-projection callers can supply it. */
export interface PourBaseInput {
  board: PcbBoardSettings;                              // FULL settings — never a Pick, never a cast
  placements: readonly PcbPlacedPart[]; traces: readonly PcbTrace[]; vias: readonly PcbVia[];
  freeHoles: readonly PcbFreeHole[]; freePads: readonly PcbFreePad[];
  padNets: Readonly<Record<string, string>>;            // required; `{}` is an explicit answer
}
export interface PourProjection extends PourBaseInput {
  zones: readonly PcbZone[];
  keepouts: readonly PcbKeepout[];                      // required (§13.3)
  netNames: Readonly<Record<string, string>>;
}
/** The ONE kernel argument set every consumer passes (ALL traces, ALL vias). */
export function pourBaseParams(p: PourBaseInput, records?: CopperRecords): PourBaseParams;
export interface ProjectionPour { zone: EffectiveCopperZone; result: CopperFillResult }
export function buildProjectionPours(p: PourProjection, opts: {
  nets: ZonePourNets;                                   // required: zonePourNets(p.board, p.netNames) or DRC's own resolver
  records?: CopperRecords; layer?: PcbCopperLayerId;
  tick?: (index: number, total: number) => void;
}): ProjectionPour[];
```
`PourBaseParams` = exactly today's `common` (`writer.ts:441-456`): layerCount, outline, records?, placements, traces, vias, padNetIds (`new Map(Object.entries(padNets))`), copperToBoardEdgeMm, `copperToHoleClearanceMm(rules)`, cutouts, freeHoles, freePads. `buildProjectionPours` = `collectCopperZones({zones, layerCount, knownNetIds: keys(netNames)})` → `collectKeepouts` → per zone (filtered by `opts.layer`) `buildCopperFillIslands({...base, ...pourParamsForZone(zone, rules, keepouts, zones, opts.nets)})`, in derivation order; `records` built ONCE when not supplied.

Consumers — all six hand-built sites that contract 03 §13.3 lists (finding 20):
- Gerber `emitCopperPour`: `buildProjectionPours(ctx.proj, { nets: zonePourNets(ctx.proj.board, ctx.proj.netNames), records: ctx.records, layer })`; keep its failed-fill → 422 throw (converted to a blocker by `prepare`) and the per-net union.
- DRC `drc-context.ts:1207-1250`: `buildProjectionPours(projection, { nets: { resolver }, records, tick: (i, n) => options.tick?.("pour", i, n) })`, or keep the loop with `pourBaseParams(projection, records)` — implementer picks whichever keeps the existing DRC golden fixtures byte-identical.
- `shared/pcb-connectivity/board-connectivity.ts:133-150` `buildBoardPourFills`: build its argument set with `pourBaseParams(<PourBaseInput assembled from copper+fill>)`; if its inputs cannot express the full `PcbBoardSettings`, widen `BoardFillInput` to carry `board` (it is in-tree).
- `backend/command-executor.ts:~1549` coverage check: `pourBaseParams({ ...proj, traces: fillTraces }, …)`.
- 3D `CopperPour.tsx`, snapshot `board-snapshot-pours.ts`: replace hand-built `common` with `pourBaseParams`.
- Canvas: new hook `frontend/pcb/layers/use-projection-pours.ts`:
  ```ts
  export function useProjectionPours(projection: DesignerPcbProjection): ReadonlyMap<string, ProjectionPour>
  // nets = useMemo(() => zonePourNets(projection.board, projection.netNames), [board, netNames])
  // useMemo([projection.zones, projection.keepouts, nets, projection.padNets, projection.board,
  //          projection.placements, projection.traces, projection.vias, projection.freeHoles, projection.freePads])
  ```
  `PcbScene` renders `<CopperFillLayer key={"pour:"+zone.id} layer islands={pour.result.status === "ok" ? pour.result.islands : EMPTY} …render-only props>` for `pourRenderList`. `CopperFillLayer` becomes render-only: props `{ layer, islands, opacity, viewSide }` (drop all kernel props, `tracesByLayer`, `pourParamsByZone`). A `failed` result draws nothing (unchanged contract §8).
- Delete the canvas-only separator: `ViaLayer` props `samePourViaIds` / `showSeparator` / `separatorColor`, constants `VIA_SEPARATOR_*`, `PcbScene.samePourViaIds`. Vias render exactly as their copper; no board-colour ring.
- A grep gate in S3's test (`pour-consumer-parity.test.ts`) asserts `buildCopperFillIslands(` is called only from `projection-pours.ts`, `board-connectivity.ts` and the kernel's own tests, and that no other file assigns `copperToBoardEdgeMm:` outside `pourBaseParams`.

Performance note: the canvas now refills on any trace change on any layer (it already refilled on commit; pours use COMMITTED geometry, not drag overrides — keep that). Accepted for correctness.

### 3.9 T-140 visibility vs physical pour

View state (ephemeral, not persisted, no command, no revision bump) in `pcb-view-store.ts`:
```ts
hiddenFillLayers: ReadonlySet<PcbCopperLayerId>;          // reset to empty when designId changes
toggleFillVisibility(layer: PcbCopperLayerId): void;
```
`PcbScene` filters `pourRenderList` by `!hiddenFillLayers.has(zone.layer)` (affects board AND polygon pours on that layer; never DRC/Gerber).

`PcbLayersPanel` props: remove `onToggleBoardZone`; add
```ts
hiddenFillLayers?: ReadonlySet<PcbCopperLayerId>;
onToggleFillVisibility?: (layer: PcbCopperLayerId) => void;
onAddBoardPour?: (layer: PcbCopperLayerId) => void;               // opens AddBoardPourDialog
onSetBoardZoneEnabled?: (layer: PcbCopperLayerId, enabled: boolean) => void;
pourConflicts?: ReadonlyMap<PcbCopperLayerId, PourConnectionConflict[]>; // §3.9.1, for the inline warning
```
Droplet button (every copper row): `aria-label={`${node.label} copper fill visibility`}`, `aria-pressed={!hidden}`, `title={hidden ? "Show copper fill (view only)" : "Hide copper fill (view only)"}`, `data-testid={`copper-fill-visibility-${layer}`}`. Struck-through icon when hidden.

Pour settings row (inside the existing expand area): when a board zone exists → kit `Switch` "Board pour" (aria-label `${label} board pour enabled`) → `pcb_update_zone {enabled}`, + existing net and pad-connection pickers. When none exists → button "Add board pour…" (`data-testid="add-board-pour-${layer}"`). When `pourConflicts.get(layer)` is non-empty → inline amber row `"{k} pad(s) on this layer are covered by same-net pours with different pad connections — export is blocked until they match."` (`role="status"`), recomputed from the projection on EVERY change (net picker, pad-connection picker, polygon-zone inspector edits, MCP/import writes — it is derived, not event-driven).

`AddBoardPourDialog.tsx` (kit Dialog): fields Net (default = `defaultZoneToolOptions({activeLayer: layer, netNames}).net`, existing helper `tools/area-tool-options.ts:58`), Pad connection (kit Select over the 4 `PcbZonePadConnection` values). Default connection from
```ts
// tools/board-zone-controls.ts (replaces boardZoneToggleAction)
export interface PourConnectionSetting { padConnection: PcbZonePadConnection; thermal: { gapMm: number; spokeWidthMm: number } | null }
export function boardPourConnectionDefault(zones: readonly PcbZone[], layer: PcbCopperLayerId, net: PcbZoneNetRef):
  { value: PourConnectionSetting | null; inheritedFromZoneIds: string[] };
```
Same-net = enabled polygon zones on `layer` where both `netId`s non-null and equal, else upper-cased trimmed `netName`s equal. Each match is normalised to `{padConnection ?? "solid", thermal ?? null}` and compared by value (`thermal` only when the connection can resolve to thermal). 0 matches → `{BOARD_PAD_CONNECTION, null}`; exactly one distinct setting → that setting, INCLUDING its `thermal` (finding 1) + note "Matches the pad connection of zone {name}"; >1 distinct → `null`, no preselection, Create disabled until chosen, note "Same-net zones on this layer use different pad connections — choose one." Recomputed on net change. When the user picks a connection that differs from an inherited one, the dialog shows the §3.9.1 conflict preview for that choice. Create dispatches ONE `pcb_add_zone {layer, net, region:{kind:"board"}, padConnection, thermal}` through `dispatchOnce(designId, "add-board-pour:" + layer, …)` (OPENPCB-103; a double click coalesces instead of hitting `PCB_ZONE_BOARD_EXISTS`) and makes the layer visible (existing behaviour). No code path flips `enabled`, `padConnection` or `thermal` implicitly.

#### 3.9.1 Same-net pour connection conflicts (`shared/pcb-areas/pour-connection-conflicts.ts`) — finding 1

Verified: same-net zones never carve each other (`pour-params.ts:170`) and the Gerber/canvas union per net, so where two same-net pours overlap a pad, the copper is the union — any disagreement silently resolves to "most copper" (a solid board pour floods a thermal polygon's relief gaps; inherited `thermal` with a different gap shrinks it). The design keeps today's physical semantics (no golden change) and makes the disagreement impossible to ship:
```ts
export interface PourConnectionConflict {
  layer: PcbCopperLayerId; netId: string;
  pad: { kind: "pad"; placementId: string; padNumber: string } | { kind: "freePad"; freePadId: string };
  zones: Array<{ zoneId: string; isBoard: boolean; resolved: "solid" | "thermal" | "none"; gapMm: number | null; spokeWidthMm: number | null }>;
}
export function findPourConnectionConflicts(input: {
  zones: readonly EffectiveCopperZone[];                // collectCopperZones(...).zones, enabled only
  records: CopperRecords;                               // buildCopperRecords of the same projection
}): PourConnectionConflict[];                           // sorted (layer, netId, pad key) in code-unit order
```
Predicate: for every same-net pad record P on layer L (record net = zone net, non-null), collect the enabled effective zones of that net on L whose region overlaps P's copper with positive area (board zone → the board region; polygon → `area-overlap.ts` of the pad polygon and the zone ring). Resolve each zone's connection for P with the kernel's now-exported `resolvePadConnection(padConnection, drilled)` and `resolveThermalConfig(zone.thermal)` (defaults applied). If the resolved tuples `(mode, gap, spoke)` (gap/spoke only for `thermal`) are not all equal → one conflict. Consumers: `pourConnectionConflictBlocker` (export, non-waivable capability — catches legacy rows, MCP `pcb_add_zone/pcb_update_zone`, KiCad import and the lazy legacy migration alike), the layers-panel inline warning and the Add-board-pour preview. Not a DRC code (no severity-table / golden churn); recorded in contract 17.

Alternative considered and deferred (Q4): amend contract 03 §5 so a same-net explicit polygon carves the lower-priority board zone and its own connection governs inside it (KiCad-like "priority wins"). That changes pour geometry and DRC goldens and needs an Astra review; the blocker is the fail-closed minimum and stays useful under either semantics.

Contract amendment `docs/pcb-hardening/03-zone-keepout-contract.md` (finding 26 — scoped wording; every site that creates board zones is named):
- §12.3 Layers panel bullet → "**Layers panel:** the per-layer droplet is VIEW-ONLY fill visibility (frontend session state; never a command, never persisted, never read by DRC, Gerber or the snapshot). In the layers panel a board zone is created only by the explicit *Add board pour* action (`pcb_add_zone` with a board region, net, pad connection and thermal settings chosen in a dialog whose default is inherited from same-net polygon zones on the layer and left unset when they disagree), enabled/disabled by an explicit *Board pour* switch (`pcb_update_zone {enabled}`), and edited through the net and pad-connection pickers. Outside the panel, board zones are also written by MCP/assistant `pcb_add_zone`, KiCad project import and the one-time legacy-fill migration (§12.1). An existing `enabled: false` board zone is a physical "no plane" — it may have been set by the pre-H19 droplet meaning "hidden"; export lists every disabled board zone as a warning. (Amended by H19/OPENPCB-67, 2026-10.)"
- §5 Board-zones bullet: append "Where same-net pours overlap a pad and resolve its connection differently (mode, thermal gap or spoke width), the union would silently override one of them; manufacturing export refuses with `EXPORT_POUR_CONNECTION_CONFLICT` (contract 17)."
- Line 26 ("Today's per-layer "copper fill" toggle is a board zone") → "A board zone is the per-layer plane created by *Add board pour* (or import / MCP / the legacy migration); there is at most one per layer."
- Line 99 (`board rows are written by pcb_add_zone / the layers-panel toggle and by the one-time legacy-fill migration`) → "… by `pcb_add_zone` (layers-panel *Add board pour*, MCP, KiCad import) and by the one-time legacy-fill migration (§12.1)".
- Line 467 (`the layers-panel toggle is a board zone's lifecycle control`) → "the layers-panel *Board pour* switch and *Add board pour* action are a board zone's lifecycle controls".
- §7 table `PcbLayersPanel.tsx` row and any remaining "layers-panel toggle" phrase in §12.1/§12.2 → "the layers-panel *Add board pour* action".
- Same wording in `src/modules/designer/AGENTS.md` PCB CAPABILITY BOUNDARIES paragraph if it mentions the toggle.

### 3.10 T-152 / T-205

T-152: remove `includeInnerLayers` from `GerberExportOptions`, `parseExportOptions` (`routes.ts:362-364`; unknown keys keep being ignored), `export/index.ts:87-88` (`includeInner = layerCount === 4`), `frontend/api.ts:52,660`, dialog state/checkbox. Assistant tool (MCP-only, so the historical `inAppTools` schema loop does not cover it — finding 14): REMOVE the `includeInnerLayers` property from the input schema and the `args` type, stop forwarding it (the schema has no `additionalProperties:false`, so an old client that still sends it is accepted and the key ignored). While editing that description, drop the dangling "read the openpcb://design/{id}/export/gerber resource for the ZIP" sentence (`read-tools.ts:303`; no such resource kind exists) and replace it with "File contents are not returned; export the ZIP from the OpenPCB app." Update `fixtures/assistant-parity/catalog.current.json` (schema property removed + description, both `mcpReadOnly` and `mcpWithWrites` occurrences); `catalog.json` (historical) untouched. `designer-capability-quarantine.test.ts:210` → pass `{ includeBom: false }`.

T-205: delete the `microvia` entry and the header line from `via-presets.ts`; reword `types.ts:1016` to drop "Phase C". No microvia creation path exists (route tool commits `through`; `pcb.advancedVias` is data/DRC only).

### 3.11 HTTP / SDK surface

`POST /designs/:designId/exports/gerber?format=summary|json|zip` (any other `format` → 400 `ValidationError`):
```
body (optional JSON): { includeBom?: boolean; includePickAndPlace?: boolean; expectedRevision?: integer >= 0 }
```
Body parsing (finding 30): no body / empty body → `{}`; a non-empty body that is not valid JSON, or valid JSON that is not an object → 400 `ValidationError` ("Request body must be a JSON object") — never silently `{}` (that would drop `expectedRevision`). `expectedRevision` present but not a non-negative safe integer → 400.

Handler:
```ts
assertQualifiedManufacturing();                      // FIRST, unchanged
const prepared = await prepareManufacturingExport(deps, designId, request, {
  createdAt: new Date().toISOString(), appVersion: process.env.OPENPCB_APP_VERSION ?? "dev" });
if (format !== "summary") await capture.onExport(designId);   // a delivered bundle only (zip|json); never summary, never a refusal
```
`export/prepare.ts`:
```ts
export interface ExportRequest { includeBom: boolean; includePickAndPlace: boolean; expectedRevision: number | null }
export interface PreparedExport {
  revision: number; bundle: GerberExportResult;  // artifacts incl. manifest
  manifest: ManufacturingManifest; drc: StoredDrcGateEvidence; zip?: { bytes: Uint8Array; sha256: string };
}
export interface PrepareDeps {
  store: Pick<DesignerStore, "readExportSnapshot">;
  readLibraryInputs(snapshot: ExportSnapshot): Promise<ExportLibraryInputs>;   // §3.4.1, injected → testable without a library
  cache: PreparedExportCache;
}
export async function prepareManufacturingExport(
  deps: PrepareDeps, designId: string, request: ExportRequest,
  env: { createdAt: string; appVersion: string }): Promise<PreparedExport>;
```
Order:
1. snapshot (404 if null);
2. `expectedRevision` mismatch → 409 `https://openpcb.dev/problems/export-revision-changed` extras `{code:"EXPORT_REVISION_CHANGED", expectedRevision, revision}`;
3. library pre-read (§3.4.1);
4. capability blockers — ALL sources, incl. the unsupported-aperture/off-stackup pre-check and pour-connection conflicts (422 export-blocked; DRC NOT evaluated; finding 23: everything the user can fix without DRC is reported before DRC is mentioned);
5. DRC gate (422 export-blocked, single drc blocker);
6. cache lookup (below), else `buildExportBundle(snapshot.pcb, snapshot.schematic, options, snapshot.bomOverrides, env.createdAt, snapshot.designName)`; a `copper-pour-failed` AppError becomes `EXPORT_COPPER_POUR_FAILED`, mapping BOTH extras shapes (finding 22): `{zoneId, layer}` → `targets.zoneIds=[zoneId]` for a polygon zone or `targets.layer` for a board zone; `{netId, layer}` (union failure, `writer.ts:520-530`) → `targets.layer` + `zoneIds` = enabled polygon zones of that net on that layer, `detail.netId`;
7. `assertBundleComplete` (422 export-blocked, integrity);
8. manifest (+ ZIP bytes and sha for `zip`).

ONE timestamp (finding 16): `env.createdAt` for Gerber `CreationDate`, gbrjob, manifest and ZIP DOS time. The snapshot has no timestamp field. The byte-identical determinism test runs at the `prepareManufacturingExport` level with a fixed `env.createdAt` and fake deps — no clock seam in the route is needed; the HTTP test asserts only `X-OpenPCB-Bundle-Sha256 === sha256(body)`.

Prepared-bundle cache (`export/prepared-cache.ts`, finding 33): the backend runs inside Electron main, so every full build (all pours, synchronous) blocks the app. One entry per design, in module memory, max 4 designs, TTL 10 min, cleared on module dispose. Key = `designId | revision | contentDigest | rawFootprintDigest | drc.provenance.ranAt | appVersion | includeBom | includePickAndPlace`. Steps 1–5 always run (they are cheap and are the gate); only step 6–8 is reused. A hit returns the cached `PreparedExport` built for the earlier request, so the `zip` after a `summary` carries the summary's `createdAt` and identical artifact bytes — which is what the user previewed. A `zip` request fills in `zip` bytes once and reuses them. Moving the pour build off the main thread is out of scope (noted as a follow-up for H51).

Responses:
- `summary` 200: `{ bundleName, revision, warnings, drc: ManufacturingDrcEvidence, files: [{kind, fileName, bytes}] }` (bytes from encoded length, not `text.length`).
- `json` 200: `{ bundle, manifest }`.
- `zip` 200 bytes; headers `Content-Type: application/zip`, `Content-Disposition: attachment; filename="<bundle>.zip"`, `X-OpenPCB-Bundle-Name`, `X-OpenPCB-Bundle-Sha256` (hex sha256 of the ZIP bytes), `X-OpenPCB-Revision`, `X-OpenPCB-Warnings`. The route sets NO expose list (finding 15: `withCorsHeaders` overwrites it); instead core `src/core/backend/http/cors.ts:24-25` `BASE_CORS_HEADERS["Access-Control-Expose-Headers"]` += `X-OpenPCB-Bundle-Sha256, X-OpenPCB-Revision` (core infra change, no business logic; S6b; a core CORS test asserts the list).

`GET /exports/pnp.csv[?expectedRevision=N]`: `assertQualifiedManufacturing()` → `prepareManufacturingExport(..., {includeBom:false, includePickAndPlace:true, expectedRevision})` → return the `csv.pnp` artifact (same gate as the bundle: coordinates are manufacturing output — Q5). BOM routes unchanged.

SDK `getManufacturingExportSummary(designId, options?)`: `assertQualifiedManufacturing()` → `prepare` with `expectedRevision: options?.expectedRevision ?? null` → same summary shape; `NotFoundError` → `null` (unchanged contract). Assistant tool description adds: "Requires a passing DRC on the current revision (run `run_drc` first); refusals are returned as warnings."

Frontend `api.ts` (serialised with OPENPCB-103 S5, which edits the same file's `fetchData` classification — whichever lands second rebases; S2/S8a must not run concurrently with 103-S5):
```ts
export class ProblemError extends Error {
  constructor(readonly problem: ProblemDetails) { super(problem.detail ?? problem.title ?? `HTTP ${problem.status}`); this.name = "ProblemError"; }
  get status(): number; get type(): string; get code(): string | undefined;   // problem.code if string
}
export function exportBlockedExtras(e: unknown): ManufacturingExportBlockedExtras | null; // type === …/export-blocked && Array.isArray(blockers)
```
If 103-S5's `request-errors.ts` classification already carries the parsed problem body, `ProblemError` extends/reuses it instead of adding a parallel class. `fetchData` and every raw `fetch` error path in the export/BOM functions throw `ProblemError` for `application/problem+json` (plain `Error` otherwise; `.message` unchanged for existing callers).
- `fetchExportSummary(designId, {includeBom, includePickAndPlace, expectedRevision?})`.
- `downloadGerberZip(designId, {includeBom, includePickAndPlace, expectedRevision}, fallbackBundleName)` → `{ bundleName: header X-OpenPCB-Bundle-Name ?? fallbackBundleName, sha256, revision, warnings, blob }`.
- `downloadBomArtifact(designId, kind, designName: string | null)` → file name `bomExportFileName(exportBundleName(designId, designName), kind)`; `DesignerBomView` gains `designName: string | null` prop from `Space.tsx` (`activeDesign?.name ?? null`); a 422 on `pnp` surfaces through the kit toast with the problem detail.

### 3.12 Export dialog + native publication

Files: `frontend/pcb/PcbExportDialog.tsx` (shell, same import path), `frontend/pcb/export/export-dialog-machine.ts` (pure reducer), `ExportBlockersPanel.tsx`, `ExportDrcPanel.tsx`, `native-manufacturing-publisher.ts`.

State machine (pure `reduce(state, event)` + an effect runner in the component). Inputs besides API results: `settled: boolean` = OPENPCB-103 `coordinator.isSettled(designId)` (pending===0 && retained.length===0), subscribed via the coordinator's queue subscription; a change to `false` from any state except `publishing`/`saved` → `waiting-for-edits` (finding 7). Every state has Close.

| state | entered by | effect | exits |
|---|---|---|---|
| `waiting-for-edits` | open or any state (≠ publishing/saved) while `!settled` | none; copy "Saving your latest edits… Export checks start when every edit is saved." If the lane is blocked (conflicted / ack-unknown items retained), copy "Some edits are not confirmed as saved. Resolve them in the edit-recovery notice, then export." | `settled` → `checking` (resets `autoDrcRuns`, clears `expectedRevision`) |
| `checking` | open (settled), option change (debounced 300 ms), Re-check, Retry | `fetchExportSummary(expectedRevision = lastDrcRevision ?? undefined)` | 200 → `ready`; 422 with any capability/integrity blocker → `capability-blocked`; 422 DRC_NOT_RUN/STALE → `drc-running` if `autoDrcRuns < 2`, else `drc-stale`; 422 DRC_INCOMPLETE / DRC_SUPPRESSED / DRC_ERRORS → `drc-blocked`; 409 → `checking` with `expectedRevision` cleared (max 1 retry per entry, else `revision-changed`); 404 / network / other → `error` |
| `drc-running` | above | `api.runDrc(designId)` → report | ok → `lastDrcRevision = report.revision`, `autoDrcRuns++`, → `checking`; reject → `drc-failed` |
| `drc-stale` | `checking` after 2 auto DRC runs still STALE | none; copy "The design changed while it was being checked ({reason}). Re-check when you have finished editing." | Re-check → `checking` with `autoDrcRuns = 0` |
| `capability-blocked` | — | none (DRC is NOT run, options hidden); blockers panel | Show on board (closes); Re-check → `checking` |
| `drc-blocked` | — | none; DRC panel shows the blocking code's copy (errors list / incomplete checks / suppressed classes) | "Open DRC panel" (`useDrcStore.getState().setPanelOpen?.(true)` / `togglePanel`, closes dialog); Re-check → `checking` |
| `drc-failed` | — | none; copy "Design rule check could not run: {message}. Export is unavailable until DRC completes." | Retry → `drc-running` |
| `revision-changed` | `checking` 409 twice in one entry | none; copy "The design changed during export. Re-check to export the current revision." | Re-check → `checking` |
| `error` | `checking`/`publishing` unexpected failure | none; copy "Export check failed: {message}" (ProblemError detail when present) | Retry → `checking` |
| `ready` | — | renders options (kit `Checkbox` ×2), files list, warnings (incl. disabled board pours, pad-less footprints), DRC chip: green "DRC passed at revision R" when `errors === 0` (incomplete/suppressed cannot reach `ready` under the Q1/Q2 defaults); evidence line "{waived} waived · ignored: {classes} · overrides: {codes}" when any | Export → `publishing` (Export disabled while `!settled`) |
| `publishing` | Export | native: `publisher.publish({designId, expectedRevision: summary.revision, includeBom, includePickAndPlace})`; browser: `downloadGerberZip(... expectedRevision: summary.revision)` + blob anchor | saved → `saved`; cancelled → `ready` (notice "Export cancelled — nothing was written"); problem → same mapping as `checking`; `busy` → stay, notice "An export is already running"; write/verify/integrity failure → `publish-failed`; `unavailable` → `error` |
| `publish-failed` | — | copy "Saving failed: {message}. Nothing was replaced; the previous file is unchanged." | Retry → `checking` (re-validates before re-publishing) |
| `saved` | — | "Saved {fileName} ({bytes}) · SHA-256 {first 12}" | Close |

There is NO checkbox, button, or code path that exports while DRC is not passing. `ExportBlockersPanel` lists each blocker: message, count, and a "Show on board" button when `targets` has ids; for `EXPORT_UNSUPPORTED_LAYER_COUNT` it shows "{n} layers (max 4)"; for via spans the span list. Integrity blockers show "Internal export check failed — please report this" + details collapsed.

Show on board: new dialog prop `onShowOnBoard(targets: ManufacturingBlockerTargets): void`. `PcbCanvas` implements: `setSelection({...emptyPcbSelection(), placementIds, traceIds, viaIds, zoneIds: <polygon zones only>, freePadIds, freeHoleIds})` (Sets; board zones are never put into the selection — contract 03 §12.3 — a `board:<layer>` id or `targets.layer` only makes that layer visible and active), compute the bbox centre of the referenced entities from `workspace.projection` (placement `positionMm`, via `centerMm`, trace points nm/1e6, free pad / free hole `centerMm`, polygon zone ring vertices; board-only targets → board outline centre), `useDrcStore.getState().requestCenter(centre)`, and if `targets.layer` make it visible; then close the dialog.

Port the dialog chrome to kit `Dialog/DialogContent/DialogHeader/DialogFooter/Button` (focus trap, escape) — drop the hand-rolled overlay and `useEscapeLayer` if the kit dialog owns escape (verify against `dialog-escape.test.ts`).

Native publication contract `src/core/contracts/app/manufacturing-publisher.ts`:
```ts
export interface ManufacturingPublishRequest {
  designId: string; expectedRevision: number; includeBom: boolean; includePickAndPlace: boolean;
}
export interface ManufacturingPublishProblem {
  type: string; title: string; status: number; detail?: string; code?: string;
  blockers?: unknown[]; revision?: number; expectedRevision?: number;
}
export type ManufacturingPublishResult =
  | { ok: true; status: "saved"; filePath: string; fileName: string; bytes: number; sha256: string; revision: number }
  | { ok: true; status: "cancelled" }
  | { ok: false; error:
      | { kind: "problem"; problem: ManufacturingPublishProblem }
      | { kind: "busy" | "unavailable" | "invalid-request" | "integrity" | "write-failed" | "verify-failed"; message: string } };
export interface ManufacturingPublisher { publish(request: ManufacturingPublishRequest): Promise<ManufacturingPublishResult> }
/** The one electron→designer coupling, as a contract (finding 29). */
export function manufacturingExportZipPath(designId: string): string; // `/api/modules/designer/designs/${encodeURIComponent(designId)}/exports/gerber?format=zip`
```
Preload: `electronAPI.manufacturingPublisher = { publish: (r) => ipcRenderer.invoke("manufacturing:publish", r) } satisfies ManufacturingPublisher`. `vite-env.d.ts` `ElectronAPI.manufacturingPublisher?: ManufacturingPublisher`. Module detection `export/native-manufacturing-publisher.ts` mirrors `nativeDraftJournal()`.

Electron main `electron/src/main/manufacturing-publish-ipc.ts`:
```ts
export interface ManufacturingPublishDeps {
  trust: CredentialTrust;
  backendUrl(): string | null;                         // getBackendPayload()?.url
  fetch: typeof fetch;
  showSaveDialog(defaultPath: string): Promise<{ canceled: boolean; filePath?: string }>;
  defaultDirectory(): string;                          // last used dir (memory) ?? app.getPath("downloads")
  rememberDirectory(dir: string): void;
  publish: typeof publishFileAtomically;
}
export async function handleManufacturingPublish(event: CredentialSender, args: unknown[], deps): Promise<ManufacturingPublishResult>;
export function registerManufacturingPublishIpc(ipc: CredentialIpcRegistrar, deps): void; // channel "manufacturing:publish"
```
Handler (never throws to the renderer; every path returns a result):
1. `requireTrustedCredentialSender(event, deps.trust)` else `{ok:false, invalid-request}`; `args.length === 1`; object with EXACT keys `designId,expectedRevision,includeBom,includePickAndPlace`; `designId` matches `/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/`; `expectedRevision` safe integer ≥ 0; booleans.
2. Single-flight: an in-flight publish → `{kind:"busy"}`.
3. `backendUrl()` null → `unavailable`. `POST ${url}${manufacturingExportZipPath(designId)}` (core contract, §3.1) JSON body `{expectedRevision, includeBom, includePickAndPlace}`, `signal: AbortSignal.timeout(120_000)`.
4. Non-2xx: `application/problem+json` → `{kind:"problem", problem: pick(type,title,status,detail,code,blockers,revision,expectedRevision)}`; otherwise `unavailable`. **No dialog is shown and nothing is written for a refused export.**
5. Read bytes (cap 256 MiB → `integrity`); sha256 hex must equal `X-OpenPCB-Bundle-Sha256` (else `integrity`). `bundleName` = header if `/^[A-Za-z0-9_-]{1,80}$/` else `"openpcb-export"`; `revision` = header int.
6. `showSaveDialog(join(defaultDirectory(), bundleName + ".zip"))` with options `{title:"Save manufacturing files", filters:[{name:"ZIP archive", extensions:["zip"]}], properties:["createDirectory","showOverwriteConfirmation"]}` (parented to the main window in `index.ts`). Canceled / no path → `{ok:true, status:"cancelled"}`.
7. Append `.zip` when the chosen name has no `.zip` extension (case-insensitive). `await deps.publish(target, bytes, sha)`; `rememberDirectory(dirname(target))`; return saved.

`electron/src/main/atomic-file-publish.ts`:
```ts
export class PublishError extends Error { constructor(readonly code: "TARGET_INVALID" | "WRITE_FAILED" | "VERIFY_FAILED", message: string) }
export async function publishFileAtomically(
  targetPath: string, bytes: Uint8Array, expectedSha256: string,
  io: PublishIo = defaultIo,           // fs/promises subset: lstat, open, rename, unlink, readFile
): Promise<{ bytes: number; sha256: string }>;
```
Algorithm: target must be absolute; `lstat(dirname)` is a directory; if target exists it must be a regular file (directory or symlink → `TARGET_INVALID`). `tmp = join(dir, "." + basename + "." + randomUUID() + ".partial")`; `open(tmp, O_WRONLY|O_CREAT|O_EXCL, 0o644)`; write all bytes; `handle.sync()`; close; re-read tmp and sha256 → must equal `expectedSha256` (else `VERIFY_FAILED`); `rename(tmp, target)`; then best-effort directory fsync (skip on `win32`). Any failure before/at rename → `unlink(tmp)` (ignore ENOENT) and throw; the previous target is untouched because rename is the only mutation of `target`. Map to result kinds `write-failed` / `verify-failed` / `invalid-request` in the IPC handler with a message that states the previous file is unchanged.

Browser fallback (dev in a plain browser, Playwright chromium): blob download named `${bundleName}.zip` from the response header; no atomicity claim (browser owns the download).

### 3.13 Independent test oracle (S7 / S7b)

`helpers/gerber-parse.ts` (additive, existing tests keep passing):
- `ParsedGerber` += `fileAttributes: Map<string, string>` (`%TF.<name>,<value>*%`), `format: {x:[int,dec], y:[int,dec], zeroOmission:"L"|"T"} | null` from `%FSLAX46Y46*%`, `units: "mm" | "in" | null` from `%MOMM*%`/`%MOIN*%`; strict mode throws when `format`/`units` are missing before the first coordinate; coordinates are scaled by the PARSED format (KiCad may emit `%FSLAX46Y46*%` or another precision), so `COORD_SCALE` is no longer assumed.
- Aperture macros (finding 12a), written from the Gerber spec §4.5: `$n` parameters from the `%ADD` modifiers, variable definitions `$n=<expr>`, arithmetic `+ - x /` with parentheses and unary minus, primitives 1 (circle), 4 (outline), 5 (polygon), 20 (vector line), 21 (center line), each with its rotation about the macro origin, exposure 1 and 0 (0 = clear within the flash), comment primitive 0. Anything else still throws. Unit tests include KiCad's literal `%AMRoundRect*…%` definition (from KiCad source, quoted in the test with its provenance) instantiated at 0°/30°/90°.
- Object attributes: track `%TO.N,<name>*%`, `%TO.P,…*%`, `%TD*%`; attach `net?: string` and `pin?: {ref, pad}` to each flash / stroke / region.
- `ordered: Array<{ kind: "flash" | "stroke" | "region"; index: number; polarity: "dark" | "clear" }>` in emission order (flashes/strokes polarity = current `%LP`).
- `export function isDarkAt(parsed, p: {x,y}): boolean` — replays `ordered` (painter's model; flash membership via `insidePrimitives` incl. macro exposure, region via even-odd point-in-polygon, stroke via distance-to-polyline ≤ width/2).

`helpers/excellon-parse.ts` (new, written from the Excellon spec, NOT from the writer):
```ts
export interface ParsedExcellon {
  units: "mm" | "inch"; format: "decimal" | { int: number; dec: number; zeros: "LZ" | "TZ" };
  fileFunction: string | null;            // from "; #@! TF.FileFunction,…*" (KiCad style)
  tools: Map<number, { diameter: number }>;
  hits: Array<{ tool: number; x: number; y: number }>;
  slots: Array<{ tool: number; x1: number; y1: number; x2: number; y2: number }>; // G85 (KiCad --excellon-oval-format alternate)
}
export function parseExcellon(text: string): ParsedExcellon;  // throws on: coordinate before units, unknown tool, body before '%'/M95 header end, missing M30, G00/G01 route mode (unsupported)
```
Accept both `METRIC` (with optional `,LZ|,TZ`) and `INCH` headers, `FMAT,2`, `T<n>C<d>`, `G90`, `G05`, `X…Y…` with explicit decimals or format-scaled integers (KiCad emits decimals with `METRIC`), `X…Y…G85X…Y…` slots, `T0`, `M30`.

Hand-authored fixtures `src/core/backend/tests/fixtures/manufacturing/`:
Each case = `<case>.projection.ts` (builds a `DesignerPcbProjection` from explicit numbers; synthetic footprints with explicitly dimensioned pads — fixture inputs, not EDA constants; reuse `drc-fixtures.ts` builders where they exist) + `<case>.expected.ts` (hand-derived expectations with a comment showing the arithmetic; NEVER generated by running the exporter or calling the kernel/transform helpers). Pads that need `drillOffsetMm` / `plated` / `drillSlotMm` are built structurally as `FootprintRenderSourcePad & FootprintPadDrillFields` object literals (finding 32): those fields are not in the pinned `@openpcb/rendering-core` type and are read through `padDrillFields` (`pcb-drills.ts:92-99`), so no re-pin is needed for S7. Frame for all expectations: OpenPCB world, Y-up, Gerber/Excellon coordinate = world mm (the writer emits world coordinates without a flip — `xyOperand(record.center.x, record.center.y)`).

| case | content | expected (asserted) |
|---|---|---|
| `2l-basic` | 2L, 50×30 mm rect outline at origin; 2 SMD parts (2 rect pads 1.0×1.2 mm at ±1.5 mm, one rotated 90°); 1 THT part (2 round pads Ø1.7 mm, drill 1.0 mm, pitch 2.54 mm); trace 0.25 mm on F.Cu net SIG; via Ø0.6/0.3 mm net SIG; NPTH free hole Ø3.2 mm | layer manifest = 11 Gerbers + PTH + NPTH + gbrjob (+BOM/PnP); copper FileFunctions `Copper,L1,Top,Signal`/`Copper,L2,Bot,Signal`; `units mm`, `FSLAX46Y46`; per-layer flash centres (±1 nm) and aperture sizes; `%TO.N` per flash/stroke; PTH tools {0.3:[via], 1.0:[2 pads]} with hit coords; NPTH {3.2:[hole]}; Excellon units mm; gbrjob LayerNumber 2, Size 50×30 |
| `4l-inner-planes` | 4L; board zones In1.Cu = GND (solid), In2.Cu = +3V3 (solid); through via on GND; THT pad on +3V3; explicit `designRules.clearance.copperToBoardEdgeMm` | In1/In2 files exist with `Copper,L2,Inr,Signal`/`Copper,L3,Inr,Signal`, B.Cu `Copper,L4,Bot,Signal`; `isDarkAt(In1, viaCentre+ (annular radius+ε))` true (same-net, no antipad); `isDarkAt(In1, padCentre + pad radius + clearance/2)` false (different-net antipad); points inside outline by < edge clearance are clear; In1 `%TO.N,GND` on regions |
| `thermal-pour` | 2L; F.Cu polygon zone GND `padConnection:"thermal"`, `thermal:{gapMm:0.5, spokeWidthMm:0.5}`; one THT GND pad Ø1.7 mm at (25,15) | sample at radius r = padR + gap/2 on 0°/90°/180°/270° → dark (spokes); on 45°/135°/225°/315° → clear (gap); spoke count = 4. Variant `thermal-pour+solid-board`: add an F.Cu GND board zone `solid` → `prepare` refuses with `EXPORT_POUR_CONNECTION_CONFLICT` naming the pad and both zones; with the board zone inheriting `{thermal, gap 0.5, spoke 0.5}` → export passes and the 45° samples stay clear |
| `npth-slots` | free round hole Ø3.2, free oblong hole 1.0×2.5 @30°, footprint plated oblong slot 0.8×1.6 @0°, footprint pad with `drillOffsetMm (0.2,0)` | NPTH: round hit + G85 slot whose endpoints = centre ± ((L−W)/2)(cos,sin); PTH: G85 plated slot; offset hit at pad centre + R·offset; copper flash at pad centre. This is the NATIVE convention (copper at `centerMm`, hole at `centerMm + R·drillOffsetMm`), stated in contract 17 §drills. It is the opposite of KiCad's (`at` = hole, copper at `at + offset`) — see the H13/H14 note in §8; until the importer converts, the KiCad oracle marks offset-drill pads as a known divergence |
| `bside-rotated` (finding 11) | 2L, outline = 40×30 rect with 2 mm corner arcs (arc outline) and one chamfered corner; part U1 on **B.Cu (mirrored)** at (12, 9) rotation **30°** with three ASYMMETRIC SMD pads: pad 1 rect 0.6×1.4 at local (−1.9, 0.0) rot 0°, pad 2 **roundrect** 0.6×1.0 ratio 0.25 at local (0.0, 1.2) rot 0°, pad 3 rect 0.5×0.9 at local (1.9, −0.4) **rot 15°**; part J1 on B.Cu (mirrored) at (30, 20) rotation **45°**, one THT **rect** pad 2.0×1.4 drill 1.0 at local (1.27, 0), net GND; B.Cu polygon zone GND `thermal {gap 0.4, spoke 0.5}` covering J1 | per pad: world centre, aperture kind (rect pads at non-axis angles → macro or rotated aperture, roundrect → macro) and rotation, derived by hand from contract 16 / `pcb-layout` §Back-side mirroring (local → mirror X → rotate by placement angle; mirrored pad angle = placement − pad, as `pcb-drills.ts:183-185`), arithmetic shown; flashes on B.Cu only, none on F.Cu; B.Mask/B.Paste openings at the same centres; J1 drill hit at its world centre in PTH; thermal spokes of J1 along the pad's LOCAL axes mapped to world (mirrored, `180 − angle` per `copper-fill-geometry.ts:398`): samples at `r = half-extent + gap/2` along the four mapped axes dark, along the four diagonals clear; Edge.Cuts contains the arcs as `G02/G03` (or flattened within the writer's documented chord tolerance — the expected file states which and the tolerance) |

`manufacturing-fixtures.test.ts` drives each case through `buildExportBundle` (pure, geometry) and, for the pour-conflict variant, through `prepareManufacturingExport` with fake deps. ONE HTTP case (2l-basic minimal, seeded through SDK commands, DRC run) lives in S6b's `manufacturing-export-gate.test.ts` for the manifest/sha headers. Completeness C1–C7 also runs on every fixture bundle.

S7b oracle harness (finding 12; reads references from H14's tree as H13 asked — `src/core/backend/tests/fixtures/kicad/<case>/kicad-ref/` — no third fixture tree):
- `scripts/kicad-reference/generate.ts <project.kicad_pcb> <outDir>` runs `${OPENPCB_KICAD_CLI ?? "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"}` with PINNED flags (KiCad 8/9 names; the script fails loudly if the CLI rejects one and records `kicad-cli --version` in `<outDir>/kicad-cli-version.txt`):
  - `pcb export gerbers --output <outDir>/gerber --layers F.Cu,In1.Cu,In2.Cu,B.Cu,F.Mask,B.Mask,F.Paste,B.Paste,F.Silkscreen,B.Silkscreen,Edge.Cuts --precision 6 --no-protel-ext` (X2 and netlist attributes ON; aperture macros ON; NO `--use-drill-file-origin`; inner layers only listed when the board has them).
  - `pcb export drill --output <outDir>/drill/ --format excellon --excellon-units mm --excellon-zeros-format decimal --excellon-oval-format alternate --excellon-separate-th --drill-origin absolute` (G85 slots; no map).
  - `pcb export pos --output <outDir>/pos.csv --format csv --units mm --side both` (NO drill-file origin) — the H14 `.pos` oracle.
- Frame registration (finding 12b): DECLARED, never fitted. KiCad plots with `(x, −y)` from its Y-down board frame, absolute origin. The comparison map is `kicadPlot⁻¹ ∘ H13 KicadBoardFrame` taken from contract 16's exported constant; with H13 as designed (canonical = `(x, −y)`, no origin shift, H13 row G) it is the identity on emitted coordinates. The harness imports that constant; it never estimates an offset/rotation from the data, so an H13 transform error shows up as a coordinate mismatch.
- `src/core/backend/tests/kicad-reference-parity.test.ts`: for each case with `kicad-ref/` AND an importable project, import via the project importer, export, parse both sides with the same parsers and compare: pad flash centres (1 µm), aperture sizes and kinds (macro vs standard normalised to the same outline), drill hits and slots by plating, layer FileFunction set, `.pos` X/Y for both sides and rotation for top-side parts (bottom-side rotation conventions belong to H23 and are reported, not asserted). Known divergences are an explicit allow-list file per case (`divergences.json`, each entry citing its owning item, e.g. offset-drill pads → H13/H14 importer); an unlisted difference fails. When no reference dir exists → `test.skip("kicad-cli references not generated")`.
- Meaningful only after the first `@openpcb/kicad-import` tag containing H13 SH1 (`kicadPointToCanonical`, Y negation) is pinned in OpenPCB, and after H14 wires the project importer through `KicadBoardFrame` (H13 OP9). S7b lands the harness skip-safe before that; H13 OP11 / H14 S13 own the fixture projects and the first generated references.

---

## 4. Task breakdown (commit-sized)

Tiers: standard / careful / critical. "‖" = can run in parallel (no file overlap). External prerequisites: **OPENPCB-103 S5** (coordinator `isSettled` / `dispatchOnce`, `api.ts` error classification) before S4 and S8a/S8b; H13/H15 hooks plug into S6b's `ExportLibraryHooks` whenever they land (slots stay undefined until then).

| Slice | Content | Files | ~Lines | Tests | Tier | Depends |
|---|---|---|---|---|---|---|
| **S1** | T-205 remove microvia preset + "Phase C" copy | `backend/pcb/via-presets.ts`, `sdks/designer/types.ts` (comment only) | 20 | new `core/backend/tests/via-presets.test.ts`: no id/name/description matches `/micro/i` or `/phase/i`; all presets `drillMm < diameterMm` | standard | — ‖ S3,S5 |
| **S2** | T-152 remove `includeInnerLayers` (incl. MCP tool schema + dangling resource sentence) | `sdks/designer/types.ts`, `export/index.ts`, `routes.ts`, `frontend/api.ts` (2 lines; serialise with 103-S5), `PcbExportDialog.tsx`, `assistant/backend/tools/read-tools.ts`, `tests/fixtures/assistant-parity/catalog.current.json`, `tests/designer-capability-quarantine.test.ts`, `tests/designer-export.test.ts` | 60 | builder: 4L bundle with `{includeInnerLayers:false} as never` still has In1/In2; parseExportOptions ignores it; MCP tool schema has no `includeInnerLayers` and an input carrying it still succeeds; description has no `openpcb://design/{id}/export/gerber`; parity catalog test green | standard | after S1 (types.ts) |
| **S3** | One physical pour: `projection-pours.ts` (full `PcbBoardSettings`, required keepouts/nets); all six fill sites via `pourBaseParams`/`buildProjectionPours`; canvas `useProjectionPours`; render-only `CopperFillLayer`; delete via separator ring; export `resolvePadConnection` + `resolveThermalConfig` | `shared/rendering/copper-fill/projection-pours.ts` (new), `shared/rendering/copper-fill/copper-fill-geometry.ts` (exports only), `export/gerber/writer.ts`, `shared/drc/drc-context.ts`, `shared/pcb-connectivity/board-connectivity.ts`, `backend/command-executor.ts` (fill block only), `backend/pcb/board-snapshot-pours.ts`, `frontend/three-d/primitives/CopperPour.tsx`, `frontend/pcb/PcbScene.tsx`, `frontend/pcb/layers/CopperFillLayer.tsx`, `frontend/pcb/layers/ViaLayer.tsx`, `frontend/pcb/layers/use-projection-pours.ts` (new) | 300 | Bun `core/backend/tests/pour-consumer-parity.test.ts` — ORACLE assertions are hand-derived `isDarkAt` points on the parsed Gerber (finding 20): (a) "unassigned via joined to a GND pad by a B.Cu trace inside an F.Cu GND board zone": `isDarkAt(F_Cu, viaCentre ± (viaR+0.05))` true; (b) net-class clearance fixture: a different-net pad of a net class with clearance 0.4 (board 0.2) → `isDarkAt` at 0.3 from its edge is CLEAR (proves the full board/net-class resolver reaches every consumer; fails if a `Pick`/cast drops net classes); (c) grep gate (§3.8). Regression guards, labelled as such (not oracles): DRC-context and snapshot pour islands deep-equal `buildProjectionPours`. Vitest `use-projection-pours.test.ts`: (b)'s fixture renders a gap at the same point; `ViaLayer` renders no separator mesh. All DRC golden / determinism tests unchanged | careful | — ‖ S1,S5 |
| **S3b** | Pour connection conflicts (shared, pure) | `shared/pcb-areas/pour-connection-conflicts.ts` (new), `core/backend/tests/pour-connection-conflicts.test.ts` (new) | 220 | table: solid board + thermal polygon same net over a THT pad → 1 conflict; same with board inheriting thermal+same gap/spoke → 0; thermal gap 0.4 vs 0.5 → conflict; `thruHoleThermal` vs `thermal` on an SMD pad → conflict (none vs thermal), on a THT pad → 0; pad outside the polygon → 0; different nets → 0; disabled zone ignored; deterministic order | careful | S3 (exports) |
| **S4** | T-140 visibility-only droplet, Add-board-pour dialog (inherits padConnection+thermal, `dispatchOnce`), Board-pour switch, inline conflict warning, contract 03 amendment | `frontend/pcb/PcbLayersPanel.tsx`, `pcb-view-store.ts`, `PcbCanvas.tsx` (handlers ~6600-6650 only), `PcbScene.tsx` (filter only), `tools/board-zone-controls.ts` (+spec), `frontend/pcb/AddBoardPourDialog.tsx` (new), `docs/pcb-hardening/03-zone-keepout-contract.md`, `src/modules/designer/AGENTS.md` | 320 | Vitest: droplet has aria-label/aria-pressed and dispatches NO command (spy on dispatcher); `boardPourConnectionDefault` table (0/1/2 distinct, thermal params inherited, differing thermal = distinct, name-vs-id match, disabled zones ignored); dialog disables Create on conflict; double-click Create → exactly one `pcb_add_zone` (via `dispatchOnce`) carrying the chosen `padConnection` and `thermal`; switch dispatches `pcb_update_zone {enabled}`; inline warning appears when the projection gains a conflicting zone without any panel interaction; view-store resets hidden set on design change | careful | S3, S3b, 103-S5 |
| **S5** | DRC provenance stamp | `migrations/0021_drc_result_provenance.sql` (new), `schema.ts`, `drc-results.ts`, `drc/run-digest.ts` (new), `drc/run-service.ts`, `pcb/raw-footprint-lookup.ts` (`digestRawFootprintEntries`), `pcb/board-content-digest.ts` (code-unit sort), `shared/drc/engine-version.ts` (new), `store.ts` (saveDrcResult passthrough only) | 200 | Bun `designer-drc-provenance.test.ts`: migration applies on a DB with a legacy row (provenance null → gate STALE legacy-result); a run persists a stamp whose digests equal `computeBoardContentDigest`/`computeDrcOptionsDigest`/`digestRawFootprintEntries` of what the worker received; simulated old-binary upsert (write counts + `ran_at` without touching `provenance_json`) → evidence `provenance:null`; library row change after DRC → digest differs; run join key: same revision+options but different content digest → a new run, not a join; `getDrcGateEvidence` counts waived/unchecked/ignored/overrides; corrupt JSON → null; digest sort test (`"a"`,`"B"`,`"_x"`); engine-table snapshot fixture; existing `drc-run-service` tests green | critical | — ‖ S1,S3 |
| **S6a** | Types, capability blockers (incl. unsupported-copper pre-check, pour conflicts, dedupe), completeness over emitted text, preflight cleanup | `sdks/designer/types.ts`, `sdks/designer/index.ts`, `export/blockers.ts` (new), `export/completeness.ts` (new), `export/preflight.ts`, `export/gerber/writer.ts` (extract ctx-free `padApertureShape` only), `tests/designer-export.test.ts` | 480 | Bun `manufacturing-blockers.test.ts`: one test per §3.3 row (predicate + message + targets); `no-pads` part WITH pins blocks, pad-less logo part without pins passes with a warning, `virtual` passes; dedupe (a stale-net zone reported once, by zone-not-poured; an H08-orphaned trace reported once); disabled board zone → warning not blocker; empty vs holes-only vs pour-only board; deterministic order. `manufacturing-completeness.test.ts`: healthy 2L/4L pass; each C1–C7 violation injected by editing the EMITTED TEXT of a built bundle (drop In2, wrong FileFunction header, remove one `%TO.P` flash, remove one Excellon hit line, extra gbrjob path, revision mismatch, missing NPTH) yields the exact check id | critical | S2, S3, S3b |
| **S6b** | Snapshot, library pre-read, DRC gate, manifest, prepare + cache, deterministic ZIP, routes/SDK/assistant wiring, CORS, body 400, capture only on delivered bundles, update ungated-export tests | `store.ts` (`readExportSnapshot`), `export/library-inputs.ts` (new), `export/drc-gate.ts` (new), `export/manifest.ts` (new), `export/prepare.ts` (new), `export/prepared-cache.ts` (new), `export/zip.ts`, `routes.ts` (gerber + pnp routes, body parse), `sdk.ts`, `module.backend.ts` (wire `ExportLibraryHooks` registry, empty), `core/backend/http/cors.ts` (expose list), `src/core/contracts/app/manufacturing-publisher.ts` (path fn only; S9a adds the rest), `assistant/backend/tools/read-tools.ts` (description), `catalog.current.json`, `electron/src/main/backend-server.ts` (1 line `OPENPCB_APP_VERSION`), `tests/designer-export-naming.test.ts`, `tests/designer-capture-outcomes.test.ts`, generated SDK stubs (`npm run gen`) | 620 | Bun `manufacturing-export-gate.test.ts` (HTTP via `bootDesignerRuntime` + SDK): no DRC → 422 `EXPORT_DRC_NOT_RUN`; DRC run on a clean seeded board → summary 200 with `revision`, `drc`; edit after DRC → 422 STALE `revision`; DRC errors → 422 `EXPORT_DRC_ERRORS`; `*_UNCHECKED` → `EXPORT_DRC_INCOMPLETE`; ignored `clearance` class / severity override to ignore on an error code → `EXPORT_DRC_SUPPRESSED`, ignored `dfm` class → passes with the class in `drc.ignoredRuleClasses`; engine version / app version change → STALE `engine-changed`; body `{allowDrcViolations:true, qualification:"override", ackDrc:true}` changes nothing; unparsable body → 400; `expectedRevision` mismatch → 409; 4L/blind-via fixtures → 422 capability blockers with `evaluateDrcGate` never called and `runDrc` never called (spies; the snapshot still reads the row — finding 17) and still `>4` refusal; unsupported pad shape → capability blocker before DRC; pour union failure `{netId,layer}` → blocker with `targets.layer`; zip: sha header == sha256(body), manifest member present with per-file sha256 matching unzip (Bun ZIP reader as in `designer-export.test.ts:2037`); `Access-Control-Expose-Headers` contains Sha256 + Revision; summary then zip with same options → ONE bundle build (spy) and identical member bytes; prepare-level determinism: two `prepareManufacturingExport` calls with fixed `env.createdAt` and fake deps → byte-identical ZIP; pnp.csv gated identically; quarantine flag on → 422 `UNQUALIFIED_MANUFACTURING` before any snapshot read (existing test stays green); assistant tool returns `ok:false` with the blocked message; `capture.onExport` NOT called for `summary` or for a 422, called once for `zip`/`json`. Updated: `designer-export-naming.test.ts` — BOM routes keep 200 + names; `pnp.csv` and `?format=summary` on the empty design assert 422 `export-blocked` with `EXPORT_EMPTY_BOARD`; bundle naming asserted on the seeded passing board. `designer-capture-outcomes.test.ts:214,270,316` — before each export: run DRC, waive remaining non-safety violations by id, re-run DRC, then POST (format json); if the fixture board has a safety-critical violation, instead seed it clean; outcome assertions unchanged | critical | S5, S6a |
| **S7** | Parsers (incl. macros) + 5 hand-authored fixtures | `tests/helpers/gerber-parse.ts`, `tests/helpers/excellon-parse.ts` (new), `tests/fixtures/manufacturing/*` (new), `tests/manufacturing-fixtures.test.ts` (new) | 900 | itself + parser unit tests (`excellon-parse.test.ts`: METRIC/INCH, LZ/TZ ints, decimals, G85, error cases; `gerber-macro.test.ts`: KiCad RoundRect at 0/30/90°, `$n` arithmetic, primitives 4/5/20 + rotation, exposure 0); all existing gerber-*-parity tests green | careful | S2, S3, S3b, S6b (prepare for the conflict variant) |
| **S7b** | kicad-cli oracle harness (skip-when-absent, declared frame, pinned flags, `.pos`) | `scripts/kicad-reference/generate.ts` (new), `tests/kicad-reference-parity.test.ts` (new), `tests/fixtures/kicad/README-kicad-ref.md` (H14 tree) | 260 | skips cleanly with no references; a synthetic reference dir (hand-written tiny Gerber/Excellon/pos) exercises compare + divergence allow-list; frame map comes from contract 16 constant (skip-with-reason if H13 OP1 has not landed) | standard | S7 |
| **S8a** | `ProblemError`, api export/BOM functions, T-164 frontend naming, BOM view prop | `frontend/api.ts`, `frontend/components/DesignerBomView.tsx`, `frontend/Space.tsx` (prop pass), `frontend/api.test.ts` (new or existing) | 130 | Vitest: problem+json → `ProblemError` with code/blockers; plain error unchanged; zip name from header, fallback; BOM file names equal `bomExportFileName(exportBundleName(id,name),kind)` for all 5 kinds (and differ from old `-csv.csv`) | careful | S6b, 103-S5 |
| **S8b** | Dialog rewrite: machine (all states incl. waiting-for-edits), kit Dialog/Checkbox, blockers panel, DRC panel, Show-on-board, no override | `frontend/pcb/PcbExportDialog.tsx`, `frontend/pcb/export/{export-dialog-machine.ts,ExportBlockersPanel.tsx,ExportDrcPanel.tsx}` (new), `PcbCanvas.tsx` (dialog props ~6289 + `onShowOnBoard`), `PcbExportDialog.test.tsx`, `capability-quarantine.fixture.tsx` | 480 | Vitest: reducer table — every row and every exit in §3.12, retry caps, `settled=false` from each state; capability-blocked renders panel, never calls `runDrc`, hides options; drc-blocked renders no enabled export control and no "anyway" text anywhere (`queryByText(/anyway|ignore DRC/i)` null); drc-failed never green; checkboxes are kit `Checkbox`; Show-on-board passes targets and the canvas handler never selects a `board:` zone id; Export disabled while not settled; quarantine stub tests unchanged | careful | S8a, S2, 103-S5 |
| **S9a** | Electron atomic publisher + IPC handler + preload/contract | `src/core/contracts/app/manufacturing-publisher.ts`, `electron/src/main/atomic-file-publish.ts` (new), `electron/src/main/manufacturing-publish-ipc.ts` (new), `electron/src/main/index.ts` (register + dialog binding), `electron/src/preload/index.ts`, `src/core/frontend/src/vite-env.d.ts` | 330 | Bun `electron/tests/atomic-file-publish.test.ts` (real tmp dirs): new file written + sha; overwrite replaces atomically; injected write failure / verify mismatch / rename failure → previous file byte-identical, no `.partial` left; target is dir/symlink → TARGET_INVALID. `electron/tests/manufacturing-publish-ipc.test.ts` (fakes): untrusted sender/extra keys/bad id → invalid-request, fetch never called; fetch URL == `manufacturingExportZipPath(id)`; 422 → problem result and showSaveDialog never called; sha header mismatch → integrity, dialog never called; cancel → cancelled and publish never called; busy single-flight; success passes header-validated name; `.zip` appended | critical | S6b (headers) ‖ S8a/S8b |
| **S9b** | Renderer integration + Electron e2e | `frontend/pcb/export/native-manufacturing-publisher.ts` (new), `PcbExportDialog.tsx` (publish branch), `tests/e2e/electron-manufacturing-export.spec.ts` (new), `playwright.config.ts` (add spec name to `DESKTOP_ELECTRON_SPEC` and `ELECTRON_SPECS`) | 260 | e2e (see §7.3) | careful | S8b, S9a |
| **S10** | Docs | `src/modules/designer/backend/CAPABILITY-QUARANTINE.md`, `docs/pcb-hardening/17-manufacturing-output-contract.md` (new: gate incl. provenance stamp/incomplete/suppressed, blockers incl. pour-connection conflicts, completeness, manifest, publication, native drill-offset convention; 16 is reserved by H13), `docs/drc/OPEN_FINDINGS.md` (T-140/152/164/171/195/201/205 + S15-2 status), `src/modules/designer/AGENTS.md` export bullet, `electron/AGENTS.md` IPC table row | 220 | — | standard | S6b, S9a |

Parallel lanes: {S1 → S2}, {S3 → S3b → S4}, {S5} run concurrently (S4 also waits for 103-S5); then S6a → S6b; then {S7 → S7b}, {S8a → S8b}, {S9a} concurrently; then S9b; S10 last. File-overlap hot spots: `sdks/designer/types.ts` (S1,S2,S6a — serialise), `export/gerber/writer.ts` (S3,S6a — serialise), `PcbScene.tsx` (S3,S4), `PcbCanvas.tsx` (S4 handlers block vs S8b dialog block — serialise), `routes.ts` (S2 parser, S6b routes), `catalog.current.json` (S2,S6b), `frontend/api.ts` (S2, S8a vs OPENPCB-103 S5 — never concurrent), `copper-fill-geometry.ts` (S3 exports only).

---

## 5. Edge cases & failure modes

- View-state persistence (`pcb_set_view_state`, debounced 200 ms) bumps the revision after DRC → summary 422 STALE → dialog auto-reruns DRC (cap 2 runs per entry); then `drc-stale` with Re-check.
- Unsaved / ack-unknown edits (OPENPCB-103 lane not settled) → `waiting-for-edits`; nothing is checked or exported until the lane settles, so the exported revision always contains every acknowledged edit.
- Waivers bump the revision (view state) → DRC must re-run after waiving; dialog handles via STALE path.
- Legacy DRC rows (pre-0021, null stamp) → STALE, never green. A row last written by an older binary after a downgrade (stamp `ranAt` ≠ row `ran_at`) → STALE.
- App upgrade or `DRC_ENGINE_VERSION` bump → STALE `engine-changed`; the dialog auto-reruns DRC.
- Library footprint re-import between DRC and export (courtyards change) → raw-footprint digest mismatch → STALE `library-changed`. Library read error during export → the digest is computed over the same partial entry list DRC would build (DRC's documented preview-bounds fallback); H13/H15 classifiers treat an unreadable row as unverified → blocker.
- `*_UNCHECKED` > 0 → `EXPORT_DRC_INCOMPLETE` (Q2). Ignoring `clearance`/`connectivity`/`electrical`/`structural`, or downgrading an error-default code → `EXPORT_DRC_SUPPRESSED` (Q1).
- Lazy non-revisioned writes in `loadPcbProjection` (placement sync from schematic) between DRC and export → content digest mismatch → STALE.
- DRC worker failure / cancel / shutdown → `drc-failed`, export unavailable.
- Export of a design deleted mid-dialog → 404 → dialog error.
- A copper pour kernel failure → `EXPORT_COPPER_POUR_FAILED` (capability), canvas already draws nothing for a failed pour; DRC reports ZONE_EMPTY_FILL/pour codes.
- Board with only free holes (no copper) → NOT empty (holes are content); board with only a pour → not empty; nothing at all → `EXPORT_EMPTY_BOARD`.
- Pad with unsupported aperture shape, or copper on no stackup layer → `EXPORT_COPPER_INCOMPLETE` before DRC, never silently dropped.
- Same-net overlapping pours that resolve a pad's connection differently (incl. legacy rows, MCP edits, imports) → `EXPORT_POUR_CONNECTION_CONFLICT`; the layers panel shows the same conflict inline.
- Disabled board zones (possibly "hidden" under the old droplet) → exported without that plane, listed as warnings in dialog and manifest.
- Pad-less footprint on a part without pins (logo/art) → exported (no copper) with a warning; pad-less footprint on a part with pins → blocker; `virtual` mount → skipped silently (no copper by design).
- Same-net stale zone: reported once (zone-not-poured), never also as unresolved net.
- 4L board posted with `includeInnerLayers:false` by an old client/MCP → ignored, full stack exported.
- >4L or non-through via: capability blocked before DRC; builder throws still exist.
- Name with only non-ASCII → bundle `openpcb-<id>`; header validator in Electron accepts it (≤80 chars? `openpcb-` + 36-char uuid = 44 OK; ids up to 64 → 72 ≤ 80).
- Save dialog: user types name without `.zip` → appended; picks an existing file → OS overwrite confirmation, then atomic replace; picks a directory path / symlink → TARGET_INVALID, nothing changed; target dir read-only → open fails → write-failed, no tmp left; disk full mid-write → write-failed, tmp unlinked; process crash between write and rename → a stray `.<name>.<uuid>.partial` may remain (hidden dot-file); previous file intact. Document; no startup sweeper (the app does not own that directory).
- Windows: rename over a file open in another program fails (EPERM/EBUSY) → write-failed, previous intact; dir fsync skipped.
- Concurrent clicks → single-flight `busy`.
- Backend restarted (ephemeral port) between summary and publish → main re-reads `backendUrl()` per call.
- ZIP > 256 MiB → integrity refusal (practically unreachable).
- Clock: one `env.createdAt` from the backend clock per build; manifest/gbrjob/Gerber/zip consistent. A cached build reused for the zip keeps the summary's timestamp (the user downloads exactly what they previewed).
- Option toggles in the dialog are debounced 300 ms; each distinct option set costs one synchronous build on Electron main (pours); repeat requests hit the prepared cache.
- Unparsable JSON body → 400 (was silently `{}`).
- `expectedRevision` omitted by MCP/SDK → gate still pins DRC to the snapshot revision.
- BOM view PnP download now gated → toast shows the problem detail.

## 6. Migration / rollback & data safety

- Only schema change: one nullable `ALTER TABLE … ADD COLUMN provenance_json` on `designer_drc_results` (0021). Additive; old binaries select explicit Drizzle columns and ignore it. No data rewrite, no backup needed. Rollback = revert code; the column stays harmless, and if the newer binary returns later, rows written meanwhile by the old binary fail the stamp/row match → STALE (re-run DRC), never a false pass.
- `board-content-digest` sort change (code-unit): digests change once; only transient autolayout job digests consume them (in-flight jobs re-snapshot).
- No change to persisted zones/view state: hidden fill layers are session-only; contract 03 board-zone rows unchanged. Behaviour change for existing data (finding 10): a board zone the old droplet set `enabled=false` ("hidden") now means "no plane" and stays unpoured — it is surfaced as a warning in the layers panel row (switch off), the export dialog and the manifest, and recorded in the contract 03 amendment; no automatic re-enable (that would be a silent physical change).
- The export pipeline becomes stricter (DRC gate, blockers): no persisted data affected; worst case is a refused export with a typed reason.
- Release builds: `designer.outputQuarantine` remains ON → no user-visible change in packaged apps until the user lifts it (out of scope; requires H08/H13/H15/H16 + H51 qualification and sign-off). Do not edit `QUALIFICATION_BLOCKERS`.
- Native writes never touch a target except by `rename` of a fully written, fsynced, checksum-verified temp file in the same directory.
- No `../shared` change; no re-pin; OpenPCB keeps typechecking against pinned tags.

## 7. Verification

### 7.1 Per slice / final
```bash
cd /Users/andrejvysny/workspace/openpcb/OpenPCB
npm run typecheck && npx tsc -p electron/tsconfig.json --noEmit     # typecheck excludes electron/
npm run gen && npm run gen:check
bun test src/core/backend/tests/designer-export.test.ts src/core/backend/tests/designer-export-naming.test.ts \
  src/core/backend/tests/designer-capture-outcomes.test.ts \
  src/core/backend/tests/designer-capability-quarantine.test.ts src/core/backend/tests/assistant-export-refusal.test.ts \
  src/core/backend/tests/assistant-parity-catalog.test.ts src/core/backend/tests/via-presets.test.ts
bun test src/core/backend/tests/manufacturing-blockers.test.ts src/core/backend/tests/manufacturing-completeness.test.ts \
  src/core/backend/tests/manufacturing-export-gate.test.ts src/core/backend/tests/manufacturing-fixtures.test.ts \
  src/core/backend/tests/excellon-parse.test.ts src/core/backend/tests/kicad-reference-parity.test.ts \
  src/core/backend/tests/designer-drc-provenance.test.ts src/core/backend/tests/pour-consumer-parity.test.ts \
  src/core/backend/tests/pour-connection-conflicts.test.ts src/core/backend/tests/gerber-macro.test.ts
bun test src/core/backend/tests/gerber-pad-parity.test.ts src/core/backend/tests/gerber-silk-parity.test.ts \
  src/core/backend/tests/gerber-outline-parity.test.ts src/core/backend/tests/pcb-drills.test.ts
npm run test:backend                                                 # full Bun suite incl. DRC goldens/determinism
bun test electron/tests
npx vitest run src/modules/designer/frontend/pcb src/modules/designer/frontend/components   # via test:react workspace config if direct run fails: npm run test:react -- src/modules/designer/frontend/pcb
npm run test:drc-worker-smoke
```

### 7.2 E2E (browser, chromium) — extend or add `tests/e2e/pcb-export.spec.ts`
1. Open seeded 2L design → Export dialog → DRC auto-runs → "DRC passed at revision N" → Download → ZIP name `<slug>.zip`; unzip contains `<slug>-manifest.json` whose sha256s match members. (Cache reuse is asserted in S6b's Bun test, not here.)
2. Add a clearance violation → dialog shows DRC errors panel; no enabled export control; no "anyway" text.
3. 4L fixture with a blind via (seed via SDK/DB) → capability panel lists span; DRC request count = 0 (route intercept); Show on board selects the via.
4. Layers panel: droplet hides F.Cu fill (canvas screenshot / DOM state) and network log shows no `/commands` POST; Add board pour → dialog (double-click Create) → exactly one `pcb_add_zone`.
5. Thermal polygon zone on GND + Add board pour on the same layer with "solid" → inline conflict warning in the layers panel; Export dialog shows `EXPORT_POUR_CONNECTION_CONFLICT` with Show on board; switching the board pour to the inherited thermal setting clears both.
6. Throttle the `/commands` route (Playwright route delay) → make an edit → open Export immediately → dialog shows "Saving your latest edits…", no summary request until the command acks.

### 7.3 Electron e2e `tests/e2e/electron-manufacturing-export.spec.ts` (project `electron-desktop`, helpers from `electron-native-helpers.ts`)
- Stub `dialog.showSaveDialog` via `app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }) }, target)`.
- (a) success: file exists, size/sha equal to result, contains manifest member; (b) pre-create target with known bytes, stub `canceled: true` → bytes unchanged, no `.partial`; (c) pre-create target, make the design blocked (DRC error) → dialog shows blocker, `showSaveDialog` never invoked (counter in main), target unchanged; (d) pre-create target, chmod target dir 0555 (POSIX only) → error state "previous file is unchanged", bytes unchanged.

### 7.4 Manual (user, needs_user) — macOS packaged/dev Electron
Native save sheet appears parented to the window; Cancel leaves no file; overwrite prompts and replaces atomically; saved ZIP opens in Finder/Archive Utility and uploads to a fab viewer (e.g. JLCPCB Gerber viewer) showing all layers; light/dark dialog styling; VoiceOver reads droplet state.

## 8. Cross-item interfaces

| Item | H19 consumes | H19 provides |
|---|---|---|
| H08 OPENPCB-56 (net identity) | populates `ExportSnapshot.orphanedCopper` inside `readExportSnapshot` from its retired-id ledger (designer table, sync) | `EXPORT_ORPHANED_NET_COPPER` code + `orphanedCopperBlocker` slot with top dedupe precedence; today's `EXPORT_UNRESOLVED_COPPER_NET` (H08 may fold it into the orphan classification) |
| H13 OPENPCB-61 (KiCad frame) | `ExportSnapshot.frameImportStamp` (designer-side read, in the snapshot transaction) + an `ExportLibraryHooks.sourceFrame` PURE classifier over the snapshot projection and the pre-read library rows (§3.4.1) — H19 asks H13 to split `computeDesignFrameStatus` into that pure part plus its own upserting wrapper; `resolution` drives the blocker copy; contract 16's `KicadBoardFrame` constant for the oracle; the `@openpcb/kicad-import` tag containing SH1; owns KiCad fixture projects (in H14's `fixtures/kicad/<case>/` tree, which H19 now uses) | `EXPORT_AMBIGUOUS_SOURCE_FRAME` slot; `parseExcellon`, extended `parseGerber` (macros), `kicad-reference/generate.ts` (pinned flags incl. `pcb export pos`) + parity harness with declared frame map. **Note to H13/H14 (finding 13):** KiCad pad `at` is the HOLE position and copper sits at `at + offset`; OpenPCB's native convention is copper at `centerMm`, hole at `centerMm + R·drillOffsetMm` (`pcb-drills.ts:180-189`). The importer (`kicad-import/src/build-preview-models.ts:669-682`) currently copies `at`→`centerMm`, `offset`→`drillOffsetMm`; it should emit `centerMm = at + R·offset` and `drillOffsetMm = −offset` (R = pad rotation, in the canonical frame). Until then offset-drill pads are an allow-listed oracle divergence |
| H14 OPENPCB-62 (project import) | importer used by the oracle test; KiCad multi-layer/blind fixtures; the `fixtures/kicad/<case>/kicad-ref/` tree | same parsers/harness; blockers already refuse imported >4L/blind boards; offset-drill note above |
| H15 OPENPCB-63 (IPC presets) | an `ExportLibraryHooks.unqualifiedFootprints` PURE classifier (variant of `collectUnqualifiedPlacements` that takes the snapshot projection + pre-read rows instead of reading the library itself); H15's preflight order (quarantine → footprint qualification → DRC → build) is preserved: H15's check is a capability source, evaluated before the DRC gate | `EXPORT_UNQUALIFIED_FOOTPRINT` slot; H15's interim `assertPlacedFootprintsQualified` call sites are removed when S6b lands |
| H16 OPENPCB-64 (authoritative DRC) | if landed first: its rules fingerprint replaces `optionsDigest` inside the provenance stamp; its report states map `incomplete` → `EXPORT_DRC_INCOMPLETE`, others → STALE | `StoredDrcGateEvidence`, `evaluateDrcGate`, provenance stamp (content, options, engine version, raw-footprint digest), suppression rules, "no override at export" consumer |
| H23 (BOM/CPL consistency) | BOM/PnP writer semantics; bottom-side `.pos` rotation conventions | single-snapshot `prepare` path and gated `pnp.csv`; manifest `bomOverridesDigest`; `.pos` oracle output |
| OPENPCB-103 (designer recovery journal) | `coordinator.isSettled(designId)` + queue subscription (dialog `waiting-for-edits`, Export disabled when unsettled); `dispatchOnce` for *Add board pour*; its S5 `api.ts` error classification (H19 S2/S8a serialise with it; `ProblemError` reuses its parsed problem body if present) | the server half of its H19 row: export pinned to the DRC snapshot revision == head (`expectedRevision` + gate); independent IPC channel reusing the same trusted-sender check |
| Quarantine (H51 sign-off) | — | `CAPABILITY-QUARANTINE.md` updated to state which `output-completeness` evidence now exists; flag untouched; follow-up: move export builds off Electron main |

## 9. Open questions (only these need the user)

1. **DRC suppressions at export (finding 5).** Per-violation waivers count as part of the verdict (individual, auditable, never on safety-critical codes). Decided default (strict): the gate refuses (`EXPORT_DRC_SUPPRESSED`) when the design ignores a rule class in {clearance, connectivity, electrical, structural}, overrides an error-default code to `ignore`/`warning`/`info`, or gives any `drcRules` entry a non-error severity; ignoring other classes (dfm, manufacturability, signal-integrity, constraint) is allowed and recorded in the manifest and dialog. Alternatives: (a) allow all suppressions, recorded only; (b) refuse on ANY ignored class or override. Confirm the default or pick (a)/(b), and say whether ignoring `connectivity` (unrouted nets) should ever pass.
2. **Incomplete DRC (`*_UNCHECKED` > 0) (finding 6).** Decided default: block with `EXPORT_DRC_INCOMPLETE` (A12: an incomplete check is not a pass). Consequence: a board whose copper/outline exceeds the engine's exact-check budget cannot be exported until simplified or the engine improves. Alternative: allow with an amber "passed with N unchecked" chip recorded in the manifest.
3. **Unresolved-net copper before H08 (finding 24).** Decided default: ship `EXPORT_UNRESOLVED_COPPER_NET` in S6a (fail-closed; release builds stay quarantined, so only dev builds are affected; dev boards with stale unnamed-net copper after part moves will refuse export until the copper is re-assigned). Alternative: sequence that blocker after H08 lands, exporting such copper meanwhile without `%TO.N`.
4. **Same-net pour connection conflicts (finding 1).** Decided default: keep today's union semantics and refuse export on a conflict (`EXPORT_POUR_CONNECTION_CONFLICT`, non-waivable), with inline warnings. Alternative: amend contract 03 §5 so a higher-priority same-net polygon carves the board zone and its connection governs inside it (KiCad-like; changes pour geometry and DRC goldens; needs an Astra review) — would be a separate follow-up item.
5. **Standalone `pnp.csv` (BOM view) behind the full DRC gate.** Decided: yes (placement coordinates are manufacturing output; one validated revision). Say if the BOM-view PnP download should instead require only the capability blockers.

## 10. Review disposition (adversarial review, rev 1 → rev 2)

All 33 findings were checked against the code at d5547f9 before acting. Every factual claim was confirmed, except the KiCad pad-offset semantics (finding 13), which come from KiCad source knowledge; kicad-cli is absent, so they are recorded as a cross-item note plus an allow-listed oracle divergence rather than a code change here.

| # | Sev | Disposition | Where |
|---|---|---|---|
| 1 | blocker | Fixed: conflict detector + non-waivable export blocker + inline warnings; dialog inherits `thermal`; union semantics kept, carve alternative is Q4 | §3.9, §3.9.1, S3b/S4/S6a |
| 2 | major | Fixed: full `PcbBoardSettings`, required `keepouts`, required `nets` everywhere | §3.8 |
| 3 | major | Fixed: async library pre-read in `prepare`, keyed `(footprintId, sourceHash)`; H13/H15 supply pure classifiers; hash mismatch → unverified | §3.4.1, §8 |
| 4 | major | Fixed: one `provenance_json` stamp with engine version, raw-footprint digest and a ranAt/revision self-check for downgrade safety | §3.5, S5 |
| 5 | major | Fixed: overrides + rule severities recorded; strict suppression gate; Q1 extended | §3.2, §3.5, Q1 |
| 6 | major | Fixed: `EXPORT_DRC_INCOMPLETE` default block; Q2; H16 alignment | §3.5, Q2 |
| 7 | major | Fixed: consume `isSettled` + `dispatchOnce`; `api.ts` serialised with 103-S5 | §3.9, §3.12, §4, §8 |
| 8 | major | Fixed: tests added to S6b; capture only for delivered bundles (zip/json) — not zip-only, because the capture test and the JSON format are real deliveries | §3.11, S6b |
| 9 | major | Fixed: `no-pads` blocks only when the schematic part has pins; `virtual` passes | §3.3 |
| 10 | major | Fixed: disabled board zones listed as warnings; contract 03 amendment records the reinterpretation | §3.3, §3.9, §6 |
| 11 | major | Fixed: `bside-rotated` fixture (B-side 30°, rotated pad, roundrect, mirrored rect THT thermal at 45°, arc outline) | §3.13 |
| 12 | major | Fixed: macro parser extension, declared (not fitted) frame map from contract 16, pinned flags incl. `alternate` ovals, `.pos` | §3.13, S7/S7b |
| 13 | major | Fixed (doc + note): native convention stated for contract 17 and the fixture; importer note to H13/H14; allow-listed divergence | §3.13, §8 |
| 14 | minor | Fixed: property removed from the MCP-only schema; dangling resource sentence replaced | §2, §3.10 |
| 15 | minor | Fixed: core `cors.ts` base list | §3.11, S6b |
| 16 | minor | Fixed: only `env.createdAt`; determinism test at `prepare` level | §3.3, §3.11 |
| 17 | minor | Fixed: assert gate/runDrc spies, not row reads | S6b |
| 18 | minor | Fixed: `outlineBlocker` / `EXPORT_NO_OUTLINE` dropped; BOARD_OUTLINE_INVALID via DRC gate | §3.2, §3.3 |
| 19 | minor | Fixed: completeness scans emitted text; no writer stats; C4b | §3.6 |
| 20 | minor | Fixed: hand-derived `isDarkAt` + net-class oracle; deep-equals relabelled as regression guards; two extra fill sites routed | §3.8, S3 |
| 21 | minor | Fixed: dedupe precedence orphaned > zone > unresolved | §3.3 |
| 22 | minor | Fixed: both extras shapes mapped | §3.11 |
| 23 | minor | Fixed: unsupported-copper pre-check among capability sources | §3.3, §3.11 |
| 24 | minor | Fixed: moved to Q3 | §3.3, Q3 |
| 25 | minor | Fixed: table completed (all states + exits, plus `waiting-for-edits`) | §3.12 |
| 26 | minor | Fixed: wording scoped to the layers panel; lines 26/99/467 updated | §3.9.1 |
| 27 | minor | Fixed: `contentDigest` in the run join key | §3.5 |
| 28 | minor | Fixed: code-unit sort | §3.5 |
| 29 | minor | Fixed: path fn in core contract | §3.1, §3.12 |
| 30 | minor | Fixed: unparsable body → 400 | §3.11 |
| 31 | minor | Fixed: `freeHoleIds`; board zones never selected | §3.2, §3.12 |
| 32 | minor | Fixed: structural pad construction stated; S7b re-pin named | §3.13 |
| 33 | minor | Fixed: prepared-bundle cache + debounce; off-main-thread build noted as follow-up | §3.11 |

### Rejected review findings

None rejected outright. Partial deviations from the suggested fix, with rationale:
- **#1**: the reviewer offered two options. Amending contract 03 §5 (carve) is not done here. It changes physical pour geometry and DRC goldens, and needs its own Astra-reviewed item. The blocker meets A1's "never silently override" requirement under either semantics. The carve option is put to the user as Q4.
- **#8** ("fire capture only for `format=zip`"): capture fires for `zip` **and** `json`. Both deliver a complete, gated bundle, and `designer-capture-outcomes.test.ts` exercises the JSON path. It still never fires for `summary` or for a refusal, which was the substance of the finding.
- **#18**: the reviewer offered "base it on outline region validity" as an alternative. That was not taken, because DRC's `BOARD_OUTLINE_INVALID` is already the one outline verdict (`checks/outline.ts:outlineProblems`). It is non-overridable, and the gate blocks it. A second capability-side verdict could disagree with it.
