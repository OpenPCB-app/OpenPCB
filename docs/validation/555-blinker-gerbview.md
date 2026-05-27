# 555 Blinker — KiCad GerbView Validation

Manual fab-output validation for the 555 astable LED-blinker fixture. The
automated half lives in `src/core/backend/tests/designer-555-export.test.ts`
(asserts artifact set, copper geometry, drills, BOM/PnP rows, ZIP validity).
This doc covers the visual GerbView pass that automation cannot do.

## Fixture

- Builder: `src/core/backend/tests/fixtures/blinker-555.ts`
  (`build555BlinkerPcb` / `build555BlinkerSchematic`).
- Board: 40 × 30 mm, 2-layer, JLCPCB 2L preset.
- Parts: U1 NE555P (DIP-8 THT), R1/R2/R3 (0603), C1 (0805), C2 (0603),
  D1 LED (0805), J1 power header (1×02 THT), 2× 3.2 mm mounting holes (NPTH).

## Generating the bundle for inspection

The export pipeline (`buildExportBundle`) is pure; to produce real files for
GerbView, export from a design built from this fixture, or run the bundle
through `packZip` and write the bytes to a `.zip`. (The automated test exercises
`buildExportBundle` + `packZip` directly.)

Open the resulting folder/zip in **KiCad → GerbView → File → Open Gerber Plot Files**
(load all `*.gbr`), then **File → Open Excellon Drill Files** (load `*.drl`).

## Checklist

- [ ] **Edge.Cuts** renders a closed 40 × 30 mm rectangle; no stray segments.
- [ ] **F.Cu** shows all SMD + THT pads and the VCC + OUT traces; OUT trace shows
      a clean 45° elbow.
- [ ] **B.Cu** shows the GND return trace and the through-via annulus.
- [ ] **Drill (PTH)**: 8 DIP holes + 2 header holes + 1 via = 11 plated hits,
      aligned to their pads.
- [ ] **Drill (NPTH)**: exactly 2 mounting holes at opposite corners, 3.2 mm.
- [ ] **F.Mask**: openings over every F.Cu pad; no mask over bare copper traces.
- [ ] **F.Paste**: openings over the 6 SMD parts only (12 pads); none over THT.
- [ ] **F.Silkscreen / B.Silkscreen**: load without parse errors (may be sparse).
- [ ] No GerbView load warnings/errors for any file.

## Result log

| Date      | OpenPCB version | GerbView version | Result | Notes                                                              |
| --------- | --------------- | ---------------- | ------ | ------------------------------------------------------------------ |
| _pending_ | 0.1.0-beta.4    | —                | —      | Automated assertions green; manual GerbView pass not yet recorded. |
