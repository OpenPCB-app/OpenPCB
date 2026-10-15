# OPENPCB-63 (H15) — Qualify IPC presets and CoreLibrary land patterns before fabrication

Status: design, revision 2 (2026-10-15), after the adversarial review (verdict fix-required, 24
findings). This file is the H15 design; `H15.md` in this directory is a symlink to it.
§10 maps every finding to its resolution, and §11 records the findings that were rejected or
narrowed.

Scope: the H15 work remaining after shared commits `da9db4c` (SOT pin rows, QFN EP sizing) and
`91c7e7e` (table fixtures) on `../shared` branch `fix/offline-eda-text`.

Repos:

- OpenPCB, branch `master`.
- `../shared`, branch `fix/offline-eda-text`. Commit only, never publish.
- `../CoreLibrary`, branch `master`. Its tree is dirty, owned by another lane.

---

## 1. Scope & acceptance mapping

| # | Plane acceptance criterion | Design element (slice) |
|---|---|---|
| A1 | Quarantine broken generators in the UI and the generation API; keep the quarantine until a replacement passes | Availability needs three things: the upstream qualification manifest, an **OpenPCB-owned accepted-fingerprint table** (§3.2), and a server-side output check. The pinned `rendering-core-v0.1.3` ships no manifest, so **all five IPC families are quarantined** (D1). A server geometry guard covers IPC presets and templates (§3.3). (O1) |
| A2 | Fix family data and algorithms in rendering-core from cited drawings; no invented constants, no certification claim | S1 chip, S2 SOIC, S3 QFP, S4 silk clip with cited constants, SOURCES.md rows (S1–S4, S7). |
| A3 | Check pad count, numbering, pitch, EP dimensions and non-overlap | Shared table fixtures plus the KiCad oracle (S1–S3); `generatedGeometryDefects` (O1); in-tree DRC qualification (O6). |
| A4 | Regenerate on any package or density change; displayed parameters == saved geometry (T-319) | O2 has four parts: derived IPC payload, a tab-aware current payload, a **race-safe** template materialize, and wizard-store persistence of tab, template form and payload. Server re-derivation already exists (`resolve-generated-footprint.ts:156-176`). |
| A5 | Qualify CoreLibrary footprints against the default DRC profile by fixing geometry (T-214) | **Silk scope (T-214).** The `clipSilkToPads` kernel (S4) runs as a CoreLibrary post-process (C1/C2) after H13 regeneration. Strict G10 silk rules use the kernel's own checker. O7 runs the real DRC with **silk codes asserted**. Non-silk codes are held by a ratchet baseline and become follow-ups (§3.6, open question 3). |
| A6 | Publish and pin tested rendering-core and CoreLibrary | User action. The publish is named **`rendering-core-v0.1.4` containing S1–S7** (§4, open question 1). O8 is the re-pin. Every OpenPCB slice before it typechecks on v0.1.3. |
| A7 | Table fixtures: every preset × density, all SOT, QFN EP; geometry, clearance, numbering, params↔result | Shared geometry tests (S1–S3), the manifest↔revision-hash invariant (S5), OpenPCB parity, fingerprint-table and DRC tables (O1, O6). |
| A8 | Independent comparison against source drawings; report tolerances and sources | `ipc7351b-drawings.ts` (transcribed separately) and the KiCad oracle at `cb8299c`; S7 report → SOURCES.md delta table. |
| A9 | Invalid presets cannot be imported indirectly | Qualification is **geometry-based**: the fingerprint of the pads actually placed and written (§3.2, §3.4). It is never claim-based. A forged `raw.source`, a forged `ipcRevision` or a relabelled `sourceKind` cannot make legacy or arbitrary geometry qualify. A flagged footprint cannot be set as a default (server check), and placed footprints block export (H19 slot). |
| A10 | Migrate placed geometry only with explicit provenance and backup | **User decision: flag, do not migrate.** Placed parts are classified from **their own snapshot geometry** (§3.5); library rows are not used. No data rewrite in OpenPCB. The CoreLibrary silk change (C2) is a git-tracked source change. |

Also in scope (FOCUS):

- The parametric-template overlap defect (S6, O1).
- QA rows T-214, T-316 and T-319 (O9).
- Native Electron QA (manual).

Non-goals:

- A pin-1 silk marker for generated parts.
- Renaming chip footprints (`C_*` for every chip; see D7).
- IPC-7351B tolerance-stack Z/G/X equations.
- Re-sourcing the density addition tables.
- Coordinate frames (H13).
- Rule semantics (H16).
- CoreLibrary non-silk DRC findings (follow-ups, §3.6).

### Decisions taken (rationale recorded; user may veto)

- **D1 — Quarantine chip, SOIC and QFP too, immediately.** Each was verified on the pinned
  generator; chip, SOIC and QFP generation has not changed between `rendering-core-v0.1.3` and the
  branch head (review probe 5).
  - **Chip 0603:** pad 1 centre is |x| 1.15 with an X extent of 0.65. The copper spans |x|
    0.825…1.475, while the terminals span 0.5…0.8. The lands miss the terminals. KiCad
    `R_0603_1608Metric` has centre 0.825 and pads 0.8×0.95.
  - **SOIC-8:** pad centre is 3.0 against KiCad's 2.475.
  - **QFP:** bodies are invented by formula (`family-presets.ts:241-255`) and
    `terminalWidthMm = pitch·0.5`.
  - **Consequence:** on the pinned tag the IPC tab offers no family until the publish and O8.
    Templates and drawn footprints remain available.
- **D2 — Flagged footprints are a manufacturing-export blocker** (not overridable). The blocker is
  delivered as **H19's `EXPORT_UNQUALIFIED_FOOTPRINT` capability blocker** (§3.5), not as a
  separate problem type. Defects of the legacy (≤ v0.1.3) generators:
  - Chip lands miss the terminals: opens.
  - SOIC/QFP lands are offset outward. For QFP the bodies and lead spans are not from drawings.
    The result is missing or weak heel fillets, and on QFP lands that miss the leads. *(This
    replaces the earlier "heel-short" wording: the review's probe 3 found no shorts on SOIC or
    QFP.)*
  - QFN exposed pad overlaps signal lands: 320 `NET_SHORT_CIRCUIT` across the v0.1.3 QFN presets
    (probe 3).
  - SOT has the wrong pin count.
  - Remedy: replace the footprint in the Library, then `refresh_part_footprint`.
- **D3 — Qualification is derived at read time from geometry, not stored.**
  - No SQL migration.
  - Inputs are the pads actually placed (snapshot) or stored (row).
  - Two OpenPCB code tables, accepted fingerprints and legacy fingerprints, hold the policy.
    Revoking a revision deletes its block, which re-flags affected parts without a data
    migration.
- **D4 — Silk semantic:** silk ink stays ≥ 0.15 mm from each pad's mask opening, or from bare
  copper where the pad has no opening on that face.
  - Sources for 0.15 mm: JLCPCB "pad-to-silkscreen", eda-standards S12, `fab-presets.ts:150`.
  - The mask opening is the copper grown by the pad's `solderMaskExpansionMm`, else 0.075 mm (the
    new-board default, `pcb-defaults.ts:111`).
  - This matches `FAB_SILK_CLEARANCE` (contract 11 §3). No H16 dependency.
- **D5 — Indirect intake never rejects on the generator branch and never mutates claims.** The
  read-time classifier decides from geometry (§3.4), so intake needs no stripping.
  - The previous "strip `ipcRevision`" behaviour is removed.
  - This resolves review findings 3 and 4. Downgrades are impossible: acceptance does not depend
    on the installed generator.
  - The release flag `library.footprintIntakeQuarantine` (H13) is unchanged.
- **D6 — Fine-pitch `FAB_MASK_*` warnings are accepted only when proven inevitable by the package
  drawing** (§3.6), never by code allowlist and never because the generator chose a narrow gap.
- **D7 — The chip family uses resistor terminal dimensions.** The sources are IPC-SM-782 resistor
  table and Vishay CRCW; the oracle is KiCad `R_*`. Names stay `C_*` (non-goal). SOURCES.md states
  this, and the S7 report prints the KiCad `C_*` deltas for information only (no assertion).
  Open question 7.

---

## 2. Current state (verified)

### 2.1 `../shared/packages/rendering-core` (branch `fix/offline-eda-text`, version field 0.1.4, unpublished)

Remote tags are `rendering-core-v0.1.0`…`v0.1.3` only.

**IPC history.** The IPC generator entered the package at v0.1.3. It is byte-identical, apart from
`.js` import extensions, to the in-tree OpenPCB generator from `dda0d07` (2026-04-15) up to
extraction in `81c3ccd`. Verified by `git log --all` on `*ipc7351b/pad-calculator.ts` and
`family-presets.ts`, and by diffing `dda0d07` against `rendering-core-v0.1.3`. So **exactly one
legacy IPC generator state ever shipped.** That makes the legacy deny-list finite: every family ×
size × density.

**Chip — `pad-calculator.ts:117-175`:**
- `padSpan = L − T + padHeight + toe` gives centre = (L + 2·toe + heel)/2. The correct nominal
  centre is (L − T)/2 + (toe − heel)/2.
- Silk is transposed.

**Gull-wing — `pad-calculator.ts:196-273`:**
- `padCenterX = spanMm/2 + (toe−heel)/2`. `spanMm` is documented as centre-to-centre, but
  `soicParams` feeds the tip-to-tip E.
- `bodyLengthMm` is invented.
- Courtyard (l.258) is `spanMm + padHeight + 2c`.

**QFP — `pad-calculator.ts:396-512`:**
- Same span semantics.
- `qfpParams` invents body, span, b and L.
- Courtyard (l.500-501) is `span + padH + 2c`.

**Silk and labels:**
- `silkRect` ignores pads.
- `SILK_LINE_WIDTH = 0.12`.
- `SILK_PAD_CLEARANCE = 0.2` (uncited).
- The 0.8 mm ref label produces `FAB_SILK_WIDTH` and `FAB_SILK_TEXT_HEIGHT` on every generated
  part.

**SOT and QFN:**
- Fixed by `da9db4c`.
- `QFN_EP_MIN_GAP_MM = 0.2` (l.522) is cited: MO-220 K ≥ 0.20–0.25 mm (SOURCES.md:41).

**Parametric templates (`src/parametric/*`, `generatorVersion: 1`):**
- **`mounting-array` numbers every pad `""`** (`mounting-array.ts`; `parametric-geometry.test.ts:105`
  asserts it). Unplated holes use `layer: "Edge.Cuts"`.
- `parametric-geometry.test.ts:116-131` reproduces four schema-valid overlapping sets. One of them
  is a mounting array with `drillMm 8, pitch 1`, whose pads all have number `""`.

**Pad type on the branch:** carries `layers`, `drillSlotMm`, `drillOffsetMm` and `plated`. The
pinned v0.1.3 type lacks them, so consumers read them structurally.

**KiCad oracle (`references/kicad-libs/kicad-footprints` @ `cb8299c`).** The review spot-checked
R_0603, SOIC-8 and LQFP-64 against this table. Generator column = current/pinned nominal output.

| Preset | generator now | KiCad file | KiCad |x|, size (x×y) |
|---|---|---|---|
| 0201 | 0.65 | `Resistor_SMD.pretty/R_0201_0603Metric` | 0.32, 0.46×0.4 |
| 0402 | 0.85 | `R_0402_1005Metric` | 0.51, 0.54×0.64 |
| 0603 | 1.15 | `R_0603_1608Metric` | 0.825, 0.8×0.95 |
| 0805 | 1.35 | `R_0805_2012Metric` | 0.9125, 1.025×1.4 |
| 1206 | 1.95 | `R_1206_3216Metric` | 1.4625, 1.125×1.75 |
| 1210 | 1.95 | `R_1210_3225Metric` | 1.4625, 1.125×2.65 |
| 2010 | 2.85 | `R_2010_5025Metric` | 2.3125, 1.225×2.65 |
| 2512 | 3.5 | `R_2512_6332Metric` | 2.9625, 1.225×3.35 |
| SOIC-8 | 3.0 | `Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm` (MS-012AA, ADI R-8) | 2.475, 1.95×0.6 |
| SOIC-14 | 3.0 | `SOIC-14_3.9x8.7mm_P1.27mm` (MS-012AB, ADI R-14) | 2.475, 1.95×0.6 |
| SOIC-16 | 3.0 | `SOIC-16_3.9x9.9mm_P1.27mm` (MS-012AC, ADI R-16) | 2.475, 1.95×0.6 |
| SOIC-28W | 5.15 | `SOIC-28W_7.5x17.9mm_P1.27mm` (MS-013AE, ADI RW-28) | 4.65, 2.05×0.6 |
| TQFP-32 | 4.7 | `Package_QFP.pretty/TQFP-32_7x7mm_P0.8mm` (MS-026 ABA) | 4.1625, 1.475×0.55 |
| TQFP-48 | 4.5 | `TQFP-48_7x7mm_P0.5mm` (MS-026 ABC) | 4.1625, 1.475×0.3 |
| LQFP-64 | 5.5 | `LQFP-64_10x10mm_P0.5mm` | 5.675, 1.55×0.3 |
| LQFP-100 | 7.75 | `LQFP-100_14x14mm_P0.5mm` (NXP SOT407-1) | 7.675, 1.6×0.3 |

**Review probes on the generators:**
- Probe 3, pinned v0.1.3, all presets × densities: 320 `NET_SHORT_CIRCUIT`, all on QFN.
- Probe 4, branch source: no errors. The remaining warnings are `FAB_MASK_BRIDGE` (13 footprints)
  and the silk codes.

### 2.2 OpenPCB (`master`; pins `rendering-core-v0.1.3`, `kicad-import-v0.1.2`, `opclib-pack-v0.3.0`)

**Contracts dependency.** `package-lock.json:3811`: the vendored `@openpcb/contracts` candidate tgz
**already depends on `rendering-core-v0.1.4`**. That tag does not exist yet.

**Generator policy (`generator-policy.ts:23-33`):**
- Hard-coded to `sot`/`qfn`.
- Four consumers: `IpcPresetTab.tsx:55-63`, `FootprintGeneratorPanel.tsx:139`,
  `useImportWizardStore.ts:314`, and the server `resolve-generated-footprint.ts:75-76`.

**Generated footprint resolver (`resolve-generated-footprint.ts`):**
- `:55-84` takes a strict tuple.
- `:87-130` re-materializes templates server-side.
- `:132-150` writes provenance including `generatedSourceSha256` = sha256(JSON.stringify(source)).
- `:156-176` rejects mismatched client source with a 422 `UNQUALIFIED_GENERATOR`.
- No geometry check.

**Persisted provenance (`footprints.data_json.provenance`):**
- Pre-`d11ce92` generated rows have no generator identity.
- Post-`d11ce92` rows carry `generator`, `generatorPackage`, `presetParameters` and
  `generatedSourceSha256`. Templates carry `generator{kind:"template",…}` and `generatorVersion`.
- CoreLibrary rows have `provenance.source:"kicad-derived"`.

**Placement snapshot (`LibraryFootprintPlacementSnapshot`, `src/sdks/library/types.ts:178-187`):**
- Carries no provenance.
- Built by `parseFootprintPlacementSnapshot` (`queries.ts:429-460`) from **`normalized.preview`**.
  It passes through `rederivedFootprintPreview` (bounds only) and `withLegacyPlating`.
- Stored verbatim as `designer_schematic_parts.footprint_snapshot_json`. The parser
  (`projection-read.ts:42-48`) is a pass-through cast, so new optional fields survive.
- `PcbPlacedPart.footprint` is the same type (`sdks/designer/types.ts:977`).

**Library rows can change or vanish under a placed snapshot:**
- `deleteComponents` (`queries.ts:1714-1736`) deletes orphaned footprint rows.
- `.opclib` import updates existing footprint rows in place under the same id
  (`opclib-importer.ts:497-509`). It sets the `content_sha256` column to the pack entry sha.

**Staleness check (`store.ts:166-185` `markStaleFootprints`):**
- Compares id and `provenance.sourceHash`, read via `json_extract`
  (`getDefaultFootprintRefs`, `queries.ts:2302-2327`).
- It is called inside `getSchematicProjection`, so it runs on every projection read.

**Default-footprint writes:**
- `PATCH /components/:id {defaultFootprintId}` (`routes.ts:1391`) → `updateComponent`
  (`queries.ts:1877`).
- Callers are `ChangeFootprintDialog.tsx:131` and `ComponentDetailPage.tsx:201`. Neither checks
  qualification.

**Manufacturing export:**
- `routes.ts:3426` (`pnp.csv`), `:3440` (gerber) and `sdk.ts:136-142` call
  `assertQualifiedManufacturing()`.
- H19 (OPENPCB-67) replaces this flow with `readExportSnapshot` → `collectCapabilityBlockers` →
  422 `export-blocked` carrying `blockers[]`.
- H19 reserves the H15 slot (OPENPCB-67 §3.3): `ExportSnapshot.unqualifiedFootprints?:
  {placementId, reference, generator: string}[]`, blocker `EXPORT_UNQUALIFIED_FOOTPRINT`, and owns
  `PcbExportDialog`.

**Intake (`importOpclib`):**
- `opclib-importer.ts:280` calls `rejectUnqualifiedPackFootprints`, which rejects **every** pack
  footprint when the release flag is on.
- With the flag off (dev builds), packs enter unverified.

**T-319:**
- `FootprintGeneratorPanel.tsx:114-205` keeps the selection, the payload and an uncontrolled
  `<Tabs defaultValue="ipc">` in local state.
- `TemplateTab.tsx:168-198` `handleGenerate` awaits `materialize` with no request identity check.
  A late response for old parameters is emitted.
- Wizard store guard (`useImportWizardStore.ts:255-321`): `hasCurrentPreset` returns `true` for
  **any** template payload, so it never compares against displayed template parameters.

**DRC:**
- `runDrc` lives at `drc-engine.ts:201`. Intra-footprint pad pairs run the short tier only
  (`clearance.ts:122-124`).
- Default board: `jlcpcb_2l`, expansion 0.075, `annularRingMm 0.2`, `drillSizeMm 0.4`,
  `copperToBoardEdgeMm 0.5`, clearance floor 0.1 (`pcb-defaults.ts:61-111`).
- Arc chords: `MAX_CHORD_DEVIATION_MM = 0.01`, inscribed (`arc-chords.ts:32`,
  `silk-artwork.ts:345-360`).
- Silk layers: `F.SilkS`/`F.Silkscreen`/`B.SilkS`/`B.Silkscreen` (`silk-artwork.ts:87-92`).

**Tests that depend on a usable IPC family:**
- `library-generator-import.test.ts:162-201` (chip 0603; `:125-` SOT/QFN quarantine loop).
- **`library-component-footprint-assign.test.ts:95-117` and
  `designer-refresh-part-footprint.test.ts:150-155` use SOIC-8**, which D1 quarantines.
- `preset-quarantine.test.tsx` (chip as "available").

**CoreLibrary pack in CI:** `resources/core-library-release.json` has **`productionRelease: null`**,
so no pinned pack exists in CI.

**QA rows:** `docs/qa/2026-10-hardening/reconciliation.json` T-214, T-316 and T-319 are all
pending.

### 2.3 `../CoreLibrary` (`master` @ `392b75e`, dirty: 45 files owned by another lane)

**Footprints:**
- 168 footprints, all `kicad-derived` and Y-down (H13 will regenerate).
- 1605 silk graphics, all 0.12 mm.
- Pads: 897 roundrect, 351 rect, 413 circle, 29 oval.
- Silk text heights: 168 reference labels at 1.0 mm, plus one footprint text at 0.8 mm.

**Pins:** `rendering-core-v0.1.3` and `kicad-import-v0.1.2` (`package.json:28-31`). H13's
regeneration needs an unpublished kicad-import.

**Footprint ids** derive from `sha256(source)` (`import-kicad-batch.ts:903`).

**G10 gate** (`tools/gates/footprint-drc.ts:40-52`):
- `minDrillMm 0.3`, `minAnnularMm 0.13`, `minCopperGapMm 0.127`, `silkClearanceMm 0.15`.
- The silk rule is `note`, uses AABB, and has no stroke-width rule.

**Review probe 1** (168 previews, each alone on a fixed 60×60 board, one net per pad number):

| Code | Count | Footprints | Cause |
|---|---|---|---|
| `ANNULAR_RING_MIN` | 11 | 9 | real (G10 limits looser than the default board) |
| `DRILL_SIZE_MIN` | 3 | — | real |
| `COPPER_OFF_BOARD`, `HOLE_OFF_BOARD`, `COPPER_TO_BOARD_EDGE` | 27, 25, 5 | 4 | harness: THT origin at pin 1 on a fixed board |
| `NET_SHORT_CIRCUIT` | 96 | 10 | harness: unnumbered paste pads put on nets |
| `NET_SHORT_CIRCUIT` (after unnumbered pads were left off nets) | 4 | 1 | usb-c: merged pad numbers |

Silk and other warnings in the same probe: `FAB_SILK_WIDTH` 159/159, `FAB_SILK_CLEARANCE` 490/103,
`FAB_MASK_BRIDGE` 718/29, `MASK_SLIVER` 16, `COURTYARD_INVALID` 1, `SILK_TO_MASK_CLEARANCE` 13/5,
`SILK_TO_BOARD_EDGE` 13/4, `FAB_SILK_TEXT_HEIGHT` 1.

---

## 3. Design

### 3.1 rendering-core (shared) — algorithms and data

All lengths are in mm.

**Land model.** Lands stay IPC-7351B **nominal-dimension lands**, as SOT and QFN already are:
- A land spans the nominal foot plus the density's toe, heel and side additions.
- "Nominal" means the drawing's min/max midpoint, or its BSC value.
- Every preset literal carries `// <standard> — <drawing id>`.
- Drawing values are transcribed **separately** into `tests/fixtures/ipc7351b-drawings.ts`.

**S1 Chip.**
```
padLength = T + toe + heel ; padWidth = W + 2·side
centreX   = (L − T)/2 + (toe − heel)/2
pad i: { centerMm: {x: ∓centreX, y: 0}, widthMm: padLength, heightMm: padWidth, rotationDeg: 0 }
silk body outline: rect width L (x), height W (y) → S4 clip
courtyard: width = 2·centreX + padLength + 2·c, height = max(W, padWidth) + 2·c
```
- **Sources** are the drawings KiCad's `descr` cites: IPC-SM-782 resistor table p.72 (0402…2512)
  and Vishay CRCW e3 (0201). These go into `CHIP_DRAWINGS`; if a preset disagrees with the
  fixture, the fixture wins.
- **SOURCES.md must state** (D7): "chip family = **resistor** terminal dimensions; MLCC terminal
  bands differ; footprint names keep the historical `C_` prefix".
- **Expected |x|** with the current literals: 0.40/0.575/0.825/0.975/1.525/1.525/2.375/3.025,
  against KiCad R_* (all Δ ≤ 0.08).

**S2 SOIC.**
- Rename `spanMm` → `leadSpanMm` (tip-to-tip E, nominal).
- Centre: `padCenterX = leadSpanMm/2 − terminalLengthMm/2 + (toe − heel)/2`.
- **Courtyard (fixes l.258):** `courtW = 2·padCenterX + padLength + 2·c`;
  `courtH = max(bodyLengthMm, pinsPerSide·pitch) + 2·c` (unchanged).
- Delete the `soicParams()` formulas. Use four literal presets citing JEDEC MS-012AA/AB/AC and
  MS-013AE, with the ADI drawings R-8, R-14, R-16 and RW-28. Fields: e, E, L, b, E1, D.
- Silk is the body rect E1×D, then the S4 clip.
- **Tolerance flag (record in SOURCES.md *before* coding):**
  - MS-012 has L 0.40–1.27 (nominal 0.835).
  - The nominal-land centre then differs from KiCad's IPC-equation centre by ≈ 0.108 mm on
    SOIC-8/14/16.
  - That rounds up to the 0.15 ceiling with only 0.042 mm of headroom.
  - The implementer records the exact observed Δ. If any transcription moves it above 0.15, it is
    a STOP (§S1–S3 rule), not a widening.

**S3 QFP.**
- Rename `spanXMm/spanYMm` → `leadSpanXMm/leadSpanYMm`; centre formula as S2 on both axes.
- **Courtyard (fixes l.500-501):** `courtW = 2·padCenterX + padLength + 2·c`,
  `courtH = 2·padCenterY + padLength + 2·c`.
- Delete `qfpParams()`. Use four literal MS-026 presets: TQFP-32 ABA, TQFP-48 ABC, LQFP-64 BCD,
  LQFP-100 BED. Cross-check against the drawings KiCad cites: Microchip 00000049BZ p.656/666 and
  NXP SOT314-2/SOT407-1. Fields: e, D/E, D1/E1, L, b.

**Oracle tolerance rule (S1–S3).**
- Extend `KICAD_ORACLE` with the 16 rows from §2.1, copied verbatim from `cb8299c`.
- Tolerances start at the SOT/QFN values: centre 0.10, signal size 0.50.
- Where an observed Δ is larger, record value and cause in SOURCES.md, and set the family
  tolerance to the Δ rounded up to 0.05.
- **Hard ceilings: centre 0.15, size 0.60.** Exceeding one is a STOP.

**S4 Silk clip kernel** — new `src/silk/clip-silk.ts`, exported from the package root.
```ts
export interface SilkClipOptions {
  /** Minimum ink-edge distance to a pad's mask opening, or to its copper where it has none. */
  readonly silkToPadMm: number;
  /** Opening growth for pads without their own `solderMaskExpansionMm`; negatives clamp to 0. */
  readonly defaultMaskExpansionMm: number;
  /** Strokes narrower than this are widened first; null keeps widths. */
  readonly minStrokeWidthMm: number | null;
  /** Surviving fragments shorter than this (centreline) are dropped. */
  readonly minFragmentMm: number;
  /** Chord error when this kernel samples or flattens an arc/circle (inscribed chords). */
  readonly arcChordToleranceMm: number;
  /** Max chord deviation of the DOWNSTREAM consumer that will flatten kept arcs (OpenPCB DRC/Gerber: 0.01). */
  readonly consumerChordDeviationMm: number;
}
export interface SilkClipReport {
  readonly widened: number; readonly cut: number; readonly droppedFragments: number;
  readonly flattenedArcs: number; readonly droppedFilled: number;
}
export function clipSilkToPads(graphics: readonly PreviewGraphic[], pads: readonly FootprintRenderSourcePad[],
  options: SilkClipOptions): { graphics: PreviewGraphic[]; report: SilkClipReport };
/** The SAME keepout predicate, as a checker: every silk ink point closer than required (used by CoreLibrary G10). */
export function silkClearanceViolations(graphics: readonly PreviewGraphic[], pads: readonly FootprintRenderSourcePad[],
  options: SilkClipOptions): readonly { graphicIndex: number; padId: string; distanceMm: number; requiredMm: number }[];
/** Rounding step of emitted coordinates (4 decimals) and the outward margin derived from it. */
export const SILK_COORD_STEP_MM = 1e-4;
export const SILK_CUT_MARGIN_MM = 2e-4; // > √2 · step/2: any 4-decimal rounding of a cut end stays outside
```
Algorithm (pure, deterministic, order-preserving):
1. **Layers.** Only graphics on `F.SilkS`, `F.Silkscreen`, `B.SilkS` or `B.Silkscreen` are
   touched. The layer string is preserved as written.
2. **Widen.** `w = max(strokeWidthMm, minStrokeWidthMm)`.
3. **Pad faces and openings.** Face F applies if `layers` contains `F.Cu`/`F.Mask`/`*.Cu`/`*.Mask`,
   or if `layers` is absent and (`layer === "F.Cu"` or the pad has a drill); B is symmetric. A pad
   has an opening on a face iff `layers` contains `<face>.Mask` or `*.Mask`, or `layers` is absent.
   Read `layers`, `solderMaskExpansionMm`, `drillSlotMm` and `drillOffsetMm` structurally.
4. **Keepout.** For each pad, face and stroke: `c = silkToPadMm + (opening ? max(0, expansion) : 0)
   + w/2`.
   - Shape, in the pad frame: a circle becomes a disc of radius `r + c`; any other shape becomes a
     box with half-extents `+c`.
   - A drilled pad additionally gets its drill disc or slot box, grown by `c` (this covers NPTH).
5. **Decompose.**
   - `line` → 1 segment; `rect` (unfilled) → 4; `polyline` (unfilled) → n−1, plus a closing
     segment when closed.
   - **Arcs and circles — the keep test.** Sample the arc with inscribed chords at
     `arcChordToleranceMm`, and test those segments against keepouts grown by
     `consumerChordDeviationMm + arcChordToleranceMm + SILK_CUT_MARGIN_MM`. If nothing is hit,
     keep it verbatim as `arc3`/`circle`.
     - Why that growth is enough: every point of a downstream inscribed chord lies within
       `consumerChordDeviationMm` of the true arc. Every true-arc point lies within
       `arcChordToleranceMm` of the samples. So a kept arc cannot encroach after downstream
       flattening (review finding 9).
   - **Arcs and circles that hit:** flatten at `arcChordToleranceMm` into a polyline and clip it as
     segments. The emitted polyline is then what the DRC measures.
   - Filled graphics and beziers that hit any keepout are dropped whole.
6. **Cut each segment `a→b`.**
   - Removed parameter intervals = the union over keepouts **grown by `SILK_CUT_MARGIN_MM` in every
     direction**. Use Liang–Barsky for boxes and a quadratic for discs.
   - Survivors are `[0,1]` minus that union. Endpoints are rounded to 4 decimals.
   - Because the margin is larger than the worst-case rounding displacement (√2·0.5e-4), a rounded
     cut end can never land inside the ungrown keepout, whatever the crossing angle.
   - The previous "pull back along the segment" step is deleted.
7. **Re-assemble.**
   - A cut `rect`, `polyline` or flattened arc becomes open `polyline`s; a cut `line` becomes
     `line`s.
   - Drop pieces shorter than `minFragmentMm`.

`silkClearanceViolations` reports the distance from every silk ink sample to each pad's opening
shape, using the **exact** shape (not the conservative box) for circles and boxes. It samples arcs
with inscribed chords at `consumerChordDeviationMm`, which mirrors the DRC (arc-chords).

Generator constants in `ipc-dimensions.ts`, each with a source comment:

| Constant | Value | Source |
|---|---|---|
| `SILK_LINE_WIDTH` | 0.15 | JLCPCB min silk line width |
| `SILK_TO_PAD_MM` | 0.15 | JLCPCB pad-to-silk |
| `ASSUMED_MASK_EXPANSION_MM` | 0.075 | OpenPCB `pcb-defaults.ts` |
| `SILK_TEXT_HEIGHT_MM` | 1.0 | JLCPCB |
| `CONSUMER_CHORD_DEVIATION_MM` | 0.01 | OpenPCB `src/shared/pcb-geometry/arc-chords.ts` `MAX_CHORD_DEVIATION_MM` |

Remaining generator wiring:
- Delete `SILK_PAD_CLEARANCE`.
- `minFragmentMm = SILK_LINE_WIDTH`; `arcChordToleranceMm = 0.005`; ref label size =
  `SILK_TEXT_HEIGHT_MM`.
- Generators emit only rects, so the arc path is exercised by kernel tests and CoreLibrary.

**S5 Qualification manifest** — new `src/ipc7351b/qualification.ts`, re-exported:
```ts
export interface Ipc7351bFamilyQualification {
  /** Bumped on ANY change to the family's emitted geometry (pads, silk, courtyard, labels). */
  readonly revision: number;
  /** True only when every size has drawing fixtures AND KiCad oracle rows passing. */
  readonly qualified: boolean;
  readonly sources: readonly string[];
}
export const IPC7351B_QUALIFICATION: Readonly<Record<PackageFamily, Ipc7351bFamilyQualification>>;
```
- After S1–S4, all five families are `{revision: 2, qualified: true}`. Revision 1 = v0.1.3.
- Test `tests/ipc7351b-qualification.test.ts`:
  - The manifest's keys equal `ALL_FAMILIES`.
  - `qualified` implies that every size has drawing and oracle entries.
  - Per-revision output hashes are pinned in `tests/fixtures/ipc7351b-revisions.ts`, so changing
    geometry without bumping the revision fails.
- This is the upstream self-check only. **OpenPCB's acceptance is its own fingerprint table**
  (§3.2; §11 R1).

**S6 Parametric templates.** Each template's `generate` validates with
`assertNoPadOverlap(pads)` and throws `ParamValidationError`; `validateParams` returns
`{ok:false}`. The pair rule:
- **every pad pair**, whatever the numbers, **except** two pads with the **same non-empty number**
  (an intentional stacked pad)
- copper overlap is checked when the pads share a copper face
- drill overlap (hole-to-hole) is checked when both pads are drilled
- mounting arrays (all numbers `""`) are therefore checked hole-to-hole and copper-to-copper

Flip the four reproductions to assert rejection; valid sets (including all-`""` mounting arrays)
must still pass. Bump `generatorVersion` 1→2.

**S7 Report.**
- `scripts/ipc-oracle-report.ts` prints the per-preset Δ table, with KiCad `R_*` for chip.
- It also prints an **informational** `C_*` delta table for chip (D7).
- SOURCES.md gets the full table, the D4 silk semantic, and "no certification is claimed".

### 3.2 OpenPCB — generator qualification policy (O1)

**Fingerprint** — new `src/modules/library/backend/qualification/pad-fingerprint.ts`. It is
backend-only and uses `node:crypto`.
```ts
/** sha256 over the canonical projection of the pads the Gerber writes:
 *  per pad {n:number, s:shape, x, y, w, h, r:rotationDeg, rr:roundrectRatio??null,
 *  d:drillDiameterMm??null, ds:drillSlotMm??null, do:drillOffsetMm??null,
 *  p: drilled ? plated!==false : null, l:layer??null, ls:layers??null}
 *  numbers rounded to 1e-6 mm, pads sorted by (n, x, y), keys in fixed order. Structural reads (pinned type lacks fields). */
export function padGeometryFingerprint(pads: readonly unknown[]): string;
```
Fingerprinting the **placed preview pads** is what closes review findings 2 and 3:
- `raw.source` is never trusted.
- `withLegacyPlating` only changes `p` on drilled pads, and IPC lands have no drill.

**Tables** — plain data, importable by frontend and backend:
- `src/modules/library/shared/qualified-ipc-fingerprints.generated.ts`
  ```ts
  /** family → accepted revision → "size|density" → fingerprint. Append-only; delete a revision block to revoke it.
   *  Generated by scripts/gen-ipc-fingerprints.ts --qualified AFTER O6 passes on that revision. */
  export const QUALIFIED_IPC_FINGERPRINTS: Readonly<Record<string, Readonly<Record<number, Readonly<Record<string, string>>>>>>;
  ```
  It is empty on the pinned tag. O8 adds the revision-2 block.
- `src/modules/library/shared/legacy-ipc-fingerprints.generated.ts`
  ```ts
  /** Every pad fingerprint the only legacy IPC generator (rendering-core v0.1.3 == in-tree dda0d07…81c3ccd)
   *  can emit: ALL_FAMILIES × sizes × densities, fingerprinted over BOTH source.pads and
   *  buildFootprintRenderModel(source).pads (deduplicated). Frozen; header records the generator identity. */
  export const LEGACY_IPC_FINGERPRINTS: ReadonlySet<string>; // with label map for reasons
  ```
  It is generated now, from the installed v0.1.3, by `scripts/gen-ipc-fingerprints.ts --legacy`.
  The `--check` mode runs only while the installed version is 0.1.3; after O8 the file is frozen.

**Policy** — new `src/modules/library/shared/generator-qualification.ts`:
```ts
export interface InstalledIpcFamily { readonly revision: number; readonly qualified: boolean }
/** Feature-detects IPC7351B_QUALIFICATION through the namespace; null on ≤ v0.1.3 or malformed shape. */
export function installedIpcQualification(source?: unknown): Readonly<Partial<Record<PackageFamily, InstalledIpcFamily>>> | null;
export type IpcFamilyAvailability =
  | { readonly available: true; readonly revision: number }
  | { readonly available: false; readonly reason: string };
/** available ⇔ manifest present ∧ entry.qualified ∧ QUALIFIED_IPC_FINGERPRINTS[family][entry.revision] exists. */
export function ipcFamilyAvailability(family: PackageFamily, installed?: ReturnType<typeof installedIpcQualification>): IpcFamilyAvailability;
```
- **Reasons.** All end with "Import a verified footprint or draw one instead."
  - The existing SOT/QFN strings stay verbatim.
  - Chip: "…the installed generator places the lands outside the component terminals."
  - SOIC: "…measures the lead span tip-to-tip as pad centres."
  - QFP: "…body sizes and lead spans are not taken from package drawings."
  - Generic, when a manifest is present but the revision has no accepted block: "<Label> presets
    from generator revision N have not passed OpenPCB's land-pattern qualification."
- **Typecheck on the pinned tag.** Only namespace plus string-key access. The review's probe 7
  confirmed that `(ipc as Record<string, unknown>)["IPC7351B_QUALIFICATION"]` passes
  `tsc --strict`.
- `generator-policy.ts`: `generatorUnavailableReason(family)` keeps its signature and delegates;
  the four consumers are unchanged.

**Server** (`resolve-generated-footprint.ts`):
- `resolvePreset` uses `ipcFamilyAvailability`.
- After generation, it computes `padGeometryFingerprint(buildFootprintRenderModel(source).pads)`. A
  value different from `QUALIFIED_IPC_FINGERPRINTS[f][rev][size|density]` gets a 422
  `UNQUALIFIED_GENERATOR`: "The installed generator's output differs from its qualification
  evidence." This catches a re-pinned or linked generator whose geometry changed without a
  re-qualification.
- Provenance gains two fields: `ipcRevision` (diagnostic only; never trusted) and
  `padFingerprint`.
- `assertGeneratedGeometry(source)` (§3.3) runs for IPC and templates, and also on the template
  materialize route (`routes.ts:1341-1365`).

### 3.3 OpenPCB — generated geometry guard (O1)

`src/modules/library/backend/import/generated-geometry.ts`:
```ts
export interface GeneratedGeometryDefect {
  readonly kind: "non-positive-size" | "duplicate-pad-number" | "pad-overlap" | "drill-overlap";
  readonly padIds: readonly string[];       // ids, not numbers: numbers may be "" or repeated
  readonly padNumbers: readonly string[];
  readonly gapMm?: number;
}
export function generatedGeometryDefects(pads: readonly FootprintRenderSourcePad[]): GeneratedGeometryDefect[];
export function assertGeneratedGeometry(source: FootprintRenderSource): void; // throws UnqualifiedGeneratorError
```
- **`duplicate-pad-number`** applies to repeated **non-empty** numbers only. An empty number means
  "no electrical pad" (mounting-array). This fixes review finding 1.
- **Pairs checked:** every unordered pair **except** two pads with the same non-empty number. This
  is the same rule as S6.
  - **`pad-overlap`** is checked when the pads share a copper face (§3.1 step 3). It uses the exact
    gap: identity placement → `padOutlineWorldMm` + `padRoundedWorldMm` + `roundedGap`.
  - **`drill-overlap`** is checked when both pads are drilled, as the drill disc or slot distance.
  - A defect is a gap ≤ `GEOM_EPS_MM`.
- The 4 template reproductions (including the all-`""` mounting array, caught as overlap) are
  rejected on the pinned tag.
- Cost and output: O(n²); the message lists ≤ 5 pairs.

### 3.4 OpenPCB — footprint classification (O3)

SDK types (`src/sdks/library/types.ts`, additive):
```ts
export type LibraryFootprintQualificationStatus = "qualified" | "unqualified-generator" | "not-generated";
export interface LibraryFootprintQualification {
  status: LibraryFootprintQualificationStatus;
  reason: string | null;                       // non-null iff unqualified-generator
  generatorKind: "ipc7351b" | "template" | "legacy-generated" | null;
  generatorLabel: string | null;               // "SOT-23 · nominal" | "pin-header" | null
}
/** Stamped into placement snapshots at build time (additive; absent on snapshots built before O3). */
export interface FootprintGenerationStamp {
  kind: "ipc7351b" | "template" | "legacy-generated";
  label: string | null;
}
// LibraryFootprintPlacementSnapshot gains: generation?: FootprintGenerationStamp; derivationHash?: string | null;
// LibraryComponentFootprintVariant gains: qualification?: LibraryFootprintQualification;
// LibraryDefaultFootprintRef gains: derivationHash: string | null;
// LibrarySDK gains:
getFootprintQualifications(footprintIds: readonly string[]): Promise<Record<string, LibraryFootprintQualification>>;
classifyPlacedFootprints(items: readonly { key: string; snapshot: LibraryFootprintPlacementSnapshot }[]):
  Promise<Record<string, LibraryFootprintQualification>>;
```

Core classifier: `src/modules/library/backend/qualification/classify.ts`. It is pure apart from an
LRU cache.
```ts
export function classifyFootprintGeometry(input: {
  pads: readonly unknown[] | null;              // preview pads actually placed / stored
  generation: FootprintGenerationStamp | null;  // from snapshot stamp or row provenance
}): LibraryFootprintQualification;
```
Rules, applied in order, with `fp = padGeometryFingerprint(pads)`:
1. **Accepted.** `fp` is in an accepted block (any family, any revision listed in
   `QUALIFIED_IPC_FINGERPRINTS`) ⇒ `qualified`, labelled from the table key.
2. **Legacy.** `fp ∈ LEGACY_IPC_FINGERPRINTS` ⇒ `unqualified-generator`, kind `ipc7351b`, labelled
   from the deny-list. **This applies whatever the claims or `sourceKind` say** (a relabelled
   pack, a deleted row, an old snapshot).
   - The generator script asserts that the accepted and legacy sets are disjoint.
   - An overlap would mean the legacy pads were already correct, and that fingerprint is removed
     from the deny-list with a logged note.
3. **IPC claim.** `generation.kind === "ipc7351b"` but `fp` is in neither set ⇒
   `unqualified-generator` ("generated by an IPC preset revision that has not passed
   qualification"). Examples: an unaccepted newer revision, or forged geometry.
4. **Template claim.** `generation.kind === "template"` ⇒ `generatedGeometryDefects(pads)` empty ⇒
   `qualified`, else `unqualified-generator` ("pads N and M overlap…"). The verdict is cached in an
   LRU of 1024 entries keyed by `fp`; the key covers exactly the geometry the check reads.
5. **Legacy generated.** `generation.kind === "legacy-generated"` ⇒ `unqualified-generator`
   ("Generated before generator provenance was recorded; its geometry cannot be verified.").
6. Otherwise ⇒ `not-generated`.

**Pin-aware reasons** (review finding 23). Rules 2–5 append a remedy that depends on what is
installed:
- `ipcFamilyAvailability(family).available` ⇒ "Replace it in the Library (Change footprint → IPC
  package), then update the part."
- Otherwise ⇒ "No qualified generator for <family> is installed yet; replace it with a drawn or
  verified footprint."
- Templates ⇒ "Regenerate it with non-overlapping parameters."

**Row classification** (`getFootprintQualifications`, the variants list):
- Query: `select id, json_extract(data_json,'$.provenance') as prov, json_extract(data_json,'$.normalized.preview.pads') as pads` (chunk 500).
- Generation from `prov`:
  - `sourceKind === "generated"` with an IPC tuple ⇒ `ipc7351b`.
  - With a template identity ⇒ `template`.
  - With no identity ⇒ `legacy-generated`.
  - Otherwise ⇒ null.
- Malformed JSON ⇒ `not-generated`.

**Snapshot classification** (`classifyPlacedFootprints`):
- If `snapshot.generation` is present, use it with `snapshot.preview.pads`. The stamp only selects
  rules 3–5; rules 1–2 are geometric.
- If the stamp is absent (snapshots built before O3), apply rules 1–2 on the snapshot pads. If
  neither matches, do one batched row lookup of the distinct footprint ids, **only** for rows whose
  `prov.sourceKind === "generated"`:
  - Row present and `padGeometryFingerprint(row pads) === fp` ⇒ adopt the row's generation and
    apply rules 3–5.
  - Row present but its pads differ (the row was updated in place after placement, e.g. by
    `.opclib` re-import) ⇒ `unqualified-generator`: "The placed footprint no longer matches its
    generated library footprint and cannot be verified. Update the part from the Library."
  - Row absent (deleted) ⇒ `not-generated`. This is the **documented residual**: a pre-O3 snapshot
    of a *defective template* whose row was deleted. Mitigation is H19's DRC gate, because
    overlapping pads of different nets are `NET_SHORT_CIRCUIT` errors on the short tier.
    Legacy IPC is never in this residual: rule 2.

**Stamp writer.** `parseFootprintPlacementSnapshot` (`queries.ts:429`) sets `generation` from the
row provenance (as above) and `derivationHash` from `provenance.derivationHash` (§3.9). The
designer persists the snapshot JSON verbatim (`projection-read.ts:42-48`).

**Default-footprint write guard** (review finding 17). `updateComponent` (`queries.ts:1877`):
when `patch.defaultFootprintId` **differs** from the current default and the row classifies as
`unqualified-generator`, throw `UnqualifiedGeneratorError` (422 `UNQUALIFIED_GENERATOR`, the
existing class) with the reason. This covers `PATCH /components/:id` from every client (the
ChangeFootprintDialog, ComponentDetailPage and the SDK). It does not cover `.opclib` intake
defaults (D5); those are blocked at export instead.

**Library UI.**
- `ComponentDetailPage.tsx` footprint section and the `ChangeFootprintDialog.tsx` variants show
  `data-testid="footprint-unqualified-badge"`, with the reason as title.
- "Use selected footprint" is disabled for those variants, mirroring the server guard.
- No auto-migration.

### 3.5 OpenPCB — designer annotation, staleness, export blocker (O4a, O4b)

**O4a — annotation and staleness (no H19 dependency).**
- `DesignerPlacedPart` gains `footprintUnqualified?: { reason: string; generatorLabel: string | null }`.
- `store.ts`: `markStaleFootprints` becomes `annotateLibraryFootprints`, still one pass and still
  called from `getSchematicProjection`. It does two things:
  1. `getDefaultFootprintRefs` (existing). **The stale rule gains**:
     `|| (ref.derivationHash !== null && ref.derivationHash !== (part.footprint.derivationHash ?? null))`.
     This fixes review finding 10. A snapshot built before C2 has no `derivationHash`, so it becomes
     stale exactly once, when the library row has been post-processed (§3.9). Rows without
     `derivationHash` (everything else) behave as before.
  2. `classifyPlacedFootprints(parts.map(p => ({key: p.id, snapshot: p.footprint})))`. It sets
     `footprintUnqualified` for `unqualified-generator`.
- **Cost bound** (review finding 15). Per read:
  - One fingerprint per part, linear in its pads.
  - Set lookups.
  - Template verdicts from the LRU.
  - At most one batched `json_extract` query, only for stampless snapshots not matched by rules
    1–2.
  - No full `data_json` parse except, for those rows, the `pads` JSON.
  - Non-gating micro-benchmark in the O4a test: 500 parts / 20k pads, logged.
- `PartInspectorPanel.tsx` shows `data-testid="footprint-unqualified-badge"` ("Generated footprint
  failed qualification — <remedy>") next to the stale badge. The refresh button stays.

**O4b — export blocker, implemented as H19's slot (review finding 6).**
- **No separate problem type, no route edits, no `PcbExportDialog` edits.**
- H19 owns `readExportSnapshot`, `CAPABILITY_BLOCKER_SOURCES`, `unqualifiedFootprintBlocker`, the
  422 `export-blocked`, and the dialog's `ExportBlockersPanel`.
- H15 O4b adds:
  - In `readExportSnapshot` (`store.ts`, H19 S6b), populate
    `unqualifiedFootprints = (await library.classifyPlacedFootprints(pcb.placements.map(p => ({ key: p.id, snapshot: p.footprint }))))`
    filtered to `unqualified-generator`, mapped to
    `{placementId, reference, generator: generatorLabel ?? "legacy generated footprint"}`.
  - The classification uses **PCB placements**, which are what the Gerber writes. It recomputes
    fingerprints from the snapshot pads and trusts no stored value.
  - Tests in H19's `manufacturing-blockers.test.ts` style, listed in §4.
- **Ordering.** O4b is serial after H19 S6a+S6b. Until H19 lands there is no H15 export blocker.
  Accepted, because release builds keep `designer.outputQuarantine` on (H13 decision), and the
  badge (O4a) shows the defect in every build.
- Docs: `CAPABILITY-QUARANTINE.md` (H19 S10 owns that file; H15 adds one paragraph in O9) and
  `src/modules/designer/AGENTS.md` FOOTPRINTS section.

### 3.6 OpenPCB — DRC qualification harness (O6, O7)

`src/core/backend/tests/helpers/footprint-drc-harness.ts`:
```ts
export const QUAL_TS = "2026-01-01T00:00:00.000Z";
/** createDefaultPcbBoardSettings (clearance floor INCLUDED, jlcpcb_2l, expansion 0.075); outline = the footprint
 *  preview bounds (pads + graphics + labels) grown by copperToBoardEdgeMm + 5 mm, rectangle; placement at origin. */
export function qualificationBoard(preview: FootprintRenderModel): PcbBoardSettings;
/** One placement "U1" at origin, F.Cu, rotation 0. Nets: see netPlan. */
export function footprintProjection(preview: FootprintRenderModel, netPlan: FootprintNetPlan): DesignerPcbProjection;
/** Pads with empty number or no copper face ⇒ no net. Numbered copper pads: groups from `groups`
 *  (pad numbers that must share a net), else one net per number. */
export interface FootprintNetPlan { readonly groups: readonly (readonly string[])[] }
export interface FootprintQualificationVerdict {
  readonly violations: readonly DrcViolation[];  // all, pad-anchored ones resolved to pad ids
  readonly unexpected: readonly DrcViolation[];
  readonly justified: readonly DrcViolation[];
  readonly minSignalGapMm: number;
}
export function qualifyFootprint(preview: FootprintRenderModel, netPlan: FootprintNetPlan,
  inevitability?: MaskInevitability): FootprintQualificationVerdict;
/** From the preset's drawing parameters (O6 only). */
export interface MaskInevitability { readonly pitchMm: number; readonly terminalWidthNominalMm: number; readonly epMinGapMm: number | null }
```
Board sizing from bounds fixes the review's off-board/edge harness artefacts. Unnumbered pads take
no net, which fixes the 96 harness shorts.

**Anchor resolution** (review finding 12). A pad anchor reported by number is resolved to the pad
of that number nearest the violation's `locationMm`. Duplicate numbers are disambiguated that
way, and the minimum gap is taken over the resolved pair.

**Violation classification:**
- `severity === "error"` ⇒ unexpected.
- A board-level code (no pad/placement anchor) that is present in the empty-board baseline ⇒
  ignored.
- `FAB_MASK_BRIDGE` or `FAB_MASK_TO_COPPER` between two **signal** pads ⇒ justified iff
  `inevitability` is given, the two pads are adjacent in a pitch row, and
  `pitchMm − terminalWidthNominalMm < maskDamMm + 2e` (or `< maskToCopperMm + e`). That means even
  a land exactly as wide as the nominal lead leaves no dam, so the generator's choice is not the
  cause.
- Between an **exposed pad and a signal pad** ⇒ justified iff `epMinGapMm !== null`, the exact gap
  equals the generator's cited `QFN_EP_MIN_GAP_MM` within `GEOM_EPS_MM`, and
  `epMinGapMm < maskDamMm + 2e`. The gap must be the drawing's guaranteed paddle-to-terminal K_min
  (MO-220, SOURCES.md:41) and not a generator choice. Any other EP–signal mask warning is
  unexpected. §11 R3 explains the partial rejection.
- Everything else ⇒ unexpected.
- In addition, `minSignalGapMm ≥ FAB_PRESETS.jlcpcb_2l.minClearanceMm`, because intra-footprint
  pads are short-checked only.

**O6** `library-generator-qualification.test.ts` (table over `ALL_FAMILIES × sizes × densities`):
- **Evidence branch** (installed manifest says `qualified`):
  - Preview = `buildFootprintRenderModel(generateFootprint(...).source)`.
  - `qualifyFootprint(preview, one-net-per-number, inevitability from preset params)`.
  - `unexpected` must be empty, along with `generatedGeometryDefects`.
  - **If** `QUALIFIED_IPC_FINGERPRINTS[f][rev]` exists, every output fingerprint must equal its
    entry (table ↔ installed parity; replaces the deleted tautological "policy honesty" test,
    review finding 11).
- **Quarantine branch** (no manifest, or not qualified): `resolveGeneratedFootprint` throws
  `UnqualifiedGeneratorError`.
- **Legacy-list completeness** (only while the installed version is 0.1.3): every installed output
  fingerprint is in `LEGACY_IPC_FINGERPRINTS`. The size equals the combination count × the
  distinct source/preview projections.
- On the pinned tag the quarantine and legacy-list branches run. Under `shared:link` the evidence
  branch runs. After O8 the evidence branch runs with parity.

**O7** `corelibrary-drc-qualification.test.ts` (review findings 5 and 18):
- **Sources, in this order:**
  1. env `OPENPCB_CORELIBRARY_DIR` (sibling checkout).
  2. **Vendored fixture subset** `src/core/backend/tests/fixtures/corelibrary-silk/*.json`, added in
     O7b after C2. It holds 12 post-C2 previews covering line, polyline, arc3, rect and circle silk,
     roundrect/rect/circle/oval pads, a THT part, and the raised 0.8→1.0 mm label. It is produced by
     `scripts/vendor-corelibrary-silk-fixtures.ts` from a recorded CoreLibrary commit.
  3. The pinned pack, once `productionRelease` is set.
- In CI only the fixture subset runs until C3. O9 records the T-214 regression test as **"O7
  fixture subset (CI) + CoreLibrary G10 strict silk rules (CoreLibrary CI)"**, not as full-library
  CI coverage.
- **Net plan** comes from the component(s) referencing the footprint (the `footprints[].pinMap` of
  `components/**/*.component.json`):
  - Pads mapped to symbol pins that share an identical non-empty name share a net. This is the
    KiCad stacked-pin convention, e.g. USB-C A1/B12 GND.
  - With several referencing components, the first by sorted id is used.
  - With none, one net per number.
- **Assertion (T-214 scope):** zero violations with codes `FAB_SILK_WIDTH`, `FAB_SILK_CLEARANCE`,
  `SILK_TO_MASK_CLEARANCE`, `FAB_SILK_TEXT_HEIGHT` and `SILK_TO_BOARD_EDGE`.
- **Ratchet for all other codes:** `src/core/backend/tests/fixtures/corelibrary-drc-baseline.json`,
  rows `{footprintId, code, count}`, generated by `--update-baseline`.
  - The test fails when a `(footprint, code)` pair is new or its count increases.
  - It prints, but tolerates, decreases.
- The baseline at authoring holds the review's real findings: `ANNULAR_RING_MIN` ×11/9,
  `DRILL_SIZE_MIN` ×3, `COURTYARD_INVALID` ×1, `MASK_SLIVER` ×16, fine-pitch `FAB_MASK_BRIDGE`,
  and any residual short. Each becomes a proposed follow-up (§9 Q3). The G10/default-profile limit
  mismatch (0.13/0.3 vs 0.2/0.4) is one of them.

### 3.7 OpenPCB — indirect intake (O5)

**No importer code change.** The classifier (§3.4) is geometric, so a pack cannot buy
qualification:
- A forged `ipcRevision` is never read.
- A genuine `raw.source` next to an arbitrary preview is irrelevant, because the preview pads are
  fingerprinted.
- A relabelled `sourceKind:"drawn"` carrying legacy pads is caught by rule 2.
- An in-place update under the same id makes older snapshots "no longer match" (§3.4).
- A user's revision-2 rows pulled back after an upgrade to revision 3 stay qualified while
  revision 2's block remains in the table. Downgrade is impossible (review finding 4).

O5 consists of tests `library-intake-generator-claims.test.ts`, built with an in-memory pack and
the existing opclib test helpers:
- (a) A forged `ipcRevision` with legacy pads ⇒ flagged.
- (b) An IPC claim with an arbitrary preview and a genuine `raw.source` ⇒ flagged.
- (c) A `sourceKind:"drawn"` row with legacy chip-0603 pads ⇒ flagged.
- (d) A synthetic accepted block (fixture-injected table) with a matching preview ⇒ qualified;
  after removing that block from the injected table ⇒ flagged (revocation).
- (e) Re-importing the same pack ⇒ identical classifications (idempotent).
- (f) A placement made before the re-import of an updated pack ⇒ "no longer matches".

**H13 interface.** `classifyFootprintGeometry` is exported for H13's intake qualifier (the
generator branch).

### 3.8 OpenPCB — FootprintGeneratorPanel T-319 (O2)

```ts
export type IpcDerivation =
  | { readonly kind: "incomplete" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "ready"; readonly payload: GeneratedFootprintPayload };
export function deriveIpcPayload(selection: IpcSelection): IpcDerivation;
export interface TemplateSelection { readonly templateId: string | null; readonly values: ParamValues }
```
**IPC derivation.**
- `ipc = useMemo(() => deriveIpcPayload(selection), [family, size, density])`. Generation is
  synchronous.
- **The Generate button is removed** (`IpcPresetTab` loses `onGenerate`).

**Controlled-optional props**, the same pattern as the existing `ipcSelection` (review finding
22):
- `activeTab?` / `onActiveTabChange?`.
- `templateSelection?` / `onTemplateSelectionChange?`.
- `templatePayload?` / `onTemplatePayloadChange?`.

**Local state** is used when a prop is absent (the ChangeFootprintDialog path).

**Wizard store** (`useImportWizardStore.ts`):
- New fields `generatorTab`, `templateSelection` and `templatePayload`, so a remount between steps
  keeps the tab, the form and the payload.
- `hasCurrentPreset` for templates now requires
  `sameTemplateIdentity(generated.generator, state.templateSelection)`, with `params` compared
  after `validateTemplateParams` normalisation. A template payload whose parameters differ from the
  displayed form is not committable.

**TemplateTab race** (review finding 8):
- `handleGenerate` captures `requestKey = stableStringify({templateId, params: validation.values})`
  and a fresh `AbortController`, and aborts the previous one.
- On response, it drops the result unless `requestKey === currentKeyRef.current`.
- `currentKeyRef` is updated on **every** `templateId`/`values` change. Any change also calls
  `onInvalidated()`, which sets the payload to `null`, whether or not a materialize succeeded
  before.

**Current payload and the Use button.**
- `current = activeTab === "ipc" ? (ipc.kind === "ready" ? ipc.payload : null) : templatePayload`,
  emitted with `useEffect(() => onGeneratedRef.current(current), [current])`.
- Preview, `PinCoverage` and Use read only `current`.
- Use is disabled unless `current` matches the displayed identity: the IPC tuple, or
  `sameTemplateIdentity`.
- `ipc.kind === "unavailable"` renders the reason with `role="alert"`.

### 3.9 CoreLibrary — T-214 (C1, C2)

**Blocked on publishes** (review finding 7). C1 needs `clipSilkToPads` and
`silkClearanceViolations` from **`rendering-core-v0.1.4`** (S1–S7 published), plus H13's published
kicad-import. CoreLibrary pins tags (`package.json:28-31`). **Nothing is vendored**, and
`shared:link` is for local evidence only and never committed. C1/C2 therefore cannot be committed
before both publishes, H13's regeneration and a clean tree.

**`tools/silk-qualify.ts`:**
```ts
export const SILK_QUALIFY_VERSION = 1;
export interface SilkQualifyResult { preview: FootprintRenderModel; report: SilkClipReport; textRaised: number }
export function qualifySilk(preview: FootprintRenderModel): SilkQualifyResult;
```
It calls `clipSilkToPads` with `silkToPadMm: DRC_LIMITS.silkClearanceMm`,
`defaultMaskExpansionMm: 0.075`, `minStrokeWidthMm` and `minFragmentMm` = 0.15,
`arcChordToleranceMm: 0.005` and `consumerChordDeviationMm: 0.01`. It then raises silk labels below
1.0 mm to 1.0 mm and recomputes the bounds.

**New `DRC_LIMITS` rows** (each with a source comment): `minSilkWidthMm 0.15`,
`minSilkTextHeightMm 1.0`, `assumedMaskExpansionMm 0.075`, `consumerChordDeviationMm 0.01`.

**Wiring.** Call `qualifySilk` after `buildFootprintPreviewFromParsed`
(`import-kicad-batch.ts:899`) and in `rebuild-previews.ts`. Provenance:
- `provenance.postProcess = [{ tool: "silk-qualify", version: SILK_QUALIFY_VERSION }]`
  (append-only; replaces an entry with the same tool).
- **`provenance.derivationHash = sha256(sourceHash + "\n" + canonicalJson(postProcess))`** (review
  finding 10).
- `sourceHash` and the id derivation are unchanged.

**G10 rules:**
- Stroke width < 0.15 ⇒ `fail`.
- Silk clearance ⇒ `fail`, through **`silkClearanceViolations`**: the same predicate as the
  kernel, with arcs sampled the way the DRC samples them. This replaces AABB/centreline.
- Text height ⇒ `fail`.
- `tests/gates-footprint-drc.test.ts` gets inline boundary fixtures for each rule. That includes a
  kept arc 0.005 mm outside the plain keepout, which must be cut, and a shallow-angle crossing
  whose rounded cut end must stay outside.

**Data (C2):** run `bun tools/rebuild-previews.ts --footprints` over all 168 footprints and commit
the JSON diff. The C1 tool exits non-zero if `droppedFilled > 0`.

### 3.10 Module boundaries

- **Library policy, classifier and fingerprint** live in `src/modules/library/{shared,backend}`.
  They import `src/shared/rendering` (shim) and `src/shared/pcb-geometry`.
- **Designer access to classification** is only through
  `LibrarySDK.{classifyPlacedFootprints,getFootprintQualifications,getDefaultFootprintRefs}` via
  `resolveLibrarySdk(ctx)`.
- **SDK additions** are types only. Run `npm run gen` and commit the result.
- **Flags.** No new feature flag. `designer.outputQuarantine` and
  `library.footprintIntakeQuarantine` are untouched.

---

## 4. Task breakdown

Tier legend: standard / careful / critical. "∥" means the slices may run in parallel (no file
overlap).

**Publish naming (open question 1).**
- The user cuts **`rendering-core-v0.1.4`** from `fix/offline-eda-text` after S1–S7. The vendored
  contracts candidate already depends on `#rendering-core-v0.1.4` (`package-lock.json:3811`).
- If v0.1.4 were cut without S1–S7, O8 would resolve two rendering-core copies (v0.1.4 for
  contracts, v0.1.5 for OpenPCB) or fail to install.
- The tag also carries the unrelated canvas/plating commits `e882332`…`acab96e`. O8 therefore runs
  the full suite.

### Shared (`../shared`, `fix/offline-eda-text`; commit only)

| Slice | Files | ~Lines | Tests | Tier | Depends |
|---|---|---|---|---|---|
| **S1** chip | `pad-calculator.ts` (chip), `family-presets.ts`, `tests/fixtures/ipc7351b-drawings.ts` (+`CHIP_DRAWINGS`), `ipc7351b-kicad-oracle.ts` (+8 R_* rows), `ipc7351b-geometry.test.ts`, `SOURCES.md` (incl. D7 resistor statement) | 220 | drawing per density; land covers terminal; oracle | critical | — |
| **S2** SOIC | gull-wing calc + courtyard formula, SOIC literals, fixtures (+4 rows), test, `SOURCES.md` (Δ≈0.108 headroom note first) | 200 | drawing + oracle + courtyard = outer pad edges + 2c | critical | S1 |
| **S3** QFP | QFP calc + courtyard, MS-026 literals, fixtures (+4), test, `SOURCES.md` | 200 | drawing + oracle + four-side symmetry + courtyard | critical | S2 |
| **S4** silk kernel + checker | `src/silk/clip-silk.ts`, `src/index.ts`, `ipc-dimensions.ts`, `pad-calculator.ts` (silk/labels), `tests/silk-clip.test.ts`, geometry test, `SOURCES.md` | 380 | box/disc/rotated pad, drilled NPTH, per-pad expansion, both silk spellings, kept-arc growth boundary, flatten only when hit, shallow-crossing rounding (property test over 1000 random angles: rounded ends outside ungrown keepout), fragment drop, checker == kernel on outputs (0 violations after clip), generator outputs ≥ 0.15 width + clearance | careful | S3 |
| **S5** manifest | `qualification.ts`, `ipc7351b/index.ts`, test, `tests/fixtures/ipc7351b-revisions.ts` | 120 | S5 invariants | careful | S4 |
| **S6** template overlap | `src/parametric/{pin-header,screw-terminal,mounting-array,param-schema,registry}.ts`, `parametric-geometry.test.ts` | 140 | 4 reproductions rejected (incl. all-`""` mounting array, drill overlap); valid sets incl. all-`""` arrays pass | standard | ∥ S1–S5 |
| **S7** report | `scripts/ipc-oracle-report.ts`, `SOURCES.md` | 130 | R_* table + informational C_* table | standard | S5, S6 |

Verification per slice: `cd ../shared && bun test packages/rendering-core/tests && npm run typecheck`.

### OpenPCB (`master`; every slice before O8 typechecks and passes on `rendering-core-v0.1.3`)

| Slice | Files | ~Lines | Tests | Tier | Depends |
|---|---|---|---|---|---|
| **O1** policy + fingerprint + guard | `library/shared/generator-qualification.ts`, `library/shared/{qualified,legacy}-ipc-fingerprints.generated.ts`, `library/backend/qualification/pad-fingerprint.ts`, `scripts/gen-ipc-fingerprints.ts`, `generator-policy.ts`, `backend/import/generated-geometry.ts`, `resolve-generated-footprint.ts`, `routes.ts` (materialize guard), tests: `library-generator-policy.test.ts` (renamed from `-quarantine`; synthetic manifest absent/unqualified/no-accepted-block/accepted; injected table), `library-generated-geometry.test.ts` (4 reproductions rejected; all-`""` valid mounting array accepted; duplicate non-empty number; same-number stack allowed), `library-pad-fingerprint.test.ts` (order/rounding/JSON round-trip invariance; pinned-type structural fields), `library-generator-import.test.ts` (chip 0603 positives), `library-component-footprint-assign.test.ts` + `designer-refresh-part-footprint.test.ts` (**SOIC-8** positives) → template `pin-header`; IPC positives `test.if(ipcFamilyAvailability(f).available)`; `import-wizard/preset-quarantine.test.tsx` (all five disabled on pinned; positives via `vi.mock` of `generator-qualification`) | 520 | listed | critical | — (∥ shared) |
| **O3** classifier + SDK + stamp + default guard + library UI | `src/sdks/library/{types,index}.ts`, `backend/qualification/classify.ts`, `backend/queries.ts` (variants, `getFootprintQualifications`, `classifyPlacedFootprints`, snapshot stamp + `derivationHash`, `getDefaultFootprintRefs` `derivationHash`, `updateComponent` guard), `frontend/ComponentDetailPage.tsx`, `frontend/ChangeFootprintDialog.tsx`, generated SDK stubs; tests `library-footprint-qualification.test.ts` (row table: legacy generated, post-d11ce92 IPC legacy pads, accepted block via injected table, template ok/overlap, drawn, kicad, CoreLibrary, malformed, relabelled drawn with legacy pads; snapshot table: stamped/unstamped, row deleted, row updated in place, revoked block), `library-default-footprint-guard.test.ts` (PATCH to flagged → 422; unchanged flagged default → 200), `ComponentDetailPage.test.ts` badge | 420 | listed | careful | O1 |
| **O2** T-319 panel | `FootprintGeneratorPanel.tsx`, `IpcPresetTab.tsx`, `TemplateTab.tsx`, `import-wizard/useImportWizardStore.ts`, `steps/FootprintStep.tsx`, new `FootprintGeneratorPanel.test.tsx`, new `ChangeFootprintDialog.test.tsx`, `preset-quarantine.test.tsx` | 340 | §7 list (a)–(h) | careful | **O3** (serial: O3 edits `ChangeFootprintDialog.tsx`) |
| **O4a** designer annotation + staleness | `src/sdks/designer/types.ts`, `designer/backend/store.ts`, `PartInspectorPanel.tsx`; tests `designer-footprint-qualification-annotation.test.ts` (legacy-pad snapshot flagged with library row deleted; re-imported row ⇒ "no longer matches"; clean template; derivationHash stale rule incl. pre-C2 snapshot vs post-C2 row and rows without derivationHash unchanged; micro-benchmark logged) | 220 | listed | careful | O3 |
| **O5** intake tests | `library-intake-generator-claims.test.ts` | 180 | §3.7 (a)–(f) | careful | O3 (∥ O4a, O2) |
| **O6** generated-preset DRC qualification | `tests/helpers/footprint-drc-harness.ts`, `library-generator-qualification.test.ts` | 300 | §3.6 | careful | O1 (∥ O3/O2/O4a/O5) |
| **O7** CoreLibrary DRC (sibling) | `corelibrary-drc-qualification.test.ts`, `fixtures/corelibrary-drc-baseline.json` | 200 | silk codes zero; ratchet | standard | O6; green only after C2 |
| **O4b** H19 slot | `designer/backend/store.ts` (`readExportSnapshot` populates `unqualifiedFootprints`), tests appended to H19's `manufacturing-blockers.test.ts` (slot → blocker message/targets) + `manufacturing-export-gate.test.ts` (flagged legacy part ⇒ 422 export-blocked with `EXPORT_UNQUALIFIED_FOOTPRINT` on gerber json/summary/zip, pnp.csv, SDK summary; clean ⇒ passes; deleted library row with legacy pads ⇒ still blocked) | 120 | listed | careful | O4a, **H19 S6a+S6b** |
| **O8** re-pin (after publish) | `package.json` (`rendering-core-v0.1.4`), `package-lock.json` (single rendering-core copy; `npm ls @openpcb/rendering-core` shows one version), `qualified-ipc-fingerprints.generated.ts` (revision-2 block via `gen-ipc-fingerprints.ts --qualified` after O6 evidence branch green), e2e `tests/e2e/library-ipc-preset.spec.ts` | 160 | full suite | critical | publish, S1–S7, O1–O6 |
| **O7b** CI fixture subset | `scripts/vendor-corelibrary-silk-fixtures.ts`, `fixtures/corelibrary-silk/*.json` (12) | 120 | O7 fixture branch green in CI | standard | C2, O7 |
| **O9** QA rows + docs | `reconciliation.json` (T-316/T-319 after O1/O2/O6/O8; T-214 after C2/O7/O7b, regression test text per §3.6), `library/AGENTS.md`, `CAPABILITY-QUARANTINE.md` paragraph | 70 | — | standard | O8, O7b, O4b |

**Parallelism:**
- O1 ∥ all shared slices.
- After O1: O3 and O6 in parallel.
- After O3: O2, O4a and O5 in parallel; their file sets are disjoint.
- O4b waits for H19.
- Shared S1→S5 is strictly serial; S6 is parallel.

**Re-pin requirements.**
- **Only O8 needs it.** O1–O7 and O4b typecheck and pass on v0.1.3.
- The O6 evidence branch is exercised under `npm run shared:link` before O8.

### CoreLibrary (`../CoreLibrary`; **blocked on `rendering-core-v0.1.4` + H13's kicad-import publish + H13 regeneration + a clean tree**)

| Slice | Files | ~Lines | Tests | Tier | Depends |
|---|---|---|---|---|---|
| **C1** silk-qualify + G10 | `tools/silk-qualify.ts`, `tools/gates/footprint-drc.ts`, `tools/rebuild-previews.ts`, `tools/import-kicad-batch.ts`, `package.json` (pin `rendering-core-v0.1.4`), `tests/silk-qualify.test.ts` (idempotent; derivationHash stable), `tests/gates-footprint-drc.test.ts` | 300 | boundary fixtures | careful | publishes, H13 |
| **C2** apply | `footprints/**/*.fp.json` | data | `bun validate`, `bun test`, OpenPCB O7 with `OPENPCB_CORELIBRARY_DIR` | careful | C1 |
| **C3** pack/sign/publish | version + release; OpenPCB `resources/core-library-release.json` | 10 | `npm run build` | — (user) | C2, O7 |

---

## 5. Edge cases & failure modes

**Availability and generation:**
- **Pinned tag, no manifest** ⇒ all IPC families are unavailable, with reasons. Templates and
  drawn footprints are unaffected.
- **Manifest present, no accepted block** ⇒ the family is unavailable with the generic reason.
  Placed parts from accepted revisions stay qualified.
- **Installed output differs from the accepted fingerprint** (a linked branch, or a geometry change
  without re-qualification) ⇒ generation returns 422 and the family stays offered.
  - It is not silently disabled: the error states the cause.
  - O6 parity fails in CI.
- **Malformed manifest** ⇒ null ⇒ quarantine.

**Fingerprints:**
- **Fingerprint determinism:** a JSON round trip, key order and float noise below 1e-6 do not
  change it (test).
  - It is sensitive to any pad edit ≥ 1e-6 mm.
  - Silk is excluded on purpose. Silk issues are DRC warnings, handled by H19's DRC gate posture
    and the T-214 work, not by the generator blocker.
- **Legacy and accepted overlap** ⇒ the generator script fails unless that fingerprint is removed
  from the legacy set with a logged note (the legacy pads were correct).

**Pad numbering:**
- **Mounting arrays and other empty-number pads** ⇒ excluded from the duplicate-number check, but
  included in the overlap and drill checks.
- **Same non-empty number stacked pads** (KiCad EP sub-pads) are allowed. Templates do not emit
  them.

**Snapshots and library rows:**
- **Library row deleted:**
  - Legacy IPC pads ⇒ still flagged (rule 2).
  - Stamped template ⇒ still checked.
  - Unstamped pre-O3 defective template ⇒ the documented residual (§3.4); H19's DRC gate catches
    the shorts.
- **Row updated in place by `.opclib`** ⇒ a stamped snapshot is classified on its own geometry. An
  unstamped generated one becomes "no longer matches" until refreshed.
- **Cloud-synced or imported design with forged stamps:**
  - Removing a stamp can only reach the same residual.
  - Adding an IPC stamp can't turn arbitrary geometry into "qualified", because rule 1 is
    geometric.
- **Part both stale and unqualified** ⇒ the refresh button resolves both once the library default
  is replaced.
- **Flagged default via `.opclib` intake** ⇒ allowed (D5). It is flagged in the Library, cannot be
  re-selected through PATCH once changed away, and is blocked at export.

**Silk kernel:**
- A segment fully inside a keepout ⇒ removed. A point touch ⇒ no cut.
- Rotated pads use the frame transform.
- A negative expansion is clamped for the opening term.
- A drill offset outside the copper gets its own keepout.
- `droppedFilled > 0` ⇒ the C1 tool exits non-zero.
- A kept arc may sit up to (growth) closer than a plain clip would allow. That only removes more
  ink, never less (conservative).
- **Label raise (CoreLibrary):** the single 0.8 mm text may then violate. O7/G10 catches it, and
  the fix is moving it to `F.Fab`.

**DRC harness:**
- **Fine-pitch mask warnings** ⇒ justified only by the drawing-based predicates (D6, §3.6).
- **DRC baseline drift** ⇒ the board-level baseline is computed per run. Pad-anchored codes are
  never baselined.
- **O7 ratchet:** a footprint fixed upstream lowers counts (prints a hint to `--update-baseline`).
  A regression fails.
- **O7 against a dirty sibling tree:** the test reads what is on disk. Evidence must come from a
  clean checkout.

**Repo tooling:**
- **SDK stub drift** ⇒ `gen:check` fails until O3/O4a commit `npm run gen` output.
- **Two rendering-core copies after O8** ⇒ the O8 acceptance includes `npm ls` showing one
  version.

**Performance:** see §3.5 O4a. The template check is cached by fingerprint. There is no
2000-pad skip anymore, because the LRU bounds the repeat cost; the first check of a huge template
is O(n²) once.

## 6. Migration / rollback & data safety

- **No SQL migration.** The only new JSON fields are additive:
  - Row provenance: `ipcRevision` and `padFingerprint`, written on new generations only.
  - Snapshots: `generation` and `derivationHash`, written on snapshot build only.
  - Old rows and snapshots stay valid. Rollback of O1–O4b is a commit revert; the extra fields are
    ignored by old code (the snapshot parser is a pass-through cast).
- **No placed geometry is rewritten.** Users replace the footprint in the Library, then
  `refresh_part_footprint` (undoable; journal per OPENPCB-103).
- **Intake (O5)** makes no mutation. (The earlier claim that intake "never touches existing rows"
  is withdrawn: the importer does overwrite matching rows. That is existing behaviour, which H15
  makes harmless by classifying geometry.)
- **CoreLibrary C2** is a git-tracked JSON rewrite. Ids and `sourceHash` are unchanged; the new
  `derivationHash` triggers a one-time stale prompt on existing placements. Rollback = `git revert`.
- **Release posture:** `designer.outputQuarantine` stays on in release builds. The H15 blocker is
  active in all builds once H19 lands (D2).
- **O8 revert:** re-pin to v0.1.3. The families quarantine again. The accepted block can stay,
  since it is unreachable without a manifest, or can be removed together with the revert.

## 7. Verification commands

Shared:
```
cd /Users/andrejvysny/workspace/openpcb/shared && bun test packages/rendering-core/tests && npm run typecheck
cd /Users/andrejvysny/workspace/openpcb/shared && bun packages/rendering-core/scripts/ipc-oracle-report.ts
```
OpenPCB (pinned):
```
cd /Users/andrejvysny/workspace/openpcb/OpenPCB
bun test src/core/backend/tests/library-generator-policy.test.ts src/core/backend/tests/library-generated-geometry.test.ts \
  src/core/backend/tests/library-pad-fingerprint.test.ts src/core/backend/tests/library-generator-import.test.ts \
  src/core/backend/tests/library-component-footprint-assign.test.ts src/core/backend/tests/designer-refresh-part-footprint.test.ts \
  src/core/backend/tests/library-footprint-qualification.test.ts src/core/backend/tests/library-default-footprint-guard.test.ts \
  src/core/backend/tests/designer-footprint-qualification-annotation.test.ts src/core/backend/tests/library-intake-generator-claims.test.ts \
  src/core/backend/tests/library-generator-qualification.test.ts src/core/backend/tests/library-import-quarantine.test.ts
bun scripts/gen-ipc-fingerprints.ts --legacy --check
npx vitest run src/modules/library/frontend src/modules/designer/frontend/components/SelectionInspector
npm run typecheck && npm run gen:check && npm run test:backend && npm run test:react
```
Against the shared branch (pre-publish evidence; restore after):
```
npm run shared:link && npm run shared:status
bun test src/core/backend/tests/library-generator-qualification.test.ts src/core/backend/tests/library-generator-policy.test.ts
npm run shared:unlink
```
After O8: `npm ls @openpcb/rendering-core` (one version), `bun scripts/gen-ipc-fingerprints.ts --qualified --check`.

CoreLibrary through OpenPCB DRC:
```
OPENPCB_CORELIBRARY_DIR=/Users/andrejvysny/workspace/openpcb/CoreLibrary bun test src/core/backend/tests/corelibrary-drc-qualification.test.ts
cd /Users/andrejvysny/workspace/openpcb/CoreLibrary && bun validate && bun test tests/gates-footprint-drc.test.ts tests/silk-qualify.test.ts
```

**Vitest specs (O2)**, in `FootprintGeneratorPanel.test.tsx`:
- (a) Selecting a family and size emits a payload with the identical tuple; no click needed.
- (b) T-319 repro: after a size change and then a density change, the emitted generator always
  equals the displayed tuple (SOT-323 + least shown ⇒ never SOT-23/nominal).
- (c) The Template tab emits `null` until a template materializes. Switching back re-emits the IPC
  payload.
- (d) Editing a template field emits `null` and disables Use.
- (e) An unavailable family renders the reason and emits `null`.
- **(f) Race:** start materialize for params P1, edit to P2 before it resolves, resolve P1 ⇒
  nothing is emitted and Use stays disabled. Resolving P2 ⇒ the P2 payload is emitted.
- **(g) Wizard remount:** choose a template and materialize, go to the next step and back ⇒ the
  Template tab is active, the form shows the same params, the payload is unchanged, and it is
  committable.
- **(h) Store guard:** a template payload whose params differ from `templateSelection` ⇒
  `hasCurrentPreset` is false.

Positive IPC paths use `vi.mock("../../shared/generator-qualification")`.

`ChangeFootprintDialog.test.tsx` checks two things:
- Use posts exactly the displayed tuple.
- A flagged variant's Use button is disabled with the reason.

**E2E (O8, Chromium)** `library-ipc-preset.spec.ts`:
- SOT-23 at C (Least) gives 3 pads, with no badge.
- QFN-16 gives 17 pads.
- A design with a seeded legacy-pad footprint shows the `EXPORT_UNQUALIFIED_FOOTPRINT` blocker in
  H19's blockers panel. This needs H19; otherwise it is skipped with the reason stated.

**Manual (native Electron, user):** the wizard preset flow and ChangeFootprintDialog on a packaged
build after O8, with screenshots to `docs/qa/2026-10-hardening/`.

## 8. Cross-item interfaces

- **H13 (frames, intake qualification).**
  - Generator output is Y-up by construction.
  - H13's intake qualifier consumes `classifyFootprintGeometry` for its generator branch.
  - CoreLibrary regeneration (H13) and H13's kicad-import publish **precede** C1/C2.
  - H13's `sourceFrame` slot and H15's `unqualifiedFootprints` slot are siblings in H19's
    `ExportSnapshot`.
  - Not verified: the name of H13's frame-provenance field (its design is not in this directory).
- **H19 (OPENPCB-67).**
  - **H15 fills H19's reserved slot.** Shape: `{placementId, reference, generator}`. Blocker:
    `unqualifiedFootprintBlocker`. Dialog: H19's `ExportBlockersPanel`.
  - H15 adds no problem type, no route edits and no dialog edits. O4b is serial after H19
    S6a/S6b.
  - Order inside `prepare`: H19's.
- **H14 (KiCad import).** No generated rows. KiCad project import (`insert-pcb.ts`) creates
  unstamped snapshots: rule 2 still applies, rules 3–5 never do.
- **OPENPCB-103 (journal).** `refresh_part_footprint` inherits 103's semantics.
- **H16:** not a prerequisite (D4).
- **H51 / OPENPCB-99:** blocked on O8/C3 only.

## 9. Open questions (user action or decision required)

1. **Publish:** cut **`rendering-core-v0.1.4`** from `fix/offline-eda-text` *after* S1–S7.
   - The contracts candidate already pins `#rendering-core-v0.1.4`.
   - The tag also carries the unrelated canvas/plating commits.
   - Confirm the name, and that no other v0.1.4 will be cut first.
2. **Veto check on D1/D2.** These go beyond the binding H15 decision ("flag SOT/QFN, don't
   migrate"):
   - Quarantine chip/SOIC/QFP on the pinned tag.
   - Flag every legacy generated geometry, and overlapping templates.
   - Block manufacturing export in **every build**, via H19's blocker.
   - Consequence: until O8, a dev user with a legacy chip part cannot export it without replacing
     it with a drawn or verified footprint.
3. **A5 scope:**
   - Accept T-214 = **silk only** for H15, with all other CoreLibrary DRC findings held by the O7
     ratchet as follow-ups: `ANNULAR_RING_MIN` ×11, `DRILL_SIZE_MIN` ×3, `COURTYARD_INVALID`,
     `MASK_SLIVER`, fine-pitch `FAB_MASK_BRIDGE`.
   - Decide which profile is "the documented default" for CoreLibrary: G10 0.13/0.3 or the default
     board 0.2/0.4.
   - Approve creating those follow-up Plane items.
4. **CoreLibrary release:** signing, publish (C3) and `productionRelease`. Until then O7 runs the
   sibling checkout locally and the fixture subset in CI.
5. **H19 ownership:** confirm H19 owns export routes and the dialog, and that H15 O4b waits for
   H19 S6b with no interim H15 export guard. This is the default.
6. **Native acceptance:** manual Electron QA of the wizard and ChangeFootprintDialog after O8.
7. **Chip naming (D7):** keep resistor dimensions under `C_*` names (current non-goal), or
   schedule a later rename/split into R/C presets.

---

## 10. Review response (2026-10-15 adversarial review → this revision)

| # | Sev | Resolution |
|---|---|---|
| 1 | blocker | Fixed. Empty numbers are excluded from duplicates. Overlap and drill checks cover all pairs except same non-empty number (§3.3, S6). The all-`""` reproduction is rejected; valid arrays pass. |
| 2 | major | Fixed by snapshot-geometry classification (§3.4). The legacy fingerprint deny-list covers every output of the single legacy generator (verified: v0.1.3 == in-tree `dda0d07`). The generation stamp is added to snapshots. Updated-in-place rows ⇒ "no longer matches". The `sourceHash`-differs ⇒ block rule is narrowed (§11 R2). |
| 3 | major | Fixed. Placed and stored **preview pads** are fingerprinted; `raw.source` and `sourceKind` are never trusted (§3.4 rule 2, §3.7). |
| 4 | major | Fixed differently: an append-only OpenPCB accepted-fingerprint table, and no intake mutation, so there is no downgrade (§3.2, §3.7; §11 R1). §6 wording corrected. |
| 5 | major | Fixed. O7 asserts silk codes; a ratchet baseline holds the rest. The harness board is sized from bounds. Unnumbered/no-copper pads take no net. Nets come from the pinMap plus same-name pins. Follow-ups are open question 3. |
| 6 | major | Fixed. H15 fills H19's `unqualifiedFootprints` slot (O4b). No own problem type or dialog. |
| 7 | major | Fixed. C1/C2 are blocked on the `rendering-core-v0.1.4` and H13 kicad-import publishes; nothing vendored. The publish is named v0.1.4 with S1–S7, with an `npm ls` single-copy check. |
| 8 | major | Fixed. Request key, AbortController and invalidate-on-any-change; Vitest (f). |
| 9 | major | Fixed. Kept-arc test growth = consumer deviation + own sampling + margin. Omnidirectional 2e-4 margin covers rounding. G10 uses the kernel's own `silkClearanceViolations`, which samples like the DRC. |
| 10 | major | Fixed. `provenance.derivationHash` in CoreLibrary; snapshot field plus stale rule. Ids and `sourceHash` unchanged. |
| 11 | minor | Fixed. Tautological test deleted; replaced by table↔installed parity. |
| 12 | minor | Partly fixed. Signal pairs bounded by pitch − nominal lead width. Anchors resolved by location. EP–signal pairs allowed only at the cited K_min (§11 R3). |
| 13 | minor | Fixed (D2 wording). |
| 14 | minor | Fixed (§2.2; O1 test list says SOIC-8). |
| 15 | minor | Fixed. `json_extract` for provenance and pads; LRU by fingerprint; linear fingerprint per read; benchmark logged. |
| 16 | minor | Fixed. Courtyard = outer pad edges + 2c (S2/S3). |
| 17 | minor | Fixed. `updateComponent` server guard covers PATCH from every client. |
| 18 | minor | Fixed. CI fixture subset (O7b); O9 wording states the real coverage. |
| 19 | minor | Fixed. O2 is serial after O3. |
| 20 | minor | Fixed. Both silk spellings. |
| 21 | minor | Fixed. SOURCES.md headroom note precedes S2 coding. |
| 22 | minor | Fixed. Tab, template form and payload live in the wizard store; template identity guard; Vitest (g)/(h). |
| 23 | minor | Fixed. Pin-aware remedies. |
| 24 | minor | Fixed. D7, SOURCES.md statement, informational C_* table; open question 7. |

## 11. Rejected or narrowed review findings

- **R1 (finding 4, partial): per-revision output hashes are not moved into the rendering-core
  manifest.**
  - Acceptance is OpenPCB's decision, made after OpenPCB's own DRC qualification (O6).
  - It must also list historical accepted revisions that a newer package no longer emits, and it
    must exist on the pinned tag for typecheck.
  - An upstream manifest can't satisfy all three. OpenPCB therefore owns the append-only
    fingerprint table.
  - rendering-core keeps only its self-check (S5 revision hashes in tests).
- **R2 (finding 2, narrowed): "snapshot `sourceHash` ≠ row `sourceHash` ⇒ block" is not adopted
  as stated.**
  - CoreLibrary and other KiCad-derived rows legitimately change `sourceHash` on re-import, so the
    rule would block many non-generated parts.
  - The adopted rule is narrower: a pad-fingerprint mismatch, **only for rows whose provenance says
    generated**, plus the geometric deny-list for every snapshot.
  - A pad-fingerprint comparison is more exact than a `sourceHash` comparison anyway.
- **R3 (finding 12, partial): "exposed-pad–signal mask warnings are always unexpected" is not
  adopted.**
  - The QFN EP gap 0.20 mm is the cited MO-220 paddle-to-terminal K_min (SOURCES.md:41). It is not
    a free generator choice.
  - Forcing ≥ 0.25 mm (dam + 2·expansion) would shrink every EP below what the drawings support,
    with an uncited constant.
  - The predicate accepts EP–signal warnings **only** at exactly the cited K_min, with
    `K_min < dam + 2e`; anything else is unexpected.
- **R4 (finding 5, scope):** "add C-slices for the non-silk CoreLibrary codes" is not adopted
  inside H15. The ANNULAR_RING/DRILL findings depend on which profile is the documented default
  (G10 vs default board), which is a user decision (open question 3). They are held by the ratchet
  and proposed as follow-ups.
- **R5 (finding 17, partial):** no designer "per-instance variant picker" was found. `Space.tsx`
  and `PartInspectorPanel.tsx:401-410` only display the current variant. The only writes are
  `PATCH /components/:id` (dialog, detail page) and `refresh_part_footprint`. The server guard on
  `updateComponent` covers all of them.
