# Designer grid and electrical anchors

The application editing policy lives in `src/shared/domain/editor-grid.ts`. It is independent of
the published rendering package's visual defaults. The schematic pitch is 1.27 mm (50 mil); PCB
pitch defaults to 0.25 mm and supports 0.05, 0.1, 0.25, 0.5, 1 and 1.27 mm.

## Coordinates and persistence

Schematic commands store integer nanometres. PCB interactions convert millimetres to integer
nanometres for snapping, then back to millimetres for existing PCB command fields. Half-grid ties
follow `Math.round` (toward positive infinity), including negative coordinates. Non-finite inputs,
negative or fractional nanometre pitches, and unsafe integer results are rejected.

Explicit API/command coordinates remain authoritative. PCB placement moves, staging and auto-layout
candidates persist millimetre fields rounded to integer nanometres only (no 1 µm quantization).
Loading, projecting or reopening a design does not quantize existing geometry. One normalization
exception: `create_wire` repairs a malformed (non-Manhattan) command path by snapping interior
anchors to the 1.27 mm schematic grid regardless of the renderer snap preference; endpoints stay
on exact pins and an already-orthogonal path is kept verbatim. Disabling snap permits intentional off-grid placement while
retaining integer-nanometre precision. Grid preferences are renderer-local view preferences under
`openpcb.designer.grid.v1`; changing them does not issue a design command or consume a revision.
Invalid persisted preferences fall back to supported defaults.

## Interaction policy

- Grid visibility and snapping are independent for each editor. The status bar exposes both;
  PCB additionally exposes the current pitch. Hidden grids still snap when snapping is enabled.
- `Shift+S` toggles snapping. PCB `N` and `Shift+N` cycle pitch forward and backward. These
  shortcuts require canvas focus and ignore text editing, repeats and modal dialogs.
- Schematic pointer placement, MIME drop preview and drop commit use the same world-nm policy.
  Duplication offsets by two schematic grid steps and snaps only the new object when enabled.
- Schematic group movement snaps the grabbed object's destination, preserving relative offsets.
  It captures the selected pitch at gesture start. A zero movement leaves off-grid data unchanged.
- Segment dragging snaps the absolute perpendicular destination. Attached endpoints remain exact;
  invalid/self-overlapping results are refused by the existing routing kernel.
- A canonical electrical pin outranks a nearby pointer/grid coordinate. Wire and primitive previews
  use the same exact pin coordinates as their commits, including rotated and off-grid pins.
- A newly clicked wire waypoint can align to the preceding anchor within the smaller of three
  screen pixels and 50,000 nm. This gesture aid removes sub-pixel orthogonal corner jogs. It is
  not a connectivity tolerance, DRC tolerance or normalization pass over persisted geometry.

## Regression evidence

Backend coverage includes negative coordinates, half ties, mm/nm parity, off-grid endpoints,
segment movement and layout consumers. Frontend coverage includes preference hydration,
independent visibility/snapping, shortcut scope, duplication and the archived 22.7 µm corner jog.

Native Electron coverage lives in `tests/e2e/electron-designer-hardening.spec.ts`,
`tests/e2e/electron-designer-anchors.spec.ts` and `tests/e2e/electron-designer-grid-matrix.spec.ts`
(PCB footprint drag × 0.05/0.25/1.27 mm pitch × two zooms, negative/zero origins, rotated and
flipped bottom-side, Undo and reopen). It uses fresh disposable profiles, real command
HTTP/SQLite persistence, actual canvas pointer/keyboard gestures and explicitly identified renderer
artifacts. The capture bridge projects world coordinates for pointer targeting and seeds fixtures
through the normal revision-safe dispatcher; it does not change interaction results.

Qualification results and remaining limits are recorded in
`docs/qa/2026-10-hardening/evidence/designer-grid-snapping.json`. Candidate native evidence does
not qualify an unpublished canvas dependency, the packaged application, every PCB footprint
transform, or the complete original T-095 reproduction matrix. Plane OPENPCB-57 remains the task
authority.
