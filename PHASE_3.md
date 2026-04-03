# PHASE 3 — PCB Trace Routing, Undo/Redo & Keyboard Shortcuts

**Scope**: Manual interactive PCB trace routing (Manhattan 90°), via placement with layer switching, undo/redo for both editors, keyboard shortcuts, trace-aware ratsnest, trace selection and deletion.

**Acceptance criteria**:

1. User can **click a pad to start routing**, click to create corners (Manhattan 90° angles), and click a target pad to complete a trace. Route preview follows the cursor.
2. **Via placement**: pressing `V` mid-route drops a through-hole via and switches the active copper layer. Routing continues on the new layer.
3. **Trace width cycling**: pressing `W` / `Shift+W` mid-route cycles through trace width presets from the net's `NetClass`.
4. **Elbow flip**: pressing `F` mid-route swaps horizontal-first vs vertical-first corner direction.
5. **Undo/redo** works in both schematic and PCB editors. `Ctrl+Z` undoes, `Ctrl+Shift+Z` redoes. Separate undo stacks per editor.
6. **Keyboard shortcuts**: `R` rotate, `F` flip, `Delete` remove selection, `Esc` cancel, `Ctrl+A` select all — context-aware for active tab.
7. **Ratsnest updates live** as traces complete connections between pads.
8. **Traces and vias** render on the PCB canvas with correct layer colors and widths.
9. **Trace/via selection and deletion**: user can click to select traces, press `Delete` to remove them.
10. Traces and vias **persist** in the `PcbDocument` through save/load.

**Out of scope**: DRC, 45° routing, copper zones, push-and-shove, any-angle routing, drag-to-move traces, batch DRC, Gerber export.

---

## Architecture decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Routing angle | **Manhattan 90° only** | Simplest. 45° chamfered routing deferred. |
| Via type | **Through-hole only** | Standard for 2-layer boards. Blind/buried deferred. |
| DRC during routing | **None** | Route freely. Batch DRC in future phase. |
| Undo architecture | **Command pattern with document snapshots** | Each mutating action captures before/after document state. Simpler than inverse-command approach. Works for both stores. |
| Undo scope | **Document state only** | Viewport, tool mode, selection are not undoable. Only symbol/wire/label/placement/trace/via changes. |
| Undo stack cap | **50 steps per editor** | Sufficient for interactive use, bounded memory. |
| Keyboard dispatch | **Tab-aware handler in DesignScreen** | Extend existing `keydown` handler with `designTab` branching. No new abstraction needed for Phase 3 scope. |
| Trace rendering order | **After board outline, before silkscreen** | Traces are copper — under silkscreen/pads in layer order. Back traces → front traces → silkscreen → pads. |
| Ratsnest connectivity | **Upgrade to account for traces + vias** | Use Union-Find on pad positions + trace endpoints to determine connected groups. |

---

## Work breakdown

Phase 3 contains **6 milestones**.

```
M1: Undo/redo infrastructure (both stores)
M2: Trace & via rendering
M3: Interactive router (state machine + preview)
M4: Ratsnest upgrade (trace-aware connectivity)
M5: Trace selection & deletion
M6: Keyboard shortcuts (unified handler)

Dependency graph:
  M1 ──→ M3
  M2 ──→ M3
  M3 ──→ M4
  M3 ──→ M5
  M1 + M5 ──→ M6
```

M1 and M2 can proceed in parallel. M3 (the router) is the critical path item.

---

## M1 — Undo/redo infrastructure

**Goal**: Add undo/redo to both schematic and PCB stores using a document-snapshot approach. Each undoable action saves the previous document state. `Ctrl+Z` restores it.

**Estimated effort**: 2–3 days

### Architecture

The approach: wrap each mutating store action so it captures a snapshot of `document` before the mutation. The undo stack holds these snapshots. Redo pushes the current state before restoring.

```typescript
interface UndoEntry {
  description: string;            // e.g. "Place R1", "Move R2", "Route trace"
  documentSnapshot: SchematicDocument | PcbDocument;  // deep clone
}

interface UndoState {
  undoStack: UndoEntry[];         // max 50
  redoStack: UndoEntry[];         // cleared on new action
}
```

This is simpler than inverse-command pattern because:
- No need to write undo logic for each action type
- Works with any document mutation, including complex ones (cascade delete, wire+junction cleanup)
- Cost: JSON deep-clone per action (~1-5ms for typical documents, acceptable)

### Tasks

#### M1.1 — Create undo/redo utility

- **File**: new `src-react/src/lib/undo-manager.ts`
- **Action**:

```typescript
interface UndoManager<T> {
  pushUndo(description: string, snapshot: T): void;
  undo(currentDocument: T): { restored: T; description: string } | null;
  redo(currentDocument: T): { restored: T; description: string } | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

function createUndoManager<T>(maxSize: number = 50): UndoManager<T>
```

- Deep clone via `structuredClone()` (native, handles all JSON-serializable objects)
- Undo: push current doc to redo stack, pop undo stack, return restored doc
- Redo: push current doc to undo stack, pop redo stack, return restored doc
- New action: push to undo stack, clear redo stack
- Test: push 3 states, undo twice, redo once, verify correct state at each step

#### M1.2 — Add undo/redo to schematic store

- **File**: `src-react/src/stores/schematic-store.ts`
- **Action**:
  - Add `undoManager` instance (created with `createUndoManager<SchematicDocument>()`)
  - Add state fields: `canUndo: boolean`, `canRedo: boolean`
  - Add actions: `undo()`, `redo()`
  - Identify which existing actions are undoable (document-mutating):
    - `commitPlacement` — undoable
    - `commitWire` — undoable
    - `commitDragMove` — undoable
    - `deleteSelectedEntities` — undoable
    - `commitNetLabel` — undoable
    - `updateSymbolValue` — undoable
    - `updateNetLabelText` — undoable
  - For each undoable action: before the `set()` call, capture `structuredClone(state.persisted.document)` and push to undo manager
  - Non-undoable actions (viewport, selection, tool mode, session begin/cancel): do NOT push to undo stack
  - After undo/redo: recalculate `derived.connectivity` from restored document
  - Update `canUndo`/`canRedo` flags after every push/undo/redo

**Implementation pattern** — wrap existing action:
```typescript
// Before (existing):
commitPlacement: (position) => set((state) => {
  const nextDocument = ...;
  return { persisted: { document: nextDocument }, ... };
}),

// After (with undo):
commitPlacement: (position) => set((state) => {
  undoManager.pushUndo("Place component", structuredClone(state.persisted.document));
  const nextDocument = ...;
  return {
    persisted: { document: nextDocument },
    canUndo: undoManager.canUndo(),
    canRedo: undoManager.canRedo(),
    ...
  };
}),
```

#### M1.3 — Add undo/redo to PCB store

- **File**: `src-react/src/stores/pcb-store.ts`
- **Action**:
  - Same pattern as schematic store
  - Add `undoManager` instance (created with `createUndoManager<PcbDocument>()`)
  - Add state fields: `canUndo: boolean`, `canRedo: boolean`
  - Add actions: `undo()`, `redo()`
  - Undoable PCB actions:
    - `movePlacement` — undoable
    - `rotatePlacement` — undoable
    - `flipPlacement` — undoable
    - `deletePlacement` — undoable
    - Plus new routing actions (added in M3): `commitTrace`, `commitVia`, `deleteTrace`, `deleteVia`
  - After undo/redo: recalculate ratsnest from restored document

#### M1.4 — Tests

- **File**: `src-react/src/lib/undo-manager.test.ts`
- **Tests**:
  - Push 3 snapshots, undo 2, verify state
  - Undo then redo, verify round-trip
  - New action after undo clears redo stack
  - Stack cap at 50 — push 60, verify oldest dropped
  - Undo on empty stack returns null
  - Redo on empty stack returns null

### Acceptance

- [ ] Undo manager utility works correctly
- [ ] Schematic store tracks undo/redo for document-mutating actions
- [ ] PCB store tracks undo/redo for document-mutating actions
- [ ] `canUndo`/`canRedo` flags update correctly
- [ ] Undo restores previous document state including derived recalculation
- [ ] All tests pass

---

## M2 — Trace & via rendering

**Goal**: Render traces and vias on the PCB canvas with correct layer colors, widths, and drill holes.

**Estimated effort**: 1–2 days

### Tasks

#### M2.1 — Trace rendering function

- **File**: new `src-react/src/components/pcb-editor/canvas/pcb-traces.ts`
- **Action**:

```typescript
function renderTraces(
  ctx: CanvasRenderingContext2D,
  traces: TraceSegment[],
  viewport: PcbViewport,
  activeLayer: string,
  visibleLayers: Set<string>
): void
```

- For each trace:
  - Skip if trace's layer is not in `visibleLayers`
  - Get color from `LAYER_COLORS[trace.layer]`
  - Dim if trace's layer !== `activeLayer` (alpha 0.3)
  - Convert start/end to screen coordinates via `pcbToScreen()`
  - Set `ctx.lineWidth = trace.width * viewport.zoom` (world-space width)
  - Set `ctx.lineCap = 'round'` (standard PCB trace ends)
  - Draw line from start to end
- Reference the research document section 5.1 for trace rendering code.

#### M2.2 — Via rendering function

- **File**: add to `pcb-traces.ts` or new `pcb-vias.ts`
- **Action**:

```typescript
function renderVias(
  ctx: CanvasRenderingContext2D,
  vias: Via[],
  viewport: PcbViewport
): void
```

- For each via:
  - Convert position to screen coordinates
  - Draw outer circle (copper pad) in neutral color (#b4b4b4) — vias appear on all layers
  - Draw inner circle (drill hole) in board background color (#1a1a1a)
  - Sizes: `padDiameter * viewport.zoom` and `drillDiameter * viewport.zoom`

#### M2.3 — Integrate into render loop

- **File**: `src-react/src/components/pcb-editor/canvas/PcbCanvas.tsx`
- **Action**: Add `renderTraces()` and `renderVias()` to the render function.
- Updated draw order:
  1. background fill
  2. grid
  3. board outline
  4. **back copper traces** (B.Cu traces, dimmed if F.Cu active)
  5. silkscreen
  6. **front copper traces** (F.Cu traces)
  7. pads
  8. **vias**
  9. ratsnest
  10. selection overlay
  11. **routing preview** (new — for active routing session)

#### M2.4 — Routing preview rendering

- **File**: add to `pcb-traces.ts`
- **Action**:

```typescript
function renderRoutingPreview(
  ctx: CanvasRenderingContext2D,
  previewSegments: TraceSegment[],
  previewVia: Via | null,
  viewport: PcbViewport
): void
```

- Preview segments render with reduced opacity (0.6) and the active layer color
- Preview via renders at cursor position when V is about to be placed
- Preview updates every frame as cursor moves (read from store routing session state)

### Acceptance

- [ ] Traces render with correct width, color, and layer visibility
- [ ] Vias render with outer pad and drill hole
- [ ] Back-layer traces appear dimmed when front is active
- [ ] Routing preview renders during active routing session
- [ ] All rendering works within the existing RAF loop

---

## M3 — Interactive router

**Goal**: Implement the routing state machine, click-to-route interaction, via placement, trace width cycling, and elbow flip.

**Estimated effort**: 4–5 days (largest milestone)

### Router state machine

```
                 ┌──────────┐
                 │   IDLE   │
                 └────┬─────┘
                      │ Click pad
                      ▼
                 ┌──────────┐
          ┌──────│ ROUTING  │──────┐
          │      └────┬─────┘      │
          │           │            │
     Click empty   Click target   Press V
     (add corner)  pad (commit)   (place via)
          │           │            │
          ▼           ▼            ▼
     Stay in      ┌────────┐  ┌──────────┐
     ROUTING      │COMPLETE│  │ VIA_PLACE│
                  │→ IDLE  │  │→ ROUTING │
                  └────────┘  │ (new layer│)
                              └──────────┘

     Press Esc → discard all preview segments → IDLE
     Press W → cycle trace width (stay in ROUTING)
     Press F → flip elbow direction (stay in ROUTING)
```

### Tasks

#### M3.1 — Add routing state to PCB store

- **File**: `src-react/src/stores/pcb-store.ts`
- **Action**:
  - Extend `activeTool` type: `"select" | "place" | "route"`
  - Add routing session state:
    ```typescript
    routingSession: {
      netId: string;
      layer: string;                    // current routing layer
      width: number;                    // current trace width (mm)
      widthPresets: number[];           // from net class
      widthIndex: number;
      elbowDirection: "horizontal_first" | "vertical_first";
      committedSegments: TraceSegment[];  // segments already clicked
      committedVias: Via[];               // vias already placed
      startPoint: Point2D;               // last committed point (pad or corner)
      previewSegments: TraceSegment[];    // live preview to cursor
    } | null;
    ```
  - Add setter: `setActiveTool(tool)` — this was noted as missing in exploration
  - Add routing actions:
    - `startRouting(padRef: PadReference, worldPosition: Point2D)`: enter routing mode
    - `updateRoutingPreview(cursorPosition: Point2D)`: recalculate preview segments
    - `addRoutingCorner(position: Point2D)`: commit current preview, start new segment
    - `placeRoutingVia(position: Point2D)`: commit segment to via point, place via, switch layer
    - `completeRoute(targetPadPosition: Point2D)`: commit final segment, add all traces + vias to document
    - `cancelRouting()`: discard session, return to idle
    - `cycleTraceWidth(direction: 1 | -1)`: change width from presets
    - `flipElbowDirection()`: toggle horizontal_first ↔ vertical_first
  - `completeRoute` and `cancelRouting` are the only actions that modify `document.traces` and `document.vias`

#### M3.2 — Manhattan path calculation

- **File**: new `src-react/src/components/pcb-editor/routing/manhattan-path.ts`
- **Action**:

```typescript
function calculateManhattanPath(
  from: Point2D,
  to: Point2D,
  elbowDirection: "horizontal_first" | "vertical_first",
  width: number,
  layer: string,
  net: string
): TraceSegment[]
```

- If `horizontal_first`:
  - Segment 1: horizontal from `from` to `(to.x, from.y)`
  - Segment 2: vertical from `(to.x, from.y)` to `to`
- If `vertical_first`:
  - Segment 1: vertical from `from` to `(from.x, to.y)`
  - Segment 2: horizontal from `(from.x, to.y)` to `to`
- Skip zero-length segments (when from and to share X or Y)
- Snap corner point to grid
- Reference the research document section 3.2 for the path calculation code

#### M3.3 — Net class width resolution

- **File**: new `src-react/src/components/pcb-editor/routing/net-class-resolve.ts`
- **Action**:

```typescript
function resolveNetClassWidths(
  netId: string,
  document: PcbDocument
): { defaultWidth: number; presets: number[] }
```

- Find the net in `document.nets` by `netId`
- Look up its `netClass` name in `document.netClasses`
- Return the `traceWidth` as default, build presets array: `[netClass.traceWidth * 0.5, netClass.traceWidth, netClass.traceWidth * 2]` (or hardcoded standard widths: 0.15, 0.2, 0.25, 0.3, 0.5, 0.8, 1.0)
- Also resolve via dimensions: `viaDiameter`, `viaDrill`

#### M3.4 — Wire routing into interaction controller

- **File**: `src-react/src/components/pcb-editor/usePcbInteractionController.ts`
- **Action**:
  - Expand the interaction state machine:
    ```typescript
    type InteractionState =
      | { type: "idle" }
      | { type: "pending_drag"; ... }
      | { type: "dragging"; ... }
      | { type: "routing" };  // new
    ```
  - Route mouse events based on `activeTool`:
    - If `activeTool === "select"`: existing behavior (select/drag placements)
    - If `activeTool === "route"`: routing behavior
  - Routing mouse behavior:
    - **mouseDown on pad**: call `store.startRouting(padRef, worldPosition)`
    - **mouseMove during routing**: call `store.updateRoutingPreview(worldPosition)`
    - **mouseDown on empty space during routing**: call `store.addRoutingCorner(snappedPosition)`
    - **mouseDown on target pad during routing** (same net): call `store.completeRoute(targetPosition)`
    - **mouseDown on pad of different net during routing**: ignore (no DRC, but don't connect different nets)
  - Update hit-test check: during routing, hitting a pad should check if it's the same net

#### M3.5 — Start routing from pad

- **File**: `src-react/src/stores/pcb-store.ts`
- **Action** for `startRouting()`:
  1. Identify the pad's net from `document.nets` (find `PcbNet` where `padRefs` includes this pad)
  2. If no net found, abort (can't route unconnected pads)
  3. Resolve net class widths via `resolveNetClassWidths()`
  4. Set `routingSession`:
     - `netId`: the pad's net
     - `layer`: `activeLayer` (or the pad's layer)
     - `width`: net class default trace width
     - `widthPresets`: from net class resolution
     - `widthIndex`: index of default width in presets
     - `elbowDirection`: `"horizontal_first"`
     - `committedSegments`: `[]`
     - `committedVias`: `[]`
     - `startPoint`: pad world position (snapped)
     - `previewSegments`: `[]`

#### M3.6 — Complete route

- **File**: `src-react/src/stores/pcb-store.ts`
- **Action** for `completeRoute()`:
  1. Calculate final segments from last committed point to target pad position
  2. Generate IDs for all committed segments + final segments
  3. Push undo snapshot (before modifying document)
  4. Add all `committedSegments` + final segments to `document.traces`
  5. Add all `committedVias` to `document.vias`
  6. Clear `routingSession`
  7. Set `activeTool` back to `"select"`
  8. Recalculate ratsnest

#### M3.7 — Via placement mid-route

- **File**: `src-react/src/stores/pcb-store.ts`
- **Action** for `placeRoutingVia()`:
  1. Add corner at via position (commit preview segments)
  2. Create via:
     ```typescript
     { id: generateId(), position: snappedPosition,
       padDiameter: netClassViaDiameter, drillDiameter: netClassViaDrill,
       net: routingSession.netId, type: "through",
       layers: ["F.Cu", "B.Cu"], tented: true }
     ```
  3. Add via to `routingSession.committedVias`
  4. Switch layer: `routingSession.layer = layer === "F.Cu" ? "B.Cu" : "F.Cu"`
  5. Update `startPoint` to via position
  6. Continue routing on new layer

#### M3.8 — Activate routing tool

- **Action**: Add a "Route" button to the PCB toolbar that sets `activeTool = "route"`.
- When routing tool is active, cursor should change to crosshair.
- When user starts routing (clicks pad), the tool stays active for multiple routes until Esc or tool switch.

### Acceptance

- [ ] Click pad → route preview follows cursor with Manhattan path
- [ ] Click to create corners, click target pad to complete
- [ ] Trace appears with correct width, color, and layer
- [ ] `W` cycles trace width, `F` flips elbow, `Esc` cancels
- [ ] `V` places via at cursor, switches to other layer, routing continues
- [ ] Completed traces persist in document
- [ ] Undo reverses a completed route
- [ ] Multiple sequential routes work (tool stays active)

---

## M4 — Ratsnest upgrade (trace-aware)

**Goal**: The ratsnest calculator accounts for routed traces and vias when determining which pads are connected. Completed connections disappear from ratsnest in real-time.

**Estimated effort**: 1–2 days

### Tasks

#### M4.1 — Upgrade ratsnest connectivity

- **File**: `src-react/src/components/pcb-editor/ratsnest.ts`
- **Action**:
  - Replace the `_traces` / `_vias` ignored parameters with real connectivity logic
  - Algorithm:
    1. For each net: collect all pad world positions (existing)
    2. Build Union-Find with one element per pad
    3. For each trace in this net: find which pads are at (or within tolerance of) the trace start and end points. Union those pads.
    4. For each via in this net: a via connects pads across layers at the same position. Find pads near the via position on any layer and union them.
    5. For trace chains (A→B, B→C): the union transitively connects A to C
    6. Find connected groups from Union-Find
    7. If all pads in one group → net fully routed, no ratsnest lines
    8. If multiple groups → MST between group centroids (existing logic)
  - **Tolerance for endpoint matching**: trace endpoints should be within 0.01mm of a pad center to count as connected. Use distance check, not exact coordinate match (traces may not land exactly on pad center).

#### M4.2 — Trace endpoint to pad matching

- **Action**: Create a helper that maps trace endpoints to nearby pads:

```typescript
function findPadAtPosition(
  position: Point2D,
  padPositions: Map<number, Point2D>,  // padIndex → world position
  tolerance: number = 0.01  // mm
): number | null
```

- Also handle via-to-pad matching: a via at position P connects to any pad within tolerance of P, regardless of layer.

#### M4.3 — Trigger ratsnest recalculation after routing

- **File**: `src-react/src/stores/pcb-store.ts`
- **Action**: Ensure `recalculateRatsnest()` is called after:
  - `completeRoute()` — traces added
  - `deleteTrace()` — trace removed (M5)
  - `deleteVia()` — via removed (M5)
  - `undo()` / `redo()` — document restored

#### M4.4 — Fix B.Cu pad position mirroring

- **File**: `src-react/src/components/pcb-editor/ratsnest.ts`
- **Action**: The exploration noted that `resolvePadWorldPosition()` does NOT mirror X for B.Cu placements, while hit-testing does. Verify and fix if needed — pad positions must be consistent across ratsnest, hit-testing, and trace endpoint matching.

### Acceptance

- [ ] Routing a trace between two pads removes their ratsnest line
- [ ] Partial routing (trace doesn't reach target pad) keeps ratsnest
- [ ] Via-connected pads across layers are recognized as connected
- [ ] Deleting a trace restores the ratsnest line
- [ ] Undo of a route restores the ratsnest
- [ ] Multi-pad nets: routing connects a subgroup, ratsnest updates for remaining unrouted pads

---

## M5 — Trace selection & deletion

**Goal**: Users can select traces and vias on the PCB canvas and delete them.

**Estimated effort**: 1–2 days

### Tasks

#### M5.1 — Extend PCB hit testing for traces and vias

- **File**: `src-react/src/components/pcb-editor/canvas/pcb-hit-test.ts`
- **Action**:
  - Extend `PcbHitTarget`:
    ```typescript
    type PcbHitTarget =
      | { kind: "placement"; placementId: string }
      | { kind: "pad"; placementId: string; padNumber: string }
      | { kind: "trace"; traceId: string }      // new
      | { kind: "via"; viaId: string }           // new
      | null;
    ```
  - Trace hit test: point-to-segment distance < `trace.width / 2 + 0.1mm` tolerance
  - Via hit test: point-to-center distance < `via.padDiameter / 2`
  - Hit priority order: pads > vias > traces > placements (smallest targets first)

#### M5.2 — Extend PCB selection model

- **File**: `src-react/src/stores/pcb-store.ts`
- **Action**:
  - `selectedIds` currently holds placement IDs. Extend to hold any entity ID (traces, vias, placements).
  - Add a `selectedType` or use prefixed IDs to distinguish types. **Simpler approach**: store IDs as-is, and on delete/render, check whether the ID exists in `document.traces`, `document.vias`, or `document.placements`.
  - Add actions:
    - `selectTrace(traceId)` / `selectVia(viaId)` — or unify into `selectEntity(id)`
    - `deleteSelectedTraces()` — removes selected traces/vias from `document`

#### M5.3 — Trace/via deletion

- **File**: `src-react/src/stores/pcb-store.ts`
- **Action**:
  - `deleteSelectedEntities()` action:
    1. Push undo snapshot
    2. Filter `document.traces` to remove selected trace IDs
    3. Filter `document.vias` to remove selected via IDs
    4. Filter `document.placements` to remove selected placement IDs
    5. Clear selection
    6. Recalculate ratsnest
  - This replaces the existing `deletePlacement()` action with a more general version

#### M5.4 — Selection rendering for traces/vias

- **File**: `src-react/src/components/pcb-editor/canvas/PcbCanvas.tsx` (selection render section)
- **Action**:
  - Selected traces: render with bright highlight (white outline or thicker stroke)
  - Selected vias: render with bright ring
  - Keep existing placement selection highlighting

#### M5.5 — Update interaction controller for trace selection

- **File**: `src-react/src/components/pcb-editor/usePcbInteractionController.ts`
- **Action**:
  - When `activeTool === "select"` and user clicks:
    - Hit-test against traces and vias (not just placements)
    - If trace hit: select it
    - If via hit: select it
    - Traces and vias are not draggable (click to select only, no drag-move)

### Acceptance

- [ ] Clicking a trace selects it (highlighted)
- [ ] Clicking a via selects it (highlighted)
- [ ] `Delete` key removes selected traces/vias
- [ ] Deletion triggers ratsnest recalculation
- [ ] Undo restores deleted traces/vias
- [ ] Mixed selection (trace + placement) deletes all selected

---

## M6 — Keyboard shortcuts

**Goal**: Unified keyboard handler that dispatches context-aware shortcuts for both schematic and PCB editors.

**Estimated effort**: 1–2 days

### Shortcut mapping

| Key | Schematic context | PCB context (select mode) | PCB context (routing mode) |
|-----|-------------------|---------------------------|----------------------------|
| `Ctrl+Z` | Undo | Undo | — (cancel route instead) |
| `Ctrl+Shift+Z` | Redo | Redo | — |
| `Delete` / `Backspace` | Delete selection | Delete selection | — |
| `Escape` | Cancel session / close popover | Cancel routing / deselect | Cancel routing |
| `R` | Rotate during placement | Rotate selected placement | — |
| `F` | Flip during placement | Flip selected placement | Flip elbow direction |
| `Ctrl+A` | Select all | Select all placements | — |
| `V` | — | — | Place via + switch layer |
| `W` | — | — | Cycle trace width forward |
| `Shift+W` | — | — | Cycle trace width backward |

### Tasks

#### M6.1 — Expand keyboard handler

- **File**: `src-react/src/screens/DesignScreen.tsx`
- **Action**:
  - Refactor the existing inline `handleKeyDown` to branch on `designTab`:
    ```typescript
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if typing in a text input
      if (isTextInputFocused()) return;

      const tab = useNavigationStore.getState().designTab;

      if (tab === "schematic") {
        handleSchematicKeyDown(event);
      } else if (tab === "pcb") {
        handlePcbKeyDown(event);
      }
    };
    ```
  - `handleSchematicKeyDown`: existing Escape/Delete logic + new Ctrl+Z, Ctrl+Shift+Z, R, F, Ctrl+A
  - `handlePcbKeyDown`: new handler for PCB context

#### M6.2 — Schematic keyboard handler

- **File**: can stay in `DesignScreen.tsx` or extract to `src-react/src/screens/design/schematic-keyboard.ts`
- **Action**:
  - `Ctrl+Z`: call `schematicStore.undo()`
  - `Ctrl+Shift+Z`: call `schematicStore.redo()`
  - `Delete` / `Backspace`: existing delete logic
  - `Escape`: existing cancel logic
  - `R`: if placement preview active, rotate by 90°. If selection, rotate selected symbol.
  - `F`: if placement preview active, mirror. If selection, mirror selected symbol.
  - `Ctrl+A`: `schematicStore.selectAll()`

#### M6.3 — PCB keyboard handler

- **File**: `src-react/src/screens/design/pcb-keyboard.ts` (new)
- **Action**:
  - Check if routing session is active (`pcbStore.routingSession !== null`)
  - **During routing**:
    - `Escape`: `pcbStore.cancelRouting()`
    - `V`: `pcbStore.placeRoutingVia(currentCursorPosition)` — need cursor position from interaction controller
    - `W`: `pcbStore.cycleTraceWidth(1)`
    - `Shift+W`: `pcbStore.cycleTraceWidth(-1)`
    - `F`: `pcbStore.flipElbowDirection()`
  - **Not during routing**:
    - `Ctrl+Z`: `pcbStore.undo()`
    - `Ctrl+Shift+Z`: `pcbStore.redo()`
    - `Delete` / `Backspace`: `pcbStore.deleteSelectedEntities()`
    - `Escape`: `pcbStore.clearSelection()`
    - `R`: if selection, `pcbStore.rotatePlacement(selectedId, 90)`
    - `F`: if selection, `pcbStore.flipPlacement(selectedId)`
    - `Ctrl+A`: select all placements

#### M6.4 — Cursor position for via placement

- **Action**: The `V` key during routing needs the current cursor world position.
  - Option A: store cursor position in PCB store (updated on every mouse move)
  - Option B: store cursor position in interaction controller ref
  - **Recommended**: Option A — add `cursorWorldPosition: Point2D | null` to PCB store, updated by `updateRoutingPreview()` (already called on mouse move)

#### M6.5 — Prevent browser defaults

- **Action**: For `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+A`, `Backspace`: call `event.preventDefault()` to prevent browser undo, select-all, and back-navigation.

### Acceptance

- [ ] `Ctrl+Z` / `Ctrl+Shift+Z` work in both schematic and PCB tabs
- [ ] `Delete` removes selection in active tab context
- [ ] `R` rotates in both contexts
- [ ] `F` flips placement in select mode, flips elbow in routing mode
- [ ] `V` places via during routing
- [ ] `W` / `Shift+W` cycles trace width during routing
- [ ] `Esc` cancels routing or clears selection
- [ ] Shortcuts don't fire when typing in text inputs
- [ ] Browser default actions are prevented for captured shortcuts

---

## Test strategy

### Automated tests

| Area | Test file | What to verify |
|------|-----------|---------------|
| Undo manager | `undo-manager.test.ts` | Push, undo, redo, cap, clear |
| Manhattan path | `manhattan-path.test.ts` | Horizontal-first, vertical-first, straight lines, zero-length |
| Net class resolve | `net-class-resolve.test.ts` | Width lookup, preset generation |
| Ratsnest upgrade | `ratsnest.test.ts` (update) | Trace-aware connectivity, via connections |
| Trace hit test | `pcb-hit-test.test.ts` (update) | Point-to-segment distance, via hit |

### Manual test checklist

- [ ] Route a trace: click pad → corners → target pad → trace appears
- [ ] Route with via: start on F.Cu → V → continue on B.Cu → complete
- [ ] Trace width: start routing → press W → width changes → visible in preview
- [ ] Elbow flip: start routing → press F → corner direction swaps
- [ ] Cancel: start routing → Esc → all preview removed
- [ ] Undo route: complete a route → Ctrl+Z → trace disappears, ratsnest returns
- [ ] Redo route: undo → Ctrl+Shift+Z → trace reappears
- [ ] Undo schematic: place component → Ctrl+Z → component removed
- [ ] Select trace: click a routed trace → highlighted
- [ ] Delete trace: select → Delete key → trace removed, ratsnest returns
- [ ] Ratsnest live: route between two pads → airwire disappears
- [ ] Multiple routes: complete one route, immediately start another without re-clicking tool
- [ ] Save/load: route traces → save → reload → traces preserved

---

## File change summary

### New files

| File | Purpose |
|------|---------|
| `src-react/src/lib/undo-manager.ts` | Generic undo/redo manager utility |
| `src-react/src/components/pcb-editor/canvas/pcb-traces.ts` | Trace + via rendering |
| `src-react/src/components/pcb-editor/routing/manhattan-path.ts` | Manhattan path calculation |
| `src-react/src/components/pcb-editor/routing/net-class-resolve.ts` | Net class width/via resolution |
| `src-react/src/screens/design/pcb-keyboard.ts` | PCB keyboard shortcut handler |
| Test files for all above | Automated tests |

### Modified files

| File | Changes |
|------|---------|
| `src-react/src/stores/schematic-store.ts` | Add undo manager, wrap undoable actions, add undo/redo actions, add canUndo/canRedo state |
| `src-react/src/stores/pcb-store.ts` | Add undo manager, routing session state, routing actions, trace/via CRUD, setActiveTool, cursorWorldPosition, deleteSelectedEntities |
| `src-react/src/components/pcb-editor/usePcbInteractionController.ts` | Add routing interaction mode, tool dispatch, trace/via selection |
| `src-react/src/components/pcb-editor/canvas/PcbCanvas.tsx` | Add trace/via/preview rendering calls to draw loop |
| `src-react/src/components/pcb-editor/canvas/pcb-hit-test.ts` | Add trace and via hit targets |
| `src-react/src/components/pcb-editor/ratsnest.ts` | Upgrade to account for traces + vias connectivity |
| `src-react/src/screens/DesignScreen.tsx` | Refactor keyboard handler for tab-aware dispatch, add schematic shortcuts |

---

## Risk register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Undo snapshot performance** — `structuredClone()` on large documents may be slow | Medium | Low | Typical hobby PCB documents are <100KB JSON. Profile if >10ms. Fallback: use immutable data with structural sharing. |
| **Routing preview jank** — recalculating Manhattan path every frame during mouse move | Low | Low | Manhattan path calculation is O(1) — just two segments. No performance concern. |
| **Trace-to-pad endpoint matching** — floating point coordinates may not exactly match pad centers | Medium | Medium | Use 0.01mm tolerance for matching. If issues persist, snap trace endpoints to pad centers on commit. |
| **Interaction controller complexity** — adding routing mode to existing select/drag controller | Medium | Medium | Keep tool dispatch clean: check `activeTool` first, then delegate to mode-specific handler. Don't nest routing logic inside drag logic. |
| **Via cursor position for V key** — keyboard handler needs current world position | Low | Low | Store `cursorWorldPosition` in PCB store, updated on every `updateRoutingPreview()` call. |
| **B.Cu mirroring inconsistency** — ratsnest, hit-test, and rendering may compute pad positions differently for back-side components | High | Medium | Create a single `resolvePadWorldPosition()` utility used by ALL subsystems. Fix in M4.4. |

---

## Execution order

```
Week 1:   M1 (undo/redo) + M2 (trace rendering)           [parallel]
Week 2:   M3 (interactive router — largest milestone)
Week 3:   M4 (ratsnest upgrade) + M5 (trace selection)     [parallel]
Week 3-4: M6 (keyboard shortcuts) + integration testing
```

**Total estimated effort**: 3–4 weeks for a solo developer.

**Critical path**: M1 → M3 (undo must exist before routing commits) and M2 → M3 (trace rendering must exist before routing preview can be seen).
