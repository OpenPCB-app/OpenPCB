# Canvas Migration: Three.js + React Three Fiber

## Context

OpenPCB has 5 separate Canvas 2D implementations (4,100+ lines) with massive code duplication, inconsistent coordinate systems, broken hit-testing, no visual testability, and no GPU acceleration. This plan replaces all of them with a unified Three.js + React Three Fiber (R3F) rendering system — the same stack used by **Flux.ai**, the most mature browser-based EDA tool.

### Why Three.js + R3F

- **Flux.ai validates this approach** — confirmed via their open-source repos (`buildwithflux/thomas` MSDF text engine, `buildwithflux/camera-controls` fork), Urlbox case study ("React and Three.js"), and job listings ("Graphics Software Engineer — WebGL/Three.js")
- **Already installed** — `three@0.183.2`, `@react-three/fiber@9.5.0`, `@react-three/drei@10.7.7` are in `package.json`
- **Zero-cost 3D upgrade path** — switching from `OrthographicCamera` to `PerspectiveCamera` for 3D PCB board view is trivial; `occt-import-js` already installed for STEP import
- **Built-in scene graph** — Three.js `Object3D` hierarchy replaces manual z-ordering, hit-testing, and transform stacking
- **GPU-accelerated** — WebGL batch rendering handles 10k+ objects at 60fps; `InstancedMesh` for repeated pads/vias
- **React-native DX** — R3F reconciler writes prop changes directly to Three.js objects without VDOM overhead

---

## Current State (What We're Replacing)

| Canvas                | File                                         | Lines | Units | Y-Axis   | Problems                                   |
| --------------------- | -------------------------------------------- | ----- | ----- | -------- | ------------------------------------------ |
| SchematicCanvas       | `pcb/canvas/SchematicCanvas.tsx`             | 759   | nm    | Y-down   | Full redraw/frame, manual hit-test         |
| PcbCanvas             | `pcb-editor/canvas/PcbCanvas.tsx`            | 393   | mm    | Y-down   | Different unit system, duplicated viewport |
| SymbolEditorCanvas    | `symbol-editor/SymbolEditorCanvas.tsx`       | 1154  | nm    | **Y-up** | Y-flipped coord system, separate viewport  |
| FootprintEditorCanvas | `footprint-editor/FootprintEditorCanvas.tsx` | 502   | mm    | Y-up     | Another unit system, duplicated rendering  |
| SymbolPreview         | `library/SymbolPreview.tsx`                  | 688   | nm    | Y-up     | No DPI scaling, duplicated render          |
| FootprintPreview      | `library/FootprintPreview.tsx`               | 616   | mm    | Y-up     | No DPI scaling, duplicated render          |

**Duplicated across all**: 6 viewport transforms, 5 grid renderers, 4 hit-test engines, 3 graphic renderers, 6 resize handlers, 6 pan/zoom handlers.

**Shared code exists** in `lib/canvas-core/` (viewport.ts, graphics.ts, pins.ts, grid.ts) but each canvas reimplements most of it.

---

## Architecture

### High-Level

```
+------------------------------------------------------------------+
|                    React Components (thin wrappers)               |
|  SchematicView  SymbolEditorView  PcbView  FootprintEditorView   |
|  SymbolPreview                    FootprintPreview                |
+--------+-----------------+----------------+----------------------+
         |                 |                |
    [EditorConfig]    [EditorConfig]    [EditorConfig]
    domain: schematic domain: pcb      mode: readOnly
         |                 |                |
+--------v-----------------v----------------v----------------------+
|              R3F <Canvas orthographic frameloop="demand">         |
|              CameraControls (dollyToCursor)                       |
|              <Bvh firstHitOnly> (hit acceleration)               |
+--------+-----------------+----------------+----------------------+
         |                 |                |
+--------v---------+  +----v--------+      |
| <SchematicScene> |  | <PcbScene>  |   (same two scenes,
| (R3F components) |  | (R3F comps) |    config-driven)
+--------+---------+  +----+--------+
         |                 |
+--------v-----------------v-----------------------------------+
|                    Shared Render Primitives                   |
|  <GridShader>  <WireLines>  <SymbolBody>  <PadInstances>    |
|  <PinDots>     <NetLabel>   <TraceLines>  <ViaInstances>    |
|  <SelectionOverlay>  <PreviewGhost>  <RubberBand>           |
+--------------------------------------------------------------+
```

### Two Domain Scenes (Reused Everywhere)

1. **`<SchematicScene>`** — renders symbols, wires, net labels, junctions, pin dots

   - Used by: SchematicCanvas, SymbolEditorCanvas, SymbolPreview
   - Config: `editable` / `readOnly`, visible layers, interaction handler

2. **`<PcbScene>`** — renders placements, pads, traces, vias, silkscreen, courtyard, ratsnest
   - Used by: PcbCanvas, FootprintEditorCanvas, FootprintPreview
   - Config: `editable` / `readOnly`, visible layers, active layer, interaction handler

Each consumer is a ~40-60 line wrapper connecting a Zustand store to the appropriate scene.

---

## Unified Coordinate System

### Decision: Nanometers, Y-up (Three.js default)

| Choice         | Rationale                                                                   |
| -------------- | --------------------------------------------------------------------------- |
| **Nanometers** | Finest granularity, already canonical in schematic domain, integer-friendly |
| **Y-up**       | Three.js default, matches PCB/footprint convention, simplest code path      |

**Start Y-up everywhere.** No camera flips, no `scale.y = -1`. If schematic Y-direction feels wrong later, add `scale.y = -1` on the schematic scene root group as a targeted fix. Avoids premature complexity.

### Unit Conversions

```typescript
// src-react/src/lib/render-engine/coords.ts
export type Nm = number;
export type Mm = number;
export type Mils = number;

export const Units = {
  nmToMm: (nm: Nm): Mm => nm / 1_000_000,
  mmToNm: (mm: Mm): Nm => mm * 1_000_000,
  nmToMils: (nm: Nm): Mils => nm / 25_400,
  milsToNm: (mils: Mils): Nm => mils * 25_400,
} as const;

export interface Vec2 {
  x: Nm;
  y: Nm;
}
export interface Bounds {
  minX: Nm;
  minY: Nm;
  maxX: Nm;
  maxY: Nm;
}
```

### Migration Rules

- **Schematic entities**: Already in nm. Y-values stay as-is (already Y-up in Three.js terms after camera flip).
- **Symbol editor**: Remove Y-negation from `symbolToScreen`/`screenToSymbol`. Data already stored correctly.
- **PCB entities**: One-time migration `x_nm = x_mm * 1_000_000`.
- **Footprint editor**: Remove PIXELS_PER_MM constant; zoom is now px/nm via camera.
- **Grid sizes**: Stored in nm (e.g., 50mil grid = 1,270,000 nm).

---

## Three.js Rendering Patterns

### Canvas Setup

```tsx
<Canvas
  orthographic
  camera={{ zoom: 50, position: [0, 0, 100], near: -1000, far: 1000 }}
  frameloop="demand" // only re-render on invalidation
  gl={{ antialias: true, alpha: false }}
>
  <CameraControls makeDefault dollyToCursor />
  <Bvh firstHitOnly>
    <SchematicScene doc={doc} config={config} />
  </Bvh>
</Canvas>
```

### Layer Ordering (renderOrder, not Z)

All geometry at z=0. Depth controlled exclusively via `renderOrder`:

```typescript
export const RENDER_ORDER = {
  GRID: 0,
  BOARD_OUTLINE: 1,
  BACK_COPPER: 2,
  COURTYARD: 3,
  WIRES: 4,
  BODIES: 5,
  FRONT_COPPER: 6,
  SILKSCREEN: 7,
  PINS: 8,
  LABELS: 9,
  RATSNEST: 10,
  SELECTION: 11,
  PREVIEW: 12,
} as const;
```

All materials: `depthTest: false`, `depthWrite: false`.

### Schematic Wires — Single `LineSegments`

Pre-allocated dynamic buffer, single draw call for ALL wires:

```tsx
function SchematicWires({ wires }: { wires: WireEntity[] }) {
  const geomRef = useRef<THREE.BufferGeometry>(null);

  useEffect(() => {
    const positions = new Float32Array(MAX_WIRE_POINTS * 3);
    let idx = 0;
    for (const wire of wires) {
      for (let i = 0; i < wire.points.length - 1; i++) {
        positions[idx++] = wire.points[i].x;
        positions[idx++] = wire.points[i].y;
        positions[idx++] = 0;
        positions[idx++] = wire.points[i + 1].x;
        positions[idx++] = wire.points[i + 1].y;
        positions[idx++] = 0;
      }
    }
    geomRef.current!.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    geomRef.current!.setDrawRange(0, idx / 3);
    invalidate();
  }, [wires]);

  return (
    <lineSegments renderOrder={RENDER_ORDER.WIRES}>
      <bufferGeometry ref={geomRef} />
      <lineBasicMaterial color="#94a3b8" depthTest={false} />
    </lineSegments>
  );
}
```

### PCB Traces — `LineSegments2` (fat lines with world-unit widths)

```tsx
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
// Merged geometry for all traces of same width/layer
```

### Pads/Vias — `InstancedMesh`

Single draw call for N pads:

```tsx
function PadInstances({ pads }: { pads: Pad[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => new THREE.CircleGeometry(1, 16), []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    const m = new THREE.Matrix4();
    pads.forEach((pad, i) => {
      m.makeTranslation(pad.x, pad.y, 0).scale(
        new THREE.Vector3(pad.radius, pad.radius, 1),
      );
      meshRef.current!.setMatrixAt(i, m);
      meshRef.current!.setColorAt(i, new THREE.Color(pad.color));
    });
    meshRef.current!.instanceMatrix.needsUpdate = true;
    meshRef.current!.instanceColor!.needsUpdate = true;
  }, [pads]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, mat, pads.length]}
      renderOrder={RENDER_ORDER.PINS}
    />
  );
}
```

### Text — troika `<Text>` (via drei)

For pin names, net labels, reference designators. MSDF-based, crisp at all zoom:

```tsx
<Text
  position={[pin.x, pin.y, 0]}
  fontSize={Units.mmToNm(1.27)}
  color="#e2e8f0"
  anchorX="left"
  anchorY="middle"
  renderOrder={RENDER_ORDER.LABELS}
  material-depthTest={false}
>
  {pin.name}
</Text>
```

For dense scenes (500+ visible labels): implement frustum culling — hide `<Text>` components when camera zoom is below threshold or label is outside visible bounds.

**Future optimization**: If troika becomes a bottleneck, adopt Flux.ai's approach — build a custom MSDF instanced text renderer (their `thomas` library pattern).

### Grid — Custom Fragment Shader

Infinite grid with zero geometry, via `fract` + `fwidth` in GLSL:

```tsx
function InfiniteGrid() {
  return (
    <mesh renderOrder={RENDER_ORDER.GRID}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        uniforms={{
          gridSize: { value: Units.milsToNm(50) },
          gridColor: { value: new THREE.Color(0.58, 0.64, 0.72) },
          gridAlpha: { value: 0.35 },
        }}
        vertexShader={gridVertexShader}
        fragmentShader={gridFragmentShader}
        transparent
        depthTest={false}
      />
    </mesh>
  );
}
```

### Hit Testing

R3F's built-in pointer events + `<Bvh>` acceleration:

```tsx
<group
  onClick={(e) => {
    e.stopPropagation();
    selectSymbol(symbol.id);
  }}
  onPointerDown={(e) => beginDrag(symbol.id, e)}
>
  <SymbolBody symbol={symbol} />
</group>
```

For thin wires: set `raycaster.params.Line.threshold = hitRadius` to widen clickable area.

For complex hit priority (pins > bodies > wires): use `e.stopPropagation()` and R3F's natural front-to-back event ordering.

### Demand Rendering (`frameloop="demand"`)

R3F only re-renders when:

- React props change on scene objects
- Pointer events fire
- `CameraControls` triggers zoom/pan
- Manual `invalidate()` call

This means static schematics consume zero GPU/CPU when idle — critical for a desktop app with multiple open tabs.

---

## File Structure

```
src-react/src/lib/render-engine/
  index.ts                        # Public barrel export
  coords.ts                       # Vec2, Bounds, Nm, Units
  coords.test.ts                  # Unit conversion round-trips
  layers.ts                       # RENDER_ORDER, layer visibility configs

  camera/
    use-eda-camera.ts             # CameraControls config for EDA (zoom limits,
                                  #   dollyToCursor, schematic Y-flip)
    camera.test.ts

  primitives/
    GridShader.tsx                 # Infinite grid via fragment shader
    WireLines.tsx                  # LineSegments for schematic wires
    TraceLines.tsx                 # LineSegments2 for PCB traces (fat, world-unit width)
    SymbolBody.tsx                 # ShapeGeometry from SymbolGraphic[]
    PadInstances.tsx               # InstancedMesh for pads
    ViaInstances.tsx               # InstancedMesh for vias
    PinDots.tsx                    # InstancedMesh for pin connector dots
    EDAText.tsx                    # Wrapper around troika <Text> with EDA defaults
    SelectionOverlay.tsx           # Dashed selection rectangles
    PreviewGhost.tsx               # Semi-transparent placement preview
    RubberBand.tsx                 # Rubber-band selection rectangle

  scenes/
    SchematicScene.tsx             # Composes primitives for schematic domain
    SchematicScene.test.tsx        # Scene structure tests
    PcbScene.tsx                   # Composes primitives for PCB domain
    PcbScene.test.tsx

  interaction/
    types.ts                      # InteractionEvent, InteractionHandler
    use-schematic-interaction.ts  # Schematic interaction state machine
    use-pcb-interaction.ts        # PCB interaction state machine
    use-symbol-editor-interaction.ts
    use-footprint-editor-interaction.ts

  hit-test/
    use-hit-priority.ts           # R3F event ordering + priority logic
    spatial-index.ts              # Optional R-tree for custom queries beyond raycaster
    spatial-index.test.ts

  testing/
    scene-test-utils.ts           # Helpers to render R3F scenes in tests
    snapshot-utils.ts             # WebGL screenshot → PNG comparison
    mock-canvas.ts                # WebGL context mock for unit tests

src-react/src/components/
  pcb/canvas/
    SchematicCanvas.tsx            # ~50 lines: store → <Canvas> + <SchematicScene>

  pcb-editor/canvas/
    PcbCanvas.tsx                  # ~50 lines: store → <Canvas> + <PcbScene>

  symbol-editor/
    SymbolEditorCanvas.tsx         # ~60 lines: store → <Canvas> + <SchematicScene readOnly=false>

  footprint-editor/
    FootprintEditorCanvas.tsx      # ~60 lines: store → <Canvas> + <PcbScene readOnly=false>

  library/
    SymbolPreview.tsx              # ~40 lines: readOnly <Canvas> + <SchematicScene>
    FootprintPreview.tsx           # ~40 lines: readOnly <Canvas> + <PcbScene>
```

---

## Testing Strategy

### Level 1: Pure Function Unit Tests (Vitest, happy-dom)

**No WebGL needed.** Test coordinate math, scene logic, interaction state machines.

- `coords.test.ts` — unit conversion round-trips
- `spatial-index.test.ts` — R-tree queries
- Interaction handler tests — state machine transitions given mock events

### Level 2: R3F Scene Structure Tests (Vitest + `@react-three/test-renderer`)

Test that scenes produce the correct Three.js object hierarchy without a real canvas.

```typescript
import ReactThreeTestRenderer from '@react-three/test-renderer';

it('renders symbol with correct children', async () => {
  const renderer = await ReactThreeTestRenderer.create(
    <SchematicScene doc={testDoc} config={defaultConfig} />
  );
  const symbolGroup = renderer.scene.children.find(c => c.name === 'symbol-R1');
  expect(symbolGroup).toBeDefined();
  expect(symbolGroup.children).toHaveLength(3); // body + 2 pins
});
```

### Level 3: Visual Snapshot Tests (Playwright)

Screenshot comparison of rendered canvases at key states.

```typescript
// tests/e2e/canvas-visual.spec.ts
test("schematic renders 555 timer circuit", async ({ page }) => {
  await page.goto("/?e2e=schematic&fixture=555-timer");
  await page.waitForSelector('[data-testid="schematic-canvas"] canvas');
  await expect(
    page.locator('[data-testid="schematic-canvas"]'),
  ).toHaveScreenshot("schematic-555-timer.png", { maxDiffPixels: 50 });
});

test("pcb renders dev board layout", async ({ page }) => {
  await page.goto("/?e2e=pcb&fixture=dev-board");
  await expect(page.locator('[data-testid="pcb-canvas"]')).toHaveScreenshot(
    "pcb-dev-board.png",
    { maxDiffPixels: 50 },
  );
});
```

### Level 4: Functional E2E Tests (Playwright)

Interaction flows: place symbol, draw wire, route trace — verify state via `data-testid` DOM.

Reuse existing patterns from `tests/e2e/schematic-editor.spec.ts` and `tests/e2e/pcb-editor.spec.ts`.

### Level 5: Integration Tests (Vitest + React Testing Library)

Test store mutations from user interactions. Mock WebGL context at the boundary.

### Test Migration Strategy: Full Rewrite

Delete all 3,500 lines of existing Canvas 2D tests. Write new test suite from scratch:

- Pure-function unit tests for coords, spatial index, interaction state machines
- R3F test-renderer for scene structure verification
- Playwright visual snapshots as the primary visual correctness gate
- Playwright E2E for interaction flows
- No Canvas ctx-mock tests — those are obsolete with WebGL

---

## Build Sequence

### Phase 1: Foundation (Days 1-3)

- `coords.ts` + `layers.ts` + `use-eda-camera.ts`
- Unit tests for coordinate conversions
- **Gate**: Camera zoom/pan works in a blank `<Canvas>`

### Phase 2: Shared Primitives (Days 3-7)

- `GridShader.tsx` (shader-based infinite grid)
- `WireLines.tsx` + `TraceLines.tsx` (LineSegments / LineSegments2)
- `SymbolBody.tsx` (ShapeGeometry from graphics)
- `PadInstances.tsx` + `ViaInstances.tsx` + `PinDots.tsx` (InstancedMesh)
- `EDAText.tsx` (troika wrapper)
- `SelectionOverlay.tsx` + `PreviewGhost.tsx` + `RubberBand.tsx`
- **Gate**: Each primitive renders correctly in isolation Storybook/test harness

### Phase 3: Domain Scenes (Days 7-10)

- `SchematicScene.tsx` — compose primitives for schematic
- `PcbScene.tsx` — compose primitives for PCB
- R3F test-renderer tests for scene structure
- **Gate**: Both scenes render test fixtures correctly

### Phase 4: Interaction Handlers (Days 10-13)

- Port `useSchematicInteractionController` → `use-schematic-interaction.ts`
- Port PCB interaction → `use-pcb-interaction.ts`
- Port symbol editor interaction → `use-symbol-editor-interaction.ts`
- Port footprint editor interaction → `use-footprint-editor-interaction.ts`
- All interaction receives R3F pointer events instead of raw DOM events
- **Gate**: Place symbol, draw wire, route trace all work

### Phase 5: Consumer Migration (Days 13-16)

- Replace all 6 canvas components with thin R3F wrappers
- PCB coordinate migration (mm → nm)
- Symbol editor Y-flip removal
- **Gate**: All existing Vitest + Playwright tests pass (adapted)

### Phase 6: Testing + Cleanup (Days 16-19)

- Playwright visual snapshot baselines for all canvas states
- R3F test-renderer tests for scene structure
- Performance profiling (target: 500 components at 60fps)
- Delete ALL old Canvas 2D code: `canvas-core/`, old viewport modules, old render-utils
- **Gate**: Full test suite green. Zero old canvas code remains.

---

## Critical Files to Modify/Delete

### DELETE (after migration)

- `src-react/src/lib/canvas-core/` (entire directory)
- `src-react/src/components/pcb/canvas/viewport.ts`
- `src-react/src/components/pcb/canvas/symbols.ts`
- `src-react/src/components/pcb/canvas/wires.ts`
- `src-react/src/components/pcb/canvas/grid.ts`
- `src-react/src/components/pcb/canvas/hit-test.ts`
- `src-react/src/components/pcb/canvas/net-labels.ts`
- `src-react/src/components/symbol-editor/viewport.ts`
- `src-react/src/components/footprint-editor/viewport.ts`
- `src-react/src/components/footprint-editor/render-utils.ts`
- `src-react/src/components/pcb-editor/canvas/pcb-viewport.ts`
- `src-react/src/components/pcb-editor/canvas/pcb-pads.ts`
- `src-react/src/components/pcb-editor/canvas/pcb-silkscreen.ts`
- `src-react/src/components/pcb-editor/canvas/pcb-traces.ts`
- `src-react/src/components/pcb-editor/canvas/pcb-hit-test.ts`

### PRESERVE (domain logic, not rendering)

- `src-react/src/components/pcb/canvas/net-extraction.ts` — connectivity graph (Union-Find) — pure logic
- `src-react/src/stores/schematic-store.ts` — state management (store shape unchanged)
- `src-react/src/components/pcb-editor/pcb-types.ts` — PCB data model types (migrated to nm)
- `src-react/src/components/pcb/types.ts` — schematic entity types

---

## Risks and Mitigations

| Risk                                         | Severity | Mitigation                                                                                                    |
| -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| **Line width 1px on Windows/ANGLE**          | High     | Use `Line2`/`LineSegments2` (screen-space quads) for all visible lines, not `THREE.Line`                      |
| **Text perf with 500+ troika labels**        | Medium   | Frustum culling + zoom-threshold hiding; upgrade to instanced MSDF (Flux's `thomas` pattern) if needed        |
| **R3F test-renderer + Vitest friction**      | Medium   | Keep most tests at pure-function level; use Playwright for visual; mock WebGL for integration                 |
| **PCB mm→nm coordinate migration**           | Medium   | Delay to Phase 5; PCB scene accepts mm internally until then; branded types catch mismatches                  |
| **Big-bang breaks existing features**        | High     | Build in `lib/render-engine/` alongside old code; feature flag toggle; port one consumer at a time in Phase 5 |
| **ShapeGeometry immutability**               | Medium   | Cache geometries keyed by symbol kind; only rebuild on symbol definition change, not on move/select           |
| **Z-fighting between overlapping 2D layers** | Low      | Use `renderOrder` exclusively; `depthTest: false` on all materials                                            |
| **Arc angle degrees→radians**                | High     | Add explicit conversion in SymbolBody. Arc sweep direction flips with Y convention — test every arc variant   |
| **Native drag-drop in R3F**                  | High     | HTML overlay div captures all drag events; bridge to interaction handler with full DataTransfer payload       |
| **Wheel zoom normalization**                 | High     | Preserve current `useCanvasWheel` browser-specific delta normalization; pipe to camera instead of viewport    |
| **Filled+stroked shapes dual render**        | Medium   | Every filled shape needs ShapeGeometry (fill) + EdgesGeometry/LineSegments (stroke) — two Three.js objects    |
| **TextGraphic fontSize in mm not nm**        | Medium   | Explicit conversion at SymbolBody boundary: `fontSize_nm = fontSize_mm * 1_000_000`                           |
| **5px drag threshold**                       | Medium   | Implement manually in interaction handlers — R3F pointer events have no built-in threshold                    |
| **Wire re-routing during drag**              | High     | `rerouteWireWithMovedEndpoint()` must be preserved exactly — pure logic, called from store's updateDragMove   |

---

## Resolved Decisions

| Question               | Decision                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Y-direction**        | Y-up everywhere (Three.js default). No flips. Adjust later if schematic feels wrong via `scale.y = -1` on scene root.                                                |
| **Text engine**        | troika-three-text first (drei `<Text>`). Benchmark at 300+ labels. Upgrade to Flux-style instanced MSDF only if bottleneck.                                          |
| **Empty space clicks** | Both: invisible background plane at z=-1 for coordinate precision + `onPointerMissed` as fallback.                                                                   |
| **Test migration**     | Full rewrite. Delete all old Canvas 2D tests. New suite: unit tests + R3F test-renderer + Playwright visual/E2E.                                                     |
| **Grid shader**        | Full-screen quad with inverse view-projection matrix. Fragment shader uses `fract()`+`fwidth()` for infinite grid. Zero geometry, one draw call.                     |
| **Geometry caching**   | Global cache keyed by symbol kind. All instances of same symbol share one `ShapeGeometry`. Rebuild only on definition change.                                        |
| **Drag-and-drop**      | HTML overlay + bridge. Invisible div over R3F canvas captures native drag events, converts screen→world via `camera.unproject()`, dispatches to interaction handler. |

All architectural questions are now resolved. No remaining open questions.

---

## STRICT FUNCTIONALITY PRESERVATION RULES

**No existing functionality may be broken, altered, or removed. Only buggy behavior may be improved.**

### Core Rules

1. **Every interaction that works today MUST work identically after migration.** This includes: symbol placement, wire drawing with waypoints, drag-move with grid snapping, net label placement, PCB trace routing with via insertion/layer flip/width cycling/elbow toggle, symbol editor drawing tools (line/rect/circle), pin drag-from-palette, footprint pad editing, and all preview canvases.

2. **Visual output must match or improve.** Symbols, wires, pads, traces, grid, selection boxes, and preview ghosts must render at the same position, size, rotation, and color. Only rendering bugs (blurry text, aliasing, missed hit targets) may be improved.

3. **All keyboard shortcuts preserved.** Delete/Backspace, Ctrl+Z/Ctrl+Shift+Z, Ctrl+A, Escape, and routing keys (w/f/v for width/elbow/via in PCB).

4. **All drag-and-drop flows preserved.** Symbol palette → schematic canvas (PALETTE_SYMBOL_KIND_MIME), pin palette → symbol editor (PIN_DRAG_MIME).

5. **Undo/redo behavior preserved exactly.** Schematic uses external singleton UndoManager (50 levels). Symbol/footprint editors use store-internal history. Same undo boundaries.

6. **Derived state computation preserved.** Net extraction (Union-Find), junction detection, ratsnest calculation, document bounds, hit test cache — all must produce identical results.

7. **Store shapes unchanged.** Zustand stores (schematic-store, pcb-store, symbol-editor-store, footprint-editor-store) keep their current API. Interaction controllers keep their current action interfaces.

8. **E2E test harness preserved.** `SchematicEditorE2EHarness.tsx` and PCB editor harness must continue to work with `?e2e=schematic` and `?e2e=pcb` URL params.

### What MAY Be Improved

- Hit-test accuracy (thin wires are currently hard to click)
- Text rendering crispness at zoom extremes
- Performance during pan/zoom
- DPI handling (SymbolPreview and FootprintPreview currently lack DPI scaling)
- Grid rendering quality (currently dot-based only)

---

## AUDIT FINDINGS: Gaps in Original Plan

Deep codebase review revealed these issues that must be addressed:

### Gap 1: Native HTML Drag-Drop Events (HIGH)

R3F canvas does NOT support native `onDragEnter`/`onDragOver`/`onDragLeave`/`onDrop` events. The plan mentions HTML overlay but underestimates complexity:

- **SchematicCanvas**: Symbol palette drag uses `PALETTE_SYMBOL_KIND_MIME` custom MIME. Canvas reads `dataTransfer.getData()` on dragOver/drop. Has `handleDragEnter` that begins placement session, `handleDragLeave` with `relatedTarget` check to avoid spurious fires.
- **SymbolEditorCanvas**: Pin palette drag uses `PIN_DRAG_MIME`. Drop handler parses JSON template `{electricalType, defaultSide}`, auto-increments pin number, creates pin at snapped position.

**Fix**: HTML overlay div must:

1. Capture ALL native drag events (enter/over/leave/drop)
2. Read `dataTransfer` MIME types and data
3. Convert screen coords to world coords via `camera.unproject()`
4. Dispatch to interaction handler with full `DataTransfer` payload
5. Handle the `relatedTarget` check for dragLeave

### Gap 2: Wheel/Zoom Normalization (HIGH)

Current `useCanvasWheel` hook has complex browser-specific normalization:

- `DOM_DELTA_LINE` (Firefox): 0.05 scale factor
- `DOM_DELTA_PAGE` (rare): 1.0 scale factor
- `DOM_DELTA_PIXEL` (Chrome/trackpad): 0.002 scale factor
- Pinch-to-zoom detection via `ctrlKey`: 10x multiplier
- Pan direction inversion for Figma/Blender convention

**Fix**: This normalization must be preserved exactly. The plan's `CameraControls` from drei handles zoom but NOT with this specific normalization. Options:

1. Disable CameraControls wheel handling, keep custom `useCanvasWheel` hook, pipe results to camera
2. Configure CameraControls to match current behavior exactly

### Gap 3: Pending Drag Threshold Pattern (MEDIUM)

All editable canvases implement a 5px drag threshold before committing to drag mode. This prevents accidental drags on single-click selection. R3F pointer events don't have built-in threshold — must implement manually in interaction handlers.

### Gap 4: Mouse Leave Cleanup (MEDIUM)

All canvases handle `onMouseLeave` to clean up state: commit or cancel active drag, clear placement preview, reset panning flag. R3F `onPointerLeave` fires differently than DOM `onMouseLeave` — test carefully.

### Gap 5: Context Menu Prevention (LOW)

All canvases prevent right-click context menu via `onContextMenu={e => e.preventDefault()}`. Must preserve on the R3F canvas container element.

### Gap 6: Window-Level Keyboard Listeners (MEDIUM)

Symbol editor and footprint editor attach keyboard handlers to `window.addEventListener('keydown')` inside `useEffect`. These are NOT canvas-scoped — they fire globally when the editor is mounted. Must preserve this pattern (not R3F-specific, stays in React wrapper).

### Gap 7: Arc Angle Conversion (HIGH)

KiCad arcs store angles in **degrees**. Canvas 2D `ctx.arc()` uses **radians**. Three.js `Shape.arc()` also uses **radians**. Current code converts `degrees → radians` at render time. The plan doesn't mention this conversion.

Additionally, **arc sweep direction flips** with Y-axis convention changes. Canvas 2D with Y-down and Three.js with Y-up interpret clockwise/counterclockwise oppositely.

**Fix**: Add explicit `degreesToRadians()` conversion in the SymbolBody primitive. Add sweep direction test for every arc type.

### Gap 8: Filled + Stroked Shapes (MEDIUM)

Canvas 2D can `fill()` and `stroke()` the same path. Three.js needs separate objects:

- `ShapeGeometry` + `MeshBasicMaterial` for fill
- `EdgesGeometry` or `LineSegments` for stroke

Every filled rectangle, circle, and polygon in symbol graphics needs dual rendering.

### Gap 9: TextGraphic fontSize in mm (not nm!) (MEDIUM)

The `TextGraphic` type stores `fontSize` in mm while all other coordinates are in nm. This inconsistency must be handled in the conversion to troika `<Text>` fontSize (which uses world-space units = nm in our system).

### Gap 10: Wire Re-Routing During Symbol Drag (HIGH)

When dragging a symbol, all attached wires are re-routed in real-time via `rerouteWireWithMovedEndpoint()`. This algorithm must be preserved — it's called from `updateDragMove()` in the schematic store.

### Gap 11: Orthogonal Wire Path Algorithm (HIGH)

`buildOrthogonalWirePathWithWaypoints()` implements Manhattan routing with waypoints. This is pure logic (not rendering) but the wire preview during drawing uses it every frame. Must be preserved and tested.

### Gap 12: PCB Ratsnest Rendering (MEDIUM)

Ratsnest (unrouted connections) renders as dashed lines between unconnected pads. Computed by `calculateRatsnest()` in pcb-store. Must be rendered in PcbScene as dashed `LineSegments`.

### Gap 13: Junction Dot Rendering (MEDIUM)

Wire junctions (where 3+ wires meet) are rendered as filled circles at junction points. Computed from `deriveWireJunctions()` in derived connectivity state. Must be rendered in SchematicScene.

### Gap 14: Component Library Index Integration (MEDIUM)

During placement preview, SchematicCanvas reads `componentLibraryIndex` to create preview symbols with correct graphics/pins. This lookup must be preserved in the SchematicScene component.

### Gap 15: Cursor Management (LOW)

All canvases set `cursor-crosshair` CSS class. No dynamic cursor changes exist today, but the R3F canvas element needs this CSS applied.

---

## DETAILED VERIFICATION PLAN

### Pre-Migration: Capture Baselines

Before writing any new code, capture comprehensive baselines of current behavior:

#### 1. Visual Baselines (Playwright Screenshots)

```bash
# Capture baseline screenshots of every canvas state
npx playwright test tests/e2e/baseline-capture.spec.ts --update-snapshots
```

Capture screenshots for:

**Schematic Canvas:**

- Empty schematic (grid only)
- Single resistor placed
- 555 timer circuit (multiple components + wires)
- Wire being drawn (preview state)
- Symbol being placed (ghost preview)
- Multi-selection with selection boxes
- Zoomed in (pin labels visible)
- Zoomed out (full document)
- Net labels visible
- Junction dots at wire intersections

**PCB Canvas:**

- Empty board (grid + outline)
- Dev board with placements
- Traces routed on F.Cu and B.Cu
- Vias connecting layers
- Ratsnest lines (unrouted)
- Routing in progress (preview segments)
- Selection highlighting
- Layer visibility toggled

**Symbol Editor:**

- Imported KiCad symbol (op-amp with arcs)
- Builtin resistor symbol
- Symbol with text graphics
- Drawing tool preview (line/rect/circle being drawn)
- Pin selection highlighting
- Grid with origin cross

**Footprint Editor:**

- SOT-23 footprint (3 pads)
- QFP footprint (many pads)
- Courtyard + silkscreen lines
- Pad selection highlighting

**Previews:**

- SymbolPreview showing imported symbol
- SymbolPreview showing builtin symbol
- FootprintPreview showing SOT-23

#### 2. Interaction Baselines (Playwright E2E)

Record expected state transitions for:

**Schematic interactions:**

- [ ] Drag symbol from palette → canvas (verify placement at grid-snapped position)
- [ ] Click pin → draw wire → click target pin (verify wire created with correct points)
- [ ] Draw wire with 2 waypoints (verify orthogonal path)
- [ ] Click symbol → drag 50px → release (verify moved to grid-snapped position)
- [ ] Shift+click to add to selection (verify multi-select)
- [ ] Delete key removes selected entities
- [ ] Ctrl+Z undoes last action
- [ ] Escape cancels active wire/placement session
- [ ] Scroll wheel zooms to cursor position
- [ ] Middle-click + drag pans viewport
- [ ] Trackpad pinch-to-zoom works

**PCB interactions:**

- [ ] Click pad → route trace → click target pad (verify trace created)
- [ ] During routing: press 'v' to insert via and switch layer
- [ ] During routing: press 'w' to cycle trace width
- [ ] During routing: press 'f' to flip elbow direction
- [ ] Click placement → drag (verify moves with grid snap)
- [ ] Undo/redo routing operations

**Symbol editor interactions:**

- [ ] Drag pin from palette → canvas (verify pin created at snapped position)
- [ ] Select pin → drag (verify moves to snapped position)
- [ ] Activate line tool → click + drag → release (verify line graphic created)
- [ ] Activate rect tool → draw rectangle (verify rect graphic created)
- [ ] Delete selected pin/graphic
- [ ] Ctrl+A selects all pins

**Footprint editor interactions:**

- [ ] Select pad → drag (verify moves to snapped position)
- [ ] Select graphic → drag (verify translates correctly)
- [ ] Delete selected pad/graphic
- [ ] Undo/redo pad operations

### Per-Phase Verification

#### Phase 1 Verification: Foundation

```
□ Camera zoom to cursor works identically to current useCanvasWheel behavior
□ Pan speed and direction match current Figma-style convention
□ Zoom limits match current MIN_ZOOM / MAX_ZOOM
□ Grid snap produces identical values to current snapToGrid()
□ Unit conversions: nmToMm(mmToNm(x)) === x for all test values
□ Playwright: blank canvas screenshot matches baseline (background + grid)
```

#### Phase 2 Verification: Shared Primitives

```
□ GridShader renders dots at same positions as current grid renderer
□ GridShader adaptive spacing matches current behavior (hide when < 2px)
□ GridShader origin cross visible at (0,0)
□ WireLines render at exact same screen positions as current wires.ts
□ SymbolBody renders all 7 graphic types correctly:
  □ Line — position and stroke width
  □ Rect — position, size, filled vs stroked
  □ Circle — center, radius, filled vs stroked
  □ Arc — center, radius, start/end angles (DEGREES→RADIANS conversion!)
  □ Polygon — all points, closed vs open, filled vs stroked
  □ Bezier — 4 control points
  □ Text — position, fontSize (mm→nm conversion!), rotation
□ PadInstances render at correct positions with correct shapes
□ ViaInstances render with concentric ring pattern
□ PinDots render at pin positions with correct colors
□ SelectionOverlay shows dashed rectangle around selected entities
□ PreviewGhost renders at cursor with correct transparency
□ Playwright: each primitive screenshot matches expected rendering
```

#### Phase 3 Verification: Domain Scenes

```
□ SchematicScene with test fixture matches baseline screenshot (pixel diff < 50px)
□ PcbScene with test fixture matches baseline screenshot
□ Junction dots render at correct wire intersection points
□ Ratsnest dashed lines render between unconnected pads
□ Net labels render at correct positions with correct text
□ Symbol labels (reference + value) render at correct positions
□ Pin name/number labels render for imported symbols
□ Layer visibility toggles hide/show correct elements
□ Playwright MCP: navigate to schematic, take screenshot, compare to baseline
□ Playwright MCP: navigate to PCB editor, take screenshot, compare to baseline
```

#### Phase 4 Verification: Interaction Handlers

```
SCHEMATIC:
□ Symbol palette drag → placement preview appears at cursor
□ Placement preview snaps to grid when grid enabled
□ Click commits placement at correct position
□ Rotation during placement works (R key or toolbar)
□ Click pin starts wire session
□ Wire preview follows cursor with orthogonal routing
□ Click adds waypoint (wire path includes waypoint)
□ Click target pin commits wire
□ Click symbol body selects it (selection box appears)
□ Shift+click adds to selection
□ Click + drag beyond 5px threshold starts drag
□ Drag moves symbol with grid snapping
□ Drag re-routes attached wires in real-time
□ Release commits drag (position persisted)
□ Delete key removes selected entities
□ Ctrl+Z undoes last action
□ Escape cancels wire/placement session
□ Net label placement with prompt works
□ Context menu is prevented (no right-click menu)

PCB:
□ Click pad starts routing on correct net
□ Routing preview shows Manhattan path to cursor
□ Click adds routing corner
□ Click target pad completes route
□ 'v' key inserts via and switches layer
□ 'w' key cycles trace width
□ 'f' key flips elbow direction
□ Escape cancels routing
□ Placement drag with 5px threshold works
□ Undo/redo preserves routing state

SYMBOL EDITOR:
□ Pin drag from palette creates pin at snapped position
□ Pin auto-numbering works (skips existing numbers)
□ Pin selection and drag works
□ Graphic selection and drag works (translate delta correct)
□ Line drawing tool: click-drag-release creates line
□ Rect drawing tool: creates rect with correct bounds
□ Circle drawing tool: creates circle with correct radius
□ Zero-size shapes rejected (start === end)
□ Delete key removes selected pins/graphics
□ Ctrl+A selects all pins

FOOTPRINT EDITOR:
□ Pad selection and drag works (snapped)
□ Graphic selection and drag works
□ Delete key removes selected pads/graphics
□ Undo/redo works correctly

ALL CANVASES:
□ Scroll wheel zoom-to-cursor works with correct normalization
□ Middle-click pan works
□ Shift+left-click pan works
□ Trackpad pinch-to-zoom works
□ Mouse leave cleans up active state
□ Playwright MCP: run full interaction test suite, all pass
```

#### Phase 5 Verification: Consumer Migration

```
□ SchematicCanvas wrapper connects to schematicStore correctly
□ PcbCanvas wrapper connects to pcbStore correctly
□ SymbolEditorCanvas reuses SchematicScene with correct config
□ FootprintEditorCanvas reuses PcbScene with correct config
□ SymbolPreview renders read-only with fit-to-content
□ FootprintPreview renders read-only with fit-to-content
□ E2E test harness works: ?e2e=schematic loads test fixture
□ E2E test harness works: ?e2e=pcb loads test fixture
□ PCB coordinates migrated to nm (verify no visual position changes)
□ Symbol editor Y-flip removed (verify pins/graphics at correct positions)
□ Playwright MCP: full E2E suite passes
□ Playwright MCP: all baseline screenshots match within tolerance
```

#### Phase 6 Verification: Final Validation

```
□ ALL Playwright E2E tests pass (schematic, PCB, symbol, footprint, library)
□ ALL visual snapshot comparisons pass (< 50px diff per screenshot)
□ Performance: 500-component schematic at 60fps during pan/zoom
□ Performance: PCB with 200 pads renders at 60fps
□ Performance: idle schematic consumes 0 CPU (frameloop="demand" working)
□ No console errors or WebGL warnings
□ Dark theme and light theme both render correctly
□ All old Canvas 2D code deleted (verify no imports remain)
□ TypeScript compiles with zero errors (npx tsc --noEmit)
□ Manual inspection via Playwright MCP:
  □ Open schematic editor, place 3 components, wire them
  □ Open PCB editor, route 2 traces with vias
  □ Open symbol editor, import KiCad op-amp, edit pin
  □ Open footprint editor, move pad, verify courtyard
  □ Open library, verify symbol and footprint previews
  □ Switch theme, verify colors update
  □ Zoom to extreme levels, verify text/grid quality
```

### Playwright MCP Verification Commands

At each phase gate, use Playwright MCP tools to verify:

```
1. mcp__playwright__browser_navigate → open app at correct URL
2. mcp__playwright__browser_take_screenshot → capture current state
3. mcp__playwright__browser_click → perform interactions
4. mcp__playwright__browser_snapshot → verify DOM state
5. Compare screenshots against baselines visually
```

### Manual Inspection Checklist (Post-Migration)

After all phases complete, manually verify via Playwright MCP browser:

1. **Open schematic editor** — place resistor, capacitor, IC from palette. Draw wires between them. Verify all render correctly. Zoom in to verify pin labels. Zoom out to verify overview.

2. **Open PCB editor** — sync from schematic. Route traces. Insert via. Switch layers. Verify copper, silkscreen, courtyard all render on correct layers.

3. **Open symbol editor** — import a KiCad symbol with arcs and text. Verify arcs render with correct sweep direction. Edit pin positions. Draw a rectangle. Verify all tools work.

4. **Open footprint editor** — edit a QFP footprint. Move pads. Verify courtyard updates. Check pad shapes (rect, oval, roundrect).

5. **Open library** — browse components. Verify symbol preview shows correct symbol. Verify footprint preview shows correct pads/silkscreen.

6. **Theme test** — switch between light and dark themes. All canvases must update colors immediately.

7. **Performance test** — load a 200-component schematic. Pan rapidly. Zoom in/out. Must maintain 60fps with no visible jank.
