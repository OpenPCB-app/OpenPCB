import {
  ClipType,
  EndType,
  FillRule,
  JoinType,
  type PathD,
  type PathsD,
  PolyPathD,
  PolyTreeD,
  areaPathsD,
  booleanOpDWithPolyTree,
  differenceD,
  inflatePathsD,
  intersectD,
  unionD,
} from "clipper2-ts";
import type {
  ClipperMultiPolygon,
  ClipperPolygon,
  ClipperRing,
} from "./copper-fill-trace-geometry";

/**
 * Copper-geometry kernel — the single Clipper2 boolean/offset/triangulation
 * layer for the PCB copper pipeline (pour, annuli, trace apertures).
 *
 * Design rules (from the Codex gpt-5.5 review):
 *  - One integer grid end-to-end: `PRECISION = 4` decimals → 1e4 units/mm
 *    (0.1 µm), matching the legacy `CLIP_QUANT` so we never run two regimes.
 *  - FAIL CLOSED. Copper booleans that throw must never yield an un-clearanced
 *    fallback (a fail-open difference returns subject-with-no-clearance → a
 *    DRC-unsafe short). Every op below RETHROWS as `CopperKernelError` and
 *    warns once: `[]` is a legitimate geometric answer for an erosion or a
 *    difference, so swallowing a throw into `[]` made a lost thermal knockout
 *    indistinguishable from "no relief needed" and flooded the pad solid
 *    (copper-pour contract §3, §8, Astra run 1 #9). The pour turns the throw
 *    into `status: "failed"` at its own boundary.
 *  - Re-nesting via Clipper `PolyTree` (non-zero fill), never by feeding flat
 *    rings through a union and guessing hole-ness from winding.
 */

// Clipper2 *D ("double") API works in mm and quantizes to `precision` decimals.
export const PRECISION = 4; // 1e4 units/mm — 0.1 µm grid (matches legacy CLIP_QUANT)
// Round-join chord error at routing zoom. Exported so the pour can compensate:
// the polygonal offset's chords lie INSIDE the ideal Minkowski offset by up to
// this amount, so clearance offsets must over-shoot by ~this to stay exact.
export const ARC_TOLERANCE_MM = 0.005;
const MITER_LIMIT = 2;

// --- mm ⇄ Clipper PathsD converters ----------------------------------------

function ringToPathD(ring: ClipperRing): PathD {
  return ring.map(([x, y]) => ({ x, y }));
}

/** Flatten a polygon-clipping MultiPolygon (mm) into a flat Clipper PathsD. */
export function multiPolyToPathsD(mp: ClipperMultiPolygon): PathsD {
  const out: PathsD = [];
  for (const poly of mp) for (const ring of poly) out.push(ringToPathD(ring));
  return out;
}

export function polyToPathsD(poly: ClipperPolygon): PathsD {
  return poly.map(ringToPathD);
}

// --- Fail-closed primitives -------------------------------------------------

/** A clipper operation threw. The caller decides what "no answer" means. */
export class CopperKernelError extends Error {
  readonly op: string;
  override readonly cause: unknown;
  constructor(op: string, cause: unknown) {
    super(`[copper-kernel] ${op} failed`);
    this.name = "CopperKernelError";
    this.op = op;
    this.cause = cause;
  }
}

let warned = false;
let quiet = 0;

/**
 * Run `fn` with the one-shot `console.warn` suppressed. For a caller that
 * CONVERTS a `CopperKernelError` into a reported verdict — the copper-shape
 * check's `COPPER_SHAPE_UNCHECKED` (DFM contract 11 §5.5) — the throw is an
 * answer, not a surprise, and warning about it trains the reader to ignore the
 * pour's genuine one. The `warned` latch is untouched, so a later pour failure
 * still gets its single warning.
 */
export function runKernelQuietly<T>(fn: () => T): T {
  quiet += 1;
  try {
    return fn();
  } finally {
    quiet -= 1;
  }
}

function runOp<T>(op: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (!warned && quiet === 0) {
      warned = true;
      console.warn(`[copper-kernel] ${op} failed`, error);
    }
    throw new CopperKernelError(op, error);
  }
}

/** Union of one or more flat ring groups → flat PathsD (NonZero). */
export function union(...groups: PathsD[]): PathsD {
  const subject = groups.flat();
  if (subject.length === 0) return [];
  return runOp("union", () => unionD(subject, [], FillRule.NonZero, PRECISION));
}

/** subject − clip → flat PathsD. An empty result is a legitimate answer. */
export function difference(subject: PathsD, clip: PathsD): PathsD {
  if (subject.length === 0) return [];
  if (clip.length === 0) return subject;
  return runOp("difference", () =>
    differenceD(subject, clip, FillRule.NonZero, PRECISION),
  );
}

/** subject ∩ clip → flat PathsD. An empty result is a legitimate answer. */
export function intersection(subject: PathsD, clip: PathsD): PathsD {
  if (subject.length === 0 || clip.length === 0) return [];
  return runOp("intersection", () =>
    intersectD(subject, clip, FillRule.NonZero, PRECISION),
  );
}

/** Offset (inflate δ>0 / deflate δ<0) with the given corner join. */
function offset(paths: PathsD, deltaMm: number, joinType: JoinType): PathsD {
  if (paths.length === 0 || deltaMm === 0) return paths;
  return runOp("offset", () =>
    inflatePathsD(
      paths,
      deltaMm,
      joinType,
      EndType.Polygon,
      MITER_LIMIT,
      PRECISION,
      ARC_TOLERANCE_MM,
    ),
  );
}

/** Inflate/deflate rounding the corners it creates (convex on +δ). */
export function offsetRound(paths: PathsD, deltaMm: number): PathsD {
  return offset(paths, deltaMm, JoinType.Round);
}

/**
 * Round offset at a CALLER-CHOSEN arc tolerance (DFM contract 11 §5.2). The
 * pour's {@link ARC_TOLERANCE_MM} (0.005 mm) turns the round join at a ~0.05 mm
 * erosion radius into a 7-gon — far too coarse to decide a 0.1 mm connection
 * width — and lowering the pour's constant would re-bake every pour golden. So
 * the copper-shape kernel gets its own tolerance and shares everything else:
 * the 0.1 µm grid, the miter limit and the fail-closed {@link runOp}.
 */
function offsetRoundAt(
  paths: PathsD,
  deltaMm: number,
  arcToleranceMm: number,
): PathsD {
  if (paths.length === 0 || deltaMm === 0) return paths;
  return runOp("offset", () =>
    inflatePathsD(
      paths,
      deltaMm,
      JoinType.Round,
      EndType.Polygon,
      MITER_LIMIT,
      PRECISION,
      arcToleranceMm,
    ),
  );
}

/**
 * `E(r) = offset(paths, −r)` with round joins at `arcToleranceMm` (DFM contract
 * 11 §5.2). A non-positive radius is the identity — an erosion by nothing.
 */
export function erodeWithTolerance(
  paths: PathsD,
  radiusMm: number,
  arcToleranceMm: number,
): PathsD {
  if (radiusMm <= 0) return paths;
  return offsetRoundAt(paths, -radiusMm, arcToleranceMm);
}

/** The dilation half of the morphological opening (DFM contract 11 §5.4). */
export function dilateWithTolerance(
  paths: PathsD,
  radiusMm: number,
  arcToleranceMm: number,
): PathsD {
  if (radiusMm <= 0) return paths;
  return offsetRoundAt(paths, radiusMm, arcToleranceMm);
}

/**
 * Total boundary length (mm) of a flat ring set — EVERY ring, holes included
 * (DFM contract 11 §5.4: for an annulus `2·area/perimeter` is then exactly the
 * radial thickness). Rings are open; the closing edge is counted.
 */
export function perimeter(paths: PathsD): number {
  let total = 0;
  for (const ring of paths) {
    const n = ring.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return total;
}

/** Inflate/deflate chamfering corners — KiCad's min-thickness deflate join. */
export function offsetChamfer(paths: PathsD, deltaMm: number): PathsD {
  return offset(paths, deltaMm, JoinType.Bevel);
}

/**
 * Aesthetic, clearance-SAFE corner rounding: a round morphological opening
 * (deflate then inflate, both round). Anti-extensive — `result ⊆ input` — so it
 * only *removes* copper at convex corners and never grows into a clearance gap.
 * Concave (clearance-gap-side) corners are rounded upstream by round-inflating
 * the obstacles, not here.
 */
export function removeOnlyFillet(paths: PathsD, radiusMm: number): PathsD {
  if (radiusMm <= 0 || paths.length === 0) return paths;
  return offsetRound(offsetRound(paths, -radiusMm), radiusMm);
}

/** Absolute area (mm²) of a flat ring set (outers minus holes, sign-aware). */
export function area(paths: PathsD): number {
  return Math.abs(areaPathsD(paths));
}

// --- PolyTree → islands (correct outer/hole nesting) ------------------------

function cleanRing(poly: PathD | null): ClipperRing | null {
  if (!poly || poly.length < 3) return null;
  const ring: ClipperRing = [];
  for (const p of poly) {
    const prev = ring[ring.length - 1];
    // Drop consecutive duplicates (Clipper can emit them at offset joins).
    if (!prev || prev[0] !== p.x || prev[1] !== p.y) ring.push([p.x, p.y]);
  }
  // Drop a closing duplicate of the first point.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    ring.length > 1 &&
    first &&
    last &&
    first[0] === last[0] &&
    first[1] === last[1]
  ) {
    ring.pop();
  }
  return ring.length >= 3 ? ring : null;
}

export interface CopperIsland {
  /** [outer, ...holes] in mm — used for area + same-net connectivity tests. */
  paths: PathsD;
  /** |outer| − Σ|holes|, mm². */
  areaMm2: number;
}

/** Emit one island (outer + its holes), recursing into holes' nested outers. */
function collectIsland(contour: PolyPathD, out: CopperIsland[]): void {
  const outer = cleanRing(contour.poly);
  if (!outer) {
    // Degenerate outer — still recurse so nested solids aren't lost.
    for (let i = 0; i < contour.count; i += 1)
      descendIsland(contour.child(i), out);
    return;
  }
  const paths: PathsD = [outer.map(([x, y]) => ({ x, y }))];
  for (let i = 0; i < contour.count; i += 1) {
    const hole = contour.child(i);
    const holeRing = cleanRing(hole.poly);
    if (holeRing) paths.push(holeRing.map(([x, y]) => ({ x, y })));
    descendIsland(hole, out);
  }
  out.push({ paths, areaMm2: area(paths) });
}

/** A hole's children are nested solid outers — emit them as their own islands. */
function descendIsland(hole: PolyPathD, out: CopperIsland[]): void {
  for (let i = 0; i < hole.count; i += 1) collectIsland(hole.child(i), out);
}

/**
 * Normalize a flat ring set into per-island {outer+holes, area} via a non-zero
 * PolyTree union, dropping degenerate rings. Rethrows `CopperKernelError`.
 */
export function splitIslands(paths: PathsD): CopperIsland[] {
  if (paths.length === 0) return [];
  return runOp("splitIslands", () => {
    const tree = new PolyTreeD();
    booleanOpDWithPolyTree(
      ClipType.Union,
      paths,
      null,
      tree,
      FillRule.NonZero,
      PRECISION,
    );
    const out: CopperIsland[] = [];
    for (let i = 0; i < tree.count; i += 1) collectIsland(tree.child(i), out);
    return out;
  });
}
