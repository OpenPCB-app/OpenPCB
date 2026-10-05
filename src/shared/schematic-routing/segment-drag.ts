/**
 * Interactive wire-segment dragging (Flux-style) for the schematic canvas.
 *
 * A user grabs one orthogonal segment of a committed wire and slides it
 * perpendicular to its own axis; the adjacent segments stretch to stay
 * connected while the wire's endpoints stay pinned to their pins. Pure and
 * integer-nanometer (no Math.random / Date.now), so it is unit-testable under
 * Bun alongside the rest of `schematic-routing`.
 */

import {
  isManhattanPath,
  pointKey,
  sanitizePath,
  simplifyCollinearPath,
  snapToGrid,
  SCHEMATIC_GRID_NM,
  type Point,
} from "./manhattan";

export type SegmentAxis = "h" | "v";

/**
 * Axis of the orthogonal segment [a,b]: "h" when it is horizontal (shared y —
 * draggable in Y), "v" when vertical (shared x — draggable in X), or null when
 * degenerate (zero length) or non-orthogonal.
 */
export function wireSegmentAxis(a: Point, b: Point): SegmentAxis | null {
  if (a.y === b.y && a.x !== b.x) return "h";
  if (a.x === b.x && a.y !== b.y) return "v";
  return null;
}

/** True iff the path revisits a vertex or a segment reverses back over itself.
 *  Mirrors the backend `validatePath` doubling-back checks so a drag never
 *  produces a self-overlapping route. */
function pathDoublesBack(path: Point[]): boolean {
  const seen = new Set<string>();
  for (const point of path) {
    const key = pointKey(point);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  for (let index = 2; index < path.length; index += 1) {
    const a = path[index - 2]!;
    const b = path[index - 1]!;
    const c = path[index]!;
    const horizontal = a.y === b.y && b.y === c.y;
    const vertical = a.x === b.x && b.x === c.x;
    if (
      (horizontal && Math.sign(b.x - a.x) === -Math.sign(c.x - b.x)) ||
      (vertical && Math.sign(b.y - a.y) === -Math.sign(c.y - b.y))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Drag the segment between `points[segmentIndex]` and `points[segmentIndex+1]`
 * perpendicular to its axis by `deltaNm`.
 *
 * - Only the perpendicular component of `deltaNm` is applied (a horizontal
 *   segment moves in Y, a vertical one in X); the parallel component is dropped
 *   so the result stays Manhattan.
 * - `points[0]` and `points[last]` are pinned endpoints and never move: when the
 *   dragged segment touches an endpoint a perpendicular stub is inserted instead
 *   (a straight pin-to-pin wire becomes a 4-point staple). Interior neighbours
 *   absorb the shift by stretching.
 * - The destination is grid-snapped; gridNm=0 preserves free placement.
 *
 * Returns the ORIGINAL `points` unchanged when the drag is a no-op or would
 * produce an invalid (self-overlapping / non-orthogonal) path.
 */
export function dragWireSegment(
  points: Point[],
  segmentIndex: number,
  deltaNm: Point,
  gridNm: number = SCHEMATIC_GRID_NM,
): Point[] {
  const i = segmentIndex;
  if (i < 0 || i + 1 >= points.length) return points;
  const a = points[i]!;
  const b = points[i + 1]!;
  const axis = wireSegmentAxis(a, b);
  if (!axis) return points;

  const delta = axis === "h" ? deltaNm.y : deltaNm.x;
  if (delta === 0) return points;
  const target = snapToGrid({ x: a.x + deltaNm.x, y: a.y + deltaNm.y }, gridNm);
  const shift =
    axis === "h" ? { x: 0, y: target.y - a.y } : { x: target.x - a.x, y: 0 };
  if (shift.x === 0 && shift.y === 0) return points;

  const newA = { x: a.x + shift.x, y: a.y + shift.y };
  const newB = { x: b.x + shift.x, y: b.y + shift.y };
  const lastIndex = points.length - 1;

  const result: Point[] = [];
  for (let k = 0; k < points.length; k += 1) {
    if (k === i) {
      // Source endpoint stays pinned → insert a perpendicular stub before newA.
      if (i === 0) result.push({ x: a.x, y: a.y }, newA);
      else result.push(newA);
    } else if (k === i + 1) {
      // Target endpoint stays pinned → insert a perpendicular stub after newB.
      if (i + 1 === lastIndex) result.push(newB, { x: b.x, y: b.y });
      else result.push(newB);
    } else {
      result.push({ x: points[k]!.x, y: points[k]!.y });
    }
  }

  const cleaned = simplifyCollinearPath(sanitizePath(result));
  if (cleaned.length >= 2) {
    // The endpoints were never shifted; re-assert them explicitly so no
    // simplification step can drift the pinned coordinates.
    cleaned[0] = { x: points[0]!.x, y: points[0]!.y };
    cleaned[cleaned.length - 1] = {
      x: points[lastIndex]!.x,
      y: points[lastIndex]!.y,
    };
  }
  const final = sanitizePath(cleaned);

  if (final.length < 2 || !isManhattanPath(final) || pathDoublesBack(final)) {
    return points;
  }
  return final;
}
