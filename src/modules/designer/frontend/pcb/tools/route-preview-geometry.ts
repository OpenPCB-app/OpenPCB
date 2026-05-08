import type { PcbTraceSegmentMode } from "../../../../../sdks";
import type { PointNm, RoutePosture } from "./route-tool-state";

function dedupe(points: PointNm[]): PointNm[] {
  const out: PointNm[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) out.push(p);
  }
  return out;
}

function inferPosture(
  priorPoint: PointNm | undefined,
  prev: PointNm,
): "axis" | "diagonal" {
  if (!priorPoint) return "axis";
  const ddx = prev.x - priorPoint.x;
  const ddy = prev.y - priorPoint.y;
  if (ddx === 0 && ddy === 0) return "axis";
  const adx = Math.abs(ddx);
  const ady = Math.abs(ddy);
  if (adx === ady && adx > 0) return "diagonal";
  if (adx === 0 || ady === 0) return "axis";
  return "diagonal";
}

function elbow90(
  prev: PointNm,
  next: PointNm,
  posture: "axis" | "diagonal",
): PointNm[] {
  if (prev.x === next.x || prev.y === next.y) return [next];
  if (posture === "axis") {
    return [{ x: next.x, y: prev.y }, next];
  }
  return [{ x: prev.x, y: next.y }, next];
}

function elbow45(
  prev: PointNm,
  next: PointNm,
  posture: "axis" | "diagonal",
): PointNm[] {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  if (dx === 0 || dy === 0) return [next];
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === ady) return [next];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const diagLen = Math.min(adx, ady);
  if (posture === "diagonal") {
    return [{ x: prev.x + sx * diagLen, y: prev.y + sy * diagLen }, next];
  }
  if (adx > ady) {
    return [{ x: next.x - sx * diagLen, y: prev.y }, next];
  }
  return [{ x: prev.x, y: next.y - sy * diagLen }, next];
}

/**
 * Replace axis⟂axis 90° corners with a 45° chamfer (half the shorter leg,
 * floored to integer nm so the chamfer stays a valid 45° diagonal). Mirrors
 * backend `chamfer45Corners` in pcb-trace-geometry.ts.
 */
function chamfer45Corners(path: PointNm[]): PointNm[] {
  if (path.length < 3) return path;
  const out: PointNm[] = [{ ...path[0]! }];
  for (let i = 1; i < path.length; i += 1) {
    const next = path[i]!;
    if (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = out[out.length - 1]!;
      const dx1 = b.x - a.x;
      const dy1 = b.y - a.y;
      const dx2 = next.x - b.x;
      const dy2 = next.y - b.y;
      const seg1Horiz = dx1 !== 0 && dy1 === 0;
      const seg1Vert = dx1 === 0 && dy1 !== 0;
      const seg2Horiz = dx2 !== 0 && dy2 === 0;
      const seg2Vert = dx2 === 0 && dy2 !== 0;
      const perpendicular90 =
        (seg1Horiz && seg2Vert) || (seg1Vert && seg2Horiz);
      if (perpendicular90) {
        const len1 = Math.abs(dx1) + Math.abs(dy1);
        const len2 = Math.abs(dx2) + Math.abs(dy2);
        const chamfer = Math.floor(Math.min(len1, len2) / 2);
        if (chamfer > 0) {
          const sx1 = Math.sign(dx1);
          const sy1 = Math.sign(dy1);
          const sx2 = Math.sign(dx2);
          const sy2 = Math.sign(dy2);
          out.pop();
          out.push(
            { x: b.x - sx1 * chamfer, y: b.y - sy1 * chamfer },
            { x: b.x + sx2 * chamfer, y: b.y + sy2 * chamfer },
          );
          out.push({ ...next });
          continue;
        }
      }
    }
    out.push({ ...next });
  }
  return out;
}

/**
 * Build a route preview path through anchors using the chosen corner mode and
 * posture. Mirrors backend pcb-trace-geometry.buildTracePathThroughAnchors so
 * the ghost preview matches what the backend will validate.
 *
 * In "manhattan-45" mode, axis⟂axis 90° corners produced by L-shaped waypoint
 * clicks are auto-chamfered into 45° elbows.
 */
export function buildPreviewPath(
  anchors: PointNm[],
  mode: PcbTraceSegmentMode,
  posture: RoutePosture = "auto",
): PointNm[] {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) return [{ ...anchors[0]! }];
  const path: PointNm[] = [{ ...anchors[0]! }];
  for (let i = 1; i < anchors.length; i += 1) {
    const prev = path[path.length - 1]!;
    const next = anchors[i]!;
    const priorPoint = path.length >= 2 ? path[path.length - 2] : undefined;
    const effective: "axis" | "diagonal" =
      posture === "auto" ? inferPosture(priorPoint, prev) : posture;
    const elbows =
      mode === "manhattan-45"
        ? elbow45(prev, next, effective)
        : elbow90(prev, next, effective);
    for (const p of elbows) path.push({ ...p });
  }
  const deduped = dedupe(path);
  return mode === "manhattan-45" ? chamfer45Corners(deduped) : deduped;
}
