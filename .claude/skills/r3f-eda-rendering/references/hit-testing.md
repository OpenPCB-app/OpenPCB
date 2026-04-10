# Hit Testing Architecture — Detailed Reference

## Overview

Hit testing in this EDA app is **NOT raycaster-based**. It uses a two-layer architecture:

1. **R3F pointer events on BackgroundHitPlane** — catches all clicks, provides world coordinates
2. **Domain-level geometric functions** — CPU-based math determines which entity was clicked

## Why not Raycaster?

- All geometry is 2D at z=0 — raycasting is overkill
- InstancedMesh raycasting is expensive and imprecise
- Domain-level hit testing gives exact control over priority ordering
- Hit radii can be zoom-dependent (important for pin dots at different zoom levels)

## BackgroundHitPlane

```tsx
// EdaCanvas.tsx
<mesh renderOrder={RENDER_ORDER.HIT_PLANE}> {/* -1, behind everything */}
  <planeGeometry args={[10_000, 10_000]} />
  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
</mesh>
```

This invisible plane captures ALL pointer events. The `onPointerDown`, `onPointerMove`, `onPointerUp` handlers extract `event.point` (scene coordinates) and convert to domain units.

## Event flow

```
R3F pointer event on hit plane
  → e.point (scene mm coordinates)
  → sceneToNm() conversion
  → snapToGrid() if applicable
  → InteractionHandler.onPointerDown({ worldPoint, snappedPoint, modifiers })
  → Handler calls domain hit-test function
  → Hit result determines action (select, start drag, start wire, etc.)
```

## Schematic hit testing

**File**: `components/pcb/canvas/hit-test.ts` (legacy path, still used by R3F wrapper)

**Priority order** (first match wins):
1. Pin connectors — circle test, `PIN_HIT_RADIUS_NM` (500,000nm = 0.5mm)
2. Symbol bodies — AABB test against symbol bounds
3. Net labels — AABB test against label bounds
4. Wire segments — point-to-segment distance

```typescript
type SchematicHitTarget =
  | { kind: "connector"; symbolId: string; pinId: string }
  | { kind: "body"; symbolId: string }
  | { kind: "netLabel"; labelId: string }
  | { kind: "wire"; wireId: string }
  | null;
```

**Pin detection** uses screen-space radius (zoom-independent):
```typescript
const screenDist = worldDist * camera.zoom;
if (screenDist < PIN_HIT_RADIUS_PX) → hit
```

**Symbol body** uses world-space AABB from `getSymbolBodyBounds()`.

## PCB hit testing

**File**: `components/pcb-editor/canvas/pcb-hit-test.ts` (legacy path, still used)

**Priority order** (first match wins):
1. Pads on active layer — AABB with rotation transform
2. Vias — circle distance check (`padDiameter / 2`)
3. Traces — point-to-segment distance (`width / 2 + 0.1mm` tolerance)
4. Placement bodies — footprint bounding box

```typescript
type PcbHitTarget =
  | { kind: "pad"; placementId: string; padNumber: string }
  | { kind: "via"; viaId: string }
  | { kind: "trace"; traceId: string }
  | { kind: "placement"; placementId: string }
  | null;
```

**Active layer filtering**: pads on the non-active layer are deprioritized (tested last, not first).

**Trace hit detection** — point-to-line-segment distance:
```typescript
function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
// Hit if: distance < trace.width / 2 + 0.1 (mm tolerance)
```

## Rules for new hit targets

When adding a new entity type that needs to be clickable:

1. Add a new variant to the hit target union type
2. Add geometric test function with appropriate tolerance
3. Insert into priority order (smaller targets = higher priority)
4. Test at multiple zoom levels — hit radii should feel consistent
5. Do NOT add Three.js event handlers to the geometry — use the domain hit test
6. Do NOT use `userData` on Three.js objects

## Coordinate conversion for hit testing

```typescript
// In R3F wrapper interaction handler:
const worldNm = {
  x: sceneToNm(event.point.x),
  y: sceneToNm(event.point.y),
};
const snapped = snapToGrid(worldNm, gridSize);
const hit = hitTest(worldNm, entities, camera.zoom);
```

For PCB (mm-based): no nm conversion needed, `event.point` is already in mm.
