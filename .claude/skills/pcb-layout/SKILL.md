---
name: pcb-layout
description: "PCB layout editor — traces, pads, vias, routing, placement, layers, board outline, ratsnest, and manufacturing. Use this skill whenever implementing or modifying PCB canvas features: trace routing (Manhattan, 45°), via placement, pad rendering, component placement/rotation/flip, layer system, ratsnest calculation, board outline, copper zones, DRC, trace width calculation, net classes, or PCB-specific interactions. Trigger for any mention of: PCB traces, trace routing, via placement, copper layers, ratsnest, airwires, pad rendering, footprint placement, board outline, design rules, clearance, trace width, solder mask, silkscreen rendering on PCB, or manufacturing export. Also trigger when the user mentions 'PCB', 'board', 'layout', 'route', 'trace', 'via', 'pad', 'copper', 'layer', 'ratsnest', 'DRC', or 'Gerber' in the context of the PCB editor."
---

# PCB Layout Editor Skill

This skill covers the PCB layout editor — traces, pads, vias, routing, placement, and manufacturing. For Three.js rendering patterns, see `r3f-eda-rendering`. For IPC standards and manufacturing rules, see `eda-standards`. For component/footprint data model, see `library`.

## Architecture

```
PcbCanvasR3F (wrapper)
├── EdaCanvas (R3F shell, orthographic, dark background #1a1a1a)
├── PcbScene (R3F scene composition)
│   ├── BoardOutline (LineBasicMaterial)
│   ├── TraceLines (LineSegments2, front/back/selected/preview groups)
│   ├── PadInstances (InstancedMesh, circle + rect shapes)
│   ├── ViaInstances (2x InstancedMesh, ring + drill)
│   ├── Silkscreen graphics
│   ├── RatsnestLines (LineDashedMaterial)
│   ├── SelectionOverlay
│   └── Routing preview
├── InteractionHandler (pointer events → store actions)
└── HitTest functions (CPU geometric math)
```

**Store**: `usePcbStore` — Zustand store with `document: PcbDocument`, `ratsnest`, viewport, layer state, selection, routing session.

**Units**: Millimeters throughout. PCB domain uses mm, Three.js scene uses mm. No nm conversion needed (unlike schematic).

## PCB document model

```typescript
interface PcbDocument {
  boardOutline: BoardOutline; // { width, height } in mm
  manufacturerPreset: string; // "jlcpcb_standard"
  netClasses: NetClass[]; // Default + Power
  nets: PcbNet[]; // resolved from schematic
  placements: PcbPlacement[]; // placed footprints
  traces: TraceSegment[]; // routed copper traces
  vias: Via[]; // through-hole vias
  zones: CopperZone[]; // copper fills (future)
}

interface TraceSegment {
  id: string;
  start: Point2D; // mm
  end: Point2D; // mm
  width: number; // mm
  layer: string; // "F.Cu" or "B.Cu"
  net: string; // net ID
}

interface Via {
  id: string;
  position: Point2D;
  padDiameter: number; // mm
  drillDiameter: number; // mm
  net: string;
  type: "through";
  layers: [string, string]; // ["F.Cu", "B.Cu"]
  tented: boolean;
}
```

See `references/data-model.md` for complete type definitions.

## Layer system

### Layer IDs (KiCad-compatible)

| Layer       | Color                  | Purpose                     |
| ----------- | ---------------------- | --------------------------- |
| `F.Cu`      | `#c87533` (orange)     | Front copper — traces, pads |
| `B.Cu`      | `#3377c8` (blue)       | Back copper — traces, pads  |
| `F.SilkS`   | `#e2e8f0` (light gray) | Front silkscreen            |
| `B.SilkS`   | `#94a3b8`              | Back silkscreen             |
| `Edge.Cuts` | `#fbbf24` (yellow)     | Board outline               |
| `F.CrtYd`   | rgba yellow            | Front courtyard             |

### Layer rendering rules

- Active layer renders at full opacity
- Inactive layers render at 0.3 opacity (dimmed)
- Through-hole pads and vias render on ALL copper layers
- Traces render only on their assigned layer
- Silkscreen renders at `FRONT_SILK` (8) or `BACK_SILK` (3) render order

### Back-side component mirroring

Components on `B.Cu` are **X-mirrored** (standard PCB convention). When rendering a back-side component:

- Mirror pad X coordinates: `x = -x`
- Use `B.SilkS` graphics instead of `F.SilkS`
- Render in back copper color (blue)

## Trace routing

Read `references/routing.md` for the complete interactive routing implementation.

### Key rules

- **Manhattan (90°)**: horizontal and vertical segments only (MVP)
- **45° routing**: horizontal → 45° diagonal → vertical (future — see reference)
- **Net assignment**: traces inherit net from the starting pad
- **Same-net only**: traces can only connect pads in the same net
- **Layer**: traces are drawn on the active layer
- **Width**: from net class defaults, cycleable with W key
- **Grid snap**: trace endpoints snap to PCB grid (0.254mm default)

### Via placement during routing

1. Press `V` mid-route
2. Commit trace segments up to cursor position
3. Place via at cursor (padDiameter and drillDiameter from net class)
4. Switch active layer (`F.Cu` ↔ `B.Cu`)
5. Continue routing on new layer from via position

### Routing state machine

```
IDLE → (click pad) → ROUTING → (click corner | click target | V | Esc)
  ↓ click target: COMPLETE → IDLE (traces added to document)
  ↓ click corner: stay ROUTING (add waypoint)
  ↓ V: VIA_PLACED → ROUTING (on new layer)
  ↓ Esc: CANCEL → IDLE (discard preview)
  ↓ W: cycle width (stay ROUTING)
  ↓ F: flip elbow direction (stay ROUTING)
```

## Ratsnest calculation

Ratsnest shows unrouted connections as dashed airwires. Uses MST (Minimum Spanning Tree) via Kruskal's algorithm.

### Algorithm

1. For each net with 2+ pads: collect pad world positions
2. Build Union-Find with one element per pad
3. **Account for routed traces**: for each trace in this net, find pads at start/end (0.01mm tolerance), union them
4. **Account for vias**: vias connect pads across layers at the same position
5. Find connected groups from Union-Find
6. If all pads connected → fully routed, no ratsnest
7. If multiple groups → MST between group centroids = ratsnest lines

### Pad world position resolution

```typescript
function resolvePadWorldPosition(placement, padNumber) {
  const pad = placement.footprintData.pads.find((p) => p.number === padNumber);
  // Rotate by placement.rotation
  // Mirror X if placement.layer === "B.Cu"
  // Translate by placement.position
  return { x, y };
}
```

**Critical**: This function MUST be consistent across ratsnest, hit-testing, and trace endpoint matching. Use ONE shared implementation.

## Component placement

### Placement from schematic sync

When user switches to PCB tab, `syncSchematicToPcb()` runs:

- New schematic symbols → auto-placed near board center
- Existing symbols → preserve PCB positions
- Deleted symbols → remove from PCB
- Power symbols (GND, VCC) → skipped (no footprint)

### Interaction

- Click to select placement
- Drag to move (snaps to grid)
- R key: rotate 90° (or context menu)
- F key: flip front↔back (toggles `placement.layer`)
- Delete: remove placement

## Net classes

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

Nets named "GND" or "VCC" → Power class. All others → Default class.

Trace width cycling presets (W key): `[0.15, 0.2, 0.25, 0.3, 0.5, 0.8, 1.0]` mm.

## PCB grid

```typescript
PCB_GRID_PRESETS = [
  { label: "1.27mm (50mil)", size: 1.27 }, // through-hole spacing
  { label: "0.635mm (25mil)", size: 0.635 }, // fine placement
  { label: "0.254mm (10mil)", size: 0.254 }, // routing grid (DEFAULT)
  { label: "0.127mm (5mil)", size: 0.127 }, // fine routing
  { label: "0.1mm", size: 0.1 }, // metric fine
];
```

## Footprint rendering from kicadPayload

Footprint data is `ParsedKicadFootprint` stored as `Record<string, unknown>` in `kicadPayload`. Key substructures:

### Pad rendering

```typescript
interface ParsedPad {
  number: string; // "1", "2"
  type: "smd" | "thru_hole" | "np_thru_hole" | "connect";
  shape: "circle" | "rect" | "oval" | "roundrect" | "trapezoid" | "custom";
  position: { x: number; y: number }; // relative to footprint origin, mm
  size: { width: number; height: number };
  rotation: number;
  layers: string[]; // ["F.Cu", "F.Mask", "F.Paste"]
  roundrectRatio?: number; // 0-1 for roundrect shape
  drillDiameter?: number; // for thru_hole
}
```

### Silkscreen rendering

```typescript
interface ParsedGraphic {
  type: "line" | "rect" | "circle" | "arc" | "poly" | "text";
  layer: string;            // "F.SilkS", "F.Fab", etc.
  data: Record<string, unknown>;  // NOT strongly typed
}

// Line data format:
{ start: [x, y], end: [x, y], width: number }  // arrays, not objects!

// Circle data format:
{ center: [x, y], radius: number, width: number }
```

**Warning**: `data.start` and `data.end` are **arrays** `[x, y]`, not objects `{x, y}`. Parse defensively.

## Anti-patterns

| Don't                                                      | Do instead                                  |
| ---------------------------------------------------------- | ------------------------------------------- |
| Connect pads from different nets                           | Validate net match before completing route  |
| Ignore layer when hit-testing pads                         | Filter by active layer first                |
| Different pad position calculation in ratsnest vs hit-test | Single shared `resolvePadWorldPosition()`   |
| Store ratsnest in document                                 | Derive from nets + traces + vias (computed) |
| Assume `data.start` is `{x, y}`                            | It's `[x, y]` — parse as array              |
| Render traces with pixel-width lines                       | Use `LineSegments2` with `worldUnits: true` |

## File locations

| Area               | Path                                              |
| ------------------ | ------------------------------------------------- |
| R3F wrapper        | `render-engine/wrappers/PcbCanvasR3F.tsx`         |
| Scene              | `render-engine/scenes/PcbScene.tsx`               |
| Trace rendering    | `render-engine/primitives/TraceLines.tsx`         |
| Pad rendering      | `render-engine/primitives/PadInstances.tsx`       |
| Via rendering      | `render-engine/primitives/ViaInstances.tsx`       |
| Ratsnest rendering | `render-engine/primitives/RatsnestLines.tsx`      |
| Store              | `stores/pcb-store.ts`                             |
| Hit testing        | `components/pcb-editor/canvas/pcb-hit-test.ts`    |
| Ratsnest calc      | `components/pcb-editor/ratsnest.ts`               |
| Sync logic         | `components/pcb-editor/schematic-pcb-sync.ts`     |
| Routing            | `components/pcb-editor/routing/manhattan-path.ts` |
| PCB types          | `components/pcb-editor/pcb-types.ts`              |
| Layer colors       | `render-engine/layers.ts`                         |
