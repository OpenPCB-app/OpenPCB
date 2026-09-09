// Uniform-grid broad phase over the DRC context's four item arrays
// (broad-phase contract 08 §2.1; live-parity contract 07 §2 D2).
//
// The one property every consumer relies on: a query is a SUPERSET of every
// item whose GEOMETRY (stadium, ring, disc) is within `halo` of the query
// geometry — it may return more, never fewer, so a caller that follows it with
// the exact `aabbGap` / `farApart` test reaches the same verdict as a full
// scan. For pads, vias and holes the filed geometry IS the AABB, so the result
// is also a superset of AABB-within-halo; for traces it is NOT, because a trace
// is filed per sub-segment (§2.1) and the empty corners of a long diagonal's
// AABB are deliberately not indexed. Dependency-free (a Map of string cell
// keys), deterministic (output is a function of the filed bounds and their
// array order alone) and built once per context.

import type { PcbPointMm } from "../../sdks/designer";
import { boundsMeet, type RingBounds } from "../pcb-geometry/region-rings";
import { GEOM_EPS_MM } from "../pcb-geometry/tolerance";

export type BroadPhaseKind = "traces" | "pads" | "vias" | "holes";

/** A trace's copper as the index files it: the polyline, its half width, its AABB. */
export interface BroadPhaseTrace {
  pointsMm: readonly PcbPointMm[];
  halfWidthMm: number;
  /** The whole-polyline AABB — the bounds every query re-tests against. */
  bounds: RingBounds;
}

export interface BroadPhaseInput {
  traces: readonly BroadPhaseTrace[];
  pads: readonly RingBounds[];
  vias: readonly RingBounds[];
  holes: readonly RingBounds[];
}

/** Box query, for a pad / via / hole subject, a keepout or a window. */
export type BroadPhaseNear = (
  kind: BroadPhaseKind,
  bounds: RingBounds,
  haloMm: number,
) => readonly number[];

/** Polyline query, for a trace subject — the union of its own pieces' boxes. */
export type BroadPhaseNearPolyline = (
  kind: BroadPhaseKind,
  pointsMm: readonly PcbPointMm[],
  halfWidthMm: number,
  haloMm: number,
) => readonly number[];

/** Indices into the context array of `kind`, ascending and unique. */
export interface BroadPhase {
  near: BroadPhaseNear;
  nearPolyline: BroadPhaseNearPolyline;
}

/** Cell edge (mm). Two orders above a fine pitch, two below a small board. */
const CELL_MM = 2;

/**
 * Cap on the cells one item may occupy. An item that would cover more (a
 * board-long trace, a degenerate box) goes to `oversized` and is returned by
 * EVERY query instead — the superset property is kept, the memory is not.
 */
const MAX_CELLS_PER_ITEM = 1024;

/**
 * Cap on the cells one QUERY may walk. A query is a handful of map lookups per
 * cell, so it can afford far more cells than an item may occupy: a
 * whole-board corridor window (60 × 50 cells at 2 mm) still filters instead of
 * degrading to every item, as the S8 grid did. Past the cap the query fails
 * open exactly like an unindexable one.
 */
const MAX_CELLS_PER_QUERY = 1 << 16;

/**
 * Cap on the pieces one polyline is cut into. A 5 000-point serpentine would
 * otherwise pay a cell range per point before the cell cap could stop it.
 */
const MAX_SUBSEGMENTS_PER_ITEM = 4096;

/**
 * Query grace ON TOP of {@link GEOM_EPS_MM} (contract 08 §1 "float caveat").
 * A piece box is built by linear interpolation, so it can miss the item's own
 * arithmetic by a few ulps; the grid must never be the tighter of itself and
 * the exact test that follows it.
 */
const GRID_SLACK_MM = 1e-6;

interface Grid {
  /**
   * The bounds every query re-tests a candidate against: the item's WHOLE
   * AABB, a superset of each of its piece boxes, so the re-test can never drop
   * an item the cell walk found through one of its pieces.
   */
  bounds: readonly RingBounds[];
  cells: Map<string, number[]>;
  /**
   * Items the grid cannot index — too many cells, too many pieces, a
   * non-finite coordinate, or a cell index that is not a safe integer. They are
   * returned by EVERY query and, crucially, are NOT put through the exact
   * `boundsMeet` filter: a NaN coordinate makes every comparison false, so
   * filtering them would DROP a pair `aabbGap` would still judge. Fail open;
   * the caller's own exact test is the authority (R1 #3).
   */
  oversized: Set<number>;
  cellMm: number;
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Inclusive cell range of a box, or null when it is unusable / too large. */
function cellRange(
  b: RingBounds,
  padMm: number,
  cellMm: number,
  maxCells = MAX_CELLS_PER_ITEM,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (
    !Number.isFinite(b.minX) ||
    !Number.isFinite(b.minY) ||
    !Number.isFinite(b.maxX) ||
    !Number.isFinite(b.maxY)
  ) {
    return null;
  }
  const x0 = Math.floor((b.minX - padMm) / cellMm);
  const y0 = Math.floor((b.minY - padMm) / cellMm);
  const x1 = Math.floor((b.maxX + padMm) / cellMm);
  const y1 = Math.floor((b.maxY + padMm) / cellMm);
  // Finite is not enough (Astra A1 #4): past 2^53 the unit increment of the
  // cell loop below no longer advances (`2**53 + 1 === 2**53`), so a via at
  // x = 2^54 mm would hang it. Bail to `oversized` instead.
  if (
    !Number.isSafeInteger(x0) ||
    !Number.isSafeInteger(y0) ||
    !Number.isSafeInteger(x1) ||
    !Number.isSafeInteger(y1)
  ) {
    return null;
  }
  if (x1 < x0 || y1 < y0) return null;
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > maxCells) return null;
  return { x0, y0, x1, y1 };
}

/**
 * The boxes a polyline's copper is filed and queried under: every segment cut
 * into pieces of length ≤ `cellMm`, each piece's AABB inflated by the half
 * width. `stadium(piece) ⊆ box(piece) ⊕ r` and the pieces' stadiums union to
 * the whole stadium, so the boxes cover every point of the copper — a 100 mm
 * 45° trace occupies ≈ 100 cells instead of the 1 225 of its AABB.
 *
 * A ONE-POINT polyline is a disc of copper (contract 06 §2) and files its point
 * box (Astra A1 #1); an empty one has no copper and files nothing; a
 * zero-length segment is one piece. `null` = cannot be indexed (a non-finite
 * coordinate, or past the sub-segment cap) — the caller fails open.
 */
function polylinePieces(
  pointsMm: readonly PcbPointMm[],
  halfWidthMm: number,
  cellMm: number,
): RingBounds[] | null {
  if (!Number.isFinite(halfWidthMm)) return null;
  for (const p of pointsMm) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  const r = halfWidthMm;
  if (pointsMm.length === 0) return [];
  if (pointsMm.length === 1) {
    const p = pointsMm[0]!;
    return [{ minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r }];
  }
  const out: RingBounds[] = [];
  for (let s = 1; s < pointsMm.length; s += 1) {
    const a = pointsMm[s - 1]!;
    const b = pointsMm[s]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // Coordinates are finite above, so `len` is finite; a zero-length segment
    // is one piece with the endpoint's own box.
    const n = Math.max(1, Math.ceil(len / cellMm));
    if (out.length + n > MAX_SUBSEGMENTS_PER_ITEM) return null;
    for (let k = 0; k < n; k += 1) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const ax = a.x + (b.x - a.x) * t0;
      const ay = a.y + (b.y - a.y) * t0;
      const bx = a.x + (b.x - a.x) * t1;
      const by = a.y + (b.y - a.y) * t1;
      out.push({
        minX: Math.min(ax, bx) - r,
        minY: Math.min(ay, by) - r,
        maxX: Math.max(ax, bx) + r,
        maxY: Math.max(ay, by) + r,
      });
    }
  }
  return out;
}

/** File one item's boxes into the grid, or mark it `oversized`. */
function fileItem(
  grid: Grid,
  index: number,
  boxes: readonly RingBounds[] | null,
): void {
  if (!boxes) {
    grid.oversized.add(index);
    return;
  }
  // The cap counts DISTINCT cells. Consecutive pieces of one polyline share
  // most of their cells, so summing per-piece ranges would spend the budget
  // about four times over and push an ordinary 350 mm bus run into
  // `oversized` — where every query pays for it, unfiltered (R1 #4). The keys
  // are collected first so a capped item files nothing at all.
  const keys = new Set<string>();
  for (const box of boxes) {
    const range = cellRange(box, 0, grid.cellMm);
    if (!range) {
      grid.oversized.add(index);
      return;
    }
    for (let cx = range.x0; cx <= range.x1; cx += 1) {
      for (let cy = range.y0; cy <= range.y1; cy += 1) {
        keys.add(cellKey(cx, cy));
        if (keys.size > MAX_CELLS_PER_ITEM) {
          grid.oversized.add(index);
          return;
        }
      }
    }
  }
  for (const key of keys) {
    const bucket = grid.cells.get(key);
    // One item's insertions are contiguous and each key is visited once, so
    // the buckets stay duplicate-free and ascending in the item index.
    if (!bucket) grid.cells.set(key, [index]);
    else bucket.push(index);
  }
}

function emptyGrid(bounds: readonly RingBounds[], cellMm: number): Grid {
  return { bounds, cells: new Map(), oversized: new Set(), cellMm };
}

function buildBoxGrid(bounds: readonly RingBounds[], cellMm: number): Grid {
  const grid = emptyGrid(bounds, cellMm);
  for (let i = 0; i < bounds.length; i += 1) fileItem(grid, i, [bounds[i]!]);
  return grid;
}

function buildTraceGrid(traces: readonly BroadPhaseTrace[], cellMm: number): Grid {
  const grid = emptyGrid(
    traces.map((t) => t.bounds),
    cellMm,
  );
  for (let i = 0; i < traces.length; i += 1) {
    const t = traces[i]!;
    fileItem(grid, i, polylinePieces(t.pointsMm, t.halfWidthMm, cellMm));
  }
  return grid;
}

function allIndices(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(i);
  return out;
}

/**
 * The pad every query walks its cells and re-tests with. The half-nanometre
 * grace is the one the exact prefilter carries (Astra R2 #2) — `aabbGap` and
 * `boundsMeet` are different float computations of the same predicate — plus
 * the interpolation slack of §2.1's piece boxes.
 */
function queryPad(requestedHaloMm: number): number {
  return requestedHaloMm + GEOM_EPS_MM + GRID_SLACK_MM;
}

function queryGrid(
  grid: Grid,
  query: RingBounds,
  requestedHaloMm: number,
): readonly number[] {
  const haloMm = queryPad(requestedHaloMm);
  const range = cellRange(query, haloMm, grid.cellMm, MAX_CELLS_PER_QUERY);
  if (!range) {
    // A query box the grid cannot index (non-finite, unsafe cell indices, or
    // spanning too many cells): every item is a candidate, UNFILTERED. Running
    // the exact test against a NaN box would return nothing at all — fail open
    // (R1 #3).
    return allIndices(grid.bounds.length);
  }
  const kept = new Set<number>(grid.oversized);
  for (let cx = range.x0; cx <= range.x1; cx += 1) {
    for (let cy = range.y0; cy <= range.y1; cy += 1) {
      const bucket = grid.cells.get(cellKey(cx, cy));
      if (!bucket) continue;
      for (const i of bucket) {
        if (kept.has(i)) continue;
        // `boundsMeet(a, b, halo)` is exactly "a meets b inflated by halo",
        // which is implied by `aabbGap(a, b) <= halo` (a diagonal gap makes it
        // strictly wider) — the superset guarantee.
        if (boundsMeet(grid.bounds[i]!, query, haloMm)) kept.add(i);
      }
    }
  }
  return ascending(kept);
}

/**
 * A subject's pieces are a function of its polyline and half width alone, and
 * one subject queries every kind in turn — so they are cut once per subject
 * and reused (Astra A2 #5: an unindexable 4 000-vertex subject was re-cut on
 * every query before failing open). Keyed by the points array's identity; a
 * context never mutates an item's points.
 */
type PieceMemo = WeakMap<readonly PcbPointMm[], RingBounds[] | null>;

function piecesOf(
  memo: PieceMemo,
  pointsMm: readonly PcbPointMm[],
  halfWidthMm: number,
  cellMm: number,
): RingBounds[] | null {
  const cached = memo.get(pointsMm);
  if (cached !== undefined) return cached;
  const pieces = polylinePieces(pointsMm, halfWidthMm, cellMm);
  memo.set(pointsMm, pieces);
  return pieces;
}

function queryGridPolyline(
  grid: Grid,
  memo: PieceMemo,
  pointsMm: readonly PcbPointMm[],
  halfWidthMm: number,
  requestedHaloMm: number,
): readonly number[] {
  // Nothing filed under this kind: no candidate exists, indexable or not.
  if (grid.bounds.length === 0) return [];
  const haloMm = queryPad(requestedHaloMm);
  const pieces = piecesOf(memo, pointsMm, halfWidthMm, grid.cellMm);
  // A subject the grid cannot cut (non-finite, or past the sub-segment cap):
  // every item is a candidate, unfiltered — the same fail-open as a box query.
  if (!pieces) return allIndices(grid.bounds.length);
  const kept = new Set<number>(grid.oversized);
  for (const piece of pieces) {
    const range = cellRange(piece, haloMm, grid.cellMm, MAX_CELLS_PER_QUERY);
    if (!range) return allIndices(grid.bounds.length);
    for (let cx = range.x0; cx <= range.x1; cx += 1) {
      for (let cy = range.y0; cy <= range.y1; cy += 1) {
        const bucket = grid.cells.get(cellKey(cx, cy));
        if (!bucket) continue;
        for (const i of bucket) {
          // An item kept through an earlier piece needs no second test; one
          // piece meeting it is the whole condition.
          if (kept.has(i)) continue;
          if (boundsMeet(grid.bounds[i]!, piece, haloMm)) kept.add(i);
        }
      }
    }
  }
  return ascending(kept);
}

/** Sorted output, so `Set` insertion order never reaches a consumer (§2.1). */
function ascending(indices: ReadonlySet<number>): number[] {
  const out = [...indices];
  out.sort((a, b) => a - b);
  return out;
}

/** One grid per item kind, built eagerly with the context. */
export function createBroadPhase(
  input: BroadPhaseInput,
  options: { cellMm?: number } = {},
): BroadPhase {
  // A bench knob, never a semantic input: every query resolves its cells with
  // the same edge the build used, so the superset property is cell-size-free.
  const cellMm = options.cellMm ?? CELL_MM;
  const grids: Record<BroadPhaseKind, Grid> = {
    traces: buildTraceGrid(input.traces, cellMm),
    pads: buildBoxGrid(input.pads, cellMm),
    vias: buildBoxGrid(input.vias, cellMm),
    holes: buildBoxGrid(input.holes, cellMm),
  };
  const memo: PieceMemo = new WeakMap();
  return {
    near: (kind, bounds, haloMm) => queryGrid(grids[kind], bounds, haloMm),
    nearPolyline: (kind, pointsMm, halfWidthMm, haloMm) =>
      queryGridPolyline(grids[kind], memo, pointsMm, halfWidthMm, haloMm),
  };
}
