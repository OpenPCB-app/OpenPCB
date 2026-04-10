---
name: schematic-editor
description: "Schematic capture editor — symbols, wires, net labels, pins, and connectivity. Use this skill whenever implementing or modifying schematic canvas features: symbol placement, wire routing (Manhattan), net label placement, junction detection, net extraction, pin connectivity, schematic selection/interaction, symbol rendering, wire rendering, or schematic-specific keyboard shortcuts. Trigger for any mention of: schematic wiring, wire routing in schematic, net labels, pin connections, symbol placement, schematic canvas interactions, junction dots, wire waypoints, schematic hit-testing, or electrical connectivity extraction. Also trigger when the user mentions 'schematic', 'wiring', 'net label', 'junction', 'ERC', or 'netlist' in the context of the schematic editor."
---

# Schematic Editor Skill

This skill covers the schematic capture editor — how symbols, wires, net labels, and connectivity work. For rendering specifics (Three.js patterns), see the `r3f-eda-rendering` skill. For component data model, see `component-library` skill.

## Architecture

```
SchematicCanvasR3F (wrapper)
├── EdaCanvas (R3F shell, orthographic, demand rendering)
├── SchematicScene (R3F scene composition)
│   ├── WireLines (triangulated mesh, MeshBasicMaterial)
│   ├── JunctionDots (InstancedMesh)
│   ├── Net labels (EDAText instances)
│   ├── Symbol groups (SymbolBody + EDAText per symbol)
│   ├── PinDots (InstancedMesh, per-instance color)
│   ├── SelectionOverlay
│   └── PreviewGhost
├── InteractionHandler (pointer events → store actions)
└── HitTest functions (CPU geometric math)
```

**Store**: `useSchematicStore` — Zustand store with `persisted.document`, `derived.connectivity`, `chrome` (UI state), `session` (active tool state).

**Units**: All positions in **nanometers** (integer). Scene scale: `1/NM_TO_SCENE` group transform converts nm → mm for Three.js.

## Schematic document model

```typescript
interface SchematicDocument {
  symbols: SchematicSymbol[];
  wires: SchematicWire[];
  netLabels: SchematicNetLabel[];  // or 'labels' depending on schema
}

interface SchematicSymbol {
  id: string;
  componentId: string;      // library component reference
  variantId: string;         // selected variant
  position: { x: number; y: number };  // nanometers
  rotation: number;          // 0, 90, 180, 270
  mirrored?: boolean;
  reference: string;         // "R1", "C3"
  pins: SchematicPin[];
}

interface SchematicWire {
  id: string;
  points: Point[];           // polyline waypoints (nanometers, absolute)
  sourcePinId: string;       // pin ID at start
  targetPinId: string;       // pin ID at end
  net?: string | null;       // assigned net name
}

interface SchematicNetLabel {
  id: string;
  name: string;              // "SDA", "VCC", "GPIO_4"
  position: Point;           // nanometers
  rotation?: number;
}
```

## Wire routing standards

### Manhattan routing (90° only)
All schematic wires use **orthogonal Manhattan routing** — horizontal and vertical segments only, no diagonals. This is the universal EDA standard for schematics.

### Wire creation flow
1. User clicks a pin connector → begin wire session
2. Mouse move → preview shows Manhattan path from start to cursor
3. Click → add waypoint (creates an elbow/corner)
4. Click on target pin → commit wire
5. Esc → cancel, discard preview

### Elbow direction
Each segment pair forms an L-shaped elbow. The elbow direction alternates or can be flipped with `F` key:
- **Horizontal first**: horizontal segment → vertical segment
- **Vertical first**: vertical segment → horizontal segment

### Wire endpoint rules
- Wires MUST start and end at pin connectors
- Wire points are absolute world coordinates (nanometers)
- Wire stores `sourcePinId` and `targetPinId` for explicit connectivity
- Coordinate-based junction detection provides implicit connectivity

### Junction detection
When 3+ wire endpoints meet at the same coordinate, a **junction dot** is rendered. Junctions are derived (not stored) — computed from wire endpoint coordinates using exact string-key matching (`${x}:${y}`).

```typescript
// Existing: deriveWireJunctions() in wires.ts
// Groups wire endpoints by "${x}:${y}" key
// Returns junctions where 3+ endpoints meet
```

**No epsilon tolerance** — coordinates must match exactly. This is intentional and matches the snap-to-grid behavior.

## Net extraction algorithm

Full net extraction derives which pins are electrically connected. See `references/net-extraction.md` for the complete algorithm.

**Key rules**:
- Pin ID references (`sourcePinId`/`targetPinId`) are the primary connection method
- Coordinate-based matching is fallback (for junctions)
- Net labels with the same name merge disconnected groups
- Power symbols (GND, VCC) create implicit named nets — all GND pins are in one net
- Auto-name unnamed nets as `Net_1`, `Net_2`, etc.

## Pin position calculation

Pin positions on symbols are stored **relative to the symbol origin**. World positions require transform:

```typescript
// symbols.ts
function transformSymbolLocalPoint(symbol, point) {
  // Apply mirror → rotation (0/90/180/270) → translate by symbol.position
}

function getWorldConnectorAnchors(symbol) {
  return Object.fromEntries(
    symbol.pins.map(pin => [pin.id, transformSymbolLocalPoint(symbol, pin.position)])
  );
}
```

**Rule**: Always use `getWorldConnectorAnchors()` or `transformSymbolLocalPoint()` to get pin world positions. Never assume pin.position is absolute.

## Interaction patterns

### Tool modes
| Tool | Trigger | Behavior |
|------|---------|----------|
| `select` | Default | Click to select, drag to move, rubber-band select |
| `placement` | Drag from palette | Ghost follows cursor, click to place |
| `wire` | Click pin connector | Manhattan routing preview, click to add waypoints |
| `netLabel` | Click tool button | Click to place, inline text input for name |

### Selection rules
- Click body → select symbol
- Click wire → select wire
- Click net label → select net label
- Shift+click → add to selection
- Click empty space → deselect all
- Ctrl+A → select all
- Delete/Backspace → delete selected entities (cascading: deleting a symbol also deletes its connected wires)

### Undo/redo
Document-snapshot undo. Each undoable action captures `structuredClone(document)` before mutation. Separate undo stack from PCB editor.

**Undoable actions**: commitPlacement, commitWire, commitDragMove, deleteSelectedEntities, commitNetLabel, updateSymbolValue, updateNetLabelText.

**Not undoable**: viewport changes, selection changes, tool mode changes.

## Anti-patterns

| Don't | Do instead |
|-------|------------|
| Diagonal wires in schematic | Manhattan routing only (horizontal + vertical) |
| Store junction dots in document | Derive from wire endpoints (computed, not persisted) |
| Pin positions as absolute coordinates | Relative to symbol origin + transform |
| Create wires without pin references | Always set sourcePinId and targetPinId |
| Skip re-deriving connectivity | Call `deriveConnectivity()` after every document mutation |

## File locations

| Area | Path |
|------|------|
| R3F wrapper | `render-engine/wrappers/SchematicCanvasR3F.tsx` |
| Scene | `render-engine/scenes/SchematicScene.tsx` |
| Wire rendering | `render-engine/primitives/WireLines.tsx` |
| Symbol rendering | `render-engine/primitives/SymbolBody.tsx` |
| Pin rendering | `render-engine/primitives/PinDots.tsx` |
| Junction rendering | `render-engine/primitives/JunctionDots.tsx` |
| Text | `render-engine/primitives/EDAText.tsx` |
| Store | `stores/schematic-store.ts` |
| Hit testing | `components/pcb/canvas/hit-test.ts` |
| Net extraction | `components/pcb/canvas/net-extraction.ts` |
| Document types | `components/pcb/types.ts` |
| Shared types | `src-ts/shared/types/pcb.types.ts` |
