# PCB Interactive Routing — Detailed Reference

## Routing state machine

```typescript
interface RoutingSession {
  netId: string;
  layer: string;                          // current routing layer
  width: number;                          // current trace width (mm)
  widthPresets: number[];                 // from net class
  widthIndex: number;
  elbowDirection: "horizontal_first" | "vertical_first";
  committedSegments: TraceSegment[];      // segments already clicked
  committedVias: Via[];                   // vias already placed
  startPoint: Point2D;                    // last committed point
  previewSegments: TraceSegment[];        // live preview to cursor
}
```

### State transitions

| Current state | Event | Next state | Action |
|---------------|-------|------------|--------|
| IDLE | Click pad | ROUTING | Start session: resolve net, net class widths, set start point |
| ROUTING | Mouse move | ROUTING | Recalculate preview segments |
| ROUTING | Click empty | ROUTING | Commit preview as segments, update startPoint to corner |
| ROUTING | Click target pad (same net) | IDLE | Commit all segments + vias to document, recalc ratsnest |
| ROUTING | Click pad (different net) | ROUTING | Ignore (don't connect different nets) |
| ROUTING | Press V | ROUTING (new layer) | Commit to cursor, place via, switch layer |
| ROUTING | Press W | ROUTING | Cycle width forward |
| ROUTING | Press Shift+W | ROUTING | Cycle width backward |
| ROUTING | Press F | ROUTING | Toggle elbowDirection |
| ROUTING | Press Esc | IDLE | Discard session, no document changes |

## Manhattan path calculation (90°)

```typescript
function calculateManhattanPath(
  from: Point2D, to: Point2D,
  elbowDirection: "horizontal_first" | "vertical_first",
  width: number, layer: string, net: string
): TraceSegment[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Pure horizontal or vertical — single segment
  if (Math.abs(dx) < 0.001 || Math.abs(dy) < 0.001) {
    return [{ id: generateId(), start: from, end: to, width, layer, net }];
  }

  if (elbowDirection === "horizontal_first") {
    const mid = { x: to.x, y: from.y };
    return [
      { id: generateId(), start: from, end: mid, width, layer, net },
      { id: generateId(), start: mid, end: to, width, layer, net },
    ];
  } else {
    const mid = { x: from.x, y: to.y };
    return [
      { id: generateId(), start: from, end: mid, width, layer, net },
      { id: generateId(), start: mid, end: to, width, layer, net },
    ];
  }
}
```

## 45° path calculation (future)

```typescript
function calculate45DegreePath(
  from: Point2D, to: Point2D, horizontalFirst: boolean
): Point2D[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const diag = Math.min(absDx, absDy);

  if (absDx === 0 || absDy === 0) return [from, to];

  if (horizontalFirst) {
    const straightLen = absDx - diag;
    const midX = from.x + Math.sign(dx) * straightLen;
    return [from, { x: midX, y: from.y }, to];
  } else {
    const straightLen = absDy - diag;
    const midY = from.y + Math.sign(dy) * straightLen;
    return [from, { x: from.x, y: midY }, to];
  }
}
```

## Trace width cycling

```typescript
const STANDARD_WIDTHS = [0.15, 0.2, 0.25, 0.3, 0.5, 0.8, 1.0]; // mm

function cycleTraceWidth(session: RoutingSession, direction: 1 | -1): number {
  const presets = session.widthPresets.length > 0
    ? session.widthPresets
    : STANDARD_WIDTHS;
  session.widthIndex = (session.widthIndex + direction + presets.length) % presets.length;
  return presets[session.widthIndex];
}
```

## Via placement

```typescript
function placeRoutingVia(session: RoutingSession, position: Point2D, netClass: NetClass): void {
  // 1. Commit preview segments to cursor position
  session.committedSegments.push(...session.previewSegments);

  // 2. Create via
  const via: Via = {
    id: generateId(),
    position: snapToGrid(position, gridSize),
    padDiameter: netClass.viaDiameter,
    drillDiameter: netClass.viaDrill,
    net: session.netId,
    type: "through",
    layers: ["F.Cu", "B.Cu"],
    tented: true,
  };
  session.committedVias.push(via);

  // 3. Switch layer
  session.layer = session.layer === "F.Cu" ? "B.Cu" : "F.Cu";

  // 4. Update start point
  session.startPoint = via.position;

  // 5. Clear preview
  session.previewSegments = [];
}
```

## Completing a route

```typescript
function completeRoute(session: RoutingSession, targetPosition: Point2D): void {
  // 1. Calculate final segments to target
  const finalSegments = calculateManhattanPath(
    session.startPoint, targetPosition,
    session.elbowDirection, session.width, session.layer, session.netId
  );

  // 2. Assign real IDs to all segments
  const allSegments = [...session.committedSegments, ...finalSegments].map(seg => ({
    ...seg,
    id: generateId(),
  }));

  // 3. Push undo snapshot BEFORE modifying document
  undoManager.pushUndo("Route trace", structuredClone(document));

  // 4. Add to document
  document.traces.push(...allSegments);
  document.vias.push(...session.committedVias);

  // 5. Clear session
  routingSession = null;

  // 6. Recalculate ratsnest (traces now connect some pads)
  ratsnest = recalculateRatsnest(document);
}
```

## Trace deletion

Select a trace → Delete key:
1. Push undo snapshot
2. Remove trace from `document.traces`
3. Also remove any "orphaned" vias (vias not connected to any remaining trace)
4. Recalculate ratsnest

## Interaction controller integration

```typescript
// In usePcbInteractionController:
if (activeTool === "route") {
  onPointerDown:
    const hit = hitTestPcb(point);
    if (hit?.kind === "pad") {
      const net = findPadNet(hit.placementId, hit.padNumber, document.nets);
      if (!routingSession) {
        startRouting(hit, padWorldPosition);
      } else if (net === routingSession.netId) {
        completeRoute(padWorldPosition);
      }
    } else if (routingSession) {
      addRoutingCorner(snappedPoint);
    }

  onPointerMove:
    if (routingSession) {
      updateRoutingPreview(snappedPoint);
    }
}
```
