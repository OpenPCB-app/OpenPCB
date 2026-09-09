// Uniform-grid broad phase over the DRC context's four item arrays
// (live-parity contract 07 §2 D2).
//
// The one property every consumer relies on: `near(kind, bounds, halo)` is a
// SUPERSET of every item whose AABB is within `halo` of `bounds` — it may
// return more, never fewer, so a caller that follows it with the exact
// `aabbGap` test reaches the same verdict as a full scan. Dependency-free (a
// Map of string cell keys), deterministic (output is a function of the item
// bounds and their array order alone) and built once per context.

import { boundsMeet, type RingBounds } from "../pcb-geometry/region-rings";
import { GEOM_EPS_MM } from "../pcb-geometry/tolerance";

export type BroadPhaseKind = "traces" | "pads" | "vias" | "holes";

/** Indices into the context array of `kind`, ascending. */
export type BroadPhase = (
  kind: BroadPhaseKind,
  bounds: RingBounds,
  haloMm: number,
) => readonly number[];

/** Cell edge (mm). Two orders above a fine pitch, two below a small board. */
const CELL_MM = 2;

/**
 * Cap on the cells one item may occupy. An item that would cover more (a
 * board-long trace, a degenerate box) goes to `oversized` and is returned by
 * EVERY query instead — the superset property is kept, the memory is not.
 */
const MAX_CELLS_PER_ITEM = 1024;

interface Grid {
  bounds: readonly RingBounds[];
  cells: Map<string, number[]>;
  /**
   * Items the grid cannot index — too many cells, or a non-finite box. They are
   * returned by EVERY query and, crucially, are NOT put through the exact
   * `boundsMeet` filter: a NaN coordinate makes every comparison false, so
   * filtering them would DROP a pair `aabbGap` would still judge. Fail open;
   * the caller's own exact test is the authority (R1 #3).
   */
  oversized: Set<number>;
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Inclusive cell range of a box, or null when it is unusable / too large. */
function cellRange(
  b: RingBounds,
  padMm: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (
    !Number.isFinite(b.minX) ||
    !Number.isFinite(b.minY) ||
    !Number.isFinite(b.maxX) ||
    !Number.isFinite(b.maxY)
  ) {
    return null;
  }
  const x0 = Math.floor((b.minX - padMm) / CELL_MM);
  const y0 = Math.floor((b.minY - padMm) / CELL_MM);
  const x1 = Math.floor((b.maxX + padMm) / CELL_MM);
  const y1 = Math.floor((b.maxY + padMm) / CELL_MM);
  if (x1 < x0 || y1 < y0) return null;
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_ITEM) return null;
  return { x0, y0, x1, y1 };
}

function buildGrid(bounds: readonly RingBounds[]): Grid {
  const cells = new Map<string, number[]>();
  const oversized = new Set<number>();
  for (let i = 0; i < bounds.length; i += 1) {
    const range = cellRange(bounds[i]!, 0);
    if (!range) {
      oversized.add(i);
      continue;
    }
    for (let cx = range.x0; cx <= range.x1; cx += 1) {
      for (let cy = range.y0; cy <= range.y1; cy += 1) {
        const key = cellKey(cx, cy);
        const bucket = cells.get(key);
        if (bucket) bucket.push(i);
        else cells.set(key, [i]);
      }
    }
  }
  return { bounds, cells, oversized };
}

function queryGrid(
  grid: Grid,
  query: RingBounds,
  requestedHaloMm: number,
): readonly number[] {
  // The same half-nanometre grace the exact prefilter carries (Astra R2 #2):
  // `aabbGap` and `boundsMeet` are different float computations of the same
  // predicate, and the grid must never be the tighter of the two.
  const haloMm = requestedHaloMm + GEOM_EPS_MM;
  const range = cellRange(query, haloMm);
  if (!range) {
    // A query box the grid cannot index (non-finite, or spanning too many
    // cells): every item is a candidate, UNFILTERED. Running the exact test
    // against a NaN box would return nothing at all — fail open (R1 #3).
    const all: number[] = [];
    for (let i = 0; i < grid.bounds.length; i += 1) all.push(i);
    return all;
  }
  const seen = new Set<number>(grid.oversized);
  for (let cx = range.x0; cx <= range.x1; cx += 1) {
    for (let cy = range.y0; cy <= range.y1; cy += 1) {
      const bucket = grid.cells.get(cellKey(cx, cy));
      if (!bucket) continue;
      for (const i of bucket) seen.add(i);
    }
  }
  // `boundsMeet(a, b, halo)` is exactly "a meets b inflated by halo", which is
  // implied by `aabbGap(a, b) <= halo` (a diagonal gap makes it strictly
  // wider) — the superset guarantee. An un-indexable item skips the filter.
  const kept: number[] = [];
  for (const i of seen) {
    if (grid.oversized.has(i) || boundsMeet(grid.bounds[i]!, query, haloMm)) {
      kept.push(i);
    }
  }
  kept.sort((a, b) => a - b);
  return kept;
}

/** One grid per item kind, built eagerly with the context. */
export function createBroadPhase(
  boundsByKind: Record<BroadPhaseKind, readonly RingBounds[]>,
): BroadPhase {
  const grids: Record<BroadPhaseKind, Grid> = {
    traces: buildGrid(boundsByKind.traces),
    pads: buildGrid(boundsByKind.pads),
    vias: buildGrid(boundsByKind.vias),
    holes: buildGrid(boundsByKind.holes),
  };
  return (kind, bounds, haloMm) => queryGrid(grids[kind], bounds, haloMm);
}
