# Render Engine

GPU-accelerated WebGL rendering via Three.js + React Three Fiber. Replaces Canvas 2D.

## Architecture

```
render-engine/
├── camera/        # Zoom/pan controls, camera fitting
├── coords.ts      # Unit system (nm, mm, mils, screen px)
├── layers.ts      # Render order, PCB layer colors
├── hit-test/      # Picking, selection detection
├── interaction/   # EdaCanvas wrapper, drag-drop overlay
├── primitives/    # Reusable R3F components
├── scenes/        # Schematic/PCB scene composers
├── adapters/      # Drop-in canvas replacements
└── testing/       # Test utilities
```

## Unit System

All geometry in **nanometers** internally. Convert at boundaries:

```typescript
import { Units, type Nanometers, type Mm } from "./coords";
const nm: Nanometers = Units.mmToNm(1.27); // 1.27mm pad
const mm: Mm = Units.nmToMm(nm);
```

Grid presets: `GRID_PRESETS.METRIC_1MM`, `GRID_PRESETS.IMPERIAL_100MIL`

## Render Order

Z-ordering via `RENDER_ORDER` constants:

```typescript
RENDER_ORDER.GRID <
  RENDER_ORDER.TRACES <
  RENDER_ORDER.PADS <
  RENDER_ORDER.SYMBOLS;
```

## Primitives

| Component          | Purpose                              |
| ------------------ | ------------------------------------ |
| `GridShader`       | Infinite grid with major/minor lines |
| `SymbolBody`       | Symbol outline + fill                |
| `WireLines`        | Schematic wires (InstancedMesh)      |
| `TraceLines`       | PCB traces with width                |
| `PinDots`          | Pin connection points                |
| `PadInstances`     | SMD/TH pads (instanced)              |
| `ViaInstances`     | Via holes                            |
| `JunctionDots`     | Wire junction indicators             |
| `RatsnestLines`    | Unrouted connections                 |
| `EDAText`          | Text labels (troika-three-text)      |
| `SelectionOverlay` | Selection highlight boxes            |
| `RubberBand`       | Drag selection rectangle             |
| `PreviewGhost`     | Placement preview (semi-transparent) |

## Adapters (Drop-in Replacements)

```typescript
import { SchematicCanvasR3F, PcbCanvasR3F } from "@/lib/render-engine";
// Replace old Canvas2D components directly
```

## Performance

- Use `InstancedMesh` for repeated geometry (pads, vias, pins)
- Batch updates via `invalidate()` not continuous render
- Cache geometry in `clearGeometryCache()` on unmount
- Frustum culling automatic via Three.js

## Hit Testing

```typescript
import { type HitResult } from "./interaction";
// HitResult: { type: 'symbol'|'wire'|'pad'|..., id: string, ... }
```

Hit radius for connectors: `CONNECTOR_HIT_RADIUS_PX` (screen pixels)

## Adding New Primitives

1. Create component in `primitives/`
2. Export from `primitives/index.ts`
3. Add to scene composer in `scenes/`
4. Update `RENDER_ORDER` if needed
