import type { PcbTraceSegmentMode } from "../../../../../sdks";
import type { PointNm } from "./route-tool-state";
import { buildPreviewPath } from "./route-preview-geometry";

/**
 * Trace segment drag geometry (pure).
 *
 * Lets the user nudge an existing trace segment perpendicular to its direction
 * without deleting and re-routing. Reuses `buildPreviewPath` (the frontend
 * elbow builder that mirrors the backend) so the result is always valid for the
 * trace's `segmentMode`, which the backend re-validates on
 * `pcb_update_trace_geometry`.
 *
 * Model: the dragged segment translates by the perpendicular component of the
 * drag delta (sliding along the wire is ignored). Translation preserves the
 * segment's orientation (axis-aligned or 45°). The two adjacent connectors are
 * rebuilt from the fixed outer anchors to the moved endpoints; when the dragged
 * segment is a trace terminal (first/last) the terminal vertex stays anchored
 * and a connecting jog is inserted, so a pad never detaches.
 */

export type SegmentOrientation =
  | "horizontal"
  | "vertical"
  | "diagonal"
  | "other";

export function classifySegment(a: PointNm, b: PointNm): SegmentOrientation {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return "other";
  if (dy === 0) return "horizontal";
  if (dx === 0) return "vertical";
  if (Math.abs(dx) === Math.abs(dy)) return "diagonal";
  return "other";
}

/**
 * Perpendicular component of `deltaNm` relative to segment AB, rounded to the
 * integer nm grid. The along-segment component is discarded so dragging slides
 * the segment sideways, never lengthwise.
 */
export function projectPerpendicular(
  deltaNm: PointNm,
  a: PointNm,
  b: PointNm,
): PointNm {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0)
    return { x: Math.round(deltaNm.x), y: Math.round(deltaNm.y) };
  // delta minus its projection onto the unit segment direction.
  const along = (deltaNm.x * dx + deltaNm.y * dy) / lenSq;
  return {
    x: Math.round(deltaNm.x - along * dx),
    y: Math.round(deltaNm.y - along * dy),
  };
}

function dedupe(points: PointNm[]): PointNm[] {
  const out: PointNm[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) out.push({ ...p });
  }
  return out;
}

/** Drop interior vertices that lie on the straight line between their neighbors. */
function simplifyCollinear(points: PointNm[]): PointNm[] {
  const deduped = dedupe(points);
  if (deduped.length <= 2) return deduped;
  const out: PointNm[] = [deduped[0]!];
  for (let i = 1; i < deduped.length - 1; i += 1) {
    const prev = out[out.length - 1]!;
    const curr = deduped[i]!;
    const next = deduped[i + 1]!;
    const cross =
      (curr.x - prev.x) * (next.y - curr.y) -
      (curr.y - prev.y) * (next.x - curr.x);
    if (cross !== 0) out.push(curr);
  }
  out.push(deduped[deduped.length - 1]!);
  return dedupe(out);
}

function isValidForMode(points: PointNm[], mode: PcbTraceSegmentMode): boolean {
  if (points.length < 2) return false;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const adx = Math.abs(curr.x - prev.x);
    const ady = Math.abs(curr.y - prev.y);
    if (adx === 0 && ady === 0) return false;
    const axisAligned = adx === 0 || ady === 0;
    if (mode === "manhattan-90") {
      if (!axisAligned) return false;
    } else {
      const diagonal = adx === ady;
      if (!axisAligned && !diagonal) return false;
    }
  }
  return true;
}

export type TraceDragResult =
  | { kind: "ok"; pointsNm: PointNm[] }
  | { kind: "rejected"; reason: string };

/**
 * Produce the new trace polyline for dragging segment `segmentIndex`
 * (vertices `segmentIndex` → `segmentIndex + 1`) by `deltaNm`.
 *
 * Returns `rejected` for an undraggable segment (non-axis/non-45 orientation)
 * or when the rebuilt path is not valid for `mode` — callers should surface a
 * hint and fall back to split-and-reroute.
 */
export function dragTraceSegment(
  pointsNm: readonly PointNm[],
  segmentIndex: number,
  deltaNm: PointNm,
  mode: PcbTraceSegmentMode,
): TraceDragResult {
  const i = segmentIndex;
  if (i < 0 || i >= pointsNm.length - 1) {
    return { kind: "rejected", reason: "Segment is out of range." };
  }
  const a = pointsNm[i]!;
  const b = pointsNm[i + 1]!;
  const orientation = classifySegment(a, b);
  if (orientation === "other") {
    return {
      kind: "rejected",
      reason: "Only straight or 45° segments can be dragged.",
    };
  }

  const perp = projectPerpendicular(deltaNm, a, b);
  if (perp.x === 0 && perp.y === 0) {
    return { kind: "ok", pointsNm: pointsNm.map((p) => ({ ...p })) };
  }

  const movedA: PointNm = { x: a.x + perp.x, y: a.y + perp.y };
  const movedB: PointNm = { x: b.x + perp.x, y: b.y + perp.y };

  const hasLeft = i - 1 >= 0;
  const hasRight = i + 2 <= pointsNm.length - 1;

  // Left connector: from the fixed outer anchor (or the anchored terminal) to
  // the moved start vertex. `buildPreviewPath` emits a mode-valid elbow.
  const leftFixed = hasLeft ? pointsNm[i - 1]! : a;
  const leftPart = buildPreviewPath([leftFixed, movedA], mode, "auto");
  // Right connector: from the moved end vertex to the fixed outer anchor (or
  // the anchored terminal).
  const rightFixed = hasRight ? pointsNm[i + 2]! : b;
  const rightPart = buildPreviewPath([movedB, rightFixed], mode, "auto");

  const prefix = hasLeft ? pointsNm.slice(0, i - 1) : [];
  const suffix = hasRight ? pointsNm.slice(i + 3) : [];

  const assembled = simplifyCollinear([
    ...prefix.map((p) => ({ ...p })),
    ...leftPart,
    ...rightPart,
    ...suffix.map((p) => ({ ...p })),
  ]);

  if (!isValidForMode(assembled, mode)) {
    return {
      kind: "rejected",
      reason: "Drag would break the trace geometry — reroute instead.",
    };
  }
  return { kind: "ok", pointsNm: assembled };
}
