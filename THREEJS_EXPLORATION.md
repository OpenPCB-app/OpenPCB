# Three.js Architecture & EDA Rendering — Codebase Exploration

> Generated 2026-04-05. Read-only exploration — no code changes.

---

## 1. Three.js Setup and Scene Architecture

### Key Finding: Unified R3F Canvas Shell + Legacy Canvas 2D (coexisting)

The project has a **dual rendering architecture**:

- **Modern (R3F):** `src-react/src/lib/render-engine/` — GPU-accelerated WebGL via React Three Fiber
- **Legacy (Canvas 2D):** `src-react/src/components/*/canvas/` — still present, being phased out

### R3F Canvases

**All EDA editors share a single `EdaCanvas` shell:**

`src-react/src/lib/render-engine/interaction/EdaCanvas.tsx:101-123`

```tsx
<Canvas
  orthographic
  camera={{
    zoom: initialZoom, // 50 for schematic, ~4 for PCB
    position: [0, 0, 100],
    near: -10000,
    far: 10000,
  }}
  frameloop="demand" // On-demand rendering (no continuous loop)
  dpr={[1, 3]} // Responsive pixel ratio
  gl={{
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  }}
  style={{ background: backgroundColor }}
/>
```

**Wrapper components per editor (all use `EdaCanvas`):**

| Wrapper                    | File                                                  | Purpose           |
| -------------------------- | ----------------------------------------------------- | ----------------- |
| `SchematicCanvasR3F`       | `render-engine/wrappers/SchematicCanvasR3F.tsx`       | Schematic capture |
| `PcbCanvasR3F`             | `render-engine/wrappers/PcbCanvasR3F.tsx`             | PCB layout        |
| `SymbolEditorCanvasR3F`    | `render-engine/wrappers/SymbolEditorCanvasR3F.tsx`    | Symbol editor     |
| `FootprintEditorCanvasR3F` | `render-engine/wrappers/FootprintEditorCanvasR3F.tsx` | Footprint editor  |
| `SymbolPreviewR3F`         | `render-engine/wrappers/SymbolPreviewR3F.tsx`         | Read-only preview |
| `FootprintPreviewR3F`      | `render-engine/wrappers/FootprintPreviewR3F.tsx`      | Read-only preview |

**Plus one standalone 3D Canvas:**

`src-react/src/components/3d-viewer/StepViewer.tsx:156-177` — Uses **PerspectiveCamera** + **OrbitControls** for STEP file 3D viewing. This is the only non-orthographic canvas.

### Renderer Details

- **WebGL only.** No WebGPU references anywhere in the codebase.
- Renderer created by R3F's `<Canvas>` (delegates to `WebGLRenderer` internally).
- No manual `new THREE.Scene()` or `new WebGLRenderer()` calls — R3F manages the lifecycle.

### Legacy Canvas 2D (still present)

| Legacy File                                             | Status                                 |
| ------------------------------------------------------- | -------------------------------------- |
| `components/pcb/canvas/SchematicCanvas.tsx`             | Replaced by `SchematicCanvasR3F`       |
| `components/pcb-editor/canvas/PcbCanvas.tsx`            | Replaced by `PcbCanvasR3F`             |
| `components/symbol-editor/SymbolEditorCanvas.tsx`       | Replaced by `SymbolEditorCanvasR3F`    |
| `components/footprint-editor/FootprintEditorCanvas.tsx` | Replaced by `FootprintEditorCanvasR3F` |

---

## 2. Camera and Viewport

### Camera Type

**EDA editors:** `OrthographicCamera` — true 2D rendering at z=0.

`EdaCanvas.tsx:103-108`:

```tsx
camera={{
  zoom: initialZoom,   // px per scene-unit (mm)
  position: [0, 0, 100],
  near: -10000,
  far: 10000,
}}
```

**3D Viewer only:** `PerspectiveCamera` with FOV 45, OrbitControls.

### Zoom Handling

Zoom is `camera.zoom` (orthographic zoom = pixels per scene-unit).

`use-eda-camera.ts:82-109`:

```ts
if (e.ctrlKey || e.metaKey) {
  const delta = normalizeZoomDelta(e);
  const factor = Math.pow(2, delta);
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));

  // World position under cursor before and after zoom
  const worldX = cam.position.x + (ndcX * canvasW) / (2 * cam.zoom);
  const newWorldX = cam.position.x + (ndcX * canvasW) / (2 * newZoom);

  cam.position.x += worldX - newWorldX; // Zoom-to-cursor
  cam.position.y += worldY - newWorldY;
  cam.zoom = newZoom;
}
```

|            | Min Zoom | Max Zoom | Default                 |
| ---------- | -------- | -------- | ----------------------- |
| R3F engine | 0.01     | 5000     | 50 (schematic), 4 (PCB) |

### Pan Handling

Pan modifies `camera.position.x/y` directly. No Three.js controls used for pan.

`use-eda-camera.ts:110-114`:

```ts
const { dx, dy } = normalizePanDelta(e);
cam.position.x += dx / cam.zoom;
cam.position.y -= dy / cam.zoom;
```

Input: Ctrl/Cmd+wheel = zoom, plain wheel = pan. Matches Figma navigation.

### Controls

- **EDA editors:** No OrbitControls or MapControls. Custom `useEdaWheel` hook only.
- **3D Viewer:** `OrbitControls` from `@react-three/drei` (rotate, zoom, pan).

### Coordinate Conversion

`use-eda-camera.ts:97-105` — World under cursor via NDC:

```ts
const ndcX = (mouseX / canvasW) * 2 - 1;
const ndcY = -(mouseY / canvasH) * 2 + 1;
const worldX = cam.position.x + (ndcX * canvasW) / (2 * cam.zoom);
const worldY = cam.position.y + (ndcY * canvasH) / (2 * cam.zoom);
```

**Legacy viewport.ts / pcb-viewport.ts still exist** in the Canvas 2D components but are **not used by R3F**. The R3F engine has its own `coords.ts` with `nmToScene()` / `sceneToNm()`.

### Coordinate System

`coords.ts:1-31`:

- **Internal units:** Nanometers (all entity positions)
- **Scene units:** Millimeters (Three.js operates in mm to avoid float32 precision issues)
- **Convention:** Y-up (Three.js default)
- **Scale factor:** `NM_TO_SCENE = 1,000,000` (nm / 1M = mm)
- **Origin:** (0, 0) at center of scene

```ts
export const NM_TO_SCENE = 1_000_000;
export function nmToScene(nm: number): number {
  return nm / NM_TO_SCENE;
}
export function sceneToNm(scene: number): number {
  return scene * NM_TO_SCENE;
}
```

---

## 3. Rendering Patterns — What Exists Today

### Schematic Wires — Triangulated MeshBasicMaterial

`primitives/WireLines.tsx` — Converts Manhattan-style polylines into thick quads with corner patches.

```
Geometry: Custom BufferGeometry (triangulated rectangles + corner patches)
Material: MeshBasicMaterial { depthTest: false, depthWrite: false, side: DoubleSide }
Type: Individual Mesh per wire group (default, selected, preview)
Render Order: RENDER_ORDER.WIRES (5)
```

No Line2 addon used for schematic wires — manual triangulation for WebGPU compatibility.

### PCB Traces — LineSegments2 (fat lines)

`primitives/TraceLines.tsx` — Uses Three.js addons for thick lines with world-unit widths.

```
Library: three/addons/lines/LineSegments2 + LineMaterial
Geometry: LineSegmentsGeometry
Material: LineMaterial { worldUnits: true, dashed support }
Type: Individual LineSegments2 per render group (front/back copper, selected, preview)
Render Orders: BACK_COPPER (2), FRONT_COPPER (7), SELECTION (13), PREVIEW (14)
```

### Pads — InstancedMesh (GPU batching)

`primitives/PadInstances.tsx`:

```
Circle/oval pads: InstancedMesh + CircleGeometry(0.5, 16)
Rect/roundrect pads: InstancedMesh + PlaneGeometry(1, 1)
Material: Shared MeshBasicMaterial
Per-instance: position + rotation + scale via Matrix4, color via setColorAt()
Render Order: PINS (9)
```

### Vias — InstancedMesh x2

`primitives/ViaInstances.tsx`:

```
Outer ring: InstancedMesh + CircleGeometry(0.5, 16), copper color
Inner drill: InstancedMesh + CircleGeometry(0.5, 16), black
Render Order: PINS (9), drill at +0.1
```

### Pin Dots — InstancedMesh

`primitives/PinDots.tsx`:

```
Geometry: CircleGeometry(1, 12)
Material: MeshBasicMaterial with per-instance color (blue=unconnected, green=connected)
Render Order: PINS (9)
```

### Junction Dots — InstancedMesh

`primitives/JunctionDots.tsx`:

```
Geometry: CircleGeometry(1, 12)
Material: MeshBasicMaterial
Render Order: JUNCTIONS (12)
```

### Symbol Bodies — ShapeGeometry + LineSegments

`primitives/SymbolBody.tsx`:

```
Fills: ShapeGeometry from THREE.Shape (rect, circle, polygon)
Strokes: BufferGeometry as lineSegments (line, arc, bezier)
Materials: MeshBasicMaterial (fills) + LineBasicMaterial (strokes)
Caching: Global geometry cache keyed by symbolKind
Render Order: BODIES (6)
```

### Ratsnest — Dashed LineSegments

`primitives/RatsnestLines.tsx`:

```
Geometry: BufferGeometry (Float32Array of line segment pairs)
Material: LineDashedMaterial { dashSize: 200_000, gapSize: 150_000 }
Render Order: RATSNEST (11)
```

### Grid — Custom Fragment Shader

`primitives/GridShader.tsx` — GPU-based infinite grid:

```
Geometry: PlaneGeometry(1, 1) scaled to viewport coverage (3x margin)
Material: Custom ShaderMaterial (vertex + fragment)
Technique: fract() + fwidth() for constant-pixel-width lines at any zoom
Features: Minor/major grid, origin cross, adaptive density culling
Render Order: GRID (0)
```

Fragment shader core (lines 48-53):

```glsl
vec2 gridCoord = vWorldPos / uGridSize;
vec2 grid = abs(fract(gridCoord - 0.5) - 0.5);
vec2 lineWidth = fwidth(gridCoord);
vec2 draw = smoothstep(lineWidth * 0.5, lineWidth * 1.5, grid);
float minorLine = 1.0 - min(draw.x, draw.y);
```

### Selection Overlay

`primitives/SelectionOverlay.tsx`:

```
Fill: ShapeGeometry + MeshBasicMaterial (opacity 0.12)
Stroke: LineDashedMaterial
Rubber band rectangle for drag-select
Render Order: SELECTION (13)
```

### Preview Ghost

`primitives/PreviewGhost.tsx`:

```
Wrapper group with reduced opacity
Render Order: PREVIEW (14)
Supports: position, rotation, mirroring transforms
```

### Background

`EdaCanvas.tsx:204-213` — `scene.background = new THREE.Color(color)` set reactively.

### Custom Shaders

Only **one custom shader**: the `GridShader` (vertex + fragment). Everything else uses built-in Three.js materials.

### Post-processing

**None.** No EffectComposer, no bloom, no outline effects.

---

## 4. Scene Graph Structure

### Named Groups

Scenes use R3F JSX groups (which become `THREE.Group`):

`scenes/SchematicScene.tsx`:

```
<group name="schematic-scene" scale={[S, S, 1]}>   // S = 1/NM_TO_SCENE
  WireLines (default, selected, preview)
  JunctionDots
  Net labels (EDAText instances)
  Per-symbol groups:
    <group position={[x, y, 0]} rotation={...}>
      SymbolBody (fills + strokes)
      EDAText (reference)
      EDAText (value)
    </group>
  PinDots (InstancedMesh, not nested in symbol group)
  SelectionOverlay
```

`scenes/PcbScene.tsx`:

```
<group name="pcb-scene">
  BoardOutline (lineSegments)
  TraceLines (front/back/selected/preview)
  PcbPlacements → PadInstances
  ViaInstances
  RatsnestLines
```

### Object Add/Remove

**Reactive via R3F components.** No imperative `scene.add()`/`scene.remove()` calls. When Zustand state changes, React re-renders the relevant R3F components, which mount/unmount Three.js objects automatically.

### Geometry/Material Cleanup

- `SymbolBody.tsx:26-37` — Global `geometryCache` Map with `clearGeometryCache()` function that calls `.dispose()` on fills and strokes.
- InstancedMesh components create geometry/material once via `useMemo` — disposed by R3F on unmount.
- No explicit dispose calls in most components (R3F handles cleanup on unmount).

### Render Loop

**Demand-driven (`frameloop="demand"`):**

- No continuous `requestAnimationFrame` loop
- Components call `invalidate()` from `useThree()` after state changes
- `useFrame` used only in `GridShader` (to follow camera position)
- Result: GPU idle except during interaction

---

## 5. Hit Testing / Picking

### Architecture: Hybrid (R3F events + domain-level math)

The hit testing uses **two layers**:

1. **R3F pointer events on BackgroundHitPlane** — catches all empty-space clicks, provides world coordinates
2. **Domain-level hit test functions** — geometric math in screen or world space

### Background Hit Plane

`EdaCanvas.tsx:220-294`:

```tsx
<mesh renderOrder={RENDER_ORDER.HIT_PLANE}>
  {" "}
  {/* -1, behind everything */}
  <planeGeometry args={[10_000, 10_000]} /> {/* 10m x 10m invisible plane */}
  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
</mesh>
```

Pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`) convert `e.point` (scene coords) to nanometers via `sceneToNm()` and dispatch to `InteractionHandler`.

### No Raycaster Setup

No manual `THREE.Raycaster` usage. R3F's built-in event system handles raycasting against the hit plane. Individual symbols/wires are NOT Three.js meshes that receive events — hit testing is done in application code.

### No GPU Picking

No color-based GPU picking. All hit testing is CPU-based geometric math.

### Schematic Hit Testing

`components/pcb/canvas/hit-test.ts`:

```
Priority: Connector (pin) → Symbol body → Net label
Pin detection: Screen-space circle test (10px radius)
Symbol body: Screen-space AABB test
Uses HitTestCache for symbol bounds and connector anchors
```

### PCB Hit Testing

`components/pcb-editor/canvas/pcb-hit-test.ts`:

```
Priority: Active layer pads → Vias → Traces → Placement bounds
Pad: AABB with rotation transform
Via: Circle distance check
Trace: Point-to-segment distance (width/2 + 0.1mm tolerance)
All checks in world space (mm)
```

### R3F Hit Testing (newer pattern)

`render-engine/wrappers/SchematicCanvasR3F.tsx` — `findPinAt()` and `findSymbolAt()` helper functions:

- `findPinAt()`: Iterate connector anchors, find closest within `PIN_HIT_RADIUS_NM` (500,000 nm = 0.5mm)
- `findSymbolAt()`: Screen-space AABB test, reverse iteration for z-order

### No userData

Three.js objects are **not** given `userData` for identification. Hit testing works by iterating domain model entities and checking geometric proximity.

### Event Types

`interaction/types.ts`:

```ts
interface InteractionEvent {
  worldPoint: Vec2; // nanometers
  snappedPoint: Vec2; // grid-snapped
  screenPoint: { x; y }; // canvas-local pixels
  modifiers: { shift; ctrl; meta; alt };
  button: number;
  nativeEvent?: ThreeEvent<PointerEvent>;
}
```

---

## 6. PCB-Specific Rendering — Current State

All PCB rendering exists in the R3F engine. Here's what's implemented:

| Feature                  | Status   | Approach                                                                   | File                           |
| ------------------------ | -------- | -------------------------------------------------------------------------- | ------------------------------ |
| **Pads**                 | Done     | `InstancedMesh` (circle + rect shapes), per-instance color/transform       | `PadInstances.tsx`             |
| **Traces**               | Done     | `LineSegments2` + `LineMaterial` with `worldUnits: true`                   | `TraceLines.tsx`               |
| **Vias**                 | Done     | 2x `InstancedMesh` (outer copper ring + inner drill hole)                  | `ViaInstances.tsx`             |
| **Board outline**        | Done     | `BufferGeometry` + `LineBasicMaterial` (Edge.Cuts)                         | `PcbScene.tsx:123-180`         |
| **Ratsnest**             | Done     | `BufferGeometry` + `LineDashedMaterial`                                    | `RatsnestLines.tsx`            |
| **Silkscreen**           | Partial  | Pad shapes rendered, silkscreen graphics present in Canvas 2D legacy       | Canvas 2D: `pcb-silkscreen.ts` |
| **Copper zones/fills**   | Missing  | Not implemented in either renderer                                         | —                              |
| **Board stackup**        | Missing  | No multi-layer copper fill rendering                                       | —                              |
| **DRC markers**          | Missing  | No design rule check visualization                                         | —                              |
| **Drill table**          | Missing  | No drill summary rendering                                                 | —                              |
| **Component 3D preview** | Separate | STEP viewer in `3d-viewer/StepViewer.tsx` (not integrated with PCB layout) | —                              |

### PCB Layer Colors

`layers.ts:69-79`:

```ts
export const PCB_LAYER_COLORS = {
  "F.Cu": "#c87533", // Front copper (orange)
  "B.Cu": "#3377c8", // Back copper (blue)
  "F.SilkS": "#e2e8f0", // Front silkscreen (light gray)
  "B.SilkS": "#94a3b8",
  "F.CrtYd": "rgba(255, 193, 7, 0.5)",
  "B.CrtYd": "rgba(255, 193, 7, 0.3)",
  "F.Fab": "#64748b",
  "B.Fab": "#475569",
  "Edge.Cuts": "#fbbf24", // Board outline (yellow)
};
```

---

## 7. Symbol Editor Rendering

### R3F Implementation

`wrappers/SymbolEditorCanvasR3F.tsx` uses `EdaCanvas` with:

- Drawing tools (line, rect, circle)
- Pin drag from palette
- Pin/graphic selection and dragging
- Grid snapping + undo/redo

Symbol body rendered by `SymbolBody.tsx`:

- **Rectangles:** `THREE.Shape` → `ShapeGeometry` (fill) + `BufferGeometry` lines (stroke)
- **Circles:** `THREE.Shape` with arc path → `ShapeGeometry`
- **Polygons:** `THREE.Shape` from point arrays
- **Lines/Arcs/Beziers:** Stroke-only `BufferGeometry` as `lineSegments`
- **Geometry cache:** Global `Map<string, { fills, strokes }>` keyed by symbol kind

### Pin Rendering

`PinDots.tsx` — `InstancedMesh` with `CircleGeometry(1, 12)`, per-instance color (connected vs unconnected).

### Text Rendering

`EDAText.tsx` — Wraps `@react-three/drei` `<Text>` (troika-three-text internally):

```tsx
<Text
  position={position}
  fontSize={fontSize} // Default 250,000 nm (~0.25mm, ~12px at zoom 50)
  color={color}
  anchorX={anchorX}
  anchorY={anchorY}
  renderOrder={RENDER_ORDER.LABELS}
  material-depthTest={false}
  material-depthWrite={false}
>
  {children}
</Text>
```

**MSDF-based SDF rendering** — crisp at all zoom levels, no bitmap fonts or HTML overlays.

### Legacy Canvas 2D Text (for reference)

`SymbolEditorCanvas.tsx:402-421`:

```ts
ctx.font = `${fontSize}px monospace`;
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.fillText(graphic.content, 0, 0);
```

---

## 8. Interaction Patterns with Three.js

### Drag-and-Drop

1. **Component from palette:** HTML drag event → `DragDropOverlay` bridges to world coords → `interactionHandler.onDrop()` → store action → React re-render
2. **Moving placed component:** `onPointerDown` → begin drag (5px threshold) → `onPointerMove` updates position → `onPointerUp` commits

`DragDropOverlay.tsx` converts screen coords to world via camera:

```ts
const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
const sceneX = camera.position.x + (ndcX * rect.width) / (2 * camera.zoom);
const sceneY = camera.position.y + (ndcY * rect.height) / (2 * camera.zoom);
```

### Selection Highlighting

- `SelectionOverlay` renders dashed rectangles around selected entities
- Fill: `MeshBasicMaterial` with opacity 0.12
- Stroke: `LineDashedMaterial`
- No material swaps on selected objects (separate overlay approach)
- PCB pads: Per-instance color via `InstancedMesh.setColorAt()` for selection

### Placement Preview

`PreviewGhost.tsx` — Wrapper `<group>` with reduced opacity:

```
Render Order: PREVIEW (14) — always on top
Opacity: ~0.5 (configurable)
Supports: position, rotation, mirroring
```

### Snap-to-Grid

`coords.ts:170-178`:

```ts
export function snapToGrid(point: Vec2, gridSize: Nanometers): Vec2 {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}
```

Applied at interaction layer (before passing to store), not in the Three.js rendering.

Grid presets (`coords.ts:184-193`):

```ts
GRID_PRESETS = {
  FINE: 250_000, // 0.25 mm
  SMALL: 500_000, // 0.5 mm
  STANDARD: 1_270_000, // 50 mils (1.27mm)
  COARSE: 2_540_000, // 100 mils (2.54mm)
};
```

---

## 9. State Synchronization — Zustand to Three.js

### Pattern: Unidirectional React Prop Flow

```
User Input (mouse, keyboard)
  → InteractionHandler (EdaCanvas, DragDropOverlay)
  → Zustand Store Action (e.g., commitPlacement, addRoutingCorner)
  → State Update + Derived State Recalculation
  → React Re-render (wrapper reads store via selectors)
  → R3F Primitives Updated (via props)
  → Three.js Geometry/Material Update (in useEffect/useMemo)
  → invalidate() → WebGL Frame Rendered
```

### Store Does NOT Directly Mutate Three.js Objects

Wrapper components read store via `useSchematicStore(selector)` and pass data as props to scene components:

```tsx
// SchematicCanvasR3F.tsx (simplified)
const document = useSchematicStore((s) => s.persisted.document);
const selectedIds = useSchematicStore((s) => s.chrome.selectedEntityIds);

<SchematicScene document={document} config={{ selectedIds }} colors={colors} />;
```

### R3F Primitives Are Pure Renderers

No subscriptions inside primitives. Data flows top-down. Example from `PadInstances.tsx`:

```ts
useEffect(() => {
  // Rebuild InstancedMesh matrices from pad props
  for (let i = 0; i < circlePads.length; i++) {
    matrix.compose(pos, rot, scale);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, pad.selected ? selCol : defCol);
  }
  mesh.instanceMatrix.needsUpdate = true;
  invalidate();
}, [circlePads, ...]);
```

### Re-render Frequency

| Trigger                      | Frequency                       |
| ---------------------------- | ------------------------------- |
| Placement preview / drag     | Every mouse move                |
| Wire/trace routing           | Every mouse move                |
| Grid shader (follows camera) | Every zoom/pan (via `useFrame`) |
| Selection change             | On click                        |
| Document load                | Once                            |

The `frameloop="demand"` setting means the GPU only draws frames when `invalidate()` is called.

---

## 10. Dependencies and Libraries

From `src-react/package.json`:

| Package              | Version  | Purpose                                 |
| -------------------- | -------- | --------------------------------------- |
| `three`              | ^0.183.2 | Core Three.js library                   |
| `@react-three/fiber` | ^9.5.0   | React renderer for Three.js             |
| `@react-three/drei`  | ^10.7.7  | R3F utilities (`Text`, `OrbitControls`) |
| `@types/three`       | ^0.183.1 | TypeScript types                        |

### NOT Present

- `@react-three/postprocessing` — no post-processing effects
- `troika-three-text` — not a direct dependency (pulled in transitively by drei's `<Text>`)
- `three-mesh-line` — not used (manual triangulation in WireLines instead)
- `leva` — no debug GUI
- `@react-three/xr` — no XR support
- `three-stdlib` — not used

### Three.js Addons Used (from three/addons/)

- `LineSegments2` — fat line rendering for PCB traces
- `LineSegmentsGeometry` — geometry for fat lines
- `LineMaterial` — material for fat lines with `worldUnits` support

### Other Relevant Non-Three.js Dependencies

- `occt-import-js` — STEP file parsing (3D viewer)
- `@dnd-kit/*` — HTML drag-and-drop (UI, not canvas)

---

## 11. File Structure

```
src-react/src/lib/render-engine/             # R3F rendering system (THE main renderer)
├── index.ts                                  # Public API (all exports)
├── coords.ts                                 # NM_TO_SCENE, Vec2, Bounds, snapToGrid, Units
├── layers.ts                                 # RENDER_ORDER, PCB_LAYER_COLORS, PcbLayerId
│
├── camera/
│   └── use-eda-camera.ts                     # Wheel/trackpad zoom-to-cursor, pan, fitCameraToBounds
│
├── interaction/
│   ├── EdaCanvas.tsx                         # Unified R3F <Canvas> shell (orthographic, demand)
│   ├── DragDropOverlay.tsx                   # HTML bridge for native drag-drop events
│   └── types.ts                              # InteractionEvent, InteractionHandler, HitResult
│
├── primitives/
│   ├── GridShader.tsx                        # Infinite grid (custom GLSL fragment shader)
│   ├── SymbolBody.tsx                        # Symbol graphics (ShapeGeometry + LineSegments, cached)
│   ├── WireLines.tsx                         # Schematic wires (triangulated MeshBasicMaterial)
│   ├── TraceLines.tsx                        # PCB traces (LineSegments2 + LineMaterial, fat lines)
│   ├── PinDots.tsx                           # Pin connectors (InstancedMesh, per-instance color)
│   ├── PadInstances.tsx                      # PCB pads (InstancedMesh, circle + rect shapes)
│   ├── ViaInstances.tsx                      # PCB vias (2x InstancedMesh, ring + drill)
│   ├── JunctionDots.tsx                      # Wire junctions (InstancedMesh)
│   ├── RatsnestLines.tsx                     # Unrouted connections (LineDashedMaterial)
│   ├── EDAText.tsx                           # Text labels (drei <Text> / troika MSDF)
│   ├── SelectionOverlay.tsx                  # Selection boxes + rubber band
│   ├── PreviewGhost.tsx                      # Placement/routing preview (opacity wrapper)
│   └── index.ts
│
├── scenes/
│   ├── SchematicScene.tsx                    # Composes symbols, wires, pins, labels, selection
│   ├── PcbScene.tsx                          # Composes board outline, traces, pads, vias, ratsnest
│   └── index.ts
│
└── wrappers/                                 # Drop-in replacements for Canvas 2D components
    ├── SchematicCanvasR3F.tsx                # Schematic editor + interaction handler
    ├── PcbCanvasR3F.tsx                      # PCB editor + routing interaction
    ├── SymbolEditorCanvasR3F.tsx             # Symbol editor + drawing tools
    ├── FootprintEditorCanvasR3F.tsx          # Footprint editor + pad editing
    ├── SymbolPreviewR3F.tsx                  # Read-only symbol preview
    ├── FootprintPreviewR3F.tsx               # Read-only footprint preview
    └── index.ts

src-react/src/components/3d-viewer/           # Standalone 3D STEP viewer
├── StepViewer.tsx                            # R3F Canvas (PerspectiveCamera + OrbitControls)
├── geometry.ts                               # Mesh/bounds computation from STEP data
├── useStepLoader.ts                          # STEP file async loader
└── step-types.ts

src-react/src/components/pcb/canvas/          # LEGACY Canvas 2D (schematic)
├── SchematicCanvas.tsx
├── hit-test.ts                               # Screen-space hit testing (still used by R3F wrapper)
└── ...

src-react/src/components/pcb-editor/canvas/   # LEGACY Canvas 2D (PCB)
├── PcbCanvas.tsx
├── pcb-hit-test.ts                           # World-space PCB hit testing (still used)
├── pcb-viewport.ts
├── pcb-pads.ts
├── pcb-traces.ts
└── pcb-silkscreen.ts

src-react/src/components/symbol-editor/       # LEGACY Canvas 2D (symbol)
├── SymbolEditorCanvas.tsx
└── viewport.ts

src-react/src/components/footprint-editor/    # LEGACY Canvas 2D (footprint)
├── FootprintEditorCanvas.tsx
├── render-utils.ts
└── viewport.ts
```

### Shared Geometry/Material/Shader Files

No separate shared geometry/material/shader directory. Each primitive creates its own geometry and materials via `useMemo`. The only shared caching mechanism is in `SymbolBody.tsx` (global geometry cache keyed by symbol kind).

---

## Summary of Surprises & Architectural Notes

1. **No WebGPU.** Despite Three.js 0.183 supporting WebGPU, the project uses WebGL exclusively. The `WireLines` triangulation approach (instead of Line2) was designed for WebGPU forward-compatibility.

2. **Hit testing is NOT raycaster-based.** A single invisible hit plane captures all pointer events. Domain-level geometric functions (in legacy `hit-test.ts` / `pcb-hit-test.ts`) do the actual entity resolution. This is a conscious design choice — works well for 2D orthographic EDA.

3. **Dual rendering exists but migration is clear.** Legacy Canvas 2D components are present but R3F replacements cover all 4 editors + 2 previews. The `render-engine/index.ts` exports are the intended API.

4. **Only ONE custom shader** (the grid). Everything else uses built-in Three.js materials. This keeps the codebase simple.

5. **`InstancedMesh` for all repeated geometry** (pads, vias, pins, junctions). Good GPU batching strategy.

6. **Demand rendering** (`frameloop="demand"`) is the key performance feature — no wasted GPU frames.

7. **Text rendering via troika-three-text** (through drei's `<Text>`) — MSDF SDF rendering, crisp at all zooms. No bitmap fonts, no HTML overlays.

8. **Coordinate precision** — All domain data in nanometers, converted to millimeters for Three.js to avoid float32 precision loss at large coordinate values.

9. **Missing PCB features:** Copper zones/fills, multi-layer stackup visualization, DRC markers, and silkscreen graphics rendering in R3F (exists only in legacy Canvas 2D via `pcb-silkscreen.ts`).

10. **Layer system is renderOrder-based** — All geometry at z=0, `depthTest: false`, `depthWrite: false`. Layer precedence controlled entirely by integer `renderOrder` values (0-14, plus -1 for hit plane).
