/**
 * Obstacle collection for the schematic auto-router.
 *
 * Builds the rectangle set the Manhattan A* must avoid when routing a pin→pin
 * wire: other component bodies, existing wires (thin per-segment rects), and
 * power/ground/portal primitives. Endpoints escape their own owners:
 *  - the two parts that own the endpoint pins are excluded (pin-escape),
 *  - a primitive that owns an endpoint is excluded,
 *  - wires that share an endpoint pin are excluded (same-net wires legitimately
 *    touch — treating them as walls would block the very connection we make).
 *
 * Everything is corridor-culled around the source→target bbox so far-away
 * geometry can't bloat the lattice. Deterministic: pure integer-nm, and the
 * output Rect order does not affect the router (its A* tie-break is
 * order-independent).
 */
import type {
  DesignerPin,
  DesignerPrimitive,
  DesignerSchematicProjection,
} from "../../../../sdks/designer/types";
import {
  inflateRect,
  routeSchematicWire,
  type Rect,
} from "./schematic-autoroute";
import type { Point } from "./manhattan";

/** Inflation around each part's pin bounding box. */
export const WIRE_OBSTACLE_MARGIN_NM = 1_270_000;
/** Margin around the source→target bbox within which geometry counts. */
export const WIRE_OBSTACLE_CORRIDOR_NM = 25_000_000;
/** Inflation around each existing wire segment — small so parallel buses can
 *  pack one grid apart rather than detour wildly. */
export const WIRE_WIRE_MARGIN_NM = 2_000_000;
/** Inflation around each power/ground/portal primitive body. */
export const PRIMITIVE_OBSTACLE_MARGIN_NM = 1_270_000;

const PRIMITIVE_PIN_PREFIX = "primitive:";

/** Primitive body bounds (nm) — mirrors the frontend PRIMITIVE_LOCAL_BOUNDS_MM.
 *  Connection point is the local origin (0,0). */
const PRIMITIVE_BOUNDS_NM: Record<
  DesignerPrimitive["kind"],
  { minX: number; minY: number; maxX: number; maxY: number }
> = {
  gnd: { minX: -2_032_000, minY: -3_556_000, maxX: 2_032_000, maxY: 0 },
  pwr: { minX: -1_270_000, minY: 0, maxX: 1_270_000, maxY: 2_794_000 },
  net_portal: { minX: -4_470_000, minY: -1_016_000, maxX: 0, maxY: 1_016_000 },
};

function pinOwnerPartId(pinId: string): string | null {
  if (pinId.startsWith(PRIMITIVE_PIN_PREFIX)) return null;
  const idx = pinId.indexOf(":");
  return idx > 0 ? pinId.slice(0, idx) : null;
}

function primitiveIdFromPinId(pinId: string): string | null {
  return pinId.startsWith(PRIMITIVE_PIN_PREFIX)
    ? pinId.slice(PRIMITIVE_PIN_PREFIX.length)
    : null;
}

/** Approx body half-extent + clearance inflated around a part's pin bbox. */
export function partObstacleRect(
  part: DesignerSchematicProjection["parts"][number],
): Rect | null {
  if (part.pins.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pin of part.pins) {
    minX = Math.min(minX, pin.worldPositionNm.x);
    minY = Math.min(minY, pin.worldPositionNm.y);
    maxX = Math.max(maxX, pin.worldPositionNm.x);
    maxY = Math.max(maxY, pin.worldPositionNm.y);
  }
  return inflateRect({ minX, minY, maxX, maxY }, WIRE_OBSTACLE_MARGIN_NM);
}

function rotatePointNm(x: number, y: number, deg: number): Point {
  const r = ((deg % 360) + 360) % 360;
  if (r === 90) return { x: -y, y: x };
  if (r === 180) return { x: -x, y: -y };
  if (r === 270) return { x: y, y: -x };
  return { x, y };
}

/** Rotated, translated, inflated obstacle box for a primitive body. */
function primitiveObstacleRect(prim: DesignerPrimitive): Rect {
  const b = PRIMITIVE_BOUNDS_NM[prim.kind];
  const corners = [
    rotatePointNm(b.minX, b.minY, prim.rotationDeg),
    rotatePointNm(b.maxX, b.minY, prim.rotationDeg),
    rotatePointNm(b.minX, b.maxY, prim.rotationDeg),
    rotatePointNm(b.maxX, b.maxY, prim.rotationDeg),
  ];
  const rect: Rect = {
    minX: Math.min(...corners.map((c) => c.x)) + prim.positionNm.x,
    minY: Math.min(...corners.map((c) => c.y)) + prim.positionNm.y,
    maxX: Math.max(...corners.map((c) => c.x)) + prim.positionNm.x,
    maxY: Math.max(...corners.map((c) => c.y)) + prim.positionNm.y,
  };
  return inflateRect(rect, PRIMITIVE_OBSTACLE_MARGIN_NM);
}

/** Thin axis-aligned obstacle rect per wire segment. */
function wireSegmentRects(points: Point[]): Rect[] {
  const rects: Rect[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    rects.push(
      inflateRect(
        {
          minX: Math.min(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxX: Math.max(a.x, b.x),
          maxY: Math.max(a.y, b.y),
        },
        WIRE_WIRE_MARGIN_NM,
      ),
    );
  }
  return rects;
}

function intersectsCorridor(rect: Rect, corridor: Rect): boolean {
  return !(
    rect.maxX < corridor.minX ||
    rect.minX > corridor.maxX ||
    rect.maxY < corridor.minY ||
    rect.minY > corridor.maxY
  );
}

/**
 * Collect every obstacle rect for routing source→target. `wires` defaults to
 * the projection's wires but can be overridden (e.g. by the arrange pass, which
 * re-routes against in-progress geometry).
 */
export function collectWireObstacles(
  projection: DesignerSchematicProjection,
  opts: {
    source: Point;
    target: Point;
    sourcePinId: string;
    targetPinId: string;
    wires?: DesignerSchematicProjection["wires"];
  },
): Rect[] {
  const { source, target, sourcePinId, targetPinId } = opts;
  const ownerIds = new Set(
    [pinOwnerPartId(sourcePinId), pinOwnerPartId(targetPinId)].filter(
      (id): id is string => id !== null,
    ),
  );
  const ownerPrimitiveIds = new Set(
    [
      primitiveIdFromPinId(sourcePinId),
      primitiveIdFromPinId(targetPinId),
    ].filter((id): id is string => id !== null),
  );
  const endpointPinIds = new Set([sourcePinId, targetPinId]);
  const corridor = inflateRect(
    {
      minX: Math.min(source.x, target.x),
      minY: Math.min(source.y, target.y),
      maxX: Math.max(source.x, target.x),
      maxY: Math.max(source.y, target.y),
    },
    WIRE_OBSTACLE_CORRIDOR_NM,
  );

  const obstacles: Rect[] = [];
  for (const part of projection.parts) {
    if (ownerIds.has(part.id)) continue;
    const rect = partObstacleRect(part);
    if (rect && intersectsCorridor(rect, corridor)) obstacles.push(rect);
  }
  for (const prim of projection.primitives) {
    if (ownerPrimitiveIds.has(prim.id)) continue;
    const rect = primitiveObstacleRect(prim);
    if (intersectsCorridor(rect, corridor)) obstacles.push(rect);
  }
  const wires = opts.wires ?? projection.wires;
  for (const wire of wires) {
    // Same-net wires share an endpoint pin and legitimately touch — skip them.
    if (
      endpointPinIds.has(wire.sourcePinId) ||
      endpointPinIds.has(wire.targetPinId)
    ) {
      continue;
    }
    for (const rect of wireSegmentRects(wire.pointsNm)) {
      if (intersectsCorridor(rect, corridor)) obstacles.push(rect);
    }
  }
  return obstacles;
}

/**
 * Auto-route a pin→pin wire avoiding parts, primitives and other wires. Pass an
 * explicit `wires` set to route against in-progress geometry (arrange pass).
 */
export function autoRouteWirePoints(
  projection: DesignerSchematicProjection,
  sourcePin: DesignerPin,
  targetPin: DesignerPin,
  wires?: DesignerSchematicProjection["wires"],
): Point[] {
  const source = sourcePin.worldPositionNm;
  const target = targetPin.worldPositionNm;
  const obstacles = collectWireObstacles(projection, {
    source,
    target,
    sourcePinId: sourcePin.id,
    targetPinId: targetPin.id,
    wires,
  });
  return routeSchematicWire({ source, target, obstacles });
}
