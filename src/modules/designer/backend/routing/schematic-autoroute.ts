/**
 * Deterministic obstacle-aware Manhattan auto-router for schematic wires.
 *
 * Routes a pin-to-pin orthogonal polyline that avoids component bodies, with a
 * cheap→expensive escalation (straight → L → Hanan-grid A*) and a guaranteed
 * fallback. Pure and integer-only (no Date.now / Math.random / sqrt); A* cost
 * is a weighted integer (path length + a small fixed penalty per bend, so it
 * prefers fewer corners), with a deterministic tie-break in the frontier.
 *
 * Pin-escape is handled by the caller: it omits the obstacle rectangles of the
 * two parts that own the endpoints, so an endpoint is never trapped inside its
 * own (inflated) body.
 */

import { simplifyCollinearPath, type Point } from "./manhattan";

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Inflate a rectangle outward by `pad` nm. */
export function inflateRect(rect: Rect, pad: number): Rect {
  return {
    minX: rect.minX - pad,
    minY: rect.minY - pad,
    maxX: rect.maxX + pad,
    maxY: rect.maxY + pad,
  };
}

/**
 * Does an axis-aligned (orthogonal) segment cross the strict interior of `rect`?
 * Touching the boundary is allowed (so routing along an inflated edge is fine).
 */
function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  if (a.y === b.y) {
    const y = a.y;
    if (!(rect.minY < y && y < rect.maxY)) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return Math.max(lo, rect.minX) < Math.min(hi, rect.maxX);
  }
  if (a.x === b.x) {
    const x = a.x;
    if (!(rect.minX < x && x < rect.maxX)) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return Math.max(lo, rect.minY) < Math.min(hi, rect.maxY);
  }
  return false;
}

function pathHitsAny(path: Point[], rects: Rect[]): boolean {
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    for (const rect of rects) {
      if (segmentHitsRect(a, b, rect)) return true;
    }
  }
  return false;
}

const MAX_LATTICE_LINES = 160; // per axis — bounds A* to a tractable grid (raised
// for the denser lattice once wires + primitives are obstacles)
const BEND_PENALTY_NM = 1_000_000; // 1 mm — prefer fewer corners over marginal length

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * A* over the Hanan (escape-point) lattice: candidate lines are the endpoint
 * coordinates plus every obstacle edge. This lattice provably contains an
 * optimal min-length / min-bend rectilinear path around axis-aligned
 * rectangles. Returns null if no clean route is found within the caps.
 */
function hananRoute(
  source: Point,
  target: Point,
  rects: Rect[],
): Point[] | null {
  const xs = sortedUnique([
    source.x,
    target.x,
    ...rects.flatMap((r) => [r.minX, r.maxX]),
  ]);
  const ys = sortedUnique([
    source.y,
    target.y,
    ...rects.flatMap((r) => [r.minY, r.maxY]),
  ]);
  if (xs.length > MAX_LATTICE_LINES || ys.length > MAX_LATTICE_LINES)
    return null;

  const xi = (x: number) => xs.indexOf(x);
  const yi = (y: number) => ys.indexOf(y);
  const nodeId = (ix: number, iy: number) => iy * xs.length + ix;

  const startIx = xi(source.x);
  const startIy = yi(source.y);
  const goalIx = xi(target.x);
  const goalIy = yi(target.y);
  if (startIx < 0 || startIy < 0 || goalIx < 0 || goalIy < 0) return null;

  // State = (node, incomingDir). dir: 0 none, 1 H, 2 V.
  const stateKey = (node: number, dir: number) => node * 3 + dir;
  const heuristic = (ix: number, iy: number) =>
    Math.abs(xs[ix]! - target.x) + Math.abs(ys[iy]! - target.y);

  interface Open {
    ix: number;
    iy: number;
    dir: number;
    g: number;
    f: number;
  }
  const startState = stateKey(nodeId(startIx, startIy), 0);
  const gScore = new Map<number, number>([[startState, 0]]);
  const cameFrom = new Map<number, { state: number; ix: number; iy: number }>();
  // Small graphs → array frontier with linear extract-min is fine and stable.
  const open: Open[] = [
    { ix: startIx, iy: startIy, dir: 0, g: 0, f: heuristic(startIx, startIy) },
  ];
  let expansions = 0;
  const MAX_EXPANSIONS = 120_000;

  while (open.length > 0) {
    if (expansions++ > MAX_EXPANSIONS) return null;
    let bestIdx = 0;
    for (let i = 1; i < open.length; i += 1) {
      const o = open[i]!;
      const best = open[bestIdx]!;
      // Deterministic tie-break: lower f, then lower g, then row, then col.
      if (
        o.f < best.f ||
        (o.f === best.f && o.g < best.g) ||
        (o.f === best.f && o.g === best.g && o.iy < best.iy) ||
        (o.f === best.f && o.g === best.g && o.iy === best.iy && o.ix < best.ix)
      ) {
        bestIdx = i;
      }
    }
    const cur = open.splice(bestIdx, 1)[0]!;
    const curState = stateKey(nodeId(cur.ix, cur.iy), cur.dir);
    if (cur.ix === goalIx && cur.iy === goalIy) {
      // Reconstruct.
      const pts: Point[] = [];
      let s: number | undefined = curState;
      let cx = cur.ix;
      let cy = cur.iy;
      while (s !== undefined) {
        pts.push({ x: xs[cx]!, y: ys[cy]! });
        const prev = cameFrom.get(s);
        if (!prev) break;
        s = prev.state;
        cx = prev.ix;
        cy = prev.iy;
      }
      pts.reverse();
      return simplifyCollinearPath(pts);
    }
    if ((gScore.get(curState) ?? Infinity) < cur.g) continue;

    const neighbors: Array<{ ix: number; iy: number; dir: number }> = [];
    if (cur.ix + 1 < xs.length)
      neighbors.push({ ix: cur.ix + 1, iy: cur.iy, dir: 1 });
    if (cur.ix - 1 >= 0) neighbors.push({ ix: cur.ix - 1, iy: cur.iy, dir: 1 });
    if (cur.iy + 1 < ys.length)
      neighbors.push({ ix: cur.ix, iy: cur.iy + 1, dir: 2 });
    if (cur.iy - 1 >= 0) neighbors.push({ ix: cur.ix, iy: cur.iy - 1, dir: 2 });

    const from: Point = { x: xs[cur.ix]!, y: ys[cur.iy]! };
    for (const nb of neighbors) {
      const to: Point = { x: xs[nb.ix]!, y: ys[nb.iy]! };
      let blocked = false;
      for (const rect of rects) {
        if (segmentHitsRect(from, to, rect)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const stepLen = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      const bend = cur.dir !== 0 && cur.dir !== nb.dir ? BEND_PENALTY_NM : 0;
      const ng = cur.g + stepLen + bend;
      const nState = stateKey(nodeId(nb.ix, nb.iy), nb.dir);
      if (ng < (gScore.get(nState) ?? Infinity)) {
        gScore.set(nState, ng);
        cameFrom.set(nState, { state: curState, ix: cur.ix, iy: cur.iy });
        open.push({
          ix: nb.ix,
          iy: nb.iy,
          dir: nb.dir,
          g: ng,
          f: ng + heuristic(nb.ix, nb.iy),
        });
      }
    }
  }
  return null;
}

/**
 * Route source→target as an obstacle-avoiding Manhattan polyline.
 * Escalates straight → L (HV then VH) → Hanan A*. Falls back to the HV L-bend
 * (today's default) when no clean route exists, so it is never worse than the
 * naive router.
 */
export function routeSchematicWire(input: {
  source: Point;
  target: Point;
  obstacles: Rect[];
}): Point[] {
  const { source, target, obstacles } = input;
  if (source.x === target.x && source.y === target.y) return [source, target];

  if (source.x === target.x || source.y === target.y) {
    const straight = [source, target];
    if (!pathHitsAny(straight, obstacles)) return straight;
  }

  const hv = simplifyCollinearPath([
    source,
    { x: target.x, y: source.y },
    target,
  ]);
  if (!pathHitsAny(hv, obstacles)) return hv;

  const vh = simplifyCollinearPath([
    source,
    { x: source.x, y: target.y },
    target,
  ]);
  if (!pathHitsAny(vh, obstacles)) return vh;

  const routed = hananRoute(source, target, obstacles);
  if (routed && routed.length >= 2) return routed;

  return hv;
}
