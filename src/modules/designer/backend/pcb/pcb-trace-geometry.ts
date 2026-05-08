import type { PcbTraceSegmentMode } from "../../../../sdks/designer";

export type Point = { x: number; y: number };

const EPS = 1e-6;

export function pointKey(point: Point): string {
  return `${point.x}:${point.y}`;
}

export function sanitizePath(points: Point[]): Point[] {
  const output: Point[] = [];
  for (const point of points) {
    const prev = output[output.length - 1];
    if (!prev || pointKey(prev) !== pointKey(point)) {
      output.push(point);
    }
  }
  return output;
}

export function simplifyCollinearPath(points: Point[]): Point[] {
  const deduped = sanitizePath(points);
  if (deduped.length <= 2) return deduped;
  const output: Point[] = [deduped[0]!];
  for (let i = 1; i < deduped.length - 1; i += 1) {
    const prev = output[output.length - 1];
    const curr = deduped[i];
    const next = deduped[i + 1];
    if (!prev || !curr || !next) continue;
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const cross = dx1 * dy2 - dy1 * dx2;
    if (cross !== 0) output.push(curr);
  }
  output.push(deduped[deduped.length - 1]!);
  return sanitizePath(output);
}

/**
 * Validates a polyline is strict-Manhattan (90°): every segment axis-aligned.
 * Returns null if valid, or an error reason string.
 */
export function validate90Path(points: Point[]): string | null {
  if (points.length < 2) return "path must have at least 2 points";
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (prev.x === curr.x && prev.y === curr.y) {
      return `duplicate point at index ${i}`;
    }
    if (prev.x !== curr.x && prev.y !== curr.y) {
      return `segment ${i} is not axis-aligned`;
    }
  }
  return null;
}

/**
 * Validates a polyline is 45°-routable: every segment is either axis-aligned
 * or diagonal with |Δx| === |Δy|.
 */
export function validate45Path(points: Point[]): string | null {
  if (points.length < 2) return "path must have at least 2 points";
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (prev.x === curr.x && prev.y === curr.y) {
      return `duplicate point at index ${i}`;
    }
    const dx = Math.abs(curr.x - prev.x);
    const dy = Math.abs(curr.y - prev.y);
    const axisAligned = dx === 0 || dy === 0;
    const diagonal = dx === dy && dx > 0;
    if (!axisAligned && !diagonal) {
      return `segment ${i} is not 45°-routable (Δx=${curr.x - prev.x}, Δy=${curr.y - prev.y})`;
    }
  }
  return null;
}

export function validatePath(
  points: Point[],
  mode: PcbTraceSegmentMode,
): string | null {
  return mode === "manhattan-45"
    ? validate45Path(points)
    : validate90Path(points);
}

/**
 * Track posture: which segment goes first in a 2-segment elbow.
 *  - "auto"     — pick from inferred previous-segment direction
 *  - "axis"     — straight axis-aligned segment first, then diagonal/elbow to target
 *  - "diagonal" — diagonal/elbow first, then axis-aligned segment to target
 */
export type TracePosture = "auto" | "axis" | "diagonal";

/**
 * Infer the directional preference from the prior segment so the next elbow
 * continues that direction without a backwards zig-zag.
 *  - last segment horizontal → next elbow should start horizontal (axis-first)
 *  - last segment vertical   → next elbow should start vertical   (axis-first)
 *  - last segment diagonal   → next elbow should keep diagonal first
 *  - no previous segment     → axis-first (matches KiCad/Altium convention
 *    when starting a fresh route from a pad)
 */
function inferPosture(
  priorPoint: Point | undefined,
  prev: Point,
): "axis" | "diagonal" {
  if (!priorPoint) return "axis";
  const ddx = prev.x - priorPoint.x;
  const ddy = prev.y - priorPoint.y;
  if (ddx === 0 && ddy === 0) return "axis";
  const adx = Math.abs(ddx);
  const ady = Math.abs(ddy);
  // Pure diagonal (Δx=Δy) → diagonal-first; otherwise axis-aligned → axis-first.
  if (adx === ady && adx > 0) return "diagonal";
  if (adx === 0 || ady === 0) return "axis";
  return "diagonal";
}

/**
 * Build a 90° Manhattan elbow between two anchors. Posture decides whether the
 * intermediate vertex is `(next.x, prev.y)` (axis-first → vertical second) or
 * `(prev.x, next.y)` (axis-first vertical → horizontal second).
 */
function elbow90(
  prev: Point,
  next: Point,
  posture: "axis" | "diagonal",
): Point[] {
  if (prev.x === next.x || prev.y === next.y) return [next];
  // For 90° mode, "axis" = horizontal-first, "diagonal" = vertical-first
  // (90° has no actual diagonal — we reuse the posture flag to pick the H/V order).
  if (posture === "axis") {
    return [{ x: next.x, y: prev.y }, next];
  }
  return [{ x: prev.x, y: next.y }, next];
}

/**
 * Build a 45° elbow between two anchors. Posture decides which leg goes first:
 *  - "diagonal" → diagonal of length min(|Δx|,|Δy|), then axis-aligned to target
 *  - "axis"     → axis-aligned segment first, then diagonal to target
 */
function elbow45(
  prev: Point,
  next: Point,
  posture: "axis" | "diagonal",
): Point[] {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  if (dx === 0 || dy === 0) return [next];
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === ady) return [next]; // pure diagonal
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const diagLen = Math.min(adx, ady);
  if (posture === "diagonal") {
    // Diagonal first, then axis-aligned to target.
    const corner = { x: prev.x + sx * diagLen, y: prev.y + sy * diagLen };
    return [corner, next];
  }
  // posture === "axis": axis-aligned first, then diagonal to target.
  if (adx > ady) {
    // Horizontal portion = adx - ady, then diagonal of length ady to target.
    const corner = { x: next.x - sx * diagLen, y: prev.y };
    return [corner, next];
  }
  // ady > adx: vertical portion = ady - adx, then diagonal of length adx to target.
  const corner = { x: prev.x, y: next.y - sy * diagLen };
  return [corner, next];
}

/**
 * Walk a path and replace 90° corners between two perpendicular axis-aligned
 * segments with a 45° chamfer. The chamfer length is half the shorter adjacent
 * leg, rounded down to integer units (preserves nm-grid integrality and a true
 * 45° diagonal). Used only for "manhattan-45" mode — sharp 90° corners in 45°
 * mode are not desired (user explicitly switches to "manhattan-90" for sharp
 * elbows).
 *
 * Only chamfers axis⟂axis corners (horizontal-to-vertical or vice versa).
 * Diagonal⟂diagonal 90° corners are rare in practice (would require explicit
 * waypoint clicks on diagonals) and are left untouched.
 */
function chamfer45Corners(path: Point[]): Point[] {
  if (path.length < 3) return path;
  const out: Point[] = [{ ...path[0]! }];
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
          const chamferStart: Point = {
            x: b.x - sx1 * chamfer,
            y: b.y - sy1 * chamfer,
          };
          const chamferEnd: Point = {
            x: b.x + sx2 * chamfer,
            y: b.y + sy2 * chamfer,
          };
          // Replace corner vertex `b` with the two chamfer endpoints.
          out.pop();
          out.push(chamferStart, chamferEnd);
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
 * Build a path through a sequence of anchors. `posture="auto"` infers per-anchor
 * from the previous segment direction so the path flows naturally without
 * backward zig-zags. Manual override ("axis" / "diagonal") forces every elbow
 * to use the requested posture.
 *
 * In "manhattan-45" mode, a final pass auto-chamfers any remaining axis⟂axis
 * 90° corners produced by user waypoint clicks (so an L-shape becomes a 45°
 * elbow rather than a sharp right angle).
 */
export function buildTracePathThroughAnchors(
  anchors: Point[],
  mode: PcbTraceSegmentMode,
  posture: TracePosture = "auto",
): Point[] {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) return [{ ...anchors[0]! }];
  const path: Point[] = [{ ...anchors[0]! }];
  for (let i = 1; i < anchors.length; i += 1) {
    const prev = path[path.length - 1]!;
    const next = anchors[i]!;
    const priorPoint = path.length >= 2 ? path[path.length - 2]! : undefined;
    const effective: "axis" | "diagonal" =
      posture === "auto" ? inferPosture(priorPoint, prev) : posture;
    const elbows =
      mode === "manhattan-45"
        ? elbow45(prev, next, effective)
        : elbow90(prev, next, effective);
    for (const point of elbows) path.push({ ...point });
  }
  const sanitized = sanitizePath(path);
  return mode === "manhattan-45" ? chamfer45Corners(sanitized) : sanitized;
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Returns closest point on segment AB to P, plus the squared distance. */
function projectPointToSegment(
  point: Point,
  start: Point,
  end: Point,
): {
  x: number;
  y: number;
  t: number;
  distance: number;
} {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS) {
    return { x: start.x, y: start.y, t: 0, distance: distance(point, start) };
  }
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = { x: start.x + dx * t, y: start.y + dy * t };
  return { ...projected, t, distance: distance(point, projected) };
}

/**
 * Minimum distance from a point to a polyline. Reports best-segment index.
 * Used for hit-testing existing traces.
 */
export function pointToPolylineDistance(
  point: Point,
  polyline: Point[],
): {
  distance: number;
  segmentIndex: number;
  closest: Point;
} {
  if (polyline.length < 2) {
    const single = polyline[0];
    if (!single)
      return { distance: Infinity, segmentIndex: -1, closest: point };
    return {
      distance: distance(point, single),
      segmentIndex: -1,
      closest: single,
    };
  }
  let best = Infinity;
  let bestIndex = 0;
  let bestPoint: Point = polyline[0]!;
  for (let i = 1; i < polyline.length; i += 1) {
    const proj = projectPointToSegment(point, polyline[i - 1]!, polyline[i]!);
    if (proj.distance < best) {
      best = proj.distance;
      bestIndex = i - 1;
      bestPoint = { x: proj.x, y: proj.y };
    }
  }
  return { distance: best, segmentIndex: bestIndex, closest: bestPoint };
}

/** Returns true if segments AB and CD intersect (proper or improper). */
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const rxs = r.x * s.y - r.y * s.x;
  const qmp = { x: c.x - a.x, y: c.y - a.y };
  const qmpxr = qmp.x * r.y - qmp.y * r.x;
  if (Math.abs(rxs) < EPS) {
    // Parallel — disregard collinear-overlap (approximated by endpoint distances elsewhere).
    return false;
  }
  const t = (qmp.x * s.y - qmp.y * s.x) / rxs;
  const u = qmpxr / rxs;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Minimum distance between two segments AB and CD. */
function segmentToSegmentDistance(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  // Check candidate distances: each endpoint projected onto the other segment.
  return Math.min(
    projectPointToSegment(a, c, d).distance,
    projectPointToSegment(b, c, d).distance,
    projectPointToSegment(c, a, b).distance,
    projectPointToSegment(d, a, b).distance,
  );
}

/**
 * Minimum distance between two polylines (sweep all segment pairs).
 * Used by DRC for trace↔trace clearance.
 */
export function polylineToPolylineDistance(a: Point[], b: Point[]): number {
  if (a.length < 2 || b.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      const d = segmentToSegmentDistance(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Distance from a polyline to an axis-aligned bounding box (used for trace↔pad clearance).
 * boundsMm: { minX, minY, maxX, maxY } in same coordinate space as polyline.
 */
export function polylineToAabbDistance(
  polyline: Point[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): number {
  if (polyline.length < 2) return Infinity;
  let best = Infinity;
  // Approach: distance from each polyline segment to the closest point on the AABB perimeter.
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1]!;
    const b = polyline[i]!;
    // Sample the AABB corners and segment-AABB-edge distances.
    const corners: Point[] = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];
    for (const corner of corners) {
      const d = projectPointToSegment(corner, a, b).distance;
      if (d < best) best = d;
    }
    // AABB edges.
    for (let k = 0; k < 4; k += 1) {
      const c = corners[k]!;
      const d = corners[(k + 1) % 4]!;
      const dist = segmentToSegmentDistance(a, b, c, d);
      if (dist < best) best = dist;
    }
    // If any polyline endpoint is inside AABB, distance is 0 (overlap).
    if (
      a.x >= bounds.minX &&
      a.x <= bounds.maxX &&
      a.y >= bounds.minY &&
      a.y <= bounds.maxY
    )
      return 0;
    if (
      b.x >= bounds.minX &&
      b.x <= bounds.maxX &&
      b.y >= bounds.minY &&
      b.y <= bounds.maxY
    )
      return 0;
  }
  return best;
}
