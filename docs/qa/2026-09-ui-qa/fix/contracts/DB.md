# DB contract — designer backend changes for the frontend owners (D1, D2, D3a, D3b, D4)

Backend side of T-096, T-097, T-162, T-164, T-174, T-217, T-251. Types live in
`src/sdks/designer/types.ts` / `pcb-helpers.ts` (re-exported from `src/sdks/designer` and `src/sdks`).
Every new command is in the `DesignerCommand` union AND has a `routes.ts` parser, so it survives HTTP.
All command results are the usual `DesignerDispatchResult` (HTTP 200 `{ data: { result } }`); a
malformed command body is a 400 problem+json. No new result codes were added.

## T-096 — `batch_commands`: one action, one revision, one undo step (D1, D2, D3a)

```ts
{ type: "batch_commands"; commands: DesignerBatchableCommand[] }   // 1 … DESIGNER_BATCH_MAX_COMMANDS (5000)
```

- The steps run in order in ONE transaction; each sees the state the previous step left (a
  `move_part` re-routes wires against the moved state). The envelope's `baseRevision` is checked once.
- **Success:** `{ ok: true, revision: base + 1, createdEntityId: null }` — exactly one revision and
  one history entry, so ONE `undo` restores the whole selection (and one `redo` re-applies it).
  `legality` (if any step reported one) is the sum over the steps.
- **Failure:** the first failing step's result is returned verbatim (e.g. `ENTITY_NOT_FOUND`,
  `PCB_COPPER_ILLEGAL`) and **nothing** is persisted — no half-deleted selection.
- `delete_entity` of an entity that an earlier step already removed (a wire attached to a deleted part
  or port) is a no-op, not a failure. The frontend's "drop wires whose pin is deleted" filter is no
  longer required (harmless to keep). An id that never existed still fails.
- Not batchable (400 from the parser): `batch_commands` (no nesting), `place_part`,
  `pcb_set_view_state`, `pcb_apply_autolayout_candidate`. Everything else, schematic and `pcb_*`,
  may be mixed.
- Performance: 150 part deletes + 99 wires = one ~60 ms request (was ~8 s of sequential envelopes).
- Cloud: a linked design is re-seeded from the local projection after a schematic batch (one cloud
  revision), not mirrored step by step.

Frontend (D1 `useDesignerWorkspace.dispatchCommandsBatch`, D2 `SchematicCanvas` Delete / R / align /
group drag, `MultiPartInspectorPanel` "Delete all", D3a multi-select PCB ops):

- Send ONE envelope `{ type: "batch_commands", commands }` instead of looping `dispatchEnvelope`.
  A single-command "batch" can keep dispatching the command directly.
- Refresh: treat a batch as a schematic command when ANY step is non-`pcb_*` (refresh the schematic
  projection + history), otherwise as a PCB command (the existing optimistic revision path).
- Large destructive batches: confirm first (`confirmDialog`), and/or offer an Undo toast — the backend
  makes the undo a single step.

## T-097 — net labels connect (D2)

No wire-format change; `deriveNetsAndJunctions` semantics changed (projection shape unchanged):

- A label's anchor (`positionNm`) joins the net of **every wire it touches** — anywhere along a
  segment, at a corner or end — and of any pin / port under it, within
  **`SCHEMATIC_LABEL_ATTACH_TOLERANCE_NM` = 100 000 nm (0.1 mm)** (exported from `src/sdks`). It used
  to need a nanometre-exact wire vertex.
- Labels with the same text (trimmed, case-insensitive) are **one net** even with no wire between them.
  Labels share one name namespace with power rails and net portals (`VCC` label + `VCC` rail = one net).
- Net naming priority is unchanged: GND port > power rail > net portal > label text > `Net_<n>`.
- Labels still never create junction dots.

D2: snap the label anchor onto the wire/pin under the cursor (exact point on the segment is best;
anything within 0.1 mm attaches), prompt for / offer the net name (LabelPicker), draw a ghost, and draw
the text beside the anchor, not centred on the wire. `upsert_label` is unchanged.

## T-162 — net class add / rename / delete / via size (D3b)

Still one command: `pcb_set_design_rules` with the **whole** `netClasses` table (the dialog's Save).
One undo step. New server rules:

- **Refused whole** with `{ ok: false, code: "INVALID_PCB_BOARD_SETTINGS", detail }` (nothing saved)
  unless: the table is non-empty; every row has a non-empty id with no leading/trailing spaces
  (≤ 64 chars) and a non-empty name (≤ 64); ids are unique; names are unique **case-insensitively**
  (trimmed); `traceWidthMm`, `viaDiameterMm`, `viaDrillMm` > 0 and `clearanceMm` ≥ 0 when present;
  `viaDrillMm < viaDiameterMm`; and the stored **first (default) class is still first** (it can be
  renamed/edited, never deleted or moved). `detail` names the row, e.g.
  `net class 3 ('USB'): via drill must be smaller than via diameter` — show it inline.
  (Before, a malformed row was silently dropped.)
- **Add:** append a row with a NEW id the client mints (a slug of the name or `crypto.randomUUID()`;
  it never changes afterwards) and every field set (`traceWidthMm`, `clearanceMm`, `viaDiameterMm`,
  `viaDrillMm`, `color`, `defaultViaProtection`; missing numbers default to 0.25/0.25/0.8/0.4).
- **Rename:** change `name`, keep `id`. Assignments, rule scopes and copper hints key on the id.
- **Delete:** omit the row. Server-side, in the same undo step: its `perNetClassAssignments` entries
  are dropped (those nets fall back to the default class) and traces/vias whose `netClassId` pointed
  at it are re-pointed to the default class. A `drcRules` `netClass` scope naming it is kept and
  reported by DRC as `DRC_RULE_INEFFECTIVE` (not refused).
- Per-class via size: `viaDiameterMm` / `viaDrillMm` on each row (already persisted; now editable).
- Boards imported from KiCad before this change may carry duplicate class ids (two names slugging
  alike); saving such a table is refused with `duplicate id`. New imports mint unique ids.

## T-164 — design-named downloads (D1 `api.ts`, D3b `PcbExportDialog`, D4 BOM view)

```ts
exportBundleName(designId: string, designName?: string | null): string   // src/sdks
bomExportFileName(bundleName: string, kind: BomExportKind): string       // kind: "csv"|"tsv"|"jlc"|"kicad"|"pnp"
```

- Bundle name = slug of the design name (diacritics folded, `[^A-Za-z0-9_-]+` → `_`, ≤ 40 chars):
  `"Dual LED Blinker"` → `Dual_LED_Blinker`. No usable characters (empty, `!!!`, CJK) → `openpcb-<full
  design id>` (no more mid-group cut).
- Server (all derive from the design's current name): ZIP `Content-Disposition` =
  `<bundle>.zip`; every file inside = `<bundle>-F_Cu.gbr`, `<bundle>-PTH.drl`, `<bundle>-BOM.csv`, …;
  `.gbrjob` `GeneralSpecs.ProjectId.Name` = the design **name** (GUID still derived from the id, so a
  rename is not a new project); `?format=summary` → `bundleName`.
- Standalone downloads (`GET …/exports/{bom.csv,bom.tsv,bom-jlc.csv,kicad-bom.csv,pnp.csv}`):
  `Content-Disposition` filenames `<bundle>-BOM.csv`, `-BOM.tsv`, `-JLC-BOM.csv`, `-KiCad-BOM.csv`,
  `-PnP.csv`.
- Headers are not CORS-exposed, so the client recomputes: D1 `downloadGerberZip` should name the blob
  `exportBundleName(designId, designName)` (or use the summary's `bundleName`), and
  `downloadBomArtifact(designId, kind, designName)` should name it
  `bomExportFileName(exportBundleName(designId, designName), kind)` — replacing
  `` `${exportBundleName(designId)}-${kind}.${extension}` `` (the `-csv.csv` names). Until D1 passes
  the name, the client-side ZIP name falls back to `openpcb-<id>` while the files inside use the name.

## T-174 — trace / via inspector edits (D3a)

```ts
{ type: "pcb_update_trace"; traceId: string; widthMm?: number; layer?: PcbCopperLayerId;
  legality?: "refuse" | "report" | "off" }
{ type: "pcb_update_via"; viaId: string; diameterMm?: number; drillMm?: number;
  viaType?: "through" | "blind" | "buried" | "micro"; fromLayer?: PcbCopperLayerId;
  toLayer?: PcbCopperLayerId; protection?: "none" | "tented" | "plugged" | "filled" | "capped";
  legality?: "refuse" | "report" | "off" }
```

- Only provided fields change; a patch that changes nothing is a 400. Each edit = one revision, one
  undo step. `createdEntityId: null`.
- Trace: `widthMm > 0`; `layer` must be a copper layer of the board (`INVALID_PCB_TRACE` otherwise);
  unknown id → `PCB_TRACE_NOT_FOUND`.
- Via: validated exactly like `pcb_add_via` — `INVALID_PCB_VIA` for drill ≥ diameter, or diameter /
  drill / annular ring below the resolved minimum (scoped rules included); unknown id →
  `PCB_VIA_NOT_FOUND`. **"Convert to through"** = `{ viaType: "through" }` (layers may be omitted →
  F.Cu→B.Cu). Setting a non-through type or span needs the `pcb.advancedVias` flag, as on insert
  (`INVALID_PCB_VIA` without it); editing size/tenting of an existing blind via does not.
- Both are judged by the copper commit gate like a geometry edit: under the default `legality:
  "refuse"` a result that violates the refuse set (clearance, `TRACE_WIDTH_MIN`, `VIA_LAYER_SPAN`, …)
  is `PCB_COPPER_ILLEGAL` with `violations` / `refusedCount`, nothing saved. Send `"report"` when the
  user's "allow violations" override is on.
- **Net is not editable** (deliberately): a copper item's net is what it touches; show `netId` /
  `netName` (projection `netNames`), `netClassId` (class name), layer span and type read-only.
  Trace length is client-side geometry.

## T-217 — refdes rename reaches PCB, BOM and CPL (D4 BOM view, D3a)

No request change. `update_part_properties { reference }` (Inspector / Outline rename) now shows up
everywhere that is derived from the part:

- `GET …/pcb` projection: `placements[].reference` (and `componentId`) always equal the schematic
  part's (same `partId`) — also after undo/redo of the rename, and for designs already carrying a
  stale placement ref (self-heals on the next PCB read).
- BOM (`GET …/bom`, all BOM CSVs) pairs a placement with its schematic part by **partId**: no phantom
  line for the old ref, `summary.partCount` = number of parts. PnP/CPL designators are the schematic
  refs, so BOM and CPL always agree.
- BOM overrides (DNP, MPN, LCSC, supplier, price, notes) are **bound to the part**: an override made
  for `R1` follows a rename to `R7` and its undo/redo, so a DNP part stays out of `pnp.csv` and keeps
  `dnp: true` in the BOM. A part that later takes the freed `R1` does NOT inherit it.
  - `PATCH …/bom/refs/:refdes` is unchanged: send the reference the user sees NOW (the BOM row's
    `refs[].refdes`). The backend resolves it to the part carrying it.
  - Response `override` gains **`partId: string | null`** (additive): the bound part, or `null` for a
    reference no schematic part carries (e.g. a PCB-only placement — matched by refdes, as before).
    `override.refdes` is the part's current reference.
  - Migration `0019_bom_override_part_binding.sql` binds existing rows to the part carrying their
    refdes at upgrade time (applies automatically on backend start).
  - CPL DNP exclusion is decided per placement, never by refdes.

## T-251 — KiCad project import errors are 4xx problems (D4 `KicadProjectImportWizard`)

`POST /imports/kicad-project/inspect` and `POST /imports/kicad-project` (commit) no longer answer 500
for a bad user file. All are `application/problem+json`; show `detail` (via `describeError`); `reason`
is a stable key if you want reason-specific help:

| status | `type` (`https://openpcb.dev/problems/…`) | `reason` | when |
|---|---|---|---|
| 400 | `validation` (existing) | — | not a multipart upload, not `.zip`, or not a readable ZIP |
| 422 | `kicad-legacy-project` | `legacy_kicad` | KiCad 5 files (`.pro` / `.sch`, or a `.kicad_pcb` older than format 20211014); `detail`: "KiCad 5 projects (.pro/.sch) aren't supported yet. Open the project in KiCad 6 or newer, save it, then import the ZIP again." (+ `fileName`) |
| 422 | `kicad-project-incomplete` | `library_archive` | only library files (`.kicad_sym`/`.kicad_mod`/`.lib`) — points the user to Library import |
| 422 | `kicad-project-incomplete` | `missing_project` / `missing_board` / `missing_schematic` | no `.kicad_pro` / `.kicad_pcb` / `.kicad_sch` |
| 422 | `kicad-project-unreadable` | `unreadable_file` | a project/board/sheet file that does not parse (+ `fileName`) |

Library-side inspect (`/api/modules/library/imports/kicad/inspect`) is LB's contract.

## Housekeeping

- `npm run gen` → no generated-stub diff (the stubs are manifest-derived); `gen:contracts:check` clean.
- `@openpcb/contracts` still lags the in-tree `DesignerCommand` union (pre-existing drift); no new tsc
  errors from these additions.
