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

function samePoint(p: PointNm, q: PointNm): boolean {
  return p.x === q.x && p.y === q.y;
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
  // A manhattan-90 trace never contains diagonals; guard defensively so a
  // diagonal source segment can't produce an off-grid reshape.
  if (mode === "manhattan-90" && orientation === "diagonal") {
    return {
      kind: "rejected",
      reason: "Diagonal segments aren't draggable in 90° mode.",
    };
  }

  const hasLeft = i - 1 >= 0;
  const hasRight = i + 2 <= pointsNm.length - 1;

  // Terminal segment (exactly one end is a pad). Its only free degree of freedom
  // is the inner corner: a pad-terminated 45° segment can't be perpendicular-
  // translated and stay both mode-valid AND connected to the pinned pad — it
  // bulges into a peak. So move that corner by the full drag delta (vertex
  // semantics) and let both connectors re-solve. Interior segments (both ends
  // free) keep the clean perpendicular slide below.
  if (hasLeft !== hasRight) {
    const freeIndex = hasLeft ? i : i + 1;
    return dragTraceVertex(pointsNm, freeIndex, deltaNm, mode);
  }

  const perp = projectPerpendicular(deltaNm, a, b);
  if (perp.x === 0 && perp.y === 0) {
    return { kind: "ok", pointsNm: pointsNm.map((p) => ({ ...p })) };
  }

  // Remaining cases: interior segment (both ends free → perpendicular slide,
  // neighbors stretch) or a single pad-to-pad segment (both ends pinned →
  // staple offset). `moveStart`/`moveEnd` are true in both.
  const moveStart = hasLeft || !hasRight;
  const moveEnd = hasRight || !hasLeft;
  const movedA: PointNm = moveStart
    ? { x: a.x + perp.x, y: a.y + perp.y }
    : { ...a };
  const movedB: PointNm = moveEnd
    ? { x: b.x + perp.x, y: b.y + perp.y }
    : { ...b };

  // Outer anchor each connector routes to: the neighbor vertex, or the pinned
  // pad itself when this segment is a trace terminal.
  const leftAnchor = hasLeft ? pointsNm[i - 1]! : a;
  const rightAnchor = hasRight ? pointsNm[i + 2]! : b;

  // A *moved* endpoint landing exactly on its own anchor collapses the reshape
  // (the segment vanishes); reject so the caller falls back to reroute. A
  // *pinned* endpoint coinciding with its anchor is expected (both are the pad).
  if (
    (moveStart && samePoint(movedA, leftAnchor)) ||
    (moveEnd && samePoint(movedB, rightAnchor))
  ) {
    return {
      kind: "rejected",
      reason: "Drag would collapse the trace — reroute instead.",
    };
  }

  const leftPart = buildPreviewPath([leftAnchor, movedA], mode, "auto");
  const segPart = buildPreviewPath([movedA, movedB], mode, "auto");
  const rightPart = buildPreviewPath([movedB, rightAnchor], mode, "auto");

  const prefix = hasLeft ? pointsNm.slice(0, i - 1) : [];
  const suffix = hasRight ? pointsNm.slice(i + 3) : [];

  const assembled = simplifyCollinear([
    ...prefix.map((p) => ({ ...p })),
    ...leftPart,
    ...segPart,
    ...rightPart,
    ...suffix.map((p) => ({ ...p })),
  ]);

  if (!isValidForMode(assembled, mode)) {
    return {
      kind: "rejected",
      reason: "Drag would break the trace geometry — reroute instead.",
    };
  }
  // Pads must never detach: the reshaped path must keep the original terminals.
  const v0 = pointsNm[0]!;
  const vN = pointsNm[pointsNm.length - 1]!;
  if (
    !samePoint(assembled[0]!, v0) ||
    !samePoint(assembled[assembled.length - 1]!, vN)
  ) {
    return {
      kind: "rejected",
      reason: "Drag would move a trace endpoint — reroute instead.",
    };
  }
  return { kind: "ok", pointsNm: assembled };
}

/**
 * Produce the new trace polyline for dragging an INTERIOR vertex `vertexIndex`
 * (1 .. n-2) by `deltaNm`. Endpoints (0 and n-1) are pad anchors and are not
 * draggable — callers must not pass them.
 *
 * Model: the moved vertex becomes the new shared anchor between its two adjacent
 * connectors. Neighbors v[k-1] and v[k+1] stay fixed; both connectors are
 * re-solved via `buildPreviewPath` so the result stays valid for `mode`, then
 * collinear points are dropped. Pads (terminals) never move; the backend
 * re-validates on `pcb_update_trace_geometry`.
 */
export function dragTraceVertex(
  pointsNm: readonly PointNm[],
  vertexIndex: number,
  deltaNm: PointNm,
  mode: PcbTraceSegmentMode,
): TraceDragResult {
  const k = vertexIndex;
  if (k <= 0 || k >= pointsNm.length - 1) {
    return {
      kind: "rejected",
      reason: "Only interior trace vertices can be dragged.",
    };
  }

  const orig = pointsNm[k]!;
  const moved: PointNm = {
    x: orig.x + Math.round(deltaNm.x),
    y: orig.y + Math.round(deltaNm.y),
  };
  if (samePoint(moved, orig)) {
    return { kind: "ok", pointsNm: pointsNm.map((p) => ({ ...p })) };
  }

  const prevFixed = pointsNm[k - 1]!;
  const nextFixed = pointsNm[k + 1]!;

  // Moving the corner exactly onto a neighbor merges it away (a segment
  // vanishes / a pad would absorb the bend); reject so the caller can reroute.
  if (samePoint(moved, prevFixed) || samePoint(moved, nextFixed)) {
    return {
      kind: "rejected",
      reason: "Drag would collapse the trace — reroute instead.",
    };
  }

  // Re-solve each connector from the fixed neighbor to the moved vertex.
  const leftPart = buildPreviewPath([prevFixed, moved], mode, "auto");
  const rightPart = buildPreviewPath([moved, nextFixed], mode, "auto");

  const prefix = pointsNm.slice(0, k - 1); // up to and excluding prevFixed
  const suffix = pointsNm.slice(k + 2); // after nextFixed

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
  // Pads must never detach.
  const v0 = pointsNm[0]!;
  const vN = pointsNm[pointsNm.length - 1]!;
  if (
    !samePoint(assembled[0]!, v0) ||
    !samePoint(assembled[assembled.length - 1]!, vN)
  ) {
    return {
      kind: "rejected",
      reason: "Drag would move a trace endpoint — reroute instead.",
    };
  }
  return { kind: "ok", pointsNm: assembled };
}
