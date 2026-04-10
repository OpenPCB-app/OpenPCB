---
name: r3f-eda-rendering
description: "React Three Fiber rendering patterns for the EDA web application. Use this skill whenever implementing ANY visual rendering, canvas interaction, geometry creation, material setup, hit-testing, text rendering, or scene graph modification in the schematic editor, PCB editor, symbol editor, or footprint editor. Trigger for: adding new R3F primitives, modifying render order, creating InstancedMesh components, rendering lines/traces/wires, adding text labels, implementing selection highlighting, creating preview ghosts, modifying the grid, handling pointer events on canvas, coordinate conversion (nm↔mm↔screen), or debugging rendering issues. Also trigger when the user mentions 'canvas', 'render', 'Three.js', 'R3F', 'mesh', 'geometry', 'material', 'scene', or 'shader' in the context of the EDA editors."
---

# R3F EDA Rendering Patterns

This skill defines how visual rendering works across all EDA editors in this project. Read this BEFORE writing any rendering code.

## Architecture overview

All EDA editors use **React Three Fiber (R3F)** with an orthographic camera, demand-based rendering, and a shared `EdaCanvas` shell. NO Canvas2D — it is legacy and must not be used.

```
EdaCanvas (shared shell)
├── OrthographicCamera (zoom = px/mm, position controls pan)
├── BackgroundHitPlane (invisible, catches all pointer events)
├── GridShader (custom GLSL, infinite grid)
└── [Editor-specific scene] ← SchematicScene | PcbScene | etc.
```

## Critical rules — NEVER violate

1. **NEVER use HTML5 Canvas2D.** All rendering goes through R3F. Legacy Canvas2D files in `components/pcb/canvas/` and `components/pcb-editor/canvas/` exist only for reference — never import or modify them for rendering.
2. **NEVER use `frameloop="always"`.** The app uses `frameloop="demand"`. Call `invalidate()` after any state change that affects visuals.
3. **NEVER create raw Three.js objects imperatively** (no `new THREE.Scene()`, `new THREE.Mesh()`). Use R3F's JSX: `<mesh>`, `<group>`, `<instancedMesh>`.
4. **NEVER use `depthTest: true` or `depthWrite: true`** on EDA materials. All geometry sits at z=0; layer order is controlled by `renderOrder`.
5. **NEVER put interaction logic inside R3F primitives.** Primitives are pure renderers. Interactions go through the hit plane → interaction handler → Zustand store → re-render cycle.
6. **NEVER hardcode colors.** Import from `layers.ts` (`PCB_LAYER_COLORS`) or pass colors via props.

## Coordinate system

| Level | Unit | Purpose |
|-------|------|---------|
| Domain/store | Nanometers (integer) | All entity positions, pin locations, wire endpoints |
| Three.js scene | Millimeters (float) | Rendering — avoids float32 precision issues |
| Screen | Pixels | Mouse events, hit radius |

```typescript
// coords.ts
export const NM_TO_SCENE = 1_000_000;
export function nmToScene(nm: number): number { return nm / NM_TO_SCENE; }
export function sceneToNm(scene: number): number { return scene * NM_TO_SCENE; }
```

Schematic scenes apply a root group scale: `<group scale={[1/NM_TO_SCENE, 1/NM_TO_SCENE, 1]}>` so child positions can use raw nanometer values.

PCB scenes work directly in mm (PCB domain units are mm, not nm).

**Y-axis**: Y-up (Three.js default). Positive Y = up on screen.

## Render order system

All geometry at z=0, `depthTest: false`, `depthWrite: false`. Layer precedence via integer `renderOrder`:

| Constant | Value | Content |
|----------|-------|---------|
| `HIT_PLANE` | -1 | Invisible pointer capture plane |
| `GRID` | 0 | Grid shader |
| `BOARD_OUTLINE` | 1 | PCB board edge |
| `BACK_COPPER` | 2 | PCB back layer traces/pads |
| `BACK_SILK` | 3 | PCB back silkscreen |
| `WIRES` | 5 | Schematic wires |
| `BODIES` | 6 | Schematic symbol bodies |
| `FRONT_COPPER` | 7 | PCB front layer traces/pads |
| `FRONT_SILK` | 8 | PCB front silkscreen |
| `PINS` | 9 | Pin dots, pads, vias |
| `LABELS` | 10 | Text labels |
| `RATSNEST` | 11 | Ratsnest airwires |
| `JUNCTIONS` | 12 | Wire junction dots |
| `SELECTION` | 13 | Selection overlays |
| `PREVIEW` | 14 | Placement/routing preview |

**Rule**: New elements must use an existing render order constant or define a new one in `layers.ts`. Never use magic numbers.

## Rendering patterns by geometry type

Read `references/rendering-patterns.md` for detailed patterns covering:
- InstancedMesh for bulk repeated geometry (pads, vias, pins, junctions)
- LineSegments2 + LineMaterial for PCB traces (fat lines with world-unit width)
- Triangulated MeshBasicMaterial for schematic wires
- ShapeGeometry + LineSegments for symbol bodies
- EDAText (drei `<Text>`) for all text labels
- LineDashedMaterial for ratsnest lines
- Custom GridShader for infinite grid

## Hit testing pattern

Read `references/hit-testing.md` for the hit-testing architecture:
- Invisible BackgroundHitPlane captures all pointer events
- Domain-level geometric functions resolve entity hits (CPU-based, not Raycaster)
- No `userData` on Three.js objects
- Priority ordering for hit targets

## State synchronization pattern

```
User Input → InteractionHandler → Zustand Store Action
  → State Update → React Re-render → R3F Props Updated
  → Geometry/Material update (useEffect/useMemo) → invalidate()
  → WebGL Frame Rendered
```

**Store does NOT directly mutate Three.js objects.** Data flows Zustand → React props → R3F primitives.

## File locations

| Area | Path |
|------|------|
| Render engine root | `src-react/src/lib/render-engine/` |
| Coordinates & units | `render-engine/coords.ts` |
| Layer constants | `render-engine/layers.ts` |
| Canvas shell | `render-engine/interaction/EdaCanvas.tsx` |
| Camera/zoom/pan | `render-engine/camera/use-eda-camera.ts` |
| Primitives | `render-engine/primitives/*.tsx` |
| Scenes | `render-engine/scenes/*.tsx` |
| Wrappers | `render-engine/wrappers/*.tsx` |

## Anti-patterns

| Don't | Do instead |
|-------|------------|
| `new THREE.Mesh(geom, mat)` + `scene.add()` | `<mesh><bufferGeometry /><meshBasicMaterial /></mesh>` |
| Continuous render loop | `frameloop="demand"` + `invalidate()` |
| `ctx.fillRect()` / Canvas2D | R3F primitives |
| Raycaster for 2D picking | Hit plane + geometric math |
| `depthTest: true` | `depthTest: false`, `depthWrite: false` on all materials |
| `material.color = new Color(...)` in render | Pass color as prop, update in `useEffect` |
| Creating geometry every render | `useMemo` for geometry, reuse shared instances |
