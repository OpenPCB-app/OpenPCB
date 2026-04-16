import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type {
  PointMm,
  PreviewGraphic,
} from "../../../../../../shared/rendering/types";
import { snapToGrid } from "../useSymbolEditorStore";

const NM_PER_MM = 1_000_000;

/** Convert InteractionEvent world point (nm) to scene mm. Snaps to grid when `snap` is true. */
export function eventToMm(
  event: InteractionEvent,
  gridMm: number,
  snap: boolean = true,
): PointMm {
  const x = event.worldPoint.x / NM_PER_MM;
  const y = event.worldPoint.y / NM_PER_MM;
  return snap
    ? { x: snapToGrid(x, gridMm), y: snapToGrid(y, gridMm) }
    : { x, y };
}

/** Unsnapped mm from event. */
export function eventToMmRaw(event: InteractionEvent): PointMm {
  return {
    x: event.worldPoint.x / NM_PER_MM,
    y: event.worldPoint.y / NM_PER_MM,
  };
}

/** Translate a PreviewGraphic by (dx, dy) in mm. */
export function translateGraphic(
  g: PreviewGraphic,
  dx: number,
  dy: number,
): PreviewGraphic {
  switch (g.kind) {
    case "line":
      return {
        ...g,
        a: { x: g.a.x + dx, y: g.a.y + dy },
        b: { x: g.b.x + dx, y: g.b.y + dy },
      };
    case "rect":
      return { ...g, x: g.x + dx, y: g.y + dy };
    case "circle":
      return {
        ...g,
        center: { x: g.center.x + dx, y: g.center.y + dy },
      };
    case "arc3":
      return {
        ...g,
        start: { x: g.start.x + dx, y: g.start.y + dy },
        mid: { x: g.mid.x + dx, y: g.mid.y + dy },
        end: { x: g.end.x + dx, y: g.end.y + dy },
      };
    case "polyline":
      return {
        ...g,
        points: g.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    case "bezier":
      return {
        ...g,
        points: [
          { x: g.points[0].x + dx, y: g.points[0].y + dy },
          { x: g.points[1].x + dx, y: g.points[1].y + dy },
          { x: g.points[2].x + dx, y: g.points[2].y + dy },
          { x: g.points[3].x + dx, y: g.points[3].y + dy },
        ],
      };
  }
}

/** Rotate a point around a pivot by `angleDeg` degrees (CCW in Y-up). */
export function rotatePoint(
  p: PointMm,
  pivot: PointMm,
  angleDeg: number,
): PointMm {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

/**
 * Rotate a PreviewGraphic around `pivot` by `angleDeg` degrees (CCW in Y-up).
 * Rectangles are kept axis-aligned via AABB of rotated corners — geometry
 * stays correct for multiples of 90° and degrades gracefully otherwise.
 */
export function rotateGraphicAround(
  g: PreviewGraphic,
  pivot: PointMm,
  angleDeg: number,
): PreviewGraphic {
  const rot = (p: PointMm) => rotatePoint(p, pivot, angleDeg);
  switch (g.kind) {
    case "line":
      return { ...g, a: rot(g.a), b: rot(g.b) };
    case "rect": {
      const corners = [
        { x: g.x, y: g.y },
        { x: g.x + g.width, y: g.y },
        { x: g.x + g.width, y: g.y + g.height },
        { x: g.x, y: g.y + g.height },
      ].map(rot);
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return {
        ...g,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }
    case "circle":
      return { ...g, center: rot(g.center) };
    case "arc3":
      return { ...g, start: rot(g.start), mid: rot(g.mid), end: rot(g.end) };
    case "polyline":
      return { ...g, points: g.points.map(rot) };
    case "bezier":
      return {
        ...g,
        points: [
          rot(g.points[0]),
          rot(g.points[1]),
          rot(g.points[2]),
          rot(g.points[3]),
        ],
      };
  }
}

/** Normalize rotation to [0, 360). */
export function normalizeRotationDeg(deg: number): number {
  const mod = deg % 360;
  return mod < 0 ? mod + 360 : mod;
}
