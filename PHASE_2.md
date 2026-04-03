# PHASE 2 — PCB View, Net Extraction & Schematic↔PCB Bridge

**Scope**: Full netlist extraction from schematic, net labels in schematic editor, PCB canvas with component placement + ratsnest, front/back layer support, auto-sync on tab switch, persist PCB layout in design bundle, future-proof PCB data model.

**Acceptance criteria**:

1. Schematic editor supports **net labels** — placeable text entities on wire endpoints that name a net. Pins sharing the same net label are electrically connected.
2. **Net extraction algorithm** derives full pin-to-pin electrical connectivity from wires, junctions, and net labels. Populates the existing `DerivedNet` type.
3. **PCB canvas** renders footprint pads + silkscreen outlines + board outline on a dark background with KiCad-standard layer colors.
4. **Component placement** on PCB: drag to position, rotate, flip between front/back copper layers, snap to grid (mm units, 0.254mm default).
5. **Ratsnest lines** show unrouted connections as thin airwires, computed via MST algorithm.
6. **Auto-sync**: switching to PCB tab regenerates placements from the current schematic state.
7. **Persistence**: design save migrates to `ProjectDocumentBundle` format, storing both schematic and PCB data.
8. **PCB data model** is future-proof: includes empty `traces[]`, `vias[]`, `zones[]` arrays, `NetClass` definitions (Default + Power), and a manufacturer preset name for design rules.

**Out of scope**: Trace routing, via placement, DRC, copper zones, Gerber export, undo/redo, keyboard shortcuts beyond basic interaction.

---

## Architecture decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Canvas renderer | **Separate `PcbCanvas.tsx`**, reuse `viewport.ts` math | Viewport transforms are generic. Hit-testing and rendering are too different to share. |
| Coordinate units | **Millimeters** | PCB industry standard. Schematic uses nanometer-scale; PCB is independent. |
| Grid default | **0.254mm (10mil)** | Standard routing grid per research. Configurable. |
| Layer colors | **KiCad standard** (red=F.Cu, blue=B.Cu) | Familiar to target users. Dark board background (#1a1a1a). |
| Footprint rendering | **Pads + silkscreen outlines** | Pads show copper; silkscreen shows component shape. Courtyard deferred. |
| Sync strategy | **Full re-sync on tab switch** | Simpler than incremental diff. Regenerate all placements from schematic. Preserve user positions where component still exists. |
| Persistence | **Migrate to `ProjectDocumentBundle`** | Schema already exists with schematic + pcb slots. Clean migration. |
| PCB data model | **Future-proof** with empty arrays for traces, vias, zones | Avoids data model rewrite when routing is added. |
| Net classes | **Default + Power** included in model | Enables different trace widths per net class when routing comes. |
| Design rules | **Store manufacturer preset name only** | No DRC in Phase 2. Full `DesignRules` expansion deferred. |
| Net label UX | **Click to place on wire endpoint**, then name inline | Consistent with component placement UX. |
| Ratsnest algorithm | **MST via Kruskal's + Union-Find** | Standard approach per research, KiCad does the same. |
| Board outline | **User sets width × height via form** | Simple rectangle. DXF import deferred. |
| Background | **Dark (#1a1a1a) board area** | Standard for PCB tools. Layer colors are designed for dark backgrounds. |

---

## Work breakdown

Phase 2 contains **7 milestones** in 3 workstreams.

```
WORKSTREAM A — Schematic connectivity
  M1: Net labels (schematic entity)
  M2: Net extraction algorithm

WORKSTREAM B — PCB canvas & store
  M3: PCB data model + store
  M4: PCB canvas renderer
  M5: Component placement interactions

WORKSTREAM C — Bridge & persistence
  M6: Persistence migration (ProjectDocumentBundle)
  M7: Auto-sync bridge + ratsnest

Dependency graph:
  M1 ──→ M2 ──→ M7
  M3 ──→ M4 ──→ M5 ──→ M7
  M6 ──→ M7
```

Workstreams A and B can progress in parallel. M7 (bridge) depends on all others.

---

## M1 — Net labels in schematic editor

**Goal**: Add net labels as a new entity type in the schematic editor. A net label is placed on a wire endpoint and assigns a net name. Two pins connected to wires with the same net label are electrically connected even without a direct wire path.

**Estimated effort**: 2–3 days

### Data model

Add to `src-ts/shared/types/pcb.types.ts`:

```typescript
interface SchematicNetLabel {
  id: string;
  name: string;              // e.g. "SDA", "VCC", "GPIO_4"
  position: ProjectPoint;    // must coincide with a wire endpoint or pin
  rotation?: number;         // 0, 90, 180, 270
}
```

The `SchematicProjectDocument` already has a `labels` array (per the exploration: schema includes `labels: z.array(SchematicLabelSchema)`). Verify whether this existing `labels` field is for net labels or generic text. If it's generic text, add `netLabels` as a separate field.

### Tasks

#### M1.1 — Define net label entity type

- **File**: `src-ts/shared/types/pcb.types.ts` + `src-ts/src/core/schemas/pcb-project.schema.ts`
- **Action**: Add `SchematicNetLabel` type. Add to document schema. Verify the existing `labels` field — if it's already `SchematicLabelSchema` with a `name` field, reuse it; if not, add `netLabels[]`.
- **File**: `src-react/src/components/pcb/types.ts`
- **Action**: Add `NetLabelEntity` runtime type with `entityType: "netLabel"`.

#### M1.2 — Net label rendering

- **File**: `src-react/src/components/pcb/canvas/SchematicCanvas.tsx` (or a new `net-labels.ts` render module)
- **Action**: Draw net labels in the render loop. Visual style:
  - Small text label at the position
  - Short horizontal line or flag shape (standard EDA convention)
  - Color: distinct from wires (e.g. teal/green)
  - Render after wires, before selection overlays
- **Draw order update**: grid → wires → junctions → **net labels** → symbols → placement preview → wire preview → selection overlays

#### M1.3 — Net label placement interaction

- **File**: `src-react/src/stores/schematic-store.ts` + interaction controller
- **Action**:
  - Add `netLabel` as a new tool mode alongside `placement`, `wire`, `select`
  - Placement flow:
    1. User activates "Net Label" tool (from palette or toolbar)
    2. Click on canvas → places net label at snapped position
    3. Inline text input appears at the label position → user types net name → Enter confirms
    4. If clicked on a wire endpoint or pin, the label snaps to that coordinate
  - Store actions: `beginNetLabelPlacement()`, `commitNetLabel(name, position)`, `deleteNetLabel(id)`
  - Net labels are selectable, draggable, deletable like other entities

#### M1.4 — Net label in palette/toolbar

- **File**: `src-react/src/components/pcb/palette/ComponentPalette.tsx` or toolbar
- **Action**: Add a "Net Label" button/entry that activates net label placement mode. Can be in the palette alongside GND/VCC/Resistor, or in the toolbar above the canvas.

#### M1.5 — Hit testing for net labels

- **File**: `src-react/src/components/pcb/canvas/hit-test.ts`
- **Action**: Add hit test for net labels. Hit target type: `{ kind: "netLabel"; labelId: string }`. Test against label text bounds.

#### M1.6 — Net label persistence

- **File**: serialization functions in `src-react/src/components/pcb/types.ts`
- **Action**: Include net labels in `toSchematicProjectDocument()` and `toEditorSchematicSymbol()` (or equivalent document serializer/deserializer).

### Acceptance

- [ ] User can place a net label on the schematic canvas
- [ ] User can type a net name for the label
- [ ] Net labels render visibly on the canvas
- [ ] Net labels are selectable, draggable, deletable
- [ ] Net labels persist in saved documents
- [ ] Loading a document with net labels restores them

---

## M2 — Net extraction algorithm

**Goal**: Implement full electrical connectivity extraction from the schematic document. Populate the existing `DerivedNet` type. This is the foundation for ratsnest calculation in the PCB view.

**Estimated effort**: 2–3 days

### Algorithm overview

```
Input:  symbols[] with pins, wires[] with points + pin IDs, netLabels[]
Output: DerivedNet[] — each net is a group of electrically connected pins

Steps:
1. Build a graph of all connection points (pin world positions + wire endpoints)
2. Add edges from wire pin references (sourcePinId → targetPinId)
3. Add edges from coordinate overlap (wire endpoint matches pin position)
4. Add edges from junction sharing (wire endpoints at same coordinate)
5. Merge groups that share a net label name
6. Name each net (from net label, or "Net_N" auto-name)
7. Identify power nets (GND, VCC pins create implicit named nets)
```

### Tasks

#### M2.1 — Implement net extraction function

- **File**: new file `src-react/src/components/pcb/canvas/net-extraction.ts`
- **Action**:

```typescript
interface ExtractedNet {
  id: string;
  name: string | null;      // from net label, or null for auto-naming
  pinIds: string[];          // pin IDs (format: "symbolId-pin-N")
  symbolIds: string[];       // symbol IDs that participate
  wireIds: string[];         // wire IDs in this net
  labelIds: string[];        // net label IDs
}

function extractNets(
  symbols: EditorSchematicSymbol[],
  wires: WireEntity[],
  netLabels: NetLabelEntity[]
): ExtractedNet[]
```

- **Implementation**:
  1. Create Union-Find with all pin IDs as initial elements
  2. For each wire: union `sourcePinId` and `targetPinId` (if both are valid pin references)
  3. For each wire endpoint without a pin reference: find nearest pin by coordinate matching (exact match using `${x}:${y}` key, matching the existing junction strategy)
  4. For junctions (multiple wire endpoints at same coordinate): union all pins connected through those wires
  5. For net labels: find the pin or wire endpoint at the label's position, record the label name for that group
  6. For net labels with the same name: merge their groups (this creates named connections across distance)
  7. For power symbols (GND, VCC): treat pin names as implicit net labels — all GND pins share the "GND" net, all VCC pins share the "VCC" net
  8. Collect groups → produce `ExtractedNet[]`
  9. Auto-name unnamed nets as `Net_1`, `Net_2`, etc.

#### M2.2 — Union-Find utility

- **File**: new file `src-react/src/lib/union-find.ts`
- **Action**: Implement Union-Find with path compression and union by rank.

```typescript
class UnionFind {
  constructor(size: number);
  find(x: number): number;
  union(x: number, y: number): void;
  connected(x: number, y: number): boolean;
  groups(): Map<number, number[]>;
}
```

#### M2.3 — Integrate into schematic store

- **File**: `src-react/src/stores/schematic-store.ts`
- **Action**:
  - Update `deriveConnectivity()` to call `extractNets()` and populate `nets` (currently always `[]`)
  - The `DerivedNet` type already exists in `src-react/src/components/pcb/types.ts`:
    ```typescript
    interface DerivedNet {
      id: string;
      name: string | null;
      symbolIds: string[];
      wireIds: string[];
      labelIds: string[];
    }
    ```
  - Extend it to also include `pinIds: string[]` (needed for ratsnest)
  - Recompute nets whenever the document changes (same trigger as junction derivation)

#### M2.4 — Power symbol implicit nets

- **File**: `src-react/src/components/pcb/canvas/net-extraction.ts`
- **Action**:
  - Detect power symbols by checking if the placed component's `canonicalKey` starts with `builtin:gnd` or `builtin:vcc` (or by checking `symbolData.referencePrefix === "#PWR"`)
  - All GND symbol pins automatically join the `"GND"` net
  - All VCC symbol pins automatically join the `"VCC"` net
  - This means placing two GND symbols on the schematic without any wire between them still creates a single GND net

#### M2.5 — Tests

- **File**: new test file `src-react/src/components/pcb/canvas/net-extraction.test.ts`
- **Tests**:
  - Two pins connected by one wire → same net
  - Chain: A→B→C through two wires → all in one net
  - T-junction: three wires meeting at a point → all connected
  - Net label: two separate wire groups with same label name → merged into one net
  - Power symbols: two GND symbols → one "GND" net
  - Disconnected pins → separate nets
  - Mixed: some pins connected by wires, some by net labels, some by power symbols

### Acceptance

- [ ] `extractNets()` correctly identifies all electrically connected groups
- [ ] Wire-based connectivity works (pin ID references + coordinate matching)
- [ ] Net labels merge disconnected groups with the same name
- [ ] Power symbols create implicit named nets
- [ ] `derived.connectivity.nets` is populated in schematic store
- [ ] All tests pass

---

## M3 — PCB data model + store

**Goal**: Define the PCB document data model (future-proof) and create the Zustand store for PCB editor state.

**Estimated effort**: 2–3 days

### PCB document model

```typescript
// New file: src-react/src/components/pcb-editor/pcb-types.ts

interface Point2D {
  x: number;  // mm
  y: number;  // mm
}

// === Net classes ===

interface NetClass {
  name: string;             // "Default", "Power"
  traceWidth: number;       // mm, default trace width
  clearance: number;        // mm, clearance to other nets
  viaDiameter: number;      // mm, via pad size
  viaDrill: number;         // mm, via drill size
}

// === PCB Net (resolved from schematic) ===

interface PcbNet {
  id: string;
  name: string;             // "GND", "VCC", "Net_1"
  netClass: string;         // references a NetClass name
  padRefs: PadReference[];  // all pads in this net
}

interface PadReference {
  componentId: string;      // PCB component placement ID
  padNumber: string;        // "1", "2", etc.
}

// === Placed component ===

interface PcbPlacement {
  id: string;
  schematicSymbolId: string;  // back-reference to schematic
  componentId: string;        // library component ID
  variantId: string;
  footprintOptionId: string;
  reference: string;          // "R1", "C3"
  value: string;              // "10k", "100nF"
  position: Point2D;
  rotation: number;           // degrees
  layer: "F.Cu" | "B.Cu";    // which side
  footprintData: ParsedKicadFootprint;  // resolved footprint for rendering
}

// === Routing objects (empty for Phase 2, future-proof) ===

interface TraceSegment {
  id: string;
  start: Point2D;
  end: Point2D;
  width: number;              // mm
  layer: string;
  net: string;
}

interface Via {
  id: string;
  position: Point2D;
  padDiameter: number;
  drillDiameter: number;
  net: string;
  type: "through";
  layers: [string, string];
  tented: boolean;
}

interface CopperZone {
  id: string;
  net: string;
  layer: string;
  priority: number;
  outline: Point2D[];
  fillType: "solid" | "hatched" | "none";
  clearance: number;
  minWidth: number;
  padConnection: "thermal" | "direct" | "none";
}

// === Board ===

interface BoardOutline {
  width: number;   // mm
  height: number;  // mm
}

// === Complete PCB document ===

interface PcbDocument {
  boardOutline: BoardOutline;
  manufacturerPreset: string;       // "jlcpcb_standard", "conservative"
  netClasses: NetClass[];
  nets: PcbNet[];
  placements: PcbPlacement[];
  traces: TraceSegment[];           // empty for Phase 2
  vias: Via[];                      // empty for Phase 2
  zones: CopperZone[];              // empty for Phase 2
}
```

### Layer color constants

```typescript
// New file: src-react/src/components/pcb-editor/layer-colors.ts

const LAYER_COLORS: Record<string, string> = {
  "F.Cu":      "#FF3333",  // Red
  "B.Cu":      "#3333FF",  // Blue
  "F.SilkS":   "#F0F0F0",  // White
  "B.SilkS":   "#F0F0F0",  // White
  "F.Mask":    "#800080",  // Purple
  "B.Mask":    "#800080",  // Purple
  "F.CrtYd":   "#888888",  // Gray
  "Edge.Cuts": "#FFD700",  // Gold
  "ratsnest":  "#66CCFF",  // Light blue
};

const PCB_BACKGROUND = "#1a1a1a";
```

### Default net classes

```typescript
const DEFAULT_NET_CLASSES: NetClass[] = [
  {
    name: "Default",
    traceWidth: 0.25,
    clearance: 0.2,
    viaDiameter: 0.6,
    viaDrill: 0.3,
  },
  {
    name: "Power",
    traceWidth: 0.5,
    clearance: 0.2,
    viaDiameter: 0.8,
    viaDrill: 0.4,
  },
];
```

### Tasks

#### M3.1 — Create PCB type definitions

- **File**: new `src-react/src/components/pcb-editor/pcb-types.ts`
- **Action**: Define all interfaces listed above.

#### M3.2 — Create layer colors + constants

- **File**: new `src-react/src/components/pcb-editor/layer-colors.ts`
- **Action**: Define color map, background color, default net classes, grid presets.
- Grid presets for PCB:
  ```typescript
  const PCB_GRID_PRESETS = [
    { label: "1.27mm (50mil)", size: 1.27 },
    { label: "0.635mm (25mil)", size: 0.635 },
    { label: "0.254mm (10mil)", size: 0.254 },   // default
    { label: "0.127mm (5mil)", size: 0.127 },
    { label: "0.1mm", size: 0.1 },
  ];
  ```

#### M3.3 — Create PCB Zustand store

- **File**: new `src-react/src/stores/pcb-store.ts`
- **Action**:

```typescript
interface PcbStoreState {
  // Persisted
  document: PcbDocument | null;

  // Derived (computed, not saved)
  ratsnest: RatsnestLine[];

  // Chrome (UI state)
  viewport: Viewport;
  activeLayer: "F.Cu" | "B.Cu";
  visibleLayers: Set<string>;
  gridSize: number;           // mm, default 0.254
  selectedIds: Set<string>;   // selected placement IDs
  activeTool: "select" | "place";

  // Actions
  initFromSchematic(nets: ExtractedNet[], components: SchematicComponent[], library: ComponentLibrary): void;
  setDocument(doc: PcbDocument): void;
  movePlacement(id: string, position: Point2D): void;
  rotatePlacement(id: string, delta: number): void;
  flipPlacement(id: string): void;
  selectPlacement(id: string): void;
  clearSelection(): void;
  setBoardSize(width: number, height: number): void;
  setGridSize(size: number): void;
  setActiveLayer(layer: "F.Cu" | "B.Cu"): void;
  toggleLayerVisibility(layer: string): void;
}
```

#### M3.4 — Ratsnest calculation

- **File**: new `src-react/src/components/pcb-editor/ratsnest.ts`
- **Action**: Implement MST-based ratsnest calculation per the research.

```typescript
interface RatsnestLine {
  start: Point2D;
  end: Point2D;
  netId: string;
}

function calculateRatsnest(
  nets: PcbNet[],
  placements: PcbPlacement[],
  traces: TraceSegment[],    // empty for Phase 2, but API ready
  vias: Via[]                // empty for Phase 2
): RatsnestLine[]
```

- Implementation:
  1. For each net with 2+ pads: resolve pad world positions from placements
  2. Build MST using Kruskal's algorithm with Union-Find
  3. Each MST edge = one ratsnest line
  4. (When traces exist in future: remove MST edges where traces already connect the pads)
- Reuse the `UnionFind` class from M2.

### Acceptance

- [ ] PCB type definitions compile cleanly
- [ ] PCB store initializes with default state
- [ ] Ratsnest calculation produces correct MST lines for test cases
- [ ] Store actions (move, rotate, flip, select) update state correctly

---

## M4 — PCB canvas renderer

**Goal**: Implement the PCB canvas component that renders footprint pads, silkscreen outlines, board outline, ratsnest, and selection highlights on a dark background.

**Estimated effort**: 3–4 days

### Render order (back to front)

1. Dark background fill (#1a1a1a)
2. Board outline (gold rectangle)
3. Back copper pads (blue, dimmed if not active layer)
4. Back silkscreen (white, dimmed)
5. Front copper pads (red)
6. Front silkscreen (white)
7. Drill holes (dark circles on through-hole pads)
8. Ratsnest lines (light blue, thin)
9. Selection highlights
10. Placement preview (during drag)

### Tasks

#### M4.1 — Create PcbCanvas component

- **File**: new `src-react/src/components/pcb-editor/canvas/PcbCanvas.tsx`
- **Action**:
  - Single `<canvas>` element, full container width/height
  - DPR-aware sizing (same pattern as `SchematicCanvas`)
  - `ResizeObserver` for container
  - RAF render loop (follow existing `SchematicCanvas` pattern for consistency)
  - Read state from `usePcbStore`

#### M4.2 — Viewport for PCB (mm-based)

- **File**: new `src-react/src/components/pcb-editor/canvas/pcb-viewport.ts`
- **Action**:
  - Reuse the math from `viewport.ts` (`screenToWorld`, `worldToScreen`, `snapToGrid`)
  - Key difference: units are millimeters, not nanometers
  - `snapToGrid` already accepts configurable `gridSize` — works as-is
  - `fitViewportToBounds` needs a new default fallback for PCB (e.g. 100mm instead of 2,540,000nm)
  - **Recommendation**: create a thin wrapper that calls the same math but with mm-scale defaults.

#### M4.3 — Board outline rendering

- **Action**: Draw a rectangle at (0, 0) to (width, height) using `Edge.Cuts` color (#FFD700), 0.1mm stroke.
- Fill the board interior with a slightly lighter shade (#2a2a2a) to distinguish board from background.

#### M4.4 — Pad rendering

- **File**: new `src-react/src/components/pcb-editor/canvas/pcb-pads.ts`
- **Action**: Render pads from `PcbPlacement.footprintData.pads[]`.

For each pad in a placement:
1. Compute world position: apply placement rotation + translation to pad's local position
2. Select color based on pad's layer (`F.Cu` → red, `B.Cu` → blue, through-hole → both)
3. Dim pads on inactive layer (multiply alpha by 0.3)
4. Draw shape based on `pad.shape`:
   - `circle`: `ctx.arc()`
   - `rect`: `ctx.fillRect()` with rotation
   - `oval`: `ctx.ellipse()` or rounded rect
   - `roundrect`: `ctx.roundRect()` using `pad.roundrectRatio`
5. For through-hole pads: draw drill hole as dark circle on top

Use the research's pad rendering code as reference — it provides exact Canvas2D calls for each shape.

#### M4.5 — Silkscreen rendering

- **File**: new `src-react/src/components/pcb-editor/canvas/pcb-silkscreen.ts`
- **Action**: Render silkscreen graphics from `PcbPlacement.footprintData.graphics[]`.
- Filter for `layer === "F.SilkS"` or `"B.SilkS"` graphics
- Render types:
  - `line`: draw line from `data.start` to `data.end` with `data.width` stroke
  - `rect`: draw rectangle outline
  - `circle`: draw circle outline
  - `arc`: draw arc (may be complex — simplify or skip arcs for Phase 2 if needed)
  - `text`: render reference designator text (optional for Phase 2)
- Apply placement transform (rotation + translation) to all graphic coordinates
- Color: white (#F0F0F0) for front silkscreen, dimmed for back
- **Risk**: the `graphics[].data` format is not strongly typed (`Record<string, unknown>`). The exploration showed examples like `{ start: [-1, 0.625], end: [-1, -0.625], width: 0.1 }`. Parse defensively.

#### M4.6 — Ratsnest rendering

- **Action**: Draw ratsnest lines from `pcbStore.ratsnest`.
- Style: thin (0.5px screen-space, not world-space), light blue (#66CCFF), dashed.
- Ratsnest lines don't scale with zoom — always 1px apparent width.

#### M4.7 — Grid rendering

- **Action**: Draw grid dots or lines at the current grid spacing.
- Only render grid within the visible viewport area (performance).
- Grid color: subtle (#333333 on #1a1a1a background).
- Fade grid out when zoomed too far out (too many lines).

#### M4.8 — Selection rendering

- **Action**: Highlight selected placements with a bright outline or glow.
- Show selection handles at corners for rotation reference.

### Acceptance

- [ ] PcbCanvas renders on the PCB tab with dark background
- [ ] Board outline visible as gold rectangle
- [ ] Footprint pads render with correct shapes, sizes, positions, and colors
- [ ] Silkscreen outlines visible (component shapes)
- [ ] Through-hole drill holes visible
- [ ] Front/back layer color distinction works
- [ ] Ratsnest lines render between unconnected pads
- [ ] Grid renders at correct spacing
- [ ] Zoom/pan works

---

## M5 — Component placement interactions

**Goal**: Users can select, drag, rotate, and flip components on the PCB canvas. Grid snapping applies.

**Estimated effort**: 2–3 days

### Tasks

#### M5.1 — PCB hit testing

- **File**: new `src-react/src/components/pcb-editor/canvas/pcb-hit-test.ts`
- **Action**:
  - Hit test against placement bounding boxes (computed from footprint pads extent + silkscreen extent)
  - Hit target types:
    ```typescript
    type PcbHitTarget =
      | { kind: "placement"; placementId: string }
      | { kind: "pad"; placementId: string; padNumber: string }
      | null;
    ```
  - Test pads first (smaller targets, higher priority), then placement bodies
  - For Phase 2, pad hits are informational only (no routing). Placement hits enable selection/drag.

#### M5.2 — PCB interaction controller

- **File**: new `src-react/src/components/pcb-editor/usePcbInteractionController.ts`
- **Action**:
  - State machine: `idle` → `dragging` (with drag threshold)
  - Mouse events wired on `PcbCanvas`:
    - Click: select/deselect placement
    - Click + drag: move selected placement(s)
    - All positions snapped to grid
  - Integration with `usePcbStore` actions

#### M5.3 — Rotation

- **Action**: When a placement is selected, user can rotate it.
- For Phase 2, trigger via right-click context menu or a toolbar button (keyboard shortcuts are Phase 3).
- Rotation increments: 90° steps.
- Store action: `rotatePlacement(id, 90)` or `rotatePlacement(id, -90)`.
- Rotation applies to the placement's `rotation` field. All pad/graphic positions are recomputed from footprint data + rotation transform on next render.

#### M5.4 — Flip (front ↔ back)

- **Action**: Flip a component from `F.Cu` to `B.Cu` or vice versa.
- Trigger: context menu "Flip to back" / "Flip to front", or toolbar button.
- Store action: `flipPlacement(id)` toggles `placement.layer`.
- Rendering: when a component is on `B.Cu`:
  - Pads render in blue instead of red
  - Silkscreen uses `B.SilkS` graphics
  - Component is mirrored horizontally (standard PCB convention: back-side components are X-mirrored)
  - If back layer is dimmed (not active), the component appears dimmed

#### M5.5 — Board size form

- **File**: new `src-react/src/components/pcb-editor/BoardSizeForm.tsx`
- **Action**:
  - Small form (can be in a toolbar area or floating panel):
    - Width (mm) input
    - Height (mm) input
    - Defaults: 100mm × 100mm
  - Updates `pcbStore.document.boardOutline`
  - Board outline re-renders immediately

#### M5.6 — Layer switcher

- **File**: toolbar or panel component
- **Action**:
  - Show active layer indicator (F.Cu / B.Cu)
  - Click to toggle active layer
  - Toggle visibility of each layer (F.Cu, B.Cu, F.SilkS, B.SilkS)
  - When a layer is inactive, its content renders dimmed (alpha 0.3)

### Acceptance

- [ ] Click to select a component on PCB
- [ ] Drag to move, snaps to grid
- [ ] Rotate selected component (90° increments)
- [ ] Flip component between front and back
- [ ] Back-side components render mirrored and in blue
- [ ] Board size adjustable via form
- [ ] Layer visibility toggle works
- [ ] Active layer indicator visible

---

## M6 — Persistence migration (ProjectDocumentBundle)

**Goal**: Migrate design persistence from schematic-only `SchematicProjectDocument` to the full `ProjectDocumentBundle` format that stores both schematic and PCB data.

**Estimated effort**: 2–3 days

### Current state

- `design_sheet.content` stores `SchematicProjectDocument` (typed, strict schema)
- `DesignService.saveSheetContent()` accepts `SchematicProjectDocument`
- `ProjectDocumentBundleSchema` already exists with `schematic` + `pcb` slots

### Target state

- `design_sheet.content` stores `ProjectDocumentBundle`
- Bundle contains `{ formatVersion, docs: { schematic, pcb } }`
- Save/load handles both old format (schematic only) and new format (bundle)

### Tasks

#### M6.1 — Update save path

- **File**: `src-ts/src/domain/services/design-service.ts`
- **Action**:
  - Change `saveSheetContent()` to accept `ProjectDocumentBundle` instead of `SchematicProjectDocument`
  - Serialize the full bundle to JSON and store in `content` column
  - Update the type assertion on `design_sheet.content`
- **File**: `src-ts/src/db/schema/design-sheet.ts`
- **Action**: Change the `$type` on `content` column from `SchematicProjectDocument` to `ProjectDocumentBundle`

#### M6.2 — Update load path with backward compat

- **File**: `src-ts/src/domain/services/design-service.ts`
- **Action**:
  - When loading `content`, detect format:
    - If content has `docs.schematic` → it's a bundle, use directly
    - If content has `symbols` and `wires` (top-level) → it's old `SchematicProjectDocument`, wrap in bundle:
      ```typescript
      { formatVersion: "1.0", docs: { schematic: oldContent, pcb: null } }
      ```
  - This ensures old saved designs load correctly

#### M6.3 — Add PcbProjectDocument schema

- **File**: `src-ts/src/core/schemas/pcb-project.schema.ts`
- **Action**: Verify/update `PcbProjectDocumentSchema` to match the `PcbDocument` interface from M3. The schema already exists but may not match the Phase 2 model. Update fields:
  - `boardOutline`, `manufacturerPreset`, `netClasses`, `nets`, `placements`, `traces`, `vias`, `zones`
  - All routing arrays (`traces`, `vias`, `zones`) should default to `[]`

#### M6.4 — Update frontend save/load

- **File**: `src-react/src/stores/schematic-store.ts` (or wherever save/load is triggered)
- **Action**:
  - On save: construct `ProjectDocumentBundle` from current schematic document + current PCB document (from `usePcbStore`)
  - On load: destructure bundle into schematic document (→ schematic store) and PCB document (→ PCB store)
  - If PCB document is null (old save or no PCB work done), PCB store initializes empty

#### M6.5 — Update DesignScreen integration

- **File**: `src-react/src/screens/DesignScreen.tsx`
- **Action**: Wire the PCB store initialization from loaded bundle data. When a design is loaded:
  1. Parse bundle
  2. Load `docs.schematic` into schematic store (existing path)
  3. Load `docs.pcb` into PCB store (new path, or null → empty state)

### Acceptance

- [ ] Saving a design produces a `ProjectDocumentBundle` with both schematic and PCB slots
- [ ] Loading an old-format design (schematic only) still works — auto-wrapped in bundle
- [ ] Loading a new-format design restores both schematic and PCB state
- [ ] PCB placement positions survive save/load cycle
- [ ] No data loss for existing saved designs

---

## M7 — Auto-sync bridge + ratsnest

**Goal**: When the user switches to the PCB tab, automatically generate/update PCB placements from the current schematic state. Show ratsnest lines for all unrouted nets.

**Estimated effort**: 2–3 days

### Sync algorithm

```
On tab switch to "pcb":
  1. Run net extraction on current schematic document (M2)
  2. Collect all placed schematic symbols that have a componentId + variantId
  3. For each symbol:
     a. Resolve footprint data from component library (variant → footprintOption → kicadPayload)
     b. Check if a PcbPlacement already exists for this symbol (match by schematicSymbolId)
     c. If exists: keep existing position/rotation/layer, update footprint data if variant changed
     d. If new: create placement at auto-layout position (clustered near board center)
  4. Remove PcbPlacements for symbols that no longer exist in schematic
  5. Build PcbNet[] from extracted nets + resolved pad positions
  6. Assign net classes: "GND"/"VCC" nets → "Power" class, others → "Default"
  7. Calculate ratsnest from PcbNet[]
  8. Update pcbStore with new document
```

### Tasks

#### M7.1 — Implement sync function

- **File**: new `src-react/src/components/pcb-editor/schematic-pcb-sync.ts`
- **Action**:

```typescript
interface SyncResult {
  placements: PcbPlacement[];
  nets: PcbNet[];
  ratsnest: RatsnestLine[];
  added: string[];      // refs of newly added components
  removed: string[];    // refs of removed components
}

function syncSchematicToPcb(
  schematicSymbols: EditorSchematicSymbol[],
  extractedNets: ExtractedNet[],
  componentLibrary: ComponentLibraryIndex,
  existingPcbDoc: PcbDocument | null,
  boardOutline: BoardOutline
): SyncResult
```

#### M7.2 — Auto-layout for new components

- **Action**: When new components are added (no existing placement), place them in a cluster:
  - Start at board center
  - Offset each new component by its footprint bounding box + 2mm gap
  - Simple grid-packing: fill a row, then start next row
  - This is rough placement — user will drag them into position

#### M7.3 — Footprint resolution from library

- **Action**: For each schematic symbol with `componentId` + `variantId`:
  1. Look up component in library index
  2. Find variant by `variantId`
  3. Get default footprint option → `kicadPayload`
  4. Cast `kicadPayload` to `ParsedKicadFootprint` (runtime cast — it's stored as `Record<string, unknown>` but is structurally `ParsedKicadFootprint`)
  5. If resolution fails (missing component/variant), skip the placement (log warning)

#### M7.4 — Wire sync trigger into tab switching

- **File**: `src-react/src/screens/DesignScreen.tsx`
- **Action**:
  - Add a `useEffect` that watches `designTab`
  - When `designTab` changes to `"pcb"`:
    1. Get current schematic document from `useSchematicStore`
    2. Get current component library index
    3. Run `extractNets()` on schematic document
    4. Run `syncSchematicToPcb()` with extracted nets + existing PCB document
    5. Update `usePcbStore` with sync result
  - Also recalculate ratsnest after sync

#### M7.5 — Replace PCB tab placeholder with canvas

- **File**: `src-react/src/screens/DesignScreen.tsx`
- **Action**: Replace the "PCB layout editor — coming soon" placeholder with:
  ```tsx
  {design && designTab === "pcb" && (
    <div className="relative h-full">
      <PcbCanvas />
      <BoardSizeForm />
      <LayerSwitcher />
    </div>
  )}
  ```
- Also: conditionally render a PCB-specific toolbar (or adapt existing toolbar) when in PCB tab. The existing `EditorToolbar` is schematic-specific — either hide it for PCB tab or create a `PcbToolbar`.

#### M7.6 — Pad-to-net assignment

- **Action**: After sync, each `PcbPlacement` pad needs a net assignment for ratsnest to work.
- The mapping is: schematic symbol pin → net (from `ExtractedNet.pinIds`) → pad number (pin number maps to pad number from `symbolData.pinDefinitions`)
- Build a `padNetMap: Map<string, string>` that maps `"placementId:padNumber"` → `netId`
- Store this in `PcbNet.padRefs`

### Acceptance

- [ ] Switching to PCB tab populates placements from schematic
- [ ] Each placed schematic component with a variant becomes a PCB placement
- [ ] New components get auto-placed near board center
- [ ] Removed schematic components disappear from PCB
- [ ] Ratsnest lines appear between unconnected pads in the same net
- [ ] Power symbols (GND, VCC) do NOT create PCB placements (they have no footprint)
- [ ] Switching back and forth between tabs preserves PCB positions
- [ ] Saving and reloading preserves PCB layout

---

## Test strategy

### Automated tests

| Area | Test file | What to verify |
|------|-----------|---------------|
| Net extraction | `net-extraction.test.ts` | Wire connectivity, net labels, power nets |
| Union-Find | `union-find.test.ts` | Merge, find, groups |
| Ratsnest | `ratsnest.test.ts` | MST calculation, correct line count |
| Sync | `schematic-pcb-sync.test.ts` | Add/remove/preserve placements |
| PCB store | `pcb-store.test.ts` | State transitions, move/rotate/flip |
| Persistence | `design-service.test.ts` | Bundle save/load, backward compat |

### Manual test checklist

- [ ] Place R1 + R2 on schematic, wire them together → switch to PCB → both appear, ratsnest line between connected pads
- [ ] Add net labels "SDA" to two separate wires → switch to PCB → pads are in same net, ratsnest connects them
- [ ] Place GND symbols on two different parts of schematic → PCB shows single GND net ratsnest
- [ ] Delete a component from schematic → switch to PCB → component removed from PCB
- [ ] Add a new component to schematic → switch to PCB → new component auto-placed
- [ ] Drag component on PCB → save → reload → position preserved
- [ ] Rotate component on PCB → pads rotate correctly
- [ ] Flip component to back → appears blue, mirrored
- [ ] Change board size → outline updates
- [ ] Open old saved design (schematic-only) → loads correctly, PCB tab is empty
- [ ] Silkscreen outlines visible around pads
- [ ] Grid visible, snapping works

---

## File change summary

### New files

| File | Purpose |
|------|---------|
| `src-react/src/components/pcb-editor/pcb-types.ts` | PCB data model interfaces |
| `src-react/src/components/pcb-editor/layer-colors.ts` | Layer colors, grid presets, defaults |
| `src-react/src/components/pcb-editor/canvas/PcbCanvas.tsx` | PCB canvas renderer |
| `src-react/src/components/pcb-editor/canvas/pcb-viewport.ts` | Viewport wrapper for mm units |
| `src-react/src/components/pcb-editor/canvas/pcb-pads.ts` | Pad rendering functions |
| `src-react/src/components/pcb-editor/canvas/pcb-silkscreen.ts` | Silkscreen rendering |
| `src-react/src/components/pcb-editor/canvas/pcb-hit-test.ts` | PCB-specific hit testing |
| `src-react/src/components/pcb-editor/usePcbInteractionController.ts` | PCB mouse/interaction handling |
| `src-react/src/components/pcb-editor/BoardSizeForm.tsx` | Board dimension inputs |
| `src-react/src/components/pcb-editor/ratsnest.ts` | MST ratsnest calculator |
| `src-react/src/components/pcb-editor/schematic-pcb-sync.ts` | Schematic → PCB sync logic |
| `src-react/src/stores/pcb-store.ts` | PCB Zustand store |
| `src-react/src/lib/union-find.ts` | Union-Find data structure |
| `src-react/src/components/pcb/canvas/net-extraction.ts` | Net extraction algorithm |
| Test files for all above | Automated tests |

### Modified files

| File | Changes |
|------|---------|
| `src-ts/shared/types/pcb.types.ts` | Add `SchematicNetLabel` type |
| `src-ts/src/core/schemas/pcb-project.schema.ts` | Update `PcbProjectDocumentSchema`, verify bundle schema |
| `src-ts/src/domain/services/design-service.ts` | Save/load `ProjectDocumentBundle`, backward compat |
| `src-ts/src/db/schema/design-sheet.ts` | Change content type to bundle |
| `src-react/src/components/pcb/types.ts` | Add `NetLabelEntity`, extend `DerivedNet` with `pinIds` |
| `src-react/src/components/pcb/canvas/SchematicCanvas.tsx` | Render net labels |
| `src-react/src/components/pcb/canvas/hit-test.ts` | Add net label hit targets |
| `src-react/src/stores/schematic-store.ts` | Populate `derived.connectivity.nets`, net label actions |
| `src-react/src/screens/DesignScreen.tsx` | PCB tab rendering, sync trigger, bundle save/load |
| `src-react/src/screens/design/DesignHeader.tsx` | (minor) ensure tab switch triggers sync |

---

## Risk register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Silkscreen graphics parsing** — `graphics[].data` is `Record<string, unknown>`. Format varies (arrays vs objects for coordinates). | Medium | High | Parse defensively. Handle `line` type first (most common for outlines). Skip `arc` and `text` if format is ambiguous. Test with seeded 0805 footprint data. |
| **Footprint rotation transforms** — computing world-space pad positions from local coordinates + placement rotation + pad rotation | Medium | Medium | Write a `transformPadPosition(placement, pad)` utility with explicit tests. Use the existing `transformSymbolLocalPoint` from schematic as reference pattern. |
| **Bundle migration breaks existing saves** — changing `design_sheet.content` type could corrupt or fail to load old designs | High | Low | M6.2 includes explicit format detection and auto-wrapping. Add integration test that loads a known old-format document. Never delete old format support from the reader. |
| **Net extraction correctness** — coordinate-based matching with no epsilon tolerance could miss connections at pin/wire intersections that are off by floating point error | Medium | Medium | Match the existing strategy (exact `${x}:${y}` string key). If issues arise, add a small epsilon tolerance (0.1nm). Test with real saved schematics. |
| **Performance with many ratsnest lines** — MST calculation and rendering for large nets (e.g. GND with 50 pads) | Low | Low | MST on 50 points is trivial. Rendering 50 thin lines is trivial. Only becomes a concern at 500+ pads, which is beyond MVP scope. |
| **Full re-sync destroys manual PCB work** — re-generating all placements on every tab switch could reset user positioning | High | Medium | The sync algorithm preserves existing positions (M7.1 step 3c). Only new components get auto-placed. Test: arrange PCB → switch to schematic → switch back → positions unchanged. |

---

## Execution order

```
Week 1:   M1 (net labels) + M3 (PCB data model + store)     [parallel]
Week 2:   M2 (net extraction) + M4 (PCB canvas renderer)    [parallel]
Week 3:   M5 (placement interactions) + M6 (persistence)    [parallel]
Week 4:   M7 (sync bridge + ratsnest) + integration testing
```

**Total estimated effort**: 3–4 weeks for a solo developer.

**Critical path**: M2 → M7 (net extraction must be done before sync works) and M4 → M5 → M7 (canvas must render before interactions and sync can be tested).
