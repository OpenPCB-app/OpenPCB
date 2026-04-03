# Phase 3 Exploration

## 1. PCB store — current state after Phase 2

**Answer**

- `usePcbStore` state fields:
  - `document: PcbDocument | null`
  - `ratsnest: RatsnestLine[]`
  - `viewport: PcbViewport`
  - `activeLayer: "F.Cu" | "B.Cu"`
  - `visibleLayers: Set<string>`
  - `gridSize: number`
  - `selectedIds: Set<string>`
  - `activeTool: "select" | "place"`
- Actions/methods:
  - `initFromSchematic()`
  - `syncFromSchematic()`
  - `setDocument()`
  - `movePlacement()`
  - `rotatePlacement()`
  - `flipPlacement()`
  - `selectPlacement()`
  - `clearSelection()`
  - `deletePlacement()`
  - `setBoardSize()`
  - `setGridSize()`
  - `setActiveLayer()`
  - `toggleLayerVisibility()`
  - `setViewport()`
  - `pan()`
  - `zoomAt()`
- `traces`, `vias`, `zones` are **not top-level store fields**. They live inside `document: PcbDocument`.
- Ratsnest is recalculated by `recalculateRatsnest(document)` and is triggered by `setDocument`, `movePlacement`, `rotatePlacement`, `flipPlacement`, `deletePlacement`. Initial/sync paths set `ratsnest` from `syncSchematicToPcb()` result.
- No `needsRender`, dirty flag, or invalidation flag. `PcbCanvas` uses continuous `requestAnimationFrame` rendering.

**Relevant file paths**

- `src-react/src/stores/pcb-store.ts`
- `src-react/src/components/pcb-editor/pcb-types.ts`
- `src-react/src/components/pcb-editor/schematic-pcb-sync.ts`

**Relevant snippets**

```ts
interface PcbStoreState {
  document: PcbDocument | null;
  ratsnest: RatsnestLine[];
  viewport: PcbViewport;
  activeLayer: "F.Cu" | "B.Cu";
  visibleLayers: Set<string>;
  gridSize: number;
  selectedIds: Set<string>;
  activeTool: "select" | "place";
  // ...actions...
}
```

```ts
function recalculateRatsnest(document: PcbDocument | null): RatsnestLine[] {
  if (!document) return [];
  return calculateRatsnest(
    document.nets,
    document.placements,
    document.traces,
    document.vias,
  );
}
```

```ts
export interface PcbDocument {
  boardOutline: BoardOutline;
  manufacturerPreset: string;
  netClasses: NetClass[];
  nets: PcbNet[];
  placements: PcbPlacement[];
  traces: TraceSegment[];
  vias: Via[];
  zones: CopperZone[];
}
```

**Surprises / planning impact**

- `activeTool` exists in store but there is no setter and no current PCB UI flow using it.
- `setBoardSize()` does not recalc ratsnest; only placement/document mutations do.
- Trace/via/zone data is persisted in the document already, but current UI/store actions are placement-centric.

## 2. PCB canvas — interaction pattern

**Answer**

- Current PCB interaction modes/tools in practice:
  - Implemented: placement select / placement drag / pan / zoom
  - Declared in store: `activeTool: "select" | "place"`
  - Not implemented: routing mode, via placement mode, trace selection mode
- Mouse event flow:
  - `PcbCanvas` DOM handlers receive React mouse events
  - left-click delegates to `usePcbInteractionController.handleMouseDown/Move/Up`
  - controller converts screen → PCB coordinates via `screenToPcb()`
  - controller hit-tests via `hitTestPcb()`
  - controller mutates store via `selectPlacement()`, `clearSelection()`, `movePlacement()`
- Current controller state machine:
  - `idle`
  - `pending_drag` with drag threshold check
  - `dragging`
- A new routing mode would not fit cleanly into the current controller without expanding the state machine and tool dispatch. Right now the controller assumes left-click means placement hit-test/drag behavior.

**Relevant file paths**

- `src-react/src/components/pcb-editor/usePcbInteractionController.ts`
- `src-react/src/components/pcb-editor/canvas/PcbCanvas.tsx`
- `src-react/src/components/pcb-editor/canvas/pcb-hit-test.ts`
- `src-react/src/components/pcb-editor/canvas/pcb-viewport.ts`

**Relevant snippets**

```ts
type InteractionState =
  | { type: "idle" }
  | {
      type: "pending_drag";
      placementId: string;
      startScreen: Point2D;
      startWorld: Point2D;
      originalPosition: Point2D;
    }
  | {
      type: "dragging";
      placementId: string;
      startWorld: Point2D;
      originalPosition: Point2D;
    };
```

```ts
const hit = hitTestPcb(
  store.document.placements,
  worldPoint,
  store.activeLayer,
);

if (hit?.kind === "placement" || hit?.kind === "pad") {
  selectPlacement(placementId);
  stateRef.current = { type: "pending_drag", ... };
} else {
  clearSelection();
}
```

```ts
if (distance >= DRAG_THRESHOLD_PX) {
  stateRef.current = { type: "dragging", ... };
}
```

**Surprises / planning impact**

- PCB controller is much simpler than schematic controller: no tool branching, no session variants beyond dragging.
- Routing mode likely needs either:
  - a larger union state (`routing_preview`, `routing_commit`, etc.), or
  - a tool-dispatch layer before controller behavior.

## 3. PCB canvas — render loop

**Answer**

- `PcbCanvas` has a single `render()` function that calls sub-render helpers:
  - `renderGrid()`
  - `renderBoardOutline()`
  - `renderSilkscreen()`
  - `renderPads()`
  - `renderRatsnest()`
  - `renderSelection()`
- Current draw order:
  1. background fill
  2. grid
  3. board outline
  4. silkscreen/courtyard graphics
  5. pads
  6. ratsnest
  7. selection overlay
- Trace rendering would most naturally fit **after board outline and before silkscreen/pads**, or **between silkscreen and pads** depending on desired copper visibility. Given current visuals, the safest Phase 3 insertion is probably: board outline → traces/vias → silkscreen → pads → ratsnest → selection.
- Viewport transform is applied manually via `pcbToScreen()` / `screenToPcb()` on geometry, not by setting a world transform matrix on the canvas context. DPR scaling is applied once with `ctx.scale(dpr, dpr)`.

**Relevant file paths**

- `src-react/src/components/pcb-editor/canvas/PcbCanvas.tsx`
- `src-react/src/components/pcb-editor/canvas/pcb-viewport.ts`

**Relevant snippets**

```ts
renderGrid(ctx, width, height, vp, store.gridSize);

if (doc) {
  renderBoardOutline(ctx, doc.boardOutline.width, doc.boardOutline.height, vp);
  renderSilkscreen(ctx, doc.placements, vp, store.activeLayer, store.visibleLayers);
  renderPads(ctx, doc.placements, vp, store.activeLayer, store.visibleLayers);
  renderRatsnest(ctx, vp);
  renderSelection(ctx, vp);
}
```

```ts
const loop = () => {
  if (!running) return;
  render();
  rafRef.current = requestAnimationFrame(loop);
};
```

```ts
export function pcbToScreen(pcbX: number, pcbY: number, viewport: PcbViewport): Point2D {
  return {
    x: pcbX * viewport.zoom + viewport.offsetX,
    y: pcbY * viewport.zoom + viewport.offsetY,
  };
}
```

**Surprises / planning impact**

- No trace/via rendering helpers exist yet.
- Continuous RAF means Phase 3 can add preview rendering without inventing a render invalidation system first.

## 4. Ratsnest — current implementation

**Answer**

- Current ratsnest does **not** account for `traces[]` or `vias[]` connectivity. The parameters exist but are unused (`_traces`, `_vias`). It treats nets as pads connected only by a minimum spanning tree over pad positions.
- Function signature:

```ts
export function calculateRatsnest(
  nets: PcbNet[],
  placements: PcbPlacement[],
  _traces: TraceSegment[],
  _vias: Via[],
): RatsnestLine[]
```

- Pad world positions are resolved by:
  - finding the pad in `placement.footprintData.pads`
  - rotating pad local coordinates by `placement.rotation`
  - translating by `placement.position`
- Notably, unlike hit-testing, `resolvePadWorldPosition()` does **not** mirror X for `B.Cu` placements.

**Relevant file paths**

- `src-react/src/components/pcb-editor/ratsnest.ts`

**Relevant snippets**

```ts
function resolvePadWorldPosition(placement: PcbPlacement, padNumber: string): Point2D | null {
  const pad = placement.footprintData.pads.find((p) => p.number === padNumber);
  // rotate, then translate
  return {
    x: placement.position.x + rotatedX,
    y: placement.position.y + rotatedY,
  };
}
```

```ts
export function calculateRatsnest(
  nets: PcbNet[],
  placements: PcbPlacement[],
  _traces: TraceSegment[],
  _vias: Via[],
): RatsnestLine[] {
  // builds MST across pad positions only
}
```

**Surprises / planning impact**

- Phase 3 ratsnest work needs real connectivity graphing if routed copper should suppress unrouted lines.
- Possible bug/inconsistency: back-layer mirroring is handled in hit-testing, but not in ratsnest pad position resolution.

## 5. PcbDocument — current persisted shape

**Answer**

- `PcbDocument` currently is:

```ts
export interface PcbDocument {
  boardOutline: BoardOutline;
  manufacturerPreset: string;
  netClasses: NetClass[];
  nets: PcbNet[];
  placements: PcbPlacement[];
  traces: TraceSegment[];
  vias: Via[];
  zones: CopperZone[];
}
```

- `TraceSegment` is confirmed to have: `id`, `start`, `end`, `width`, `layer`, `net`.
- `Via` is confirmed to have: `id`, `position`, `padDiameter`, `drillDiameter`, `net`, `type`, `layers`, `tented`.
- There are **no net-class-related fields directly on traces or vias**. Net class linkage is indirect through `trace.net` / `via.net` → `PcbNet.netClass`.

**Relevant file paths**

- `src-react/src/components/pcb-editor/pcb-types.ts`

**Relevant snippets**

```ts
export interface TraceSegment {
  id: string;
  start: Point2D;
  end: Point2D;
  width: number;
  layer: string;
  net: string;
}
```

```ts
export interface Via {
  id: string;
  position: Point2D;
  padDiameter: number;
  drillDiameter: number;
  net: string;
  type: "through";
  layers: [string, string];
  tented: boolean;
}
```

**Surprises / planning impact**

- Data model is already good enough for basic routing persistence.
- Design-rule application will need a lookup from net → netClass rather than fields on each trace/via.

## 6. Schematic store — interaction model for undo reference

**Answer**

- Mutations are structured as Zustand store actions that call `set((state) => ...)` inline. There is no external command object layer today.
- There is no existing undo/redo infrastructure in `schematic-store.ts`.
- Main mutating actions in `schematic-store.ts`:
  - Viewport/chrome: `setViewport`, `pan`, `zoomAt`, `resetViewport`, `activateTool`, `setGridSize`, `toggleGrid`, `setGridPreset`, `setPopoverTarget`
  - Placement/session: `beginPlacement`, `setPlacementPreview`, `commitPlacement`, `rotatePlacement`, `cancelSession`, `setPaletteDragSymbolKind`
  - Wire/session: `beginWire`, `addWireWaypoint`, `updateWirePreview`, `commitWire`
  - Drag/move: `beginDragMove`, `updateDragMove`, `commitDragMove`
  - Net label: `beginNetLabelPlacement`, `setNetLabelPreview`, `commitNetLabel`, `updateNetLabelText`
  - Selection/deletion: `selectEntities`, `addToSelection`, `clearSelection`, `selectAll`, `deleteSelectedEntities`
  - Document/library context: `setDocument`, `clearDocument`, `setComponentLibrary`, `setProjectContext`, `setConnectivity`, `setDocumentBounds`, `setHitTestCache`, `updateSymbolValue`
- A command wrapper could intercept these well because nearly all meaningful mutations are centralized store actions. The clean interception seam is around action entry points or around a middleware that snapshots `persisted.document` plus relevant chrome/session state before/after each mutating action.

**Relevant file paths**

- `src-react/src/stores/schematic-store.ts`

**Relevant snippets**

```ts
commitPlacement: (position) =>
  set((state) => {
    // create symbol
    return {
      persisted: { ...state.persisted, document: nextDocument },
      derived: { ...state.derived, connectivity: deriveConnectivity(nextDocument) },
      chrome: { ...state.chrome, activeTool: "select", ...updateSelection([symbol.id], nextDocument) },
      session: null,
    };
  }),
```

```ts
deleteSelectedEntities: () =>
  set((state) => {
    // remove selected symbols/wires/labels and cascade connected wire deletion
    return {
      persisted: { ...state.persisted, document: nextDocument },
      derived: { ...state.derived, connectivity: deriveConnectivity(nextDocument) },
      chrome: { ...state.chrome, selectedEntityIds: new Set(), popoverEntityId: null },
    };
  }),
```

**Surprises / planning impact**

- Toolbar/UI advertises undo/redo elsewhere, but the schematic store itself has no history layer yet.
- Some actions mutate only chrome/session; Phase 3 needs a decision on whether undo should include transient UI/tool state or only document state.

## 7. Keyboard event handling — current state

**Answer**

- Keyboard events are currently handled by a **window-level `keydown` listener** inside `DesignScreen.tsx`.
- Current shortcuts in this file:
  - `Escape`
    - if a properties popover is open and text entry is not focused: close popover
    - else: `controller.cancelSession()` (schematic interaction controller)
  - `Delete` / `Backspace`
    - if text entry is not focused and schematic selection is non-empty: `store.deleteSelectedEntities()`
    - `Backspace` also calls `preventDefault()`
- There is no keyboard utility abstraction here; handler is inline in `DesignScreen`.
- It does **not** explicitly branch on schematic vs PCB tab inside the keydown handler. It always talks to schematic store/controller. Tab distinction is only in conditional rendering (`designTab === "schematic"` vs `designTab === "pcb"`).

**Relevant file paths**

- `src-react/src/screens/DesignScreen.tsx`

**Relevant snippets**

```ts
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // close popover or cancel schematic session
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      const store = useSchematicStore.getState();
      if (store.chrome.selectedEntityIds.size > 0) {
        store.deleteSelectedEntities();
      }
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [controller, popoverEntityId, setPopoverTarget]);
```

**Surprises / planning impact**

- PCB currently inherits no dedicated keyboard handling path.
- If Phase 3 adds PCB delete/route shortcuts, this file likely needs explicit tab-aware dispatch or a shared keyboard routing layer.

## 8. Trace deletion — current capability

**Answer**

- There is currently **no trace or via deletion path**.
- There is no current way to select traces or vias in PCB view.
- PCB hit-testing only returns:
  - `placement`
  - `pad`
  - `null`
- PCB selection state (`selectedIds`) is effectively placement selection only.
- Current PCB deletion capability is limited to component placements:
  - select placement on canvas
  - delete via PCB sidebar button `Delete component`
- There is no PCB delete-key handler in `DesignScreen` or `PcbCanvas`.

**Relevant file paths**

- `src-react/src/components/pcb-editor/canvas/pcb-hit-test.ts`
- `src-react/src/components/pcb-editor/usePcbInteractionController.ts`
- `src-react/src/components/pcb-editor/PcbSidebar.tsx`
- `src-react/src/screens/DesignScreen.tsx`

**Relevant snippets**

```ts
export type PcbHitTarget =
  | { kind: "placement"; placementId: string }
  | { kind: "pad"; placementId: string; padNumber: string }
  | null;
```

```ts
const deletePlacement = usePcbStore((state) => state.deletePlacement);
// ...
onClick={() => deletePlacement(selectedPlacement.id)}
```

**Surprises / planning impact**

- Phase 3 needs all of: render support, hit-test support, selection model changes, store delete actions, and keyboard/UI wiring. Trace deletion is not just a missing button.
