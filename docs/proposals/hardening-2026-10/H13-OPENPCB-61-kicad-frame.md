# OPENPCB-61 (H13/P1): correct KiCad coordinate transforms and safely migrate mirrored footprints

Status: design **r2**, 2026-10-15. Revised after an adversarial review (28 findings, verdict fix-required). The disposition of every finding is in §10. Read-only investigation; no repo was edited.

Also reachable as `H13.md` (symlink, same convention as `H15.md`/`H19.md`).

Repo heads:
- OpenPCB `d5547f9` (master). r1 was written at `839365e`. The commits in between do not touch cited code. `c723bb0` adds `OPENPCB_FEATURE_LIBRARY_FOOTPRINTINTAKEQUARANTINE=0` to the e2e fixture, which still works because the flag name is kept.
- `../shared` `91c7e7e` (branch `fix/offline-eda-text`)
- `../CoreLibrary` `392b75e` (master), 57 uncommitted changes from the in-flight extension pass. Those include `tools/import-kicad-batch.ts`, `package.json` and `tests/import-kicad-batch.test.ts`, which CL1 also edits.

Inputs:
- Plane OPENPCB-61: description, one comment (`9612c92` interim intake quarantine)
- audit seq 61
- QA triage T-244 / T-317 (`docs/qa/2026-09-ui-qa/TRIAGE-full.md:58,61,453,556,663,660`)
- `OpenPCB/CLAUDE.md`, `src/modules/designer/AGENTS.md`
- skills `eda-standards` §Coordinate system, `pcb-layout` §Back-side mirroring, `r3f-eda-rendering` (Y-up)
- sibling designs H08 (`OPENPCB-56.md`), H14 (`H14.md`), H15 (`OPENPCB-63.md`), H19 (`OPENPCB-67.md`), 103 (`P103.md`). Seams are in §8, and the cross-item merge order for shared designer files is in §4.7.

Release quarantine commits this item builds on (none is reverted):
- `3b3b670`: designer output and project-import quarantine
- `9612c92`: library footprint intake quarantine
- `d11ce92`: preset quarantine (H15)

**Binding user decisions applied**
- The canonical frame is Y-up integer nm everywhere.
- KiCad footprint data is converted once, at import, in `@openpcb/kicad-import`.
- Legacy boards are classified, carry a persistent flag and are blocked from export. Placed copper is never auto-flipped.
- Library rows get frame provenance and are backed up before any rewrite.
- Intake is qualification-based. The release `designer.outputQuarantine` stays on until the user signs off.
- Shared changes are committed on `fix/offline-eda-text` and not published. OpenPCB keeps typechecking against the pinned tags, except for the slices listed in §4 as **re-pin-gated**.

---

## 1. Scope and acceptance mapping

| # | Plane acceptance criterion | Design element |
|---|---|---|
| A1 | Document the frames (KiCad source Y-down, canonical Y-up nm, canvas, 3D, Gerber/PnP), the units, and front/back rotation and mirror composition | §3.1 contract, written as **`docs/pcb-hardening/KF1-kicad-frame-contract.md`** (contract "KF1"). The letter prefix avoids colliding with PROGRAM.md's S16/S17 numbering (§10 #21). Slice **OP1** |
| A2 | Apply each transform exactly once at the right boundary. Keep pad identity and pin mapping (T-244, T-317) | Three conversion boundaries; nothing else transforms (§3.1.4): <br>(1) `kicadPointToCanonical`/`kicadPadToCanonical` inside `@openpcb/kicad-import` for footprint-local geometry (**SH1**) <br>(2) `KicadBoardFrame` in `kicad-frame.ts` for board/schematic items, wired by H14 (**OP9**) <br>(3) the library migration re-derives through (1) (**OP8**) <br>Pad ids `${number}:${index}` and pin maps are unchanged by construction (§3.3) |
| A3 | Fix the source in shared and in CoreLibrary data. Publish and pin qualified versions, then update consumers | **SH1** (code), **SH2** (user-gated publish), **CL1/CL2/CL3** (CoreLibrary tool, data, release), **OP7** (re-pin) |
| A4 | Transform provenance and schema/frame version on footprint data | `FootprintFrameProvenance` (§3.2): the `preview.frame` stamp in shared, `provenance.frame` in library rows and CoreLibrary `fp.json`, and `library_footprints.frame_*` columns bound to a `data_json` hash. Migration `0012` (§3.4). The CoreLibrary schema adds a required `provenance.frame` (§3.9) |
| A5 | Migrate known legacy data with a backup and deterministic classification. Never blindly flip, silently move copper, or repair only the preview | Library: classify every row by **verified evidence**, not by self-declared stamps (§3.5.1). Re-derive only `user.local` rows proven legacy by geometry, backed up first, preview-only merge, pad-invariant delta check (§3.5.2, **OP8**). Designer: **no** design row is ever rewritten. Classification only (§3.6) |
| A6 | Flag ambiguous existing boards and block them from qualified export until resolved | `designer_frame_status` (§3.4.2) plus the pure classifier (§3.6). Plugs into H19's `ExportLibraryHooks.sourceFrame` over H19's single-revision snapshot (`EXPORT_AMBIGUOUS_SOURCE_FRAME`), or an interim guard that uses the export's own projection (§3.7). Banner and resolve actions (**OP5**) |
| A7 | Fixtures: asymmetric numbered parts at 0/90/180/270 on both sides, pre-routed, with NPTH. Numeric comparison against KiCad-derived references | **Status: OPEN until release sign-off** (§7.3). Front side: oracle **O1** (KiCad 8.0.4 Gerbers + Excellon tracked in `data/KiCad_Example_Project_USBtoUART.zip`, pad identity via X2 `%TO.P`; verified §2.9). Back side: **O4** (local corpus: KiCad's own B.Cu track endpoints and F/B instances of one footprint; skip-unless-present). Full matrix: **O3** (`sides` fixture rendered by kicad-cli). Sign-off requires `OPENPCB_REQUIRE_KICAD_REF=1` green, or a user waiver (Q3) |
| A8 | Re-import, save, reopen and undo do not double-transform | Read paths never transform. The frame label is descriptive only and bound to a content hash. Dedupe is frame-aware. Migration is idempotent with per-run backups. Suite **R** (§7, **OP12**) |
| A9 | Validate migrated boards, newly imported boards and user-drawn footprints separately | Suites **M**, **N**, **D** (§7, **OP12**) |
| A10 | Screenshots alone are not acceptance. H14 owns import completeness, H19 export qualification, H46 migration recovery | All acceptance is numeric. Manual macOS QA (**OP6/OP5**) is supplementary only. H46 is not ready, so H13 ships a minimal backup that H46 can absorb (§3.5.3) |

**Out of scope, with owners:**
- import completeness, call sites in `insert-pcb.ts`/`commit.ts`, board graphics, staging: H14
- the export gate and its UX: H19
- IPC/parametric geometry and generator qualification: H15 (H13 provides an intake slot, §3.5.4)
- net identity: H08
- the renderer's upside-down pad numbers at 180° (T-204, a package renderer issue)

---

## 2. Current state (verified file:line facts)

Paths are relative to `OpenPCB/` unless prefixed `shared/` (= `../shared`) or `CoreLibrary/`.

### 2.1 Shared package (unfixed)

- `shared/packages/kicad-import/src/build-preview-models.ts`:
  - `:670` `centerMm: { x: pad.position.x, y: pad.position.y }` copies the pad centre verbatim.
  - `:673` `rotationDeg: pad.rotation`.
  - `:660-682` copies `drillOffsetMm` verbatim. It therefore puts copper at `at` and the hole at `at + offset`, which is the reverse of KiCad (`PAD::ShapePos` = `m_pos + Rotate(m_offset, orient)`: the hole is at `at`, the copper at `at + R·offset`). H19 raised this (`OPENPCB-67.md` §8 H13 row, finding 13). The native convention is copper at `centerMm`, hole at `centerMm + R·drillOffsetMm` (`src/shared/rendering/pcb/pcb-drills.ts:180-189`, verified).
  - `:278-390` copies graphics points (line, rect, circle, arc, poly) verbatim.
  - `:396-449` copies text positions verbatim.
  - The symbol path (`:138-581`) is a separate code path. KiCad `.kicad_sym` symbols are Y-up already, and that path stays untouched.
- `shared/packages/kicad-import/package.json`:
  - The version is already `0.2.0` but **untagged**. Tags stop at `kicad-import-v0.1.2`.
  - It depends on `rendering-core-v0.1.4`, also untagged. That version carries H15's `da9db4c`/`91c7e7e` and S11 plating (`e882332`).
  - Unreleased since v0.1.2: `1a15c1e` (breaking: all symbol units, courtyard/mask/paste), `8732254`, `58d3620` (breaking: slotted drills, paste sub-pads), `e882332` (plating, drill offset), `da9db4c`, `91c7e7e`. **These are geometry changes beyond the frame flip**, so the frame regeneration must separate them (§3.9 CL2, §3.5.2 b4).
- `shared/packages/kicad-parsers/src/kicad-footprint-parser.ts:24-40`: `ParsedPad` carries `position`, `rotation`, `drillOffset`, `drillSlot`. It has no `rect_delta`, `chamfer` or custom primitives. Trapezoid and custom pads degrade to rect (`build-preview-models.ts:633-644`).
- `FootprintPreviewModel` (`shared/packages/kicad-import/src/types.ts:37-39`) extends `FootprintRenderModel`. That model has no frame field (`rendering-core/src/types.ts:237-246`). No rendering-core change is needed: bounds and arc helpers are orientation-agnostic.

### 2.2 OpenPCB pins and installs

- `package.json:90` pins `@openpcb/kicad-import#kicad-import-v0.1.2`. `:94` pins `rendering-core-v0.1.3`.
- The installed `node_modules` versions are kicad-import 0.1.2, rendering-core 0.1.3, kicad-parsers 0.1.3 and opclib-pack 0.3.0. 0.1.2 emits no `plated` or `drillOffset`.
- `resources/core-library-release.json` has `"productionRelease": null`. No production CoreLibrary pin exists yet.

### 2.3 Canonical composition already in-tree

`src/shared/pcb-geometry/pad-geometry.ts`:
- `:42-75` `transformPadCenterMm`: mirror X first, then a math-CCW rotation. The angle is arbitrary, with exact cardinal cases.
- `:107-128` `padCopperShape` documents `M·R(φ) = R(−φ)·M`, so a mirrored rotation is `φ − β`.
- `src/sdks/designer/pcb-helpers.ts:65-67`: `placementMirrorX = mirrored || layer === "B.Cu"`.

### 2.4 Project import (unfixed; call sites owned by H14)

`src/modules/designer/backend/import/kicad-project/`:
- `insert-pcb.ts`:
  - `:139-147` copies placement position verbatim, sets `rotationDeg = normalize360(fp.rotationDeg)` and `mirrored = layer === "B.Cu"`. Back-side parts are therefore wrong: KiCad's `θ` must become `θ+180` (§3.1.3).
  - `:167-176` copies traces verbatim; `:210` vias; `:439-441` zones and keepouts.
  - `:452-454` `normalize360(Math.round(v))` drops fractional angles.
  - `:463-472` computes the board centre in the KiCad frame.
- `commit.ts`:
  - `:78` `assertQualifiedProjectImport()`.
  - `:528-560` copies the outline (bbox and polygon) verbatim.
  - `:256-279` writes the synthetic `import_kicad_project` `commandLog` row, which has no frame stamp.
- `ingest-library.ts:305-320`: the **first** board instance per `lib_id` becomes the library footprint. Board instances store pad and text angles as **absolute** (footprint θ included; verified in §2.9). Back-side instances are stored flipped (local y negated, layers swapped), so B-side-first boards ingest a flipped and/or angle-doubled library footprint. `ingest-library.ts:19-29` imports library-module internals directly (a pre-existing boundary violation; H14 S10 deletes this file).
- `insert-schematic.ts:144-173`: schematic positions are verbatim Y-down, and the Y-up `.kicad_sym` pin locals are rotated without the KiCad Y flip (§2.9 schematic check).

### 2.5 Library intake, rows and snapshots

`src/modules/library/backend/`:
- `import/unqualified-import.ts:41-56` (`rejectKicadFootprints`) and `:91-108` (`rejectUnqualifiedPackFootprints`) are blanket rejections gated on the `library.footprintIntakeQuarantine` flag.
- `src/core/contracts/feature-flags/registry.ts:114-125`: both quarantine flags have `availability: "prod"`. `:109-113` `dataset.capture` is also `prod` ("ON in packaged builds").
- `import/commit-kicad.ts`:
  - `:94-123` `findExistingFootprintId` dedupes on `(provenance.sourceHash, normalized.id)` only. Re-importing a `.kicad_mod` would therefore reuse a legacy Y-down row.
  - `:245-260` row shape: `{provenance:{sourceKind:"imported",sourceFormat:"kicad_mod",fileName,importedAt,sourceHash}, parser, normalized, raw}`. `normalized` is the whole `NormalizedFootprint` (incl. its own `sourceHash`, `preview`). `raw` is the `ParsedKicadFootprint` in the KiCad frame, including `rawSource`.
- Other provenance writers:
  - `commit-kicad-zip.ts:466-470` rewrites `sourceFormat:"kicad_zip"`; `:393,412` writes `model_ref_json` from the KiCad `(model)`.
  - `commit-drawn.ts:188-195` writes `imported/kicad_mod`.
  - `footprint-record.ts:66-73` writes `drawn|generated`, with sourceHash prefix `drawn:`.
  - `commit-generated.ts:55-72,145-151` uses prefix `generated:`.
  - `builtins/placeholder-footprint.ts:74-75` writes `system/placeholder`.
- Other `model_ref_json` writers: the model upload route (`routes.ts:~1700-1716`, `body.modelRefJson`) and `models/import` (`routes.ts:1487-1491` → `:990`). `PATCH /footprints/:id/model` (`:1744`) only marks a conversion failed.
- `cloud-pack-builder.ts:175,206` repacks local rows with `dataJson` **verbatim and unsigned**; `cloud-sync.ts:199` pulls such packs through `importOpclib`. A local frame stamp therefore travels to other machines as an unsigned self-declaration.
- `schema.ts:60-75` `library_footprints` has `(id, name, data_json, created_at, source_id, version, uuid, content_sha256)` and no frame columns. Migrations end at `0011_untrusted_core_sources.sql`.
- `queries.ts`:
  - `:429-458` `parseFootprintPlacementSnapshot` builds `{footprintId,name,mountType,sourceHash,preview,pinMap,model3d}`. It re-derives bounds only (`:538-544`) and transforms nothing.
  - `:483-530` `withLegacyPlating`/`rawPadMatchesPreview` flips NPTH plating only when `raw.position == preview.centerMm` (1e-9). That invariant is broken by the frame conversion; it is safe today only because 0.2.0 states `plated` explicitly.
  - `:2302-2328` `getDefaultFootprintRefs` returns only `{footprintId, sourceHash}`.
  - `:1600-1625` `copyFootprintsForClone` copies `data_json` into `user.local` and sets `contentSha256: null`. The cloned model row keeps the same GLB sha.
- `sync/opclib-importer.ts`:
  - `:252-280` verifies the signature (`verdict.valid`), then calls `rejectUnqualifiedPackFootprints`.
  - `:471-505` upserts footprint rows from the pack asset JSON.
  - `:46-63` CoreLibrary model transforms are baked into the GLB (`transformBaked`), so `model_ref_json` is null for them: a baked mirror compensation is invisible in the DB.
- `index.ts:21-33` `onActivate` order is `bootstrapCoreLibrary` (`:26`), then the dev watcher, then `rebuildPreviewModelsIfStale` (`:33`). `rebuildPreviewModelsIfStale` (`builtins/migrate-preview-models.ts:169`) rebuilds **symbol** previews only and is sentinel-gated, so it never touches footprint geometry.

### 2.6 Designer

- `designer_schematic_parts.footprint_snapshot_json` is written only by:
  - `place_part` (`command-executor.ts:794`)
  - `refresh_part_footprint` (`commands/refresh-footprint.ts:84-98`)
  - the projection-world rewrite (`projection-world.ts:1080`)
- The PCB placement follows on sync (`pcb-store.ts:2059`).
- **No read path re-resolves from the library**. `store.ts:784-797` resolves at dispatch time, only for `place_part` and `refresh`. A journaled `place_part` replayed after a library rewrite therefore gets the new geometry (§6 epoch).
- `refresh_part_footprint` (`types.ts:1604-1607`) re-snapshots the **default** footprint, so it may switch variants. `resolveRefreshDetails` (`store.ts:188-205`) keys its map by **`componentId`** (`:197,201`), and `applyRefreshPartFootprint` reads it by `part.componentId` (`refresh-footprint.ts:79`).
- `store.ts:166-185` `markStaleFootprints` compares footprintId and sourceHash.
- `results.ts:11-90` `parseDispatchResultJson` whitelists result codes; an unknown code returns null, and a same-id replay (`store.ts:765`) then reports `REVISION_CONFLICT`.
- Export call sites:
  - `routes.ts:3427` (`pnp.csv`) and `:3443` (`gerber`)
  - `sdk.ts:137` (`getManufacturingExportSummary`)
  - all behind `assertQualifiedManufacturing()` (`capability-quarantine.ts:10-23`)
- `export/preflight.ts:20-87` is advisory, with an `Error:` prefix convention.
- Dataset capture (`capture/`, `tags.ts:10`, `snapshots.ts:24`, `uploader.ts:40`) captures every packaged-build design with no frame information.
- Designer migrations end at `0020_operation_receipts.sql`. H08 plans `0021_net_identity`, H14 `0021_kicad_import_reports`, H19 `0021_drc_result_provenance`. `module-migrator.ts:116-121` applies by name set, so duplicate prefixes are safe.

### 2.7 3D

`src/modules/designer/frontend/three-d/transform-helpers.ts:72-87`: back side gets `scale [-1,1,1]` and `z = -thickness`. That is an improper reflection: the model is mirror-imaged and not turned through the board. KiCad flips back-side models with a proper 180° turn, `diag(1,−1,−1)` composed with θ (§3.1.3).

### 2.8 CoreLibrary

- 168 `footprints/**/*.fp.json`, all `provenance.source = "kicad-derived"`, `sourceFormat "kicad-mod"`. All carry a usable `raw` including `rawSource`.
  - Versions: 0.2.0×56, 0.3.0×71, 0.4.0×9, 1.0.0×32.
  - Example: `footprints/package/sot-23.fp.json` has pad 1 at (−0.9375, −0.95), Y-down.
- 158 `3d/**/*.model.json`; **45** carry `scaleMm.y = −1`; every rotation is (0,0,0).
  - `docs/3d-placement-convention.md:52-59` documents this as a "required" pin-header/socket exception ("pads sit at +Y").
  - It is a compensation for the mirrored footprints and must be reverted after regeneration.
- `schemas/footprint.schema.json`: provenance has `additionalProperties: false` and no frame property.
- `schemas/library.schema.json:16`: `schemaVersion const "1.0.0"`, enforced by opclib-pack `unpack/reader.ts:53`.
- `tools/rebuild-previews.ts` re-derives previews from `raw` with the package builder. H15's C1 adds `qualifySilk` there and records `provenance.postProcess` + `derivationHash` (`OPENPCB-63.md:905-920`).
- `tools/orientation-gate.ts` checks model XY centre against the footprint. It will flip from requiring the mirror to rejecting it.
- Pins are `kicad-import-v0.1.2` and `rendering-core-v0.1.3`.

### 2.9 Numerical evidence

Scratch scripts against the tracked USBtoUART project (KiCad 8.0.4, 19 footprints, front side only, rotations 0/±90/180):

| Check | Result |
|---|---|
| Hypothesis **A**: canonical pad = `N·(at_fp + RotK(at_pad_local, θ_fp))`, where `RotK(p,θ) = (x cosθ + y sinθ, −x sinθ + y cosθ)` (KiCad `RotatePoint`) and `N = diag(1,−1)` | All 86 numbered copper pads, matched by `%TO.P` identity in `F_Cu.gbr`: max error 3·10⁻¹⁴ mm. Both J1 NPTH pegs match `NPTH.drl` at (5.5354, −5.2799) in. |
| Hypothesis B (pad `at` pre-rotated) | 40 mismatches |
| Hypothesis C (math-CCW in the Y-down frame) | 22 mismatches |
| Pad angles in a board file are absolute | Observed (θ_fp, α_pad) pairs: (−90, 270), (90, 90), (180, 180) |
| Text angles in a board file | Absolute modulo keep-upright, e.g. fp −90 with Reference text 90 |
| Footprint graphics in a board file | Footprint-local and unrotated, e.g. `fp_line (0.6,0.52)` on the −90 part |
| Schematic pins on wires/labels/junctions | 91/92 under KiCad semantics (`N·at + R(θ)·p_symbol`) versus 79/92 for today's importer. The schematic import is mirrored too. The USBtoUART schematic has **0** `(mirror` tokens, so it says nothing about mirror composition |
| USBtoUART drill offsets | none (all 17 `(offset` tokens are 3D-model offsets). Drill-offset semantics are not numerically verified by O1 |

Independent back-side evidence (reviewer, confirmed in this pass): `cloud-workspace/cloud-auto-layout/workspace/external/writeback_check_r2/0400_laptimer58_Chickadee/semantic.kicad_pcb` (gitignored local corpus). 20 B.Cu footprints, including 9×`R_0603_HandSoldering` on B and 3 on F, 3×`SOT-23_Handsoldering` and 1×`SOT-23-6` on B. Treating pad locals as stored (already flipped), 44 back-side pad centres land on track or via endpoints; re-flipping them gives 4. This supports §3.1.3.

Mirrored schematic census over `cloud-workspace/cloud-auto-layout/corpus/upstream/**/*.kicad_sch` (gitignored): `(mirror x)` at 0/90/270 (33/27/28 symbols, 6–7 projects each) and `(mirror y)` at 0 (75 symbols, 11 projects). KiCad writes only these canonical forms, which with the 4 unmirrored rotations make up all 8 orientations.

Identity used throughout: `N·RotK(p,θ) = R(θ)·N·p`. Hence:
- **angles are unchanged** under Y negation (KiCad angles are visually CCW, and so are canonical math-CCW angles in Y-up)
- only coordinates are negated

### 2.10 Environment

- kicad-cli is not installed (`/Applications/KiCad` is absent). No KiCad source checkout is available.
- Vendored KiCad libraries are at `../references/kicad-libs/kicad-footprints`, commit `cb8299c`. They contain SOT-23 (pad 1 at (−0.9375,−0.95)), SOIC-8 (pin 1 at (−2.475,−1.905)), and CP_Elec_4x5.4 (silk "+" centred at (−2.75,−1.56)).

---

## 3. Design

### 3.1 Frame contract (content of `docs/pcb-hardening/KF1-kicad-frame-contract.md`)

#### 3.1.1 Frames

| Frame | Axes and units | Angles | Owner |
|---|---|---|---|
| **K**: KiCad source (`.kicad_mod`, `.kicad_pcb`, `.kicad_sch` positions) | +x right, **+y down**, mm with up to 6 decimals (1 nm) | **Visually CCW** (KiCad `RotatePoint` is math-CW in Y-down), degrees, may be fractional, range (−180,180] | file |
| **Ks**: KiCad library symbol (`.kicad_sym` pin/body coordinates) | +y **up**, mm | visually CCW | file |
| **C**: canonical model (DB, commands, DRC, connectivity, export input) | +x right, **+y up**, **integer nm** for persisted world geometry; footprint-local preview geometry in mm (`FootprintRenderModel`, `units:"mm"`) | math-CCW, degrees, normalized to [0,360), fractional allowed | OpenPCB |
| **S**: canvas scene | mm = nm / 1_000_000 (`NM_TO_SCENE`), Y-up | identity with C | renderer |
| **Px**: screen | px, Y-down | camera projection only | camera |
| **3D**: Board3D scene | X = C.x mm, Y = C.y mm, Z up. Board top at z=0, bottom at z=−thickness | Euler about Z = C rotation | `three-d/` |
| **G**: Gerber/Excellon output | `%FSLAX46Y46*% %MOMM*%`, absolute, Y-up, identical numbers to C (no origin shift) | n/a | export (H19) |
| **P**: PnP/CPL | mm, Y-up, board origin = C origin. Bottom-side conventions belong to H19/H23 | CCW plus the family offset (`export/pnp/rotation-db.ts`) | export |

KF1 also records, for H23: imported back-side parts are stored as `rotationDeg = θ_K + 180` (§3.1.3). KiCad `.pos` reports bottom-side rotation differently; the delta is H23's to define and is **not verified** here (no kicad-cli).

#### 3.1.2 Conversion K→C

`N = diag(1,−1)`.
- Point: `p_C = N·p_K`.
- Angle: `φ_C = norm360(φ_K)`, with the **sign unchanged**. This is exact because `N·RotK(p,θ) = R(θ)·N·p`.
- `norm360(d)`: first snap `d` to `round(d)` when `|d − round(d)| < 1e-9`; then `((d % 360) + 360) % 360`; then map `360 → 0` and `−0 → 0`. Never `Math.round` otherwise. (r1 snapped after the modulo, which could return 360 for −1e-12; §10 #25.)
- A 3-point arc `(start, mid, end)` maps pointwise. Its sweep direction reverses automatically, which is correct for a reflection.
- Any angle-swept arc representation (KiCad 5 `fp_arc` with `(angle)`, or `PcbOutlineSegment.cw`) must negate the sweep, or flip `cw`.
- Integer nm: `x_nm = Math.round(x_mm·1e6)` and `y_nm = −Math.round(y_mm·1e6)`. Round **in K**, then negate, so a value and its negation round symmetrically. Normalize `−0` to `0`.
- **Pad with drill offset** (KiCad `PAD::ShapePos`: hole at `at`, copper at `at + RotK(offset, α)`, α = pad local angle). Canonical, native convention (copper at `centerMm`, hole at `centerMm + R(β)·drillOffsetMm`):
  - `centerMm = N·(at + RotK(offset, α)) = N·at + R(α)·N·offset`
  - `drillOffsetMm = −N·offset = (−ox, +oy)`
  - `rotationDeg = α`
  - Then the hole is at `centerMm + R(α)·(−N·offset) = N·at`. ✓
  - The implementer cites `pcbnew/pad.cpp` `ShapePos` at the pinned KiCad tag in a comment. If it cannot be cited, SH1 still ships this rule (it is the documented KiCad behaviour) and drill-offset pads stay an explicit open item of A7 until O3 confirms them.
- **Geometry relation** (used by classification, §3.5.1): for transform version 1, the expected canonical local centre of raw pad `r` is `expectedCentreV1(r) = N·(r.position + RotK(r.drillOffset ?? 0, r.rotation))`. Each future transform version defines its own relation in KF1.

#### 3.1.3 Placement composition

The library footprint local frame is canonical and front-side: `p_c = N·p_K,front`.

- **Front instance:** `world_C = N·at_K + R(θ)·p_c`. So `rotationDeg = norm360(θ)`, `mirrored = false`, `layer = F.Cu`.
- **Back instance:** KiCad stores the children already flipped, with local `y` negated, pad and text local angle negated, layers swapped, and footprint `θ` as written. Derivation: `world_K = at_K + RotK(N·p_K,front, θ)`. Hence:
  - `world_C = N·at_K + R(θ)·p_c'`, where `p_c' = N·N·p_K,front = M_x·R(180)·p_c`
  - which gives `world_C = N·at_K + R(θ+180)·M_x·p_c`
  - so **`rotationDeg = norm360(θ + 180)`, `mirrored = true`, `layer = B.Cu`**
  - Today's importer uses `θ` (§2.4). That is wrong for every back-side part.
  - Worked example: a front part at 0 with pad 1 at K-local (−1,0), flipped L/R in KiCad, gives `θ = 180` and world pad at `at + (1,0)`. With the rule above: `M_x·(−1,0) = (1,0)`, then `R(0)` gives `(1,0)`. ✓
  - Independent evidence: the Chickadee board (§2.9). Oracle O4 makes it a test.
- **Pad world rotation** (unchanged in-tree rule): front `φ + β`, back `φ − β`. Here `β` is the library pad rotation: `β = α_K,front` for `.kicad_mod`, and `α_abs − θ` (front) or `θ − α_abs` (back) when un-placing a board instance.
- **3D back-side model:** KiCad renders the flipped model as `R_z(θ)·diag(1,−1,−1)`, which equals `R_z(θ+180)·diag(−1,1,−1)`. In C, the model group therefore gets rotation `φ` and **scale `(−1, 1, −1)`**, a proper rotation (det = +1), placed at `z = −thickness`. The flat 2D overlay keeps `(−1,1,1)`.
- **KiCad 3D model `(offset)`** is taken to be in the 3D Y-up frame (applied after KiCad's board→3D Y negation), so it is copied unchanged. **Not verified** (no KiCad source); the `(rotate)` sign and order are also unverified. OP6 verifies both against cited source or records "unverified" in KF1 (§5 E17).
- **Schematic:** `.kicad_sch` positions are K and `.kicad_sym` locals are Ks (Y-up). `world_C = N·at_K + R(θ)·p_s` (verified 91/92, §2.9). The `(mirror …)` mapping is fixed by the corpus pin oracle in §3.8 (OP11), **not** by USBtoUART (it has no mirrors).

#### 3.1.4 Boundaries: exactly-once rule

| Data path | The ONE transform site | Everything downstream |
|---|---|---|
| `.kicad_mod` → library (wizard, ZIP, drawn+imported, project ingestion, CoreLibrary batch import) | `kicadPointToCanonical` / `kicadPadToCanonical` in `shared/packages/kicad-import/src/frame.ts`, called only from `build-preview-models.ts` footprint functions | stores C. `raw` stays K by contract and is never rendered. Any reader comparing `raw` with `preview` must go through the KF1 geometry relation (§3.5.5) |
| `.kicad_pcb` board-instance footprint → library form | `unplaceBoardFootprint` (K→K normalization: un-rotate angles, un-flip back side, `src/shared/kicad-frame/`), then path 1 | as above |
| `.kicad_pcb` board items (placements, tracks, arcs, vias, zones, keepouts, outline, board graphics) and `.kicad_sch` positions | `KicadBoardFrame` in `kicad-frame.ts`, called by H14's `frame-port.ts` call sites | C |
| Legacy library rows | re-derivation from `raw` through path 1 (OP8) | C |
| CoreLibrary `.opclib` | precomputed at pack time through path 1 (CL2) | C; intake verifies signature + stamp |
| Snapshots, projections, undo, save/reopen, cloud sync, export | **none** | C |

Grep guard (test, OP9): `kicad-frame-boundary.test.ts` reads the source of the designer import planner files. It fails if `\.yMm\b` is dereferenced outside `kicad-frame.ts`, `frame-port.ts`, or an allowlist of parser files.

### 3.2 Provenance model

#### 3.2.1 Shared (`shared/packages/kicad-import/src/types.ts`, additive)

```ts
export interface FootprintFrameStamp {
  readonly frame: "openpcb-y-up";
  readonly origin: "kicad-converted";
  /** Bumped whenever the K→C conversion output changes for the same input. */
  readonly transformVersion: number;          // 1 in this item
  readonly tool: "@openpcb/kicad-import";
}
export interface FootprintPreviewModel extends FootprintRenderModel {
  readonly pads: readonly FootprintPreviewPad[];
  /** Always present on models built by @openpcb/kicad-import ≥ 0.2.0. */
  readonly frame: FootprintFrameStamp;
}
```

New `shared/packages/kicad-import/src/frame.ts`:

```ts
export const KICAD_FOOTPRINT_TRANSFORM_VERSION = 1 as const;
export const KICAD_FOOTPRINT_FRAME_STAMP: FootprintFrameStamp = Object.freeze({
  frame: "openpcb-y-up", origin: "kicad-converted",
  transformVersion: KICAD_FOOTPRINT_TRANSFORM_VERSION, tool: "@openpcb/kicad-import",
});
/** THE single K→C point map for footprint-local geometry. Angles are NOT changed (KF1 §3.1.2). */
export function kicadPointToCanonical(p: PointMm): PointMm {
  return { x: p.x, y: p.y === 0 ? 0 : -p.y };
}
/** Pad centre + drill offset per KF1 §3.1.2 (KiCad PAD::ShapePos). */
export function kicadPadToCanonical(pad: { position: PointMm; rotation: number; drillOffset?: PointMm }):
  { centerMm: PointMm; drillOffsetMm?: PointMm };
/** Frame-delta report between a pre-0.2.0 preview (K) and a 0.2.0 preview (C) of the SAME raw.
 *  Shared by CoreLibrary CL2 and OpenPCB OP8 so both apply one rule (§3.9, §3.5.2 b4). */
export interface FrameConversionDelta {
  frameOnly: boolean;                    // every copper invariant holds
  padViolations: Array<{ padId: string; field: string; old: unknown; new: unknown }>;
  additions: Array<{ kind: AllowedAddition; count: number }>;   // reported, allowed
  other: Array<{ kind: string; detail: string }>;               // anything else ⇒ not frameOnly
}
export type AllowedAddition =
  | "plated-flag" | "courtyard-graphics" | "mask-graphics" | "paste-graphics"
  | "paste-subpads" | "frame-stamp" | "label-id";
export function compareFrameConversion(oldK: FootprintRenderModel, newC: FootprintPreviewModel): FrameConversionDelta;
```

`compareFrameConversion` copper invariants, per electrical (non-paste) pad id present in `oldK`:
- `newC` has the same id, number and shape;
- `centerMm == expectedCentreV1` derived from the old pad (`N·old.centerMm`, plus the drill-offset shift when `old.drillOffsetMm` is set);
- `widthMm`, `heightMm`, `rotationDeg`, `roundrectRatio`, `drillDiameterMm` unchanged;
- `drillSlotMm` unchanged, **or** newly present where the raw pad has an oval drill. That second case is reported as an `other` entry `slot-drill-added`, so it is never silent;
- `drillOffsetMm == −N·old.drillOffsetMm`.

No electrical pad may disappear. Any graphics kind not listed in `AllowedAddition` that changes beyond `N·old` is `other`.

`index.ts` re-exports `frame.js` and the types.

#### 3.2.2 OpenPCB types (`src/sdks/library/types.ts`, additive; pure types)

```ts
export type FootprintFrameOrigin = "kicad-converted" | "authored";
export interface FootprintFrameProvenance {
  frame: "openpcb-y-up";
  origin: FootprintFrameOrigin;
  /** kicad-converted: ≥1; authored: 0. */
  transformVersion: number;
  /** "@openpcb/kicad-import" | "openpcb-editor" | "ipc-7351b" | "parametric:<id>" */
  tool: string;
}
export type LibraryFootprintFrameClass =
  | "kicad-converted"      // canonical; stamp qualified AND verified (signature or geometry)
  | "authored"             // drawn / IPC / parametric — natively canonical, no KiCad raw
  | "placeholder"          // no geometry
  | "legacy-kicad-ydown"   // KiCad-derived, stored in K (mirrored)
  | "ambiguous";           // cannot be proven either way
/** How the class was established. Re-derived from evidence on every classification — never copied. */
export type LibraryFootprintFrameTrust =
  | "signed-pack"          // pack row, signature valid now (library_releases)
  | "geometry-verified"    // preview == KF1 relation(raw) for the stamped transform version
  | "markers";             // authored rows without KiCad raw (no K source exists to mirror)
export interface LibraryFootprintFrameEvidence {
  footprintId: string;
  frameClass: LibraryFootprintFrameClass;
  trust: LibraryFootprintFrameTrust | null;
  frame: FootprintFrameProvenance | null;
  /** Current row preview (C or K depending on class). */
  currentPreview: FootprintRenderModel | null;
  /** Pre-rewrite preview from library_footprint_frame_backups (latest run), else null. */
  legacyPreview: FootprintRenderModel | null;
  reason: string;
}
```

Additive optional fields:
- `LibraryFootprintPlacementSnapshot`: `frame?: FootprintFrameProvenance; frameClass?: LibraryFootprintFrameClass; frameTrust?: LibraryFootprintFrameTrust;`
- `LibraryDefaultFootprintRef`: `frameClass?: LibraryFootprintFrameClass;`
- `LibraryFootprintDetail` (UI): `frameClass?: LibraryFootprintFrameClass; frameReason?: string;`

#### 3.2.3 Predicates (`src/shared/pcb-geometry/footprint-frame.ts`, new; imports types only from `sdks/library`)

```ts
export const CANONICAL_FOOTPRINT_FRAME = "openpcb-y-up" as const;
export const QUALIFIED_KICAD_TRANSFORM_VERSIONS: readonly number[] = [1];
export function parseFootprintFrame(value: unknown): FootprintFrameProvenance | null;
  // strict: object, frame === CANONICAL, origin ∈ {kicad-converted, authored},
  // Number.isInteger(transformVersion), kicad-converted ⇒ ≥1, authored ⇒ 0, tool non-empty string ≤ 128
export function isQualifiedFootprintFrame(f: FootprintFrameProvenance | null): boolean;
  // shape/version check ONLY — never sufficient on its own to qualify a row (§3.5.1)
export function authoredFrame(tool: string): FootprintFrameProvenance; // {frame, origin:"authored", transformVersion:0, tool}
export function isVerifiedFrameClass(cls: LibraryFootprintFrameClass | undefined): boolean; // kicad-converted | authored
export function isCopperFrameInvariant(preview: FootprintRenderModel): boolean;
  // every non-paste pad: |centerMm.y| ≤ 1e-6, rotationDeg mod 90 within 1e-9,
  // shape ∈ {rect,oval,roundrect,circle}, drillOffsetMm?.y ≈ 0 (≤1e-6)
export function previewCopperEqual(a, b, tolMm = 1e-6): boolean; // pad ids, centres, sizes, rotation, drill, offsets
export function previewEqual(a, b, tolMm = 1e-6): boolean;       // copper + graphics + labels positions
/** KF1 geometry relation between raw (K) pads and preview pads, per electrical pad id `n:i`. */
export type RawFrameRelation = "verbatim" | "converted-v1" | "invariant" | "neither" | "unusable";
export function rawFrameRelation(preview: FootprintRenderModel, rawPads: unknown, rawGraphics?: unknown): RawFrameRelation;
  // verbatim: all centres == raw.position; converted-v1: all == expectedCentreV1(raw).
  // If BOTH hold (copper y-symmetric), compare non-symmetric graphics/text positions;
  // "invariant" only if graphics cannot decide either.
```

`expectedCentreV1` is implemented here **independently** of the shared package (≤15 lines) so that the classifier does not trust the producer it is checking. A unit test pins it to the `@openpcb/kicad-import` output on the §3.3 goldens once re-pinned.

#### 3.2.4 Installed-package detection (`src/modules/library/backend/import/frame-qualification.ts`, new; typechecks against 0.1.2)

```ts
import * as kicadImport from "@openpcb/kicad-import";
export function installedKicadTransformVersion(): number | null {
  const v = (kicadImport as unknown as Record<string, unknown>)["KICAD_FOOTPRINT_TRANSFORM_VERSION"];
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}
/** Reads the producer stamp from a server-built preview (never from a client payload). */
export function readPreviewFrame(preview: unknown): FootprintFrameProvenance | null; // parseFootprintFrame((preview as {frame?: unknown}).frame)
export function isKicadConversionQualified(): boolean; // QUALIFIED_KICAD_TRANSFORM_VERSIONS.includes(installedKicadTransformVersion() ?? -1)
```

### 3.3 Shared package change (SH1)

In `build-preview-models.ts`, footprint functions only:
1. Add the local helper `fp(value: unknown): PointMm | null = map(pointFromUnknown(value), kicadPointToCanonical)`. Use it for every point in `footprintGraphicFromParsed`:
   - line `a`/`b`
   - rect `start`/`end`, converted **before** the min/abs computation
   - circle `center`/`end`
   - arc `start`/`mid`/`end`
   - poly points
   - text `parsed.position`, and the legacy `at` fallback via the mapped `{x,y}`
2. Label id uses the converted coordinates. Rotation fields are untouched.
3. In `footprintPadFromParsed`: `{centerMm, drillOffsetMm} = kicadPadToCanonical(pad)` (KF1 §3.1.2, KiCad `ShapePos` semantics; adopts H19's finding-13 note); `rotationDeg = pad.rotation` (unchanged).
4. `buildFootprintPreviewFromParsed` returns `{ ...model (+pasteSubPads), frame: KICAD_FOOTPRINT_FRAME_STAMP }`.
5. `raw` is never mutated. A test deep-freezes the input.
6. No change to the `ParsedKicadFootprint` input type or to the symbol builder.
7. Export `compareFrameConversion` (§3.2.1).

`README.md` gets a "Coordinate frame (0.2.0, BREAKING)" section, including the drill-offset semantics. The version stays `0.2.0` because it was never tagged; the frame change rides in the same breaking release.

**Golden expectations** (copied verbatim into `frame.test.ts` from `../references/kicad-libs` @`cb8299c`; inline excerpts with a source comment):

| Footprint | Expected after conversion |
|---|---|
| SOT-23 | pad 1 = (−0.9375, +0.95), pad 2 = (−0.9375, −0.95), pad 3 = (0.9375, 0) |
| SOIC-8_3.9x4.9mm_P1.27mm | pins 1..4 = (−2.475, +1.905 / +0.635 / −0.635 / −1.905); pins 5..8 = (+2.475, −1.905 / −0.635 / +0.635 / +1.905). Numbering is CCW seen from the top: signed area of pad centres in number order > 0 |
| CP_Elec_4x5.4 | silk "+" horizontal stroke from (−3, 1.56) to (−2.5, 1.56); vertical stroke at x = −2.75 from y 1.31 to 1.81. Top-left: x<0, y>0 |
| synthetic `FRAME_PROBE` (inline) | pad 2 `(at 1 −2 30) (drill 0.8 (offset 0.3 0.2))`: hole stays at N·at = (1, 2); copper centre = (1,2) + R(30)·(0.3,−0.2); `drillOffsetMm` = (−0.3, 0.2); a 30° pad keeps 30; an arc (0,−1)→(1,0)→(0,1) keeps its mid on the arc and its signed turn reverses; a text at (1,−2,45°) becomes (1,2,45°); poly winding reverses |

Also:
- Stamp equality on every built model.
- Symbol preview of a fixture symbol is byte-identical before and after.
- `compareFrameConversion` table: frame-only SOT-23 → `frameOnly`; a size change → `padViolations`; an added courtyard → `additions`; an added slot → `other`.

### 3.4 Data model and migrations (OpenPCB)

#### 3.4.1 Library: `src/modules/library/backend/migrations/0012_footprint_frame_provenance.sql`

H14's `0012_import_staging.sql` sorts after this file. They are independent.

```sql
-- 0012_footprint_frame_provenance.sql — H13 frame classification + rewrite backups.
-- frame_* columns are a CLASSIFICATION CACHE. They are valid ONLY while
-- frame_data_sha256 = sha256(data_json) AND frame_classifier_version = current; any reader
-- seeing a mismatch reclassifies (§3.5.5). Pack rows keep data_json byte-identical to the signed asset.
ALTER TABLE library_footprints ADD COLUMN frame_class TEXT;
--> statement-breakpoint
ALTER TABLE library_footprints ADD COLUMN frame_transform_version INTEGER;
--> statement-breakpoint
ALTER TABLE library_footprints ADD COLUMN frame_trust TEXT;
--> statement-breakpoint
ALTER TABLE library_footprints ADD COLUMN frame_reason TEXT;
--> statement-breakpoint
ALTER TABLE library_footprints ADD COLUMN frame_data_sha256 TEXT;
--> statement-breakpoint
ALTER TABLE library_footprints ADD COLUMN frame_classifier_version INTEGER;
--> statement-breakpoint
ALTER TABLE library_footprints ADD COLUMN frame_rewrite_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE library_footprints ADD COLUMN frame_classified_at TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS library_footprints_frame_class_idx ON library_footprints (frame_class);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS library_frame_migration_runs (
  run_id TEXT PRIMARY KEY NOT NULL,     -- ulid
  migration_name TEXT NOT NULL,         -- '2026_10_footprint_frame_v1' | 'pack:<libId>@<version>' | 'revert:<run_id>'
  started_at TEXT NOT NULL,
  finished_at TEXT,
  db_snapshot_path TEXT,                -- VACUUM INTO file, or NULL
  report_json TEXT                      -- FootprintFrameMigrationReport
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS library_footprint_frame_backups (
  footprint_id TEXT NOT NULL,           -- no FK: a backup must outlive row deletion
  run_id TEXT NOT NULL,                 -- library_frame_migration_runs.run_id
  data_json TEXT NOT NULL,              -- the exact pre-rewrite data_json
  content_sha256 TEXT,
  frame_class_before TEXT,
  post_data_sha256 TEXT,                -- sha256 of the data_json written by this run (revert guard)
  backed_up_at TEXT NOT NULL,
  PRIMARY KEY (footprint_id, run_id)
);
```

`schema.ts`: add the eight columns to `footprints`, and table definitions `frameMigrationRuns`, `footprintFrameBackups`.

The `data_json` hash binding (§10 #4) means no writer has to remember the columns. A write path that updates `data_json` without updating them leaves a mismatched hash, so the row reads as unclassified and is reclassified inline. A trigger was considered and rejected: it would null columns that a writer sets in the same statement.

#### 3.4.2 Designer: `src/modules/designer/backend/migrations/0021_design_frame_status.sql`

Distinct name from H08's, H14's and H19's `0021_*`. The name-set migrator handles them (§2.6). P103's `DESIGNER_SCHEMA_HEAD` test follows whichever lands last (§4.7).

```sql
-- 0021_design_frame_status.sql — H13 persistent board-level frame flag.
CREATE TABLE IF NOT EXISTS designer_frame_status (
  design_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('native','qualified','legacy-mirrored','ambiguous')),
  classifier_version INTEGER NOT NULL,
  classified_revision INTEGER NOT NULL,
  legacy_project_import INTEGER NOT NULL DEFAULT 0,
  findings_json TEXT NOT NULL,          -- DesignFrameFinding[] (capped 200, + omitted count)
  first_flagged_at TEXT,                -- first time status ∉ {native, qualified}; never cleared
  resolved_at TEXT,                     -- last transition back to native/qualified
  classified_at TEXT NOT NULL
);
```

The row is **recomputed on every banner/route request** (§3.6.3) and upserted. Persistence gives the durable flag and history (`first_flagged_at`, `resolved_at`), a cheap read for dataset capture (§3.6.6) and an audit trail. The export path never reads or writes it as its decision; it recomputes over its own snapshot (§3.7). No design entity row is ever modified by H13.

`schema.ts`: add `designFrameStatus`. Design deletion: add `designer_frame_status` to the existing per-design delete list in `store.ts`.

### 3.5 Library behaviour

#### 3.5.1 Classification (`src/modules/library/backend/builtins/footprint-frame-classify.ts`, new, pure)

```ts
export const FOOTPRINT_FRAME_CLASSIFIER_VERSION = 1;
export interface FootprintFrameClassification {
  frameClass: LibraryFootprintFrameClass;
  frame: FootprintFrameProvenance | null;
  trust: LibraryFootprintFrameTrust | null;
  reason: string;
}
export function classifyFootprintRow(row: {
  id: string; sourceId: string | null; dataJson: string;
  signatureValid: boolean | null;   // from library_releases for pack sources, else null
}): FootprintFrameClassification;
```

**Trust principle (§10 #5).** A stamp in `provenance.frame` is a claim, never evidence. A `kicad-converted` class requires one of two things: a pack signature that is valid now, or the KF1 geometry relation `preview == expectedCentreV1(raw)`. Trust is re-derived from the row's own data on every classification, never from `source_id` and never copied. Clones and cloud repacks therefore cannot launder a stamp: an unsigned row with a lying stamp fails the geometry relation. A locally converted row passes by construction.

Definitions:
- `kicadRaw` = `raw.pads` is a non-empty array of objects with numeric `position` (a KiCad parse). Project-derived rows (raw root has a footprint-level `(at …)`) carry board-local K raw; the relation compares against those board-local positions, exactly as the preview was built from them.
- `rel = rawFrameRelation(preview, raw.pads, raw.graphics)` (§3.2.3).
- `stamp = parseFootprintFrame(provenance.frame)`.

Rules, first match wins:

| # | Condition | Result (class / trust) |
|---|---|---|
| 1 | `sourceKind === "system" && sourceFormat === "placeholder"`, or `sourceHash` starts with `placeholder:` | `placeholder` / null |
| 2 | `provenance.frame` present but `stamp` null or version unqualified | `ambiguous` ("frame stamp unqualified: …") |
| 3 | `stamp.origin === "kicad-converted"`, pack source with `signatureValid === true` | `kicad-converted` / `signed-pack` |
| 4 | `stamp.origin === "kicad-converted"`, otherwise | `rel ∈ {converted-v1, invariant}` gives `kicad-converted` / `geometry-verified`. `rel === verbatim` gives `legacy-kicad-ydown` ("stamp contradicts geometry"). `neither`/`unusable` gives `ambiguous` ("self-declared stamp not verifiable") |
| 5 | `stamp.origin === "authored"` and **not** `kicadRaw` | `authored` / `signed-pack` if signed pack, else `markers` |
| 6 | `stamp.origin === "authored"` and `kicadRaw` | ignore the stamp, go to row 8 ("authored stamp on KiCad-source row") |
| 7 | No stamp. Authored markers (`sourceKind ∈ {drawn, generated}` with `sourceFormat ∈ {openpcb-editor, ipc-7351b}`, or `sourceHash` starts with `drawn:`/`generated:`) and not `kicadRaw` | `authored` / `markers`, frame = `authoredFrame(sourceFormat)` |
| 8 | KiCad markers (`sourceKind === "imported" && sourceFormat ∈ {kicad_mod, kicad_zip}`, or `source === "kicad-derived"`, or `sourceFormat === "kicad-mod"`) or `kicadRaw` | `rel ∈ {verbatim, invariant}` gives `legacy-kicad-ydown` (copper-invariant ties count as legacy: unstamped data came from a pre-0.2.0 build). `converted-v1` gives `kicad-converted` / `geometry-verified`. `neither`/`unusable` gives `ambiguous` |
| 9 | Otherwise | `ambiguous` ("no provenance markers") |

The classifier writes `frame_data_sha256 = sha256(data_json)` and `frame_classifier_version` along with the class.

Reason suffixes when the class is kicad-derived (legacy or converted):
- `library_footprint_models.model_ref_json` has `scale` with negative determinant: append `"; model-ref mirror compensation present"` (§5 E16).
- The model row's `glb_sha256` is in `MIRROR_COMPENSATED_CORE_GLBS` (§3.9 CL3): append `"; 3D model carries baked CoreLibrary mirror compensation"` (§10 #12).

#### 3.5.2 Startup passes (`src/modules/library/backend/builtins/migrate-footprint-frame.ts`, new)

```ts
export const FOOTPRINT_FRAME_MIGRATION = "2026_10_footprint_frame_v1";
export const MAX_FRAME_REWRITE_ATTEMPTS = 3;
export interface FootprintFrameMigrationReport {
  runId: string; classified: number; rewritten: number; skippedAmbiguous: number;
  failed: Array<{ footprintId: string; reason: string; attempts: number }>;
  nonFrameDelta: Array<{ footprintId: string; delta: FrameConversionDelta }>;
  snapshotPath: string | null; ms: number; rewriteEnabled: boolean;
}
export function classifyFootprintFrames(ctx: CoreBackendModuleContext, opts?: { now?: () => string }): { classified: number };
export async function migrateFootprintFrames(ctx: CoreBackendModuleContext,
  opts?: { now?: () => string; rewrite?: boolean }): Promise<FootprintFrameMigrationReport>;
export function revertFootprintFrameRun(ctx: CoreBackendModuleContext, runId: string):
  { restored: number; skippedChanged: string[] };
```

**Environment (read once in `onActivate`):**
- `OPENPCB_LIBRARY_FRAME_REWRITE=0|1`. Default: `isKicadConversionQualified()`. `0` holds the rewrite pass, for example after a revert.
- `OPENPCB_LIBRARY_FRAME_REVERT=<runId>`. Runs `revertFootprintFrameRun` before any other pass, under the app's single writer, then implies `REWRITE=0` for this launch.

**`onActivate` order** (`library/backend/index.ts`; fixes §10 #2):
1. `OPENPCB_LIBRARY_FRAME_REVERT` if set.
2. `classifyFootprintFrames` (**before** `bootstrapCoreLibrary`), so the pack importer sees classified rows.
3. `bootstrapCoreLibrary`, then the dev watcher. The opclib importer's pack-update backup (§3.5.4) also classifies inline any row whose cache is stale.
4. `rebuildPreviewModelsIfStale` (symbols only; unchanged).
5. `migrateFootprintFrames` (rewrite pass).

Each step is wrapped in try/catch and never throws out of `onActivate`. Errors are logged; rows stay classified.

**Classify pass** (OP3a, pinned-compatible). Candidates: rows with `frame_class IS NULL`, `frame_classifier_version` older than current, or `frame_data_sha256` not equal to `sha256(data_json)`. Hashing every row at boot is cheap (hundreds of rows). Batches of 200 per `BEGIN IMMEDIATE`.

**Rewrite pass** (OP8, re-pin-gated; runs only when rewrite is enabled and `isKicadConversionQualified()`). Candidates: `source_id = 'user.local' AND frame_class = 'legacy-kicad-ydown' AND frame_rewrite_attempts < MAX_FRAME_REWRITE_ATTEMPTS`, plus `user.local` `kicad-converted` rows whose stamp `transformVersion` is lower than the installed version (future bumps).
- a. Insert a `library_frame_migration_runs` row for this run.
- b. **DB snapshot, at most once per migration name** (§10 #3). If no earlier run with `migration_name = FOOTPRINT_FRAME_MIGRATION` has a non-null `db_snapshot_path`, take one (§3.5.3) and record it. On failure (including the free-space precheck), abort the rewrite pass for this launch and log `frame_migration_snapshot_failed`. Later runs of the same migration (for example new dev-mode legacy imports) rely on per-row backups only. There is no repeated full-DB copy, so no retention policy is needed beyond H46.
- c. Per row, in its own `BEGIN IMMEDIATE`:
  1. Re-read the row. Skip it if its `frame_data_sha256` or class changed (concurrency).
  2. `src = raw.rawSource`. If the root `footprint` node has a footprint-level `(at …)` or `(layer "B.Cu")`, it is project-derived: `src = serializeSexpr(unplaceBoardFootprint(parseSexpr(src)).node)`.
  3. `bundle = parseImportBundle({ footprints:[{ fileName: provenance.fileName ?? row.name + ".kicad_mod", content: src }] })`, through the existing shim `import/inspect-kicad.ts`. Then `fpN = bundle.normalizedFootprints[0]`.
  4. **Identity + delta check:**
     - The multiset of electrical pad numbers of `fpN.preview` must equal the old preview's.
     - Every `pinMapJson.padNumber` of every `library_component_footprints` row referencing this footprint must exist.
     - `compareFrameConversion(oldPreviewInLibraryForm, fpN.preview).frameOnly` must hold. For project-derived rows, `oldPreviewInLibraryForm` is the old board-local preview with the same unplace normalization applied (K→K). Rotation-only differences from unplacing are part of the identity, not violations.
     - On failure: set class `ambiguous`, reason `pad-set-changed` / `non-frame-delta: …`, add the delta to the report, and do not rewrite. `ambiguous` rows are not candidates, so this terminates.
  5. **Frame check:** `readPreviewFrame(fpN.preview)` must be qualified. Otherwise abort the whole pass (the package is not qualified).
  6. Insert the backup row `(id, runId, old data_json, old content_sha256, old frame_class, post_data_sha256, now)`.
  7. Write the new `data_json`, built by **preview-only merge** (§10 #12). It equals the old one except:
     - `normalized.preview = fpN.preview` and `normalized.padCount = fpN.padCount` when present. Every other `normalized` field (id, name, description, tags, `packageCode`, `sourceHash`) is kept.
     - `raw`: kept for direct rows. For project-derived rows it is replaced by the re-parsed library-form raw from `src` (keeping `rawSource = src`), with `provenance.rawForm = "library"`, so the KF1 relation keeps working. The old raw lives in the backup.
     - `provenance.frame = fpN.preview.frame`, `provenance.frameMigratedAt = now`, `provenance.frameMigrationRun = runId`
     - `provenance.sourceHash` is **unchanged**. Staleness of placed parts is driven by the frame rule (§3.6.4), not by a hash change.
     - `content_sha256 = NULL` if it was non-null, and delete `library_preview_svgs` rows keyed by the old sha.
     - columns: reclassify the new `data_json` (expected `kicad-converted` / `geometry-verified`; anything else rolls back the row transaction).
  8. On an exception, roll back the row, then in a separate statement increment `frame_rewrite_attempts`. At `MAX_FRAME_REWRITE_ATTEMPTS`, set `ambiguous` with reason `rewrite-failed: <error>`. One poisoned row can no longer cause unbounded retries (§10 #3).
- d. Finish the run row with the report. Write the sentinel `openpcb_migrations('library', FOOTPRINT_FRAME_MIGRATION)` once no candidate remains. Re-runs are idempotent: candidates are re-queried each start.

**Pack rows** (`source_id ≠ 'user.local'`) are **never rewritten** here. They are updated by installing a qualified pack (§3.5.4). Team packs stay legacy until their owner republishes.

**Revert** (`revertFootprintFrameRun`, §10 #17), run only through `OPENPCB_LIBRARY_FRAME_REVERT` in the app's own process (single writer). For each backup of the run:
- if `sha256(current data_json) === post_data_sha256`, restore `data_json`/`content_sha256` and null the `frame_*` columns;
- otherwise skip and report the id in `skippedChanged`, so edits made after the migration are never overwritten blindly.

It records a `revert:<runId>` run row and deletes the sentinel. There is no standalone revert script and no HTTP route.

#### 3.5.3 Backup (`src/modules/library/backend/builtins/frame-backup.ts`, new)

This is a minimal H46 seam.

```ts
/** Consistent whole-DB snapshot via `VACUUM INTO`; returns null for in-memory DBs. Throws on failure. */
export function snapshotDatabase(db: LibraryDb, reason: string, now: string): string | null;
```

- Path: `SELECT file FROM pragma_database_list WHERE name = 'main'`. An empty result means in-memory: return null; the row backups still apply.
- Free-space precheck: `fs.statfsSync(dir)` must report at least 2× the DB file size (plus WAL) available. Otherwise throw `frame_snapshot_insufficient_space`.
- Target: `<dirname>/backups/<reason>-<YYYYMMDDTHHmmssZ>-<8 hex>.sqlite`. `mkdir -p` the directory. The target must not exist.
- Run `VACUUM INTO ?` outside any transaction. **Unverified** that the module Drizzle handle accepts `VACUUM INTO` with a bound parameter inside `onActivate`; OP8's first test proves it, and the fallback is a quoted literal path built from the validated directory and file name.
- No automatic deletion. At most one file per migration name (§3.5.2 b). H46 owns retention.
- It uses only the module's own Drizzle handle (`db.run(sql\`VACUUM INTO ${path}\`)`), so there is no `src/core/backend` import.

#### 3.5.4 Intake: qualification-based (replaces the blanket quarantine)

The file `unqualified-import.ts` keeps its name. Its policy changes:

```ts
export type IntakeFrameDecision = {
  accepted: true; frameClass: LibraryFootprintFrameClass;
  frame: FootprintFrameProvenance | null; trust: LibraryFootprintFrameTrust | null;
};
/** KiCad .kicad_mod paths (direct, ZIP, drawn+imported, project). previews are SERVER-built (parseImportBundle). */
export function qualifyKicadFootprintIntake(source: "kicad_mod" | "kicad_zip" | "kicad_project",
  footprints: Array<{ id: string; preview: unknown; raw: unknown }>): Map<string, IntakeFrameDecision>;
/** .opclib packs. verdictValid = verifyManifest(...).valid. */
export function qualifyPackFootprintIntake(pkg: OpclibPackage, verdictValid: boolean,
  hooks?: IntakeQualificationHooks): Map<string, IntakeFrameDecision>;
/** Slot for H15: generator qualification of authored/generated assets (H15 owns the classifier). */
export interface IntakeQualificationHooks {
  generator?(asset: { pads: readonly unknown[] | null; generation: unknown }):
    { status: "qualified" | "unqualified-generator" | "not-generated"; reason: string | null };
}
```

Both throw `UnqualifiedImportError` when rejecting.

**KiCad intake.** A footprint is qualified iff:
- `isKicadConversionQualified()`, **and**
- `readPreviewFrame(preview)` is non-null, with origin `"kicad-converted"` and `transformVersion === installedKicadTransformVersion()`, **and**
- `rawFrameRelation(preview, raw.pads) ∈ {converted-v1, invariant}`. This is cheap and catches a broken build.

Outcomes:
- Qualified: accept with `frameClass "kicad-converted"`, trust `geometry-verified`.
- Not qualified and flag `library.footprintIntakeQuarantine` on (release): throw `UnqualifiedImportError` as today, adding extension `reason: "frame-unqualified"` and `installedTransformVersion`.
- Not qualified and flag off (dev/test): accept with `frameClass "legacy-kicad-ydown"`, trust null. The startup pass migrates it once qualified.

**Pack intake.** A pack with zero footprints is accepted as today. For each footprint asset, classify the would-be row with `classifyFootprintRow` (§3.5.1) using `signatureValid = verdictValid`. Qualified iff the class is `kicad-converted` or `authored`, **and** `hooks.generator` (when registered) does not return `unqualified-generator`.
- Flag on: **any** unqualified footprint rejects the whole pack. Same error shape, with `reason: "signature-unverified" | "frame-unqualified" | "generator-unqualified"` per affected entry, capped at 20.
- Flag off: accept, and store the classification.

A forged stamp without a valid signature passes only if the geometry proves it. Unsigned cloud repacks (§2.5) of correctly converted rows therefore install in dev, while lying ones classify as legacy or ambiguous. This keeps today's "self-declared provenance cannot authorize" invariant.

The generator slot is H13's surface; **H15 owns the classifier and the one wiring line** (H15 §8 says H13's qualifier consumes `classifyFootprintGeometry`; this records that H15 plugs it in, §8).

**Stamping on every write path.** Each path writes `provenance.frame` and reclassifies, so the columns and hash are always fresh:

| Path | Stamp |
|---|---|
| `commit-kicad.ts` | `provenance.frame` = the preview stamp |
| `commit-drawn.ts` (import mode) | as `commit-kicad.ts` |
| `commit-kicad-zip.ts` | keeps the `kicad_zip` rewrite, preserving `frame` |
| `footprint-record.ts` / `commit-generated.ts` | `provenance.frame = authoredFrame(sourceFormat)` |
| `opclib-importer.ts` | classify the new row. Before overwriting an **existing** row, classify it inline if its cache is stale. If its class is not a verified class (`legacy-kicad-ydown`, `ambiguous`, or NULL before classification), insert a backup under a run `pack:<libId>@<version>` (one run row per pack install). This feeds `legacyPreview` evidence (§10 #2) |
| `copyFootprintsForClone` (`queries.ts:1614-1625`) | no column copy. The clone is classified from its own data (trust is never inherited, §10 #5) |

**Frame-aware dedupe** (`commit-kicad.ts:94-123`): `findExistingFootprintId` additionally requires:
- the row's fresh class and transform version to equal the incoming decision, **and**
- class ≠ `ambiguous`.

A legacy row is therefore never reused by a qualified import, and a qualified row is never reused by an unqualified dev import.

**3D model mirror guard** (§10 #24; warn, not refuse). The model upload route and `models/import` add `warnings: [{ code: "MODEL_MIRROR_ON_CANONICAL_FOOTPRINT", footprintId }]` to their success payload when the written `model_ref_json.scale` has a negative determinant and the footprint's class is `kicad-converted` or `authored`. The library detail shows the E16 reason. Refusal was rejected: 3D alignment never affects manufacturing output, and a refusal would break restoring an exported model bundle.

**Inspect response** (`routes.ts` inspect handlers, additive). Add `intake: { footprints: "qualified" | "unqualified"; transformVersion: number | null; requireQualification: boolean }`. The wizard (`FootprintStep.tsx:106`) shows the unavailable banner only when `requireQualification && footprints === "unqualified"`, replacing the static flag check. `FOOTPRINT_IMPORT_UNAVAILABLE` copy is unchanged.

**Feature flag** (`registry.ts:114-120`): keep the name `library.footprintIntakeQuarantine` (env override names and the e2e fixture `c723bb0` depend on it). Change the description to "Require verified frame provenance (signed pack or geometry-verified KiCad conversion) for footprint intake". Availability stays `prod`. `designer.outputQuarantine` is **unchanged**.

#### 3.5.5 Snapshots, readers and evidence

- `parseFootprintPlacementSnapshot` (`queries.ts:429`) sets `frameClass`, `frameTrust` and `frame`. They come from the row columns **only if** `frame_data_sha256 = sha256(data_json)` and the classifier version is current; otherwise from an inline `classifyFootprintRow` (§10 #4). For the authored class, `frame` falls back to `authoredFrame`.
- `getDefaultFootprintRefs` adds `frameClass` (same freshness rule; one `json_extract`-free sha comparison per row).
- **Frame-aware plating identity** (§10 #19). `rawPadMatchesPreview` (`queries.ts:516-530`) compares `raw.position` with the preview centre through the KF1 relation: verbatim when the preview has no qualified `kicad-converted` stamp, `expectedCentreV1(raw)` when it has one. KF1 states the invariant: "`raw` is K; any raw↔preview comparison goes through the relation of the preview's stamped transform version".
- New LibrarySDK methods (`src/sdks/library/index.ts`; implementation in `queries.ts buildSdk`):

```ts
getFootprintFrameEvidence(footprintIds: readonly string[]): Promise<Record<string, LibraryFootprintFrameEvidence>>;
/** Snapshot of a SPECIFIC footprint variant of a component (same shape as resolveComponentForPlacement().footprint). */
resolveFootprintPlacementSnapshot(componentId: string, footprintId: string): Promise<LibraryFootprintPlacementSnapshot | null>;
```

`getFootprintFrameEvidence` runs one `IN` query on `library_footprints` plus the latest backup per id (by `backed_up_at DESC`). Unknown ids are absent. Run `npm run gen` and commit `src/core/frontend/src/generated/sdk/**`.

### 3.6 Designer classification

#### 3.6.1 Types (`src/sdks/designer/types.ts`, additive)

```ts
export type DesignFrameStatusValue = "native" | "qualified" | "legacy-mirrored" | "ambiguous";
export type PlacementFrameClass =
  | "canonical-authored" | "canonical-kicad" | "no-geometry"
  | "legacy-copper-invariant" | "legacy-mirrored" | "ambiguous";
export type DesignFrameResolution =
  | "reimport-project" | "refresh-footprint" | "refresh-footprint-safe" | "update-library" | "replace-part";
export interface DesignFrameFinding {
  kind: "legacy-project-import" | "legacy-footprint" | "legacy-footprint-copper-invariant" | "ambiguous-footprint";
  placementId?: string; partId?: string; reference?: string; footprintId?: string;
  /** Pads in a connectivity component with any trace, via, pour or free pad (informational). */
  connectedPadCount?: number;
  resolution: DesignFrameResolution;
  detail: string;
}
export interface DesignFrameStatus {
  designId: string; status: DesignFrameStatusValue;
  classifierVersion: number; classifiedRevision: number; classifiedAt: string;
  firstFlaggedAt: string | null; resolvedAt: string | null;
  legacyProjectImport: boolean;
  findings: DesignFrameFinding[]; omittedFindingCount: number;
  blockingPlacementIds: string[];
}
/** New dispatch failure (refresh). Added to DesignerDispatchResult and to parseDispatchResultJson. */
export interface DesignerFootprintFrameLegacyResult {
  ok: false; code: "FOOTPRINT_FRAME_LEGACY"; partId: string; frameClass: string;
}
```

`DesignerSDK.getDesignFrameStatus(designId): Promise<DesignFrameStatus | null>`. Route: `GET /api/modules/designer/designs/:designId/frame-status` returns `success({ status })`, or 404. Run `npm run gen` and commit.

#### 3.6.2 Pure classifier (`src/modules/designer/backend/pcb/frame-classify.ts`, new)

```ts
export const FRAME_CLASSIFIER_VERSION = 1;
export function classifyPlacementFrame(
  snapshot: LibraryFootprintPlacementSnapshot,
  evidence: LibraryFootprintFrameEvidence | undefined,
  rowMatch: { rowSourceHash: string | null; readError: boolean } | undefined,
): { cls: PlacementFrameClass; reason: string; libraryLegacy: boolean };
export function classifyDesignFrame(input: {
  designId: string; revision: number;
  pcb: DesignerPcbProjection;                      // the CALLER's projection (no reload, §10 #13)
  partIdByPlacementId: ReadonlyMap<string, string>;
  evidence: Readonly<Record<string, LibraryFootprintFrameEvidence>>;
  rowMatch?: ReadonlyMap<string, { rowSourceHash: string | null; readError: boolean }>;
  importStamp: "none" | "legacy" | "canonical-v1";
  connectivity?: (pcb: DesignerPcbProjection) => ReadonlyMap<string, number>; // placementId → connectedPadCount
}): Omit<DesignFrameStatus, "classifiedAt" | "firstFlaggedAt" | "resolvedAt">;
```

`classifyPlacementFrame`, in order:
1. `unresolvedFootprintReason(snapshot) !== null`: `no-geometry`. Not a frame issue; the existing preflight handles it.
2. `isVerifiedFrameClass(snapshot.frameClass)` (stamped at snapshot time by the library's **verified** classification, §3.5.5):
   - `authored`: `canonical-authored`
   - `kicad-converted`: `canonical-kicad`

   A bare `snapshot.frame` stamp without a verified `frameClass` is **not** sufficient (§10 #5).
3. `snapshot.frameClass === "legacy-kicad-ydown"`: legacy (go to 9).
4. `snapshot.frameClass === "ambiguous"`: `ambiguous`.
5. `rowMatch` given and (`readError` or `rowSourceHash !== snapshot.sourceHash`): `ambiguous` ("library row does not match placed footprint"). This is H19's fail-closed rule (`OPENPCB-67.md:331`). Banner and export use the same function, so they agree.
6. `snapshot.sourceHash` starts with `drawn:`/`generated:`: `canonical-authored`.
7. `snapshot.footprintId` starts with `openpcb.core.` and there is no verified class: legacy. Every CoreLibrary footprint up to the first qualified pack was K (§2.8), and qualified packs always stamp.
8. With evidence `e`:
   - `e.legacyPreview` exists and `previewEqual(snapshot.preview, e.legacyPreview)`: legacy.
   - else `e.frameClass === "legacy-kicad-ydown"` and `previewCopperEqual(snapshot.preview, e.currentPreview)`: legacy.
   - else `e.frameClass === "authored"`: `canonical-authored`.
   - else `e.frameClass === "kicad-converted"` and `previewEqual(snapshot.preview, e.currentPreview)`: `canonical-kicad`.
   - else: `ambiguous` ("snapshot matches neither the legacy nor the current library geometry").
   - No evidence (row deleted): `ambiguous`.
9. Legacy: `isCopperFrameInvariant(snapshot.preview)` gives `legacy-copper-invariant`, else `legacy-mirrored`. `libraryLegacy = (evidence?.frameClass ?? "legacy-kicad-ydown") !== "kicad-converted"`.

`classifyDesignFrame`:
- `importStamp === "legacy"` adds the finding `legacy-project-import` (resolution `reimport-project`).
- Each placement adds:

| Placement class | Finding kind | Resolution |
|---|---|---|
| legacy, library still legacy | `legacy-footprint` | `update-library` |
| `legacy-copper-invariant` | `legacy-footprint-copper-invariant` | `refresh-footprint-safe` |
| `legacy-mirrored` | `legacy-footprint` | `refresh-footprint` |
| `ambiguous` | `ambiguous-footprint` | `replace-part` if no evidence, else `refresh-footprint` |

- `connectedPadCount` (§10 #18), only for flagged placements: the number of the placement's pads whose connectivity component, from the kernel (`computeBoardConnectivity`, `src/shared/pcb-connectivity/board-connectivity.ts:220`, fed the same copper records and pour fills batch DRC builds), contains at least one trace, via, pour or free-pad item. The route path injects it. The export hook omits it (informational only).

Status:
- `legacyProjectImport` or any legacy finding: `legacy-mirrored`
- else any ambiguous: `ambiguous`
- else any `canonical-kicad`, or `importStamp === "canonical-v1"`: `qualified`
- else `native`

`blockingPlacementIds` = placements with legacy or ambiguous findings. A legacy project import lists **all** placements.

Findings are sorted by `(kind, reference, placementId)` and capped at 200, with `omittedFindingCount`.

#### 3.6.3 Store wiring (`src/modules/designer/backend/frame-status.ts`, new; ≤250 lines)

```ts
/** Pure-input wrapper: classifies the GIVEN projection at the GIVEN revision. */
export async function computeDesignFrameStatus(ctx: CoreBackendModuleContext, db: DbClient, input: {
  designId: string; revision: number; pcb: DesignerPcbProjection; schematic: DesignerSchematicProjection | null;
}): Promise<Omit<DesignFrameStatus, "classifiedAt" | "firstFlaggedAt" | "resolvedAt">>;
/** Route/banner path: loads via store.getPcbProjection (H08 ensures net identity there), classifies, upserts. */
export async function refreshDesignFrameStatus(store: DesignerStore, ctx: CoreBackendModuleContext,
  db: DbClient, designId: string): Promise<DesignFrameStatus | null>;
export function readDesignImportStamp(db: DbClient, designId: string): "none" | "legacy" | "canonical-v1";
```

`readDesignImportStamp` is synchronous and designer-only, so H19 reads it inside its snapshot transaction (`ExportSnapshot.frameImportStamp`):
- If `designer_import_reports` exists (H14) and has a row for the design: `frame === "kicad-canonical-v1"` gives `canonical-v1`, else `legacy`.
- Else, if a `designer_command_log` row with `command_type = 'import_kicad_project'` exists: parse `command_json.frame?.kicadBoardTransformVersion`; `1` gives `canonical-v1`, else `legacy`.
- Else `none`.
- Table existence is probed once via `sqlite_master`.

`refreshDesignFrameStatus` steps:
1. `store.getPcbProjection(designId)` and the head revision, then re-check the revision after loading. On a mismatch, retry once, then return the last result marked with its revision.
2. `library.getFootprintFrameEvidence(unique footprintIds)`.
3. `computeDesignFrameStatus` with the connectivity injector.
4. Upsert `designer_frame_status`:
   - keep `first_flagged_at` if set, else set it when the status is flagged
   - set `resolved_at` on a flagged→ok transition
5. Return the status.

H13 has **no design data migration** (§10 #15). The frame-status read goes through `store.getPcbProjection`, where H08 calls `ensureNetIdentity` (`OPENPCB-56.md:789`). Refresh goes through dispatch, where H08 ensures before the transaction (`OPENPCB-56.md:426`).

#### 3.6.4 Staleness (`store.ts:166-185`)

`stale` additionally becomes true when `ref.frameClass === "kicad-converted"` and the part snapshot's `frameClass` is not verified. The existing "footprint out of date → refresh" UX then surfaces migrated parts. This replaces the sourceHash change r1 relied on.

#### 3.6.5 Resolve command (`refresh_part_footprint`, additive field)

```ts
export interface DesignerRefreshPartFootprintCommand {
  type: "refresh_part_footprint";
  partIds: string[];
  /** "default" (existing behaviour) | "same-footprint": re-snapshot the part's CURRENT footprintId. */
  mode?: "default" | "same-footprint";
}
```

- Update the **`routes.ts` command parser** for `mode`. Per the AGENTS gotcha, a field without a parser is silently dropped over HTTP.
- **Key the details map by `partId` in both modes** (§10 #1). `resolveRefreshDetails` (`store.ts:188-205`) returns `Map<partId, LibraryComponentPlacementDetail>`.
  - Default mode resolves each unique `componentId` once and fans it out to its parts.
  - `same-footprint` calls `library.resolveFootprintPlacementSnapshot(componentId, part.footprint.footprintId)` once per unique `(componentId, footprintId)` and wraps the result as a `LibraryComponentPlacementDetail`-shaped value with the footprint replaced.
  - `applyRefreshPartFootprint` (`refresh-footprint.ts:79`) looks up `details.get(partId)`.
- `applyRefreshPartFootprint` refuses with `footprintFrameLegacy(partId, frameClass)` when the resolved snapshot's `frameClass` is not verified. Refreshing onto still-legacy geometry is a no-op the user must not mistake for a fix.
- `FOOTPRINT_FRAME_LEGACY` is added to `results.ts` (constructor), to `parseDispatchResultJson` (so a same-id replay returns it rather than `REVISION_CONFLICT`, §10 #14), and to the `DesignerDispatchResult` union in `sdks/designer/types.ts`. If P103 S2's exhaustive parser table has landed, add the row and a round-trip fixture there.
- Undo and redo are unchanged (whole-projection patch).
- The pin-mismatch guard is kept.

#### 3.6.6 Dataset capture (§10 #27; part of OP4a)

`dataset.capture` is `prod`, so packaged builds already capture designs whose footprints are mirrored. In the capture runtime (`capture/index.ts`):
- At session start and on each milestone snapshot, read the persisted `designer_frame_status.status` for the design (a sync read, no recompute; `"unclassified"` when there is no row) and add it to `SessionLogTags` as `frameStatus`.
- `CaptureUploader` withholds sessions whose latest `frameStatus ∈ {legacy-mirrored, ambiguous, unclassified}` from upload. They stay local, are never deleted, and the uploader logs `capture_withheld_frame`. A later `qualified`/`native` status releases them for new segments only.
- The openpcb-dataset side needs no change; the tag lets it filter already-uploaded data later.

### 3.7 Export hook

- **Preferred, when H19 S6b has landed:** H13 registers `ExportLibraryHooks.sourceFrame(pcb, importStamp, rows)` (`OPENPCB-67.md:312-330`). The hook is a thin adapter: it builds `partIdByPlacementId` from `pcb`, takes `evidence` from `rows[i].frameEvidence`, takes `rowMatch` from `rows[i].{rowSourceHash, readError}`, and calls `classifyDesignFrame` over **the snapshot's own projection and revision**. That removes r1's time-of-check/time-of-use gap (§10 #13). It returns `{ status, placementIds: blockingPlacementIds, resolution }`, where `resolution` = `reimport-project` if `legacyProjectImport`, `update-library` if any finding has that resolution, else `refresh-footprint`.
  - **Ask H19:** (1) the one async library pre-read also calls `library.getFootprintFrameEvidence(ids)` and attaches the result as `LibraryFootprintRowEvidence.frameEvidence`; (2) extend the `resolution` union with `"update-library"` (copy: "{k} part(s) use library footprints still stored in the old KiCad frame. Update the library (install the qualified CoreLibrary or re-import the footprint), then refresh."). H19's current slot already carries `resolution` (§10 #16).
- **Interim, if H19 S6b has not landed** (slice OP4c): `assertFrameQualifiedForExport(ctx, db, { designId, revision, pcb, schematic })` throws `AppError` 422:
  - type `https://openpcb.dev/problems/unqualified-frame`
  - extensions `{ code: "UNQUALIFIED_FRAME", status, legacyProjectImport, findings (≤20), omittedFindingCount, classifierVersion, revision }`
  - It is called at `routes.ts:3427`, `:3443` and `sdk.ts:137`, **after** the handler has loaded the projection it will export and **with that projection**. If a handler builds from a lower-level reader without holding the projection, the guard and the build are wrapped together: classify, then build, then assert that the build's revision equals the classified revision, else 409 `REVISION_CONFLICT`.
  - H19 S6b removes these three calls when it replaces the call sites.
- Additionally, `runExportPreflight` prepends `Error: N part(s) use mirrored/unverified footprint geometry (…refdes…); manufacturing export is blocked.` The H19 dialog reads it.
- The blocker is **data-driven and active in all builds** (not flag-gated). Release builds remain additionally behind `designer.outputQuarantine`. With §3.5.1's trust rules, a self-declared stamp no longer qualifies in dev/test either (§10 #5).

### 3.8 KiCad board frame helper (OP9; consumed by H14 `frame-port.ts`)

`src/modules/designer/backend/import/kicad-project/kicad-frame.ts` (new, H13-owned, pure) implements H14's seam (`H14.md` §3.5) verbatim, plus schematic members:

```ts
export type KicadFrameId = "kicad-legacy-unqualified" | "kicad-canonical-v1";
export const KICAD_BOARD_TRANSFORM_VERSION = 1;
export interface KicadBoardFrame {
  readonly id: KicadFrameId;
  point(p: { xMm: number; yMm: number }): { x: number; y: number };      // nm, §3.1.2 rounding
  pointMm(p: { xMm: number; yMm: number }): { x: number; y: number };    // mm
  bboxMm(b: { minXMm: number; minYMm: number; maxXMm: number; maxYMm: number }):
    { minXMm: number; minYMm: number; maxXMm: number; maxYMm: number };   // canonical: minY=-maxY, maxY=-minY
  placementRotationDeg(kicadDeg: number, side: "front" | "back"): number; // canonical: norm360(θ + (back?180:0)); legacy: norm360(θ)
  placementMirrored(side: "front" | "back"): boolean;                      // back ⇒ true (both frames)
  textRotationDeg(kicadDeg: number): number;                               // norm360(θ) (both)
  arcSegmentCw(cwInK: boolean): boolean;                                   // canonical: !cwInK; legacy: identity
  footprintToLibraryForm(node: SExpr[], side: "front" | "back"): SExpr[] | null; // canonical: unplaceBoardFootprint(node).node; legacy: front→node, back→null
  schPoint(p: { xMm: number; yMm: number }): { x: number; y: number };    // nm; same N as point()
  schSymbolTransform(kicadDeg: number, mirror: "x" | "y" | null): { rotationDeg: number; mirrored: boolean };
}
export const KICAD_CANONICAL_FRAME_V1: KicadBoardFrame;
export const KICAD_LEGACY_FRAME: KicadBoardFrame;            // today's verbatim behaviour, minus integer rounding
export function selectBoardFrame(footprintFrameStamp: unknown): KicadBoardFrame;
  // canonical iff parseFootprintFrame(stamp) is kicad-converted && QUALIFIED_KICAD_TRANSFORM_VERSIONS.includes(v)
  // (also accepts the string "openpcb-y-up/kicad-converted/1" for H14's string-typed port)
export function boardImportFrameStamp(frame: KicadBoardFrame):
  { frame: KicadFrameId; kicadBoardTransformVersion: number | null }; // written into commandLog.command_json.frame / H14 report
```

`norm360` lives in `src/shared/kicad-frame/angles.ts` (KF1 §3.1.2 definition) and is re-exported here.

`schSymbolTransform`:
- Canonical: `{rotationDeg: norm360(θ), mirrored: false}` for `null`.
- The mirror cases follow KiCad `SCH_SYMBOL::SetOrientation`. The implementer cites `eeschema/sch_symbol.cpp` at a pinned KiCad tag if a checkout is available.
- **Oracle (binding, §10 #9).** OP11's `kicad-sch-mirror-oracle.test.ts` runs over every `.kicad_sch` under `OPENPCB_KICAD_CORPUS_DIR` (default probe: `../cloud-workspace/cloud-auto-layout/corpus/upstream`; skip-unless-present). For each symbol with `(mirror x|y)`, it places pins via `N·at + R/M(transform)·p_sym` and counts pins that land (≤1 µm) on a wire endpoint, label or junction. Assertions:
  - all four canonical mirrored orientations seen in KiCad output (x@0, x@90, x@270, y@0; §2.9) are covered;
  - per orientation, the chosen composition lands ≥ 95% of connected pins, and strictly more than the alternative (`θ` vs `−θ`, mirror before vs after rotation).

  The result is recorded in KF1 §3.1.3. Non-canonical forms KiCad does not write (y@90, x@180, …) are covered by the algebraic equivalences (`mirror_y∘R(180) = mirror_x`) as a unit test. That test is labelled non-oracle.
- Initial expectation: `y` gives `mirrored: true`; `x` gives `mirrored: true, rotation + 180`. The oracle decides.

**`src/shared/kicad-frame/board-footprint-unplace.ts`** (new, pure, K→K; §10 #20). It sits in a new shared subtree so that both the designer (`kicad-frame.ts`) and the library (OP8 migration) import it without a cross-module import. It is a candidate to move into `@openpcb/kicad-import` later; OP1 updates the CLAUDE.md shared-tree list from nine to ten subtrees.

```ts
export interface UnplacedBoardFootprint {
  node: SExpr[];            // library-form .kicad_mod node, K frame, front side, unrotated
  side: "front" | "back"; orientationDeg: number; libId: string;
  contentKey: string;       // sha256 of canonical s-expr with uuid/tstamp/at/path/property-values/pad net stripped
  warnings: Array<{ code: string; message: string }>;
}
export function unplaceBoardFootprint(node: SExpr[], opts?: { copperLayerCount?: number }): UnplacedBoardFootprint;
export function flipLayerName(name: string, copperLayerCount: number): string;
  // F.x↔B.x; In_k.Cu ↔ In_(n−1−k).Cu (n = copperLayerCount, inner = n−2); *.x, F&B.Cu unchanged
```

Steps:
1. `θ` = footprint `(at x y θ?)` (default 0). Side = back iff `(layer "B.Cu")`.
2. Drop footprint-level `at`, `uuid`, `tstamp`, `path`, `sheetname`, `sheetfile`, `locked`, and the `Sheetname`/`Sheetfile` properties. Set `(layer "F.Cu")`.
3. **pad**:
   - `(at x y α)` becomes `(at x y' β)` with `β = norm360(α − θ)`. On the back side, `y' = −y` and `β = norm360(−β)`.
   - Back: `(drill … (offset ox oy))` gives `oy → −oy`.
   - `layers` mapped with `flipLayerName` (back).
   - Custom `primitives`: back negates every primitive y.
   - `chamfer` corners: back swaps top↔bottom.
   - Strip `(net …)`.
4. **fp_line / fp_rect / fp_circle / fp_arc / fp_poly / fp_curve** (and KiCad 8 `fp_*` identical tokens): back negates y of `start`, `mid`, `end`, `center`, `pts/xy`. Layer flipped.
5. **fp_text / property / fp_text_box**:
   - `at` angle as for pads. Back: `y → −y`.
   - Back: the `(justify … mirror)` token is removed (toggled). Layer flipped.
   - Reference becomes `REF**`. The Value text becomes the item name after `:`.
6. **model:** unchanged. **zone / group / dimension inside a footprint:** kept as-is with warning `board_footprint_child_unsupported` (H14 census owns blocking).
7. `contentKey` is computed on the result.

### 3.9 CoreLibrary (CL1/CL2/CL3)

- **Schema** `schemas/footprint.schema.json`:
  - Add `provenance.properties.frame` = `{type:object, required:[frame,origin,transformVersion,tool], additionalProperties:false, frame:{const:"openpcb-y-up"}, origin:{enum:["kicad-converted","authored"]}, transformVersion:{type:integer,minimum:0}, tool:{type:string}}`.
  - Add `"frame"` to provenance `required`.
  - Add optional `frameConvertedAt` (date-time). (H15's `postProcess`/`derivationHash` properties are H15's schema edits.)
  - Bump the schema `$id`/title revision comment to "footprint schema 1.1".
- **Manifest** `schemaVersion` stays `"1.0.0"`: the opclib reader enforces it and the format did not change. Old apps installing the new pack get correct Y-up geometry.
- **Tool** `tools/regen-frame.ts` (new), `bun tools/regen-frame.ts [--dry-run] [--only=…]`:
  1. Refuse to run if `git status --porcelain` (the **whole tree**, §10 #23) is non-empty, unless `--allow-dirty` is passed.
  2. Require `kicadImport.KICAD_FOOTPRINT_TRANSFORM_VERSION === 1`.
  3. Per `fp.json` with usable raw:
     - `next = buildFootprintPreviewFromParsed(raw)`
     - assert the stamp
     - **`delta = compareFrameConversion(old normalized.preview, next)`** (§10 #10). If `!delta.frameOnly`, or `delta.other` contains anything not listed in the committed allow-file `tools/regen-frame-allow.json` (entries `{footprintId, kind, reason, reviewer}`), abort: the frame change must not carry unreviewed land-pattern changes.
     - `normalized.preview = next`; `provenance.frame = next.frame`, `provenance.frameConvertedAt = now`
     - `version` = minor bump (`x.y.z` → `x.(y+1).0`)
     - recompute `normalized.packageCode` exactly as `rebuild-previews.ts` does
  4. Per `3d/*.model.json` with `scaleMm.y === -1` whose referencing footprints were all regenerated: set `scaleMm.y = 1` and record it in the report, with the **pre-change baked GLB sha256**.
  5. Run the orientation gate on every model. Any failure aborts with a list (nothing is written in `--dry-run`).
  6. Write the JSON report `tools/reports/regen-frame-<date>.json` (gitignored), containing per-footprint deltas with all `additions` counts and `other` entries, and the model list. CL2's PR description pastes the summary.
- `tools/rebuild-previews.ts`: copies `preview.frame` into `provenance.frame` (so H15's C2 `rebuild-previews --footprints` run keeps the stamp). CL1 lands before H15 C1, and H15 rebases its `qualifySilk` call onto it.
- `tools/import-kicad-batch.ts`: copy `preview.frame` into `provenance.frame` on import, and drop the "DIP/connector scaleMm.y:-1" guidance comment (`:75`).
- **Gate G-FRAME** in `tools/validate.ts` (§10 #7):
  - every footprint has a qualified `provenance.frame`;
  - kicad-derived footprints have origin `kicad-converted` with `transformVersion = 1`;
  - determinism: `replay(raw) = applyPostProcess(buildFootprintPreviewFromParsed(raw), provenance.postProcess ?? [])` is byte-equal (canonical JSON) to the stored `normalized.preview`. `applyPostProcess` resolves each `{tool, version}` through a registry in `tools/post-process-registry.ts`. CL1 ships it empty, and H15 C1 registers `silk-qualify@SILK_QUALIFY_VERSION`. An unknown tool or version mismatch fails the gate.
  - every `rawFrameRelation(preview_before_postprocess, raw.pads) ∈ {converted-v1, invariant}`.
- **Docs:** rewrite `docs/3d-placement-convention.md:52-59`. The pin-header mirror was a compensation for Y-down footprints and is now forbidden; identity is the KLC rule. Note the change in `STATUS.md` inventory.
- **Tests:**
  - `tests/orientation-gate.test.ts`: identity passes for a pin header with pads at y = 0, −2.54; the old mirror fails.
  - `tests/regen-frame.test.ts`: golden SOT-23/SOIC-8/CP_Elec in the regenerated `fp.json`; idempotent second run; dirty-tree refusal (a dirty `tools/` file also refuses); an injected pad-size change aborts; an allow-listed `slot-drill-added` passes and is reported.
  - `tests/validate-gfram.test.ts`: postProcess replay with a fake registered tool; an unknown tool fails.
- **Pins:** CoreLibrary `package.json` re-pins `kicad-import-v0.2.0` and `rendering-core-v0.1.4` **in CL2** (after SH2). CL1 code can be developed with `bun run shared:link`.
- **Release (CL3, user):**
  - `bun pack --version 0.2.0`, Ed25519 sign, publish
  - OpenPCB `resources/core-library-release.json` `productionRelease` pin plus sha256
  - OpenPCB `src/modules/library/backend/builtins/mirror-compensated-glbs.ts`: `MIRROR_COMPENSATED_CORE_GLBS`, the pre-change GLB sha256 list from the CL2 report (for §3.5.1's clone reason)
  - `npm run corelib:fetch` verification
  - bump P103 `DESIGNER_COMMAND_EPOCH` in the same OpenPCB commit (§6)

### 3.10 3D (OP6)

`transform-helpers.ts`:
- New `getModelPlacementTransformProps(placement, thicknessMm)`, identical to `getPlacementTransformProps` except `scale = [mirrorX ? -1 : 1, 1, isBackLayer ? -1 : 1]`.
- `applyPlacementTransform` uses the model variant.
- `getPlacementTransformProps` (2D overlay, `FootprintOverlayLayer.tsx:53-81`) is unchanged.

**KiCad model `rotate`/`offset` check:**
- Read KiCad `3d-viewer` model-matrix code at a pinned tag (`render_3d_opengl.cpp`, model transform: translate offset, then rotate −z, −y, −x, then scale, as remembered; **verify**).
- If KiCad negates rotations and applies Z·Y·X, change `buildModelRefMatrix` to `Euler(−x, −y, −z, "ZYX")` for refs whose source is KiCad (`model_ref_json` written by `commit-kicad-zip.ts`, which has `resolvedFileName`).
- CoreLibrary refs are baked (`transformBaked`) and have zero rotations (§2.8), so they are unaffected.
- If the source cannot be pinned, leave it unchanged and record "unverified" in KF1 §3.1.3.

### 3.11 Module boundaries

| Layer | What H13 adds |
|---|---|
| `src/sdks/*` | types only: library frame types, LibrarySDK methods, DesignerSDK `getDesignFrameStatus`, command field, result variant |
| `src/shared/pcb-geometry/footprint-frame.ts` | pure, imports `sdks` types only, following the precedent in `pad-geometry.ts:6` |
| `src/shared/kicad-frame/` (new subtree) | `board-footprint-unplace.ts`, `angles.ts` (`norm360`). Pure; depends on `@openpcb/kicad-parsers` only |
| library | classification, migration, intake, backup, revert |
| designer | classifier, status, route, command field, capture tag; consumes library **only via `LibrarySDK`** |
| designer import helpers | `kicad-frame.ts` imports `src/shared/kicad-frame/*` and `src/shared/pcb-geometry/footprint-frame.ts`. No library-module import (§10 #20) |

No module imports `src/core/backend/*`. Backup uses the module DB handle.

---

## 4. Task breakdown (commit-sized slices)

Tiers: standard / careful / critical. "Re-pin-gated" = needs **OP7**; everything else typechecks and tests green against the pinned tags.

### 4.1 `../shared` (branch `fix/offline-eda-text`; commit, do not publish)

| Slice | Files | ~Lines | Tests | Tier | Deps |
|---|---|---|---|---|---|
| **SH1** kicad-import canonical frame | `packages/kicad-import/src/frame.ts` (new ~180: maps, pad/offset rule, `compareFrameConversion`), `build-preview-models.ts` (~70 changed), `types.ts` (+40), `index.ts` (+3), `frame.test.ts` (new ~380), `build-preview-models.test.ts` (update drill-offset/graphics expectations ~40), `README.md` (+40) | 750 | §3.3 goldens (incl. offset-drill probe), raw immutability, stamp, symbol unchanged, `compareFrameConversion` table; `npm run test -w @openpcb/kicad-import`; `npm run typecheck`; `npm run build` | **critical** | — |
| **SH2** publish (user) | tags `rendering-core-v0.1.4`, `kicad-import-v0.2.0` | — | release workflow | user-gated | SH1; H15 agrees on rendering-core 0.1.4 content |

### 4.2 `../CoreLibrary`

Q2 gates **CL1 and CL2**: CL1 edits `tools/import-kicad-batch.ts`, `package.json` and `tests/import-kicad-batch.test.ts`, which are dirty in the in-flight lane (§10 #23).

| Slice | Files | ~Lines | Tests | Tier | Deps |
|---|---|---|---|---|---|
| **CL1** frame tooling + schema + gate | `tools/regen-frame.ts` (new 300), `tools/regen-frame-allow.json` (new, empty), `tools/post-process-registry.ts` (new 40), `schemas/footprint.schema.json`, `tools/validate.ts` (G-FRAME ~110), `tools/rebuild-previews.ts` (stamp copy), `tools/import-kicad-batch.ts` (stamp copy, comment), `tools/orientation-gate.ts` (doc comment), `docs/3d-placement-convention.md`, `tests/regen-frame.test.ts` (new 200), `tests/validate-gfram.test.ts` (new 80), `tests/orientation-gate.test.ts` | 800 | `bun test`; `bun tools/regen-frame.ts --dry-run` via `shared:link` | careful | SH1 (linked); Q2 |
| **CL2** data regeneration | `package.json` (re-pin), `footprints/**/*.fp.json` (168), `3d/**/*.model.json` (≤45 scale edits), `tools/regen-frame-allow.json` (reviewed entries), `STATUS.md` | data | `bun validate` (all gates incl. G-FRAME + orientation), `bun test`; report reviewed: every footprint `frameOnly` or allow-listed | **critical** | SH2, CL1, Q2 |
| **CL3** pack/sign/release (user) | release artifacts; OpenPCB `resources/core-library-release.json`, `mirror-compensated-glbs.ts`, P103 epoch bump | — | `npm run corelib:fetch` in OpenPCB | user-gated | CL2 |

### 4.3 OpenPCB, phase A (pinned-compatible)

| Slice | Files | ~Lines | Tests | Tier | Deps |
|---|---|---|---|---|---|
| **OP1** contract doc | `docs/pcb-hardening/KF1-kicad-frame-contract.md` (new), `docs/pcb-hardening/PROGRAM.md` ("Cross-item contracts" table listing KF1 and H19's output contract; no session renumbering), `OpenPCB/CLAUDE.md` (shared subtree list: ten, add `kicad-frame/`), `src/modules/designer/AGENTS.md` (FOOTPRINTS section: frame bullets; also fix the stale CrtYd claim to "courtyard admitted from kicad-import 0.2.0"), `src/modules/library/backend/import/README.md` (qualification intake), monorepo `.claude/skills/eda-standards/SKILL.md:130` (replace "the existing KiCad parser should handle this" with the boundary rule; outside OpenPCB git, edit in place) | 400 | doc review | standard | — |
| **OP2** frame types + predicates | `src/sdks/library/types.ts` (+70), `src/shared/pcb-geometry/footprint-frame.ts` (new 220, incl. `rawFrameRelation`, independent `expectedCentreV1`), `src/shared/kicad-frame/angles.ts` (new 20), `src/modules/library/backend/import/frame-qualification.ts` (new 50), `src/core/backend/tests/footprint-frame-predicate.test.ts` (new 260) | 620 | parse strictness table; copper invariance (SOT-23 no, 0603 yes, rotated-45 pad no); `rawFrameRelation` table (verbatim, converted incl. offset pad, invariant resolved by silk, neither, unusable); `norm360(−1e-12) === 0`, `norm360(359.9999999999) === 0`, `norm360(−0) === 0`; detection returns null on 0.1.2 | careful | — |
| **OP3a** library schema + classification + propagation | `migrations/0012_footprint_frame_provenance.sql`, `schema.ts`, `builtins/footprint-frame-classify.ts` (new 260), `builtins/migrate-footprint-frame.ts` (classify pass only, 160), `index.ts` (order: classify before bootstrap), `queries.ts` (snapshot `frame`/`frameClass`/`frameTrust` with hash freshness, default refs, frame-aware `rawPadMatchesPreview`), `tests/library-footprint-frame-classification.test.ts` (new 380) | 750 (split classifier tests into a second commit if > 600) | every rule row of §3.5.1, incl. project-derived raw; **laundering cases**: unsigned stamped row with K geometry → legacy; clone of it → legacy; unsigned stamped row with C geometry → `geometry-verified`; authored stamp on a KiCad row → kicad rules; pack rows untouched (`data_json` byte-equal); stale-hash row reclassified on read and at boot; classifier runs before bootstrap (spy order); idempotent rerun; plating identity holds for a converted NPTH pad | **critical** | OP2 |
| **OP3b** qualification-based intake + stamping | `import/unqualified-import.ts`, `commit-kicad.ts` (stamp + frame-aware dedupe), `commit-drawn.ts`, `commit-kicad-zip.ts`, `footprint-record.ts`, `commit-generated.ts`, `sync/opclib-importer.ts` (classification, pack-update backups for non-verified rows, inline classify), `queries.ts` (clone: no column copy), `routes.ts` (inspect `intake`, model mirror warnings), `registry.ts` (description), `frontend/import-wizard/steps/FootprintStep.tsx`, tests: `library-import-quarantine.test.ts` (rewrite its 8 test declarations, ≈10 runtime cases with the label loop, all green today: blanket-reject cases become signed+stamped accept / unsigned-forged-K reject / unsigned-geometry-verified accept-in-dev / generator-hook reject cases), new `library-frame-intake.test.ts` (360), `import-quarantine.test.tsx` (update) | 750 | flag on: release semantics; flag off: legacy stamping; forged stamp unsigned with K geometry → reject; signed stamped pack → accept; cloud repack round trip (`buildUserLibraryPack` → `importOpclib`) of a converted row → `geometry-verified`; pack install over a NULL-class legacy core row creates a backup (first-boot case, §10 #2); dedupe never crosses frame classes; model upload with `scale.y=-1` on a converted footprint → 200 + warning | **critical** | OP3a. **Overlaps H14 S1** (`commit-kicad.ts`, `unqualified-import.ts`): land OP3b first, H14 S1 rebases |
| **OP3c** LibrarySDK evidence + variant snapshot | `src/sdks/library/index.ts`, `queries.ts` (`buildSdk`), generated SDK stubs (`npm run gen`), `tests/library-frame-evidence.test.ts` (new 150) | 300 | evidence includes latest backup preview; unknown ids absent; `resolveFootprintPlacementSnapshot` returns the non-default variant | careful | OP3a |
| **OP4a** designer classifier + status + capture tag | `migrations/0021_design_frame_status.sql`, `schema.ts`, `pcb/frame-classify.ts` (new 320), `frame-status.ts` (new 240), `routes.ts` (GET route), `sdk.ts` + `src/sdks/designer/types.ts`, `store.ts` (stale + delete), `capture/{index,types,uploader}.ts` (frameStatus tag + withhold), generated stubs, `tests/designer-frame-status.test.ts` (new 420), `tests/designer-capture-frame-tag.test.ts` (new 120) | 900 (split: classifier+tests / store+route / capture) | every §3.6.2 branch; bare stamp without verified class → not canonical; hash-mismatch row → ambiguous; legacy project import via `commandLog`; H14 report table optional; `first_flagged_at` sticky; `resolved_at` on refresh; `connectedPadCount` counts a pour-only connected pad; capture withholds a flagged design and releases after resolution | **critical** | OP3c |
| **OP4b** same-footprint refresh | `src/sdks/designer/types.ts` (command field + result variant), `routes.ts` (command parser), `store.ts` (`resolveRefreshDetails` keyed by partId), `commands/refresh-footprint.ts`, `results.ts` (constructor + `parseDispatchResultJson`), `tests/designer-refresh-same-footprint.test.ts` (new 260) | 360 | HTTP round trip keeps `mode`; **two parts of one component on different variants (0603 / 0805) refreshed in one batch keep their own footprints** (§10 #1); non-default variant preserved; still-legacy refused with `FOOTPRINT_FRAME_LEGACY`; same-commandId replay returns `FOOTPRINT_FRAME_LEGACY`, not `REVISION_CONFLICT`; undo restores the legacy snapshot and status re-flags | careful | OP4a |
| **OP4c** export wiring | either the H19 `ExportLibraryHooks.sourceFrame` adapter (`export/frame-hook.ts`, 60) **or** interim `capability-quarantine.ts` `assertFrameQualifiedForExport` + 3 call sites passing the handler's projection; `export/preflight.ts` line; `tests/designer-frame-export-blocker.test.ts` (new 240) | 180 | legacy/ambiguous → 422 / H19 blocker; native & qualified pass; flag-independent; **TOCTOU**: an undo of a refresh between classification and build never yields a bundle (409 or blocked) | careful | OP4a; H19 S6b if present |
| **OP5** banner + resolve UI | `src/modules/designer/frontend/pcb/FrameStatusBanner.tsx` (new 180), `.test.tsx` (new 150), PCB view mount point, library detail badge + E16 reasons (`frontend/detail-helpers.ts` + `ComponentDetailPage`), drawn-editor seeding guard (E26) | 480 | Vitest: copy per finding kind; batch "Refresh N safe parts" dispatches one `refresh_part_footprint` (`mode: same-footprint`, `partIds` of copper-invariant only); per-part refresh with connected-pad warning; re-import CTA; `update-library` disabled reason | careful | OP4b |
| **OP6** 3D back side | `three-d/transform-helpers.ts`, `transform-helpers.test.ts`, (maybe) `ComponentModelLayer.tsx` | 120 | det(scale) = +1 for back; overlay unchanged; KiCad rotate semantics test with cited source | careful | — |
| **OP9** board frame helper + unplace (**moved to phase A**, §10 #20) | `src/shared/kicad-frame/board-footprint-unplace.ts` (new 300), `import/kicad-project/kicad-frame.ts` (new 260), `tests/kicad-frame-helper.test.ts` (250), `tests/kicad-board-footprint-unplace.test.ts` (300), `tests/kicad-frame-boundary.test.ts` (60) | 1170 (code 560) | all K→K or pure algebra, typechecks on 0.1.2: §3.1.3 algebra on seeded random points (labelled non-oracle); back-side worked example; USBtoUART: every instance unplaces to an identical `contentKey` per lib_id; **Chickadee (skip-unless-present): F and B `R_0603_HandSoldering` instances have equal `contentKey`**; hand-flipped synthetic round trip (regression only, labelled non-oracle); fractional θ kept; inner-layer flip | **critical** | OP2; consumed by H14 S6 (frame-port) and S3 (schematic) |

### 4.4 OpenPCB, phase R

| Slice | Files | ~Lines | Tests | Tier | Deps |
|---|---|---|---|---|---|
| **OP7** re-pin | `package.json` (kicad-import-v0.2.0, rendering-core-v0.1.4), `package-lock.json`; shim re-exports if new names are needed; compatibility fixes for the other 0.2.0 breaking changes (`1a15c1e`, `58d3620`); owned jointly with the shared integrator/H15. **Coupled tests to re-derive** (§10 #22): `designer-autolayout-apply-atomic`, `designer-commands`, `designer-copper-gate`, `designer-kicad-project-errors`, `designer-pcb-transactions`, `designer-pcb`, `drc-courtyard`, `kicad-pcb-via-types`, `kicad-project-import-real`, `kicad-project-import`, `kicad-zone-keepout-import`, `library-import-bbox`, `library-import-quarantine`, `library-inspect-invalid-file`, `library-integration`, `library-zip-step-import` (all `src/core/backend/tests/*.test.ts`), plus `designer/frontend/lib/footprint-labels.test.ts`, `import-wizard/{import-quarantine,preset-quarantine}.test.tsx`. Implementer confirms which are actually coordinate-coupled | 100 + fixes (estimate 600–900 test-line changes) | full `npm run typecheck`, `test:backend`, `test:react`, `gen:check`. **Rule:** a changed coordinate golden is re-derived from an oracle (KF1 formula applied by hand in the test, the §3.3 goldens, or O1). Re-recording the new output is not allowed; each changed expectation cites its derivation in a comment | careful | SH2 |

### 4.5 OpenPCB, phase B (re-pin-gated)

| Slice | Files | ~Lines | Tests | Tier | Deps |
|---|---|---|---|---|---|
| **OP8** library rewrite pass | `builtins/migrate-footprint-frame.ts` (rewrite + revert + env), `builtins/frame-backup.ts` (new 100), `index.ts` (env handling), `tests/library-footprint-frame-migration.test.ts` (new 520); **P103 `DESIGNER_COMMAND_EPOCH` bump** (if P103 has landed) | 800 | suite M (§7) | **critical** | OP3a, OP7, OP9 |
| **OP11** golden acceptance | `tests/kicad-frame-golden.test.ts` (new 450), `tests/kicad-backside-corpus-oracle.test.ts` (new 200; O4), `tests/kicad-sch-mirror-oracle.test.ts` (new 220), `tests/helpers/gerber-x2-pads.ts` + `excellon-hits.ts` (create if H14 S13/H19 have not; else reuse), fixture `src/core/backend/tests/fixtures/kicad/sides/` (hand `.kicad_sch` + `generate_sides.py` pcbnew script + `README.md`; `kicad-ref/` when generated) | 900 + fixture | O1 now; O2 now; O4 + schematic mirror oracle skip-unless-present (`OPENPCB_KICAD_CORPUS_DIR`); O3 skip-unless-present; `OPENPCB_REQUIRE_KICAD_REF=1` turns every skip into a failure | careful | OP9, OP7; imported-design assertions additionally need H14 S6/S7 wiring |
| **OP12** round-trip + separate suites | `tests/kicad-frame-roundtrip.test.ts` (new 350), `tests/frame-suite-drawn.test.ts` (new 200), `tests/e2e/footprint-frame.spec.ts` + `tests/e2e/fixtures/seed-legacy-frame.ts` | 700 | suites R, N, D, e2e (§7) | careful | OP8, OP11 |
| **OP13** release-notes text + quarantine docs | `CAPABILITY-QUARANTINE.md` (frame evidence section), `import/README.md` final, release-notes stub `docs/release-notes/h13-frame.md` (draft text for the flag/quarantine sign-off, incl. "A7 status") | 120 | — | standard | OP12 |

### 4.6 Parallelism and ordering (H13-internal)

**Waves** (no file overlap within a wave):
1. Wave 1: **SH1 ∥ OP1 ∥ OP2 ∥ OP6**
2. Wave 2: **OP3a ∥ CL1** (CL1 uses `shared:link`, after Q2) **∥ OP9** (OP9 touches only `src/shared/kicad-frame/`, `import/kicad-project/kicad-frame.ts` and new tests)
3. Wave 3: **OP3b**, then **OP3c** (both touch `queries.ts`/routes, so serial)
4. Wave 4: **OP4a**, then **OP4b**, then **OP4c** (serial: all touch designer `routes.ts`/`sdks/designer/types.ts`), then **OP5**
5. User: **SH2**, then **CL2**, then **CL3**; **OP7** after SH2
6. Wave 5: **OP8 ∥ OP11** (OP8 = library builtins; OP11 = tests/fixtures), then **OP12**, then **OP13**

**H14 coordination:**
- H13 never edits `insert-pcb.ts`, `commit.ts`, `ingest-library.ts` or `insert-schematic.ts`.
- H14 S6 (frame-port, board items) and S3 (schematic) import `kicad-frame.ts`. With OP9 in phase A, H14 can consume the real module without a stub.
- `boardImportFrameStamp` is written by H14 into `designer_import_reports.frame` and `commandLog.command_json.frame`.

**Re-pin-gated commits:** CL2, OP7, OP8, OP11, OP12. Everything in phase A (incl. OP9) typechecks and passes against `kicad-import@0.1.2` / `rendering-core@0.1.3`.

### 4.7 Cross-item merge order for shared designer files (§10 #28)

These files are edited by several items: `designer/backend/{routes,store,sdk,results}.ts`, `sdks/designer/types.ts`, `src/core/frontend/src/generated/sdk/**`, and the designer `migrations/` head. Proposed order (each later slice rebases):

1. **P103 S2** (exhaustive `parseDispatchResultJson` table, `DESIGNER_SCHEMA_HEAD`/`DESIGNER_COMMAND_EPOCH` constants)
2. **H08 S3 → S5 → S7 → S10** (net-identity migration, `store.ts` ensure, results codes, routes parser)
3. **H13 OP4a → OP4b → OP4c**
4. **H19 S2 → S6a → S6b** (S6b registers H13's hook if OP4c chose the hook form; otherwise S6b deletes the interim guard calls)
5. **H14 S10** (`store.ts` deleteDesign, `0021_kicad_import_reports`)

Rules:
- Every slice that adds a dispatch result code adds it to the exhaustive parser table plus a round-trip fixture.
- Every slice that adds a designer migration updates `DESIGNER_SCHEMA_HEAD` if its file sorts last.
- Every slice touching `sdks/designer/*` runs `npm run gen` after rebasing and commits the stubs.
- If items land in a different order, the same rules apply. The order only minimizes rebase work.

---

## 5. Edge cases and failure modes

| ID | Case | Handling |
|---|---|---|
| E1 | Copper-symmetric footprint (0603, all pad y = 0) | Class `legacy-copper-invariant`. Copper is identical under N, but silk/fab/mask/paste graphics are not, so it is still blocked. Offered "safe refresh", never applied automatically |
| E2 | Fractional KiCad angles (e.g. 22.5°, 0.1°) | `norm360` keeps them; no integer rounding (fixes `insert-pcb.ts:452-454` via H14) |
| E3 | `−0` / rounding asymmetry / `norm360` near 0 | `y === 0 ? 0 : −y`; nm rounding in K then negate; `norm360` snaps before modulo and maps 360→0 |
| E4 | Paste sub-pads, unnumbered NPTH | Converted like any pad; ids unchanged; excluded from identity checks (role paste) |
| E5 | Arc sweep | 3-point arcs map pointwise. Angle or `cw` representations flip via `arcSegmentCw`. A test asserts the reversed signed turn |
| E6 | Text keep-upright | Board-instance text angle normalization may produce 180° relative to KiCad display. Copper-irrelevant. Renderer keeps its upright rule (T-204 separate) |
| E7 | Label ids contain coordinates | They change on conversion. Consumers key labels by role (`footprint-labels.ts`). Verified by a test that placeholder substitution still applies |
| E8 | Re-import of a `.kicad_mod` whose legacy row exists | Frame-aware dedupe creates a new canonical row. The legacy row stays, gets migrated at next start, and then deduplicates naturally |
| E9 | Same lib_id, different per-instance geometry | `contentKey` grouping (H14 §3.7 using `unplaceBoardFootprint`) |
| E10 | B-side first instance | Unplaced to front; never ingested flipped |
| E11 | Inner-layer pads on a back-side footprint | `flipLayerName` with copper layer count |
| E12 | Courtyard / mask / paste graphics | Converted by the same point map (layers admitted since 0.2.0). Reported as `additions` by `compareFrameConversion` |
| E13 | Drill offset + rotation | KF1 §3.1.2 (`ShapePos`): copper centre shifts by `R(α)·N·offset`, `drillOffsetMm = −N·offset`. Old rows with offset pads change copper position on migration/refresh; `compareFrameConversion` expects exactly that shift. No local oracle (USBtoUART has none); O3 `FRAME_PROBE` covers it; open under A7 |
| E14 | Row without usable raw (stub) | `ambiguous` (or `authored` if authored markers and no KiCad markers), never rewritten; placements using an ambiguous row are `ambiguous` |
| E15 | Migration crash mid-way | Per-row transaction includes its backup row. Failures increment `frame_rewrite_attempts`; at 3 the row becomes `ambiguous` (`rewrite-failed`). Sentinel only after zero candidates. Retry is idempotent |
| E16 | Manual model mirror (`model_ref_json.scale` det < 0) or baked CoreLibrary compensation on a clone | Reason suffixes (§3.5.1). Shown in the library detail. Upload/import paths warn (§3.5.4). Not auto-changed |
| E17 | KiCad model `rotate`/`offset` semantics uncertain | OP6 verifies against cited KiCad source. Otherwise recorded as unverified; CoreLibrary unaffected (baked, zero rotations) |
| E18 | `VACUUM INTO` fails (disk full, permissions) or the free-space precheck fails | Rewrite pass aborted for this launch, classification kept, error logged, retried next start. At most one successful snapshot per migration name, so retries never accumulate copies. `:memory:` DB means no file snapshot |
| E19 | Two app instances | `BEGIN IMMEDIATE` per row, with a hash re-read inside the transaction. Second instance skips migrated rows |
| E20 | Downgrade to an older app | Migrated rows are correct Y-up data for it too. Extra columns and tables are ignored. Older app imports create unstamped legacy rows, which the newer app migrates again. An older app writing `data_json` leaves the hash stale, so the newer app reclassifies |
| E21 | Snapshot label vs geometry tampering | Designer trusts the snapshot's library-verified `frameClass` (local single user). Documented |
| E22 | Placement on a component whose library row is still legacy (team pack, unsigned) | Flagged `update-library`. Refresh refuses with `FOOTPRINT_FRAME_LEGACY` |
| E23 | Default-variant switch on refresh | `mode: "same-footprint"` used by all frame resolve actions; details keyed by partId |
| E24 | Undo of a resolve | Restores the legacy snapshot; status recomputed and re-flagged; `first_flagged_at` kept |
| E25 | Designs with only drawn/IPC parts | `native`, never blocked by H13 (H15 owns generator qualification) |
| E26 | Editor seeding a drawn footprint from a legacy row | The drawn editor must not seed from `frameClass ∈ {legacy-kicad-ydown, ambiguous}` (OP5 guard where the editor loads an existing preview; implementer greps `src/modules/library/frontend/**` for preview→editor seeding). Server cannot tell, because drawn geometry is WYSIWYG-authored |
| E27 | Legacy KiCad project imports (whole board and schematic mirrored, 90/270 pads swapped) | Sticky `legacy-project-import` finding; resolution: re-import (Q1). No conversion command |
| E28 | Cloud-synced or dataset-captured legacy designs | Status recomputed wherever the design is opened. Capture tags `frameStatus` and withholds flagged sessions from upload (§3.6.6) |
| E29 | Pack update replaces a legacy core row that designs reference | Pack-update backup row (also on first boot, since classify runs before bootstrap) keeps `legacyPreview` evidence; classifier rule 8 still flags old snapshots |
| E30 | KiCad 5 `module` boards / legacy `fp_arc` angle format | Out of scope (H14 census reports unsupported). KF1 notes the sweep negation rule |
| E31 | Fixture Gerber staleness (USBtoUART `grbr.zip` timestamp ≠ pcb) | O1 harness first asserts every `%TO.P` flash matches the parsed board under the independent O2 formula. If not, the fixture is reported stale and the test fails loudly, never silently passes |
| E32 | Journaled `place_part` + `pcb_add_trace` replayed after OP8/CL3 rewrote the library row | P103 compat stamp: `DESIGNER_COMMAND_EPOCH` bumped in the same commits, so the records are `incompatible` (review/export/discard), never auto-replayed (§6). Packaged upgrades are already caught by P103's `appVersion` check |
| E33 | Unsigned cloud repack of local rows | Classified from geometry; correctly converted rows qualify (`geometry-verified`), lying stamps do not (§3.5.1) |
| E34 | Revert after the user edited a migrated row | Revert skips it (`skippedChanged`); the edit is preserved and reported |

---

## 6. Migration, rollback and data safety

**Library:**
- Additive columns and tables.
- Rows are rewritten only when they are `user.local`, proven legacy by geometry (§3.5.1), pass the pad-identity and frame-only delta checks, and run under a qualified package.
- Before any rewrite: one whole-DB `VACUUM INTO` snapshot per migration name, plus a per-row, per-run backup of the exact prior `data_json` with the post-rewrite hash.
- Rewrite is preview-only (`normalized.preview`/`padCount`, raw for project-derived rows); curated metadata and `sourceHash` are preserved.
- Revert: launch with `OPENPCB_LIBRARY_FRAME_REVERT=<runId>` (run ids are in `library_frame_migration_runs` and in the logged report). It restores rows still equal to their post-rewrite hash, clears `frame_*`, deletes the sentinel, and holds the rewrite for that launch. Launch with `OPENPCB_LIBRARY_FRAME_REWRITE=0` to keep holding it.
- Pack rows are never rewritten. Backups are taken whenever a pack overwrites a row that is not verified-canonical.

**Designer:**
- **No entity row is modified.** Only `designer_frame_status` is written.
- Resolution happens only by user commands under undo.
- Rollback = drop/ignore the table (older apps ignore it).

**Shared/CoreLibrary:** plain git commits. Releases and pins are user-gated (SH2, CL3). OpenPCB never depends on an unpublished tag in master: OP7 only after SH2.

**Recovery epoch (P103), revised (§10 #6).** Library rewrites change what a replayed `place_part` resolves to (`store.ts:784-789` resolves at dispatch time), while a replayed `pcb_add_trace` keeps its legacy coordinates and its `baseRevision` still matches. For SOT-23 the trace would land on pad 2's position. Therefore:
- **bump `DESIGNER_COMMAND_EPOCH`** (P103's semantic-change knob, `P103.md:585,658`; not the record-format `DESIGNER_RECOVERY_EPOCH`) in the OP8 commit and in the CL3 pin commit;
- OP4a's `0021_design_frame_status` migration already changes `DESIGNER_SCHEMA_HEAD` (test-enforced by P103);
- if P103 has not landed when OP8 lands, there is no journal to replay; P103 then starts from its own baseline and records "H13 OP8 predates epoch 1".

**Release posture:**
- `designer.outputQuarantine` stays on (export and project import blocked in release).
- `library.footprintIntakeQuarantine` now means "require verified frame provenance":
  - a signed, frame-stamped CoreLibrary pack becomes installable in release
  - fresh seeding returns once CL3 is pinned
  - local KiCad footprint intake becomes available in release only after OP7
- Lifting `designer.outputQuarantine` for KiCad-derived content additionally requires A7 sign-off (§7.3).

**Data safety tests:** suite M asserts byte-identical `designer_*` tables before and after migration, plus a successful revert with an edited row skipped.

---

## 7. Verification

### 7.1 Commands

```sh
# shared
cd ../shared && npm run test -w @openpcb/kicad-import && npm run typecheck && npm run build
# CoreLibrary
cd ../CoreLibrary && bun validate && bun test && bun tools/regen-frame.ts --dry-run
# OpenPCB (phase A, pinned)
cd OpenPCB
bun test src/core/backend/tests/footprint-frame-predicate.test.ts \
         src/core/backend/tests/library-footprint-frame-classification.test.ts \
         src/core/backend/tests/library-frame-intake.test.ts \
         src/core/backend/tests/library-import-quarantine.test.ts \
         src/core/backend/tests/library-frame-evidence.test.ts \
         src/core/backend/tests/designer-frame-status.test.ts \
         src/core/backend/tests/designer-capture-frame-tag.test.ts \
         src/core/backend/tests/designer-refresh-same-footprint.test.ts \
         src/core/backend/tests/designer-frame-export-blocker.test.ts \
         src/core/backend/tests/designer-capability-quarantine.test.ts \
         src/core/backend/tests/kicad-frame-helper.test.ts \
         src/core/backend/tests/kicad-board-footprint-unplace.test.ts \
         src/core/backend/tests/kicad-frame-boundary.test.ts
npm run test:react -- src/modules/designer/frontend/three-d src/modules/designer/frontend/pcb/FrameStatusBanner \
  src/modules/library/frontend/import-wizard
npm run typecheck && npm run gen:check && npm run gen:contracts -- --check
# OpenPCB (phase B, after OP7)
bun test src/core/backend/tests/library-footprint-frame-migration.test.ts \
         src/core/backend/tests/kicad-frame-golden.test.ts src/core/backend/tests/kicad-backside-corpus-oracle.test.ts \
         src/core/backend/tests/kicad-sch-mirror-oracle.test.ts src/core/backend/tests/kicad-frame-roundtrip.test.ts \
         src/core/backend/tests/frame-suite-drawn.test.ts src/core/backend/tests/kicad-project-import-real.test.ts
OPENPCB_KICAD_CORPUS_DIR=../cloud-workspace/cloud-auto-layout OPENPCB_REQUIRE_KICAD_REF=1 \
  bun test src/core/backend/tests/kicad-frame-golden.test.ts src/core/backend/tests/kicad-backside-corpus-oracle.test.ts \
           src/core/backend/tests/kicad-sch-mirror-oracle.test.ts      # release sign-off (A7)
npm run test:backend && npm run test:react
npm run test:e2e -- tests/e2e/footprint-frame.spec.ts                  # phase B (needs a migrated row)
```

### 7.2 Suites

All are Bun, under `src/core/backend/tests/`, per the CLAUDE.md test-location rule.

**N — newly imported** (`kicad-frame-golden.test.ts`, `kicad-backside-corpus-oracle.test.ts`):
- N1: `.kicad_mod` goldens through `commitKicadImport` → snapshot → `padWorldPositionMm` at 0/90/180/270, front and back. The expected values use the independent test-side KiCad formula: front pad = `N·(at_K + RotK(p_K, θ))`; back pad = `N·(at_K + RotK(N·p_K, θ_back))` with `θ_back` as KiCad writes it after an L/R flip (`180 − θ`). `RotK` is implemented in the test from KiCad `RotatePoint`, not imported. **Note:** the back half encodes the same reasoning as §3.1.3, so it is a regression test, not an oracle; the back-side oracle is N5/O4 (§10 #8).
- N2 (O1): USBtoUART.
  - Parse `.kicad_pcb` with the in-tree parser.
  - For each footprint: library form via `KICAD_CANONICAL_FRAME_V1.footprintToLibraryForm`, then `parseImportBundle` preview, then placement via the frame, then `padWorldPositionMm`.
  - Compare to the `F_Cu.gbr` `%TO.P` flashes: all 86 numbered pads by identity, tolerance 1 nm.
  - Drill hits: `PTH.drl`/`NPTH.drl` (inch, 4 dp), tolerance 1.5 µm.
  - Also compare to OpenPCB's own Gerber/Excellon export of the composed projection (`buildExportBundle` pure builder).
- N3: after H14 wiring, the same assertions on the **imported design after reopen** (new `ModuleRuntime` on the same DB file).
- N4 (O3, `sides` fixture):
  - Parts: SOT-23, SOIC-8, CP_Elec_4x5.4 and an in-repo `FRAME_PROBE` THT part (numbered asymmetric pads, 1 NPTH, 1 oval drill, 1 drill offset, a 30° pad).
  - Each at 0/90/180/270 on F and on B (flipped by pcbnew `Flip(pos, True)`), every numbered pad routed by a track stub.
  - Assertions: pad centres and identities; track endpoints coincide with their pad centres; drill hits by plating (incl. the offset-drill hole); `.pos` X/Y/side; skip-unless-refs.
- N5 (**O4, independent back-side oracle**, skip-unless-present via `OPENPCB_KICAD_CORPUS_DIR`; default probes `../cloud-workspace/cloud-auto-layout/workspace/external/writeback_check_r2/0400_laptimer58_Chickadee/semantic.kicad_pcb`):
  - Compose every B.Cu footprint through the production path (unplace → `parseImportBundle` → `KICAD_CANONICAL_FRAME_V1` placement → `padWorldPositionMm`). Compare against KiCad's own B.Cu track endpoints and via centres converted by `N` only (an input the composition never sees).
  - Assert: ≥ 44 coincidences (≤ 1 µm; the baseline measured in §2.9), and the alternative composition (re-flipped locals) scores strictly fewer.
  - Assert: F and B instances of `R_0603_HandSoldering` produce equal library previews (`contentKey` and `previewEqual`).
  - Also run on USBtoUART (front): every routed pad has a track endpoint at its centre.
- Schematic mirror oracle (`kicad-sch-mirror-oracle.test.ts`, §3.8).

**M — migrated** (`library-footprint-frame-migration.test.ts`). Seed an isolated DB with:
- a legacy `user.local` row from SOT-23 (direct)
- a legacy project-derived row from a 90° board instance and one from a B-side instance
- a legacy row with an offset-drill pad (`FRAME_PROBE`)
- a drawn row and an IPC row
- a team-pack legacy row
- a stub-raw row
- a `user.local` clone of a legacy core row with curated description/tags/`packageCode` and a model row whose GLB sha is in the test's `MIRROR_COMPENSATED_CORE_GLBS`
- a design placing all of them, with traces to SOT-23 pads and a pour touching one pad

Then run the migration (rewrite on) and assert, **against the old row, not a fresh import** (§10 #11):
- for every rewritten row and every electrical pad id: `new.centerMm == (old.x, −old.y)` (plus, for the offset pad, the hand-computed `R(α)·N·offset` shift written as numbers in the test); `widthMm`, `heightMm`, `rotationDeg` (after unplace normalization for project rows: the hand-derived β), `drillDiameterMm`, `number` unchanged; no pad lost
- the project-derived rows also equal a fresh import of the **front `.kicad_mod`** from `references/kicad-libs` (an independent source)
- curated `normalized` fields and `provenance.sourceHash` unchanged; clone gets the E16 GLB reason
- backups exist (row per run + one snapshot file); a second migration run (new dev legacy row) creates no new snapshot file
- drawn/IPC/team/stub `data_json` byte-equal
- all `designer_*` tables byte-equal
- design status `legacy-mirrored` with the right findings; SOT-23 `legacy-mirrored` with `connectedPadCount ≥ 1` (including the pour-only pad); 0603 `legacy-copper-invariant`
- second run: no-op
- revert restores byte-equal; a row edited after migration is skipped and reported
- injected failure (throw on row 2): row 1 migrated, row 2 untouched with `frame_rewrite_attempts = 1`; three failing launches leave row 2 `ambiguous (rewrite-failed)` and stop retrying
- `DESIGNER_COMMAND_EPOCH` changed (if P103 present)

**D — drawn/IPC** (`frame-suite-drawn.test.ts`):
- authored footprints: classification `authored`, snapshot `frameClass` authored, world pad positions unchanged by migration and by refresh
- design status `native`, export not blocked

**R — round trip** (`kicad-frame-roundtrip.test.ts`):
- the same `.kicad_mod` imported twice reuses the row, with identical preview
- import → place → save → reboot runtime → projection pad positions equal
- move + undo + redo → equal
- `refresh_part_footprint same-footprint` on a canonical part: no coordinate change
- opclib re-import of the same pack version: row byte-equal
- cloud repack (`buildUserLibraryPack`) → `importOpclib` into a fresh DB → class `kicad-converted`/`geometry-verified`, preview equal
- snapshot read 3× gives equal objects
- project import (after H14) → reopen → re-import into a new design: pad sets equal

**e2e** (`tests/e2e/footprint-frame.spec.ts`, Playwright, Chromium; **phase B, re-pin-gated**, §10 #26):
- A bun pre-step (`tests/e2e/fixtures/seed-legacy-frame.ts`) seeds `/tmp/openpcb-e2e.sqlite` with a legacy library row, a migrated (canonical) variant of the 0603, and a design placing both legacy parts.
- Open the PCB view: the banner is visible with the refdes.
- The export dialog shows the frame blocker.
- Click "Refresh safe parts" for the 0603: its finding disappears, the SOT-23 finding remains.
- Undo: the finding returns.

**Manual macOS QA (supplementary):** wizard preview, PCB and Board3D for CP_Elec / SOT-23 / SOIC-8 on F and B, plus pin-1 marks.

### 7.3 A7 status (explicit)

| Evidence | Covers | Status before sign-off |
|---|---|---|
| O1 USBtoUART Gerber/Excellon | front side, 0/±90/180, NPTH | runs in CI |
| O4 Chickadee + corpus | back side (track endpoints), F/B equality | local only (gitignored corpus), skip in CI |
| Schematic mirror oracle | 4 canonical mirrored orientations | local only, skip in CI |
| O3 `sides` via kicad-cli | full 0/90/180/270 × F/B matrix, drill offset, `.pos` | needs kicad-cli (absent) |

A7 is **open** until `OPENPCB_REQUIRE_KICAD_REF=1` passes on a machine with the corpus and kicad-cli references, or the user waives O3 (Q3). OP13's release notes state this status.

---

## 8. Cross-item interfaces

| Item | H13 provides | H13 consumes |
|---|---|---|
| **H14** (OPENPCB-62) | `kicad-frame.ts` implementing H14's `KicadBoardFrame` seam verbatim (+ `bboxMm`, `placementMirrored`, `arcSegmentCw`, `schPoint`, `schSymbolTransform`, `boardImportFrameStamp`), now in phase A; `src/shared/kicad-frame/board-footprint-unplace.ts` (`footprintToLibraryForm`, `contentKey`); `preview.frame` stamp (confirms assumption H13-a); `qualifyKicadFootprintIntake("kicad_project", …)` replacing `rejectKicadFootprints`; frame-aware dedupe; `sides` fixture content (H14 fixture tree `fixtures/kicad/sides/`); goldens; corpus oracles | All call sites (`insert-pcb`, `commit`, `insert-schematic`, ingestion) via `frame-port.ts`; `designer_import_reports.frame`; S13 oracle script `scripts/kicad-fixtures/oracle.ts` and `tests/helpers/gerber-x2-pads.ts` (whichever lands first creates it; OP11 reuses). **Overlap:** OP3b ↔ H14 S1 on `commit-kicad.ts`/`unqualified-import.ts` (serialize OP3b first) |
| **H19** (OPENPCB-67) | `readDesignImportStamp` (sync, for `ExportSnapshot.frameImportStamp`); the `ExportLibraryHooks.sourceFrame` adapter over the snapshot projection (pure `classifyDesignFrame`); preflight `Error:` line; interim guard removed when S6b lands; KF1's `KicadBoardFrame` constant for the S7b harness | `EXPORT_AMBIGUOUS_SOURCE_FRAME` slot; `parseGerber`/`parseExcellon`. **Asks:** (1) pre-read attaches `getFootprintFrameEvidence` as `LibraryFootprintRowEvidence.frameEvidence`; (2) `resolution` union += `"update-library"`; (3) rename "contract 16" references to **KF1**, and pick a non-numeric prefix for its own output contract (e.g. `MO1-manufacturing-output-contract.md`); (4) the drill-offset note is adopted in SH1, so S7b's offset-drill divergence allow-list entry is removed once SH1 is pinned |
| **H08** (OPENPCB-56) | Pad addresses `${placement.id}\|${pad.number}` are invariant under every H13 path (pad numbers/ids unchanged; refresh keeps `placement.id`), so H08 net bindings survive frame resolution; H13 never retires net ids. **H13 has no design migration**: frame-status reads go through `store.getPcbProjection` (H08 ensures there) and refresh goes through dispatch (H08 ensures before the tx). **Ask H08** to replace "H13's lazy migration must call `ensureNetIdentity` first" (`OPENPCB-56.md:837,910`) with this statement | None. Orphaned-copper blocking is separate |
| **H15** (OPENPCB-63) | `frame_class = 'authored'` for generated rows; stamping in `footprint-record.ts`/`commit-generated.ts`; CL1 `post-process-registry.ts` + G-FRAME replay of `provenance.postProcess`; `rebuild-previews.ts` stamp copy (CL1 before C1); `IntakeQualificationHooks.generator` slot in `qualifyPackFootprintIntake`. **Agreed ownership:** H15 owns `classifyFootprintGeometry` and wires it into the slot (one line in its O3) | Joint re-pin of `rendering-core-v0.1.4` (carries H15's fixes); `not-generated` classification for KiCad rows; H15 registers `silk-qualify` in the post-process registry |
| **103** (P103) | `DESIGNER_COMMAND_EPOCH` bump in OP8 and the CL3 pin commit (§6); `FOOTPRINT_FRAME_LEGACY` row in the exhaustive result table | Refresh commands go through dispatch and are journaled normally; compat stamp semantics |
| **H46** | `snapshotDatabase` (with free-space precheck), `library_frame_migration_runs`, per-run `library_footprint_frame_backups` and the in-process revert as the first concrete migration backup; H46 may absorb them into core infra and own retention | — |
| **openpcb-dataset / capture** | `frameStatus` tag on capture sessions; flagged sessions withheld from upload (§3.6.6) | — |
| **H23** | KF1 note: imported back parts are stored as `θ_K + 180`; `.pos` bottom rotation delta is H23's (unverified here) | — |

---

## 9. Open questions (user decision only)

1. **Legacy KiCad project imports.** Is re-importing from the KiCad source an acceptable sole resolution? Those boards have mirrored board coordinates, mirrored schematics and swapped 90/270 pads. The alternative is an explicit, undoable whole-design conversion command, which is large and touches every entity kind; it is not designed here. Default if unanswered: re-import only.
2. **CoreLibrary ordering.** CoreLibrary has 57 uncommitted changes, including the tool files CL1 edits. `regen-frame.ts` refuses a dirty tree (whole tree). Please commit or land that pass before **CL1** (and CL2). Alternatively, confirm you want CL1/CL2 run on a stash and the pass rebased onto them.
3. **A7 sign-off evidence.** O3 needs kicad-cli (KiCad 8.0.x, not installed). Install it so the `sides` references can be generated? Or accept O1 + O4 (local corpus) + the schematic mirror oracle as sufficient, waiving O3? Default: A7 stays open, and `designer.outputQuarantine` stays on for KiCad-derived content until answered.
4. **Corpus fixtures.** The back-side and mirror oracles use gitignored third-party boards under `cloud-workspace/cloud-auto-layout`, so they only run locally. May a small subset (the Chickadee board and one or two mirrored schematics) be vendored into `src/core/backend/tests/fixtures/kicad/` after a license check, so CI runs them? Default: local-only, with skip in CI.
5. **Dataset capture withholding.** Is withholding upload of frame-flagged sessions (kept locally, not deleted) acceptable, or should they upload tagged only? Default: withhold.

Decided here, with rationale recorded:
- No per-placement "attest as correct" escape: a mirrored land pattern cannot accept the real part.
- The export frame blocker is active in all builds, because it is data-driven.
- Frame trust is anchored on the signature or geometry evidence, never on a self-declared stamp.
- The manifest `schemaVersion` stays at 1.0.0.
- The contract is **KF1** (letter prefix, outside PROGRAM.md's numbered S-series); H19 is asked to follow suit.
- The flag name `library.footprintIntakeQuarantine` is kept.
- `provenance.sourceHash` is never changed by the frame migration.
- KiCad drill-offset semantics (`ShapePos`) are adopted in transform version 1.

---

## 10. Review findings disposition (r1 → r2)

| # | Sev | Disposition | Where |
|---|---|---|---|
| 1 | blocker | **Fixed.** Details map keyed by partId in both modes; two-variant batch test | §3.6.5, OP4b |
| 2 | major | **Fixed.** Classify pass runs before `bootstrapCoreLibrary`; pack importer classifies stale/NULL rows inline and backs up any non-verified row | §3.5.2, §3.5.4, OP3a/b |
| 3 | major | **Fixed (alternative retention).** At most one snapshot per migration name (runs table), free-space precheck, 3-attempt cap → `ambiguous`. No deletion policy is needed because copies cannot accumulate | §3.4.1, §3.5.2-3, E15/E18 |
| 4 | major | **Fixed.** `frame_data_sha256` + `frame_classifier_version`; readers and boot reclassify on mismatch. Trigger rejected (would null same-statement writes) | §3.4.1, §3.5.5 |
| 5 | major | **Fixed.** Stamps are claims; `kicad-converted` needs a valid signature or the KF1 geometry relation; trust never copied (clone, cloud repack); designer requires the verified `frameClass`, not a bare stamp | §3.2.2, §3.5.1, §3.5.4, §3.6.2 |
| 6 | major | **Fixed.** `DESIGNER_COMMAND_EPOCH` bump in OP8 and the CL3 pin commit (P103's semantic knob; the reviewer named the record-format epoch) | §6, E32 |
| 7 | major | **Fixed.** G-FRAME replays `provenance.postProcess` via a registry; generator slot in pack intake, H15 owns the classifier and the wiring | §3.9, §3.5.4, §8 |
| 8 | major | **Fixed.** O4 corpus oracle (B.Cu track endpoints ≥ 44, alternative strictly fewer; F/B equality); N1 back half relabelled non-oracle; A7 marked open | §7.2 N5, §7.3, §1 A7 |
| 9 | major | **Fixed.** Corpus mirror oracle over the 4 canonical mirrored orientations KiCad writes (census in §2.9) | §3.8, OP11 |
| 10 | major | **Fixed.** `compareFrameConversion` in SH1; CL2 aborts on any non-frame delta not in a reviewed allow-file; OP8 uses the same check | §3.2.1, §3.9, §3.5.2 b4 |
| 11 | major | **Fixed.** Suite M asserts per-pad against the old row; the front `.kicad_mod` comparison is kept | §7.2 M |
| 12 | minor | **Fixed.** Preview-only merge; `sourceHash` unchanged; baked-GLB clone reason via `MIRROR_COMPENSATED_CORE_GLBS` | §3.5.2 c7, §3.5.1, §3.9 CL3 |
| 13 | minor | **Fixed.** Classification over the caller's projection/revision; H19 hook over the snapshot; interim guard uses the handler's projection + revision assert | §3.6.2-3, §3.7 |
| 14 | minor | **Fixed.** Code added to `parseDispatchResultJson` and the SDK union; replay test | §3.6.1, §3.6.5 |
| 15 | minor | **Fixed** (H13 side); H08 asked to reword | §3.6.3, §8 |
| 16 | minor | **Partly rejected.** H19's current slot (`OPENPCB-67.md:232-233`) already carries `resolution`; the review cited an older revision. Remaining gap: `update-library` is not in the union, so H19 is asked to add it | §3.7, §8 |
| 17 | minor | **Fixed (alternative).** Backups keyed by run id with post-rewrite hash; revert skips changed rows; revert runs in-process via env (no second writer), so the standalone script is dropped; env vars specified | §3.4.1, §3.5.2, §6 |
| 18 | minor | **Fixed.** `connectedPadCount` from the connectivity kernel incl. pours/free pads | §3.6.2 |
| 19 | minor | **Fixed.** Frame-aware `rawPadMatchesPreview`; invariant stated in KF1 | §3.5.5 |
| 20 | minor | **Fixed.** Unplace moved to `src/shared/kicad-frame/`; OP9 moved to phase A | §3.8, §3.11, §4.3 |
| 21 | minor | **Fixed.** Contract renamed KF1; PROGRAM.md gets a cross-item table; H19 asked to rename | §1, OP1, §8 |
| 22 | minor | **Fixed.** Claim corrected (8 declarations, ≈10 runtime cases, all green); OP7 lists 19 coupled test files with the oracle-derivation rule | OP3b, OP7 |
| 23 | minor | **Fixed.** Whole-tree dirty check; Q2 gates CL1 and CL2 | §3.9, §4.2, Q2 |
| 24 | minor | **Partly rejected.** `PATCH /footprints/:id/model` (`routes.ts:1744`) only marks a conversion failed; the actual writers are the model upload route and `models/import`. Warn there, do not refuse (3D only, and refusing breaks bundle restore) | §2.5, §3.5.4 |
| 25 | minor | **Fixed.** Snap, then modulo, then 360→0 | §3.1.2, OP2 tests |
| 26 | minor | **Fixed.** e2e is phase B, under OP12 | §7.2, OP12 |
| 27 | minor | **Fixed.** Capture tag + upload withholding in OP4a (Q5) | §3.6.6 |
| 28 | minor | **Fixed.** Cross-item merge order with rebase rules | §4.7 |

Additional change not raised by the review: H19's drill-offset note (`OPENPCB-67.md` §8, its finding 13) is adopted in SH1, because transform version 1 must be final when it is published (§3.1.2, E13).

### Rejected review findings

- **#16 (partial):** the requested `sourceFrame` field already exists in H19 as `resolution`. Only the missing `update-library` value is carried forward as an ask.
- **#24 (partial):** the cited `PATCH` route does not write `model_ref_json`. "Refuse" was replaced by "warn": a mirrored 3D model on a canonical footprint is a visual defect, not a manufacturing one, and refusing would break re-importing an exported model bundle.
- **#17 (mechanism):** "refuse to run if the app holds the DB lock" is not reliably detectable under WAL with an open reader. Revert runs inside the app process instead, which removes the second writer.
- **#3 (mechanism):** a retention cap that deletes files was replaced by "never more than one snapshot per migration name". This bounds disk use without H13 deleting user data, which stays H46's responsibility.
