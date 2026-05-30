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
import * as THREE from "three";
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
 *  - FAIL CLOSED. Copper booleans that throw must yield *empty* copper, never
 *    an un-clearanced fallback (a fail-open difference returns subject-with-no-
 *    clearance → a DRC-unsafe short). Every op below returns `[]`/`[]shapes` on
 *    failure and warns once.
 *  - Re-nesting via Clipper `PolyTree` (non-zero fill), never by feeding flat
 *    rings through a union and guessing hole-ness from winding.
 */

// Clipper2 *D ("double") API works in mm and quantizes to `precision` decimals.
const PRECISION = 4; // 1e4 units/mm — 0.1 µm grid (matches legacy CLIP_QUANT)
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

let warned = false;
function failClosed<T>(op: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (error) {
    if (!warned) {
      warned = true;
      // Empty copper is the safe degrade: a missing pour never shorts nets,
      // an un-clearanced pour does.
      console.warn(
        `[copper-kernel] ${op} failed; returning empty copper`,
        error,
      );
    }
    return fallback;
  }
}

/** Union of one or more flat ring groups → flat PathsD (NonZero). */
export function union(...groups: PathsD[]): PathsD {
  const subject = groups.flat();
  if (subject.length === 0) return [];
  return failClosed(
    "union",
    () => unionD(subject, [], FillRule.NonZero, PRECISION),
    [],
  );
}

/** subject − clip → flat PathsD. Empty on failure (fail closed). */
export function difference(subject: PathsD, clip: PathsD): PathsD {
  if (subject.length === 0) return [];
  if (clip.length === 0) return subject;
  return failClosed(
    "difference",
    () => differenceD(subject, clip, FillRule.NonZero, PRECISION),
    [],
  );
}

/** subject ∩ clip → flat PathsD. Empty on failure. */
export function intersection(subject: PathsD, clip: PathsD): PathsD {
  if (subject.length === 0 || clip.length === 0) return [];
  return failClosed(
    "intersection",
    () => intersectD(subject, clip, FillRule.NonZero, PRECISION),
    [],
  );
}

/** Offset (inflate δ>0 / deflate δ<0) with the given corner join. */
function offset(paths: PathsD, deltaMm: number, joinType: JoinType): PathsD {
  if (paths.length === 0 || deltaMm === 0) return paths;
  return failClosed(
    "offset",
    () =>
      inflatePathsD(
        paths,
        deltaMm,
        joinType,
        EndType.Polygon,
        MITER_LIMIT,
        PRECISION,
        ARC_TOLERANCE_MM,
      ),
    [],
  );
}

/** Inflate/deflate rounding the corners it creates (convex on +δ). */
export function offsetRound(paths: PathsD, deltaMm: number): PathsD {
  return offset(paths, deltaMm, JoinType.Round);
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

// --- PolyTree → THREE.Shape[] (correct outer/hole nesting) ------------------

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

function traceRing(target: THREE.Shape | THREE.Path, ring: ClipperRing): void {
  const first = ring[0]!;
  target.moveTo(first[0], first[1]);
  for (let i = 1; i < ring.length; i += 1) {
    const p = ring[i]!;
    target.lineTo(p[0], p[1]);
  }
}

export interface CopperIsland {
  /** [outer, ...holes] in mm — used for area + same-net connectivity tests. */
  paths: PathsD;
  /** Ready for THREE.ShapeGeometry. */
  shape: THREE.Shape;
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
  const shape = new THREE.Shape();
  traceRing(shape, outer);
  const paths: PathsD = [outer.map(([x, y]) => ({ x, y }))];
  for (let i = 0; i < contour.count; i += 1) {
    const hole = contour.child(i);
    const holeRing = cleanRing(hole.poly);
    if (holeRing) {
      const path = new THREE.Path();
      traceRing(path, holeRing);
      shape.holes.push(path);
      paths.push(holeRing.map(([x, y]) => ({ x, y })));
    }
    descendIsland(hole, out);
  }
  out.push({ paths, shape, areaMm2: area(paths) });
}

/** A hole's children are nested solid outers — emit them as their own islands. */
function descendIsland(hole: PolyPathD, out: CopperIsland[]): void {
  for (let i = 0; i < hole.count; i += 1) collectIsland(hole.child(i), out);
}

/**
 * Normalize a flat ring set into per-island {outer+holes, shape, area} via a
 * non-zero PolyTree union, dropping degenerate rings. Fail closed → [] on error.
 */
export function splitIslands(paths: PathsD): CopperIsland[] {
  if (paths.length === 0) return [];
  return failClosed(
    "splitIslands",
    () => {
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
    },
    [],
  );
}

/** Strictly-nested THREE.Shapes for `paths` (one per island outer). */
export function toShapes(paths: PathsD): THREE.Shape[] {
  return splitIslands(paths).map((island) => island.shape);
}
