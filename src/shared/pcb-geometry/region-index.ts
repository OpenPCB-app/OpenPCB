/**
 * Boundary-edge index over a {@link BoardRegion} (broad-phase contract 08
 * §2.2): a uniform cell grid for "which edges are near this box" and a row-band
 * table for "which edges can straddle this y". Built once per DRC context and
 * handed to the indexed variants of the region predicates as an optional
 * trailing argument — with it absent they are the pre-S9 functions.
 *
 * Both queries are SUPERSETS of what their lemma needs (§1 L2, L3): the cell
 * query returns every edge within the halo of the box, the row query every edge
 * whose closed y-range covers `y`. An edge the index cannot file is returned by
 * every query instead, so a degenerate region degrades to the full scan rather
 * than to a wrong answer.
 */
import type { BoardRegion } from "./board-region";
import type { RingBounds } from "./region-rings";
import { boundsMeet } from "./region-rings";
import { GEOM_EPS_MM } from "./tolerance";

/** Cell edge (mm) and row height (mm) — the grid's only tuning knob. */
const CELL_MM = 2;

/** Cap on the cells or rows one edge may occupy before it is `oversized`. */
const MAX_CELLS_PER_ITEM = 1024;

/** The same interpolation grace `broad-phase.ts` queries with (§1 float caveat). */
const GRID_SLACK_MM = 1e-6;

export interface RegionIndex {
  /**
   * Ascending indices into `region.edges` whose bounds meet `bounds` inflated
   * by `haloMm` — a superset of every edge within `haloMm` of the box. `ring`
   * restricts the result to one ring, which is how every per-ring predicate of
   * `board-region.ts` stays per ring.
   */
  edgesNear(bounds: RingBounds, haloMm: number, ring?: number): readonly number[];
  /**
   * Ascending indices of one ring's edges whose closed y-range touches the row
   * band of `y`. NO grace: `Math.floor` is monotone and an inclusive closed
   * range is exactly what the ray-parity lemma needs (§1 L3).
   */
  edgesStraddling(y: number, ring: number): readonly number[];
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Inclusive cell range of a box, or null when it is unusable / too large. */
function cellRange(
  b: RingBounds,
  padMm: number,
  cellMm: number,
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
  // Past 2^53 a unit increment no longer advances the loop counter (Astra
  // A1 #4) — bail rather than hang.
  if (
    !Number.isSafeInteger(x0) ||
    !Number.isSafeInteger(y0) ||
    !Number.isSafeInteger(x1) ||
    !Number.isSafeInteger(y1)
  ) {
    return null;
  }
  if (x1 < x0 || y1 < y0) return null;
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_ITEM) return null;
  return { x0, y0, x1, y1 };
}

function ascending(indices: ReadonlySet<number>): number[] {
  const out = [...indices];
  out.sort((a, b) => a - b);
  return out;
}

export function buildRegionIndex(
  region: BoardRegion,
  cellMm = CELL_MM,
): RegionIndex {
  const edges = region.edges;
  const cells = new Map<string, number[]>();
  const rows = new Map<number, number[]>();
  /**
   * Edges no query may filter: a non-finite coordinate, an unsafe cell or row
   * index, or a span past the cap. A finite 10^9 mm edge would otherwise
   * materialise 5 × 10^8 row postings (Astra A1 #7); a NaN coordinate would
   * make every `boundsMeet` false and silently drop the edge (A1 #4).
   */
  const oversized = new Set<number>();

  for (let i = 0; i < edges.length; i += 1) {
    const e = edges[i]!;
    const range = cellRange(e.bounds, 0, cellMm);
    const loY = Math.min(e.a.y, e.b.y);
    const hiY = Math.max(e.a.y, e.b.y);
    const r0 = Math.floor(loY / cellMm);
    const r1 = Math.floor(hiY / cellMm);
    if (
      !range ||
      !Number.isSafeInteger(r0) ||
      !Number.isSafeInteger(r1) ||
      r1 < r0 ||
      r1 - r0 + 1 > MAX_CELLS_PER_ITEM
    ) {
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
    for (let r = r0; r <= r1; r += 1) {
      const bucket = rows.get(r);
      if (bucket) bucket.push(i);
      else rows.set(r, [i]);
    }
  }

  const inRing = (i: number, ring: number | undefined): boolean =>
    ring === undefined || edges[i]!.ring === ring;

  const everyEdge = (ring: number | undefined): number[] => {
    const out: number[] = [];
    for (let i = 0; i < edges.length; i += 1) if (inRing(i, ring)) out.push(i);
    return out;
  };

  return {
    edgesNear(bounds, haloMm, ring) {
      // The grid must never be tighter than the exact primitive that follows
      // it: the caller's own eps plus the grid's interpolation slack.
      const padMm = haloMm + GEOM_EPS_MM + GRID_SLACK_MM;
      const range = cellRange(bounds, padMm, cellMm);
      // A query the grid cannot index — an infinite halo ("every edge"), a
      // non-finite box, or one spanning too many cells: every edge of the ring,
      // UNFILTERED, because the exact test that follows is the authority.
      if (!range) return everyEdge(ring);
      const kept = new Set<number>();
      for (const i of oversized) if (inRing(i, ring)) kept.add(i);
      for (let cx = range.x0; cx <= range.x1; cx += 1) {
        for (let cy = range.y0; cy <= range.y1; cy += 1) {
          const bucket = cells.get(cellKey(cx, cy));
          if (!bucket) continue;
          for (const i of bucket) {
            if (kept.has(i) || !inRing(i, ring)) continue;
            if (boundsMeet(edges[i]!.bounds, bounds, padMm)) kept.add(i);
          }
        }
      }
      return ascending(kept);
    },

    edgesStraddling(y, ring) {
      const row = Math.floor(y / cellMm);
      // A y the row table cannot address (NaN, infinite, past 2^53) falls back
      // to the ring's whole edge list — the parity walk is the authority.
      if (!Number.isSafeInteger(row)) return everyEdge(ring);
      const out: number[] = [];
      for (const i of oversized) if (inRing(i, ring)) out.push(i);
      for (const i of rows.get(row) ?? []) if (inRing(i, ring)) out.push(i);
      // `oversized` edges are never filed in a row, so the two lists are
      // disjoint and a sort is all the ordering the contract asks for.
      out.sort((a, b) => a - b);
      return out;
    },
  };
}
