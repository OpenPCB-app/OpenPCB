// The copper-SHAPE kernel (docs/pcb-hardening/11-dfm-contract.md §5.1–§5.5).
//
// One question, three answers: given every piece of copper of one net on one
// layer, where is that copper narrower than `w`, where is it a thin residue,
// and when could we not tell. Nothing here knows about DRC codes, severities or
// anchors beyond carrying one through — `drc/checks/copper-shape.ts` turns the
// geometry into violations.
//
// Backend-safe (no `three`), fail-closed: every Clipper primitive it calls
// rethrows `CopperKernelError`, which the caller turns into an explicit
// "not checked" report rather than a silent pass (§5.5).

import type { PathsD } from "clipper2-ts";
import type { DrcAnchor, PcbCopperLayerId, PcbPointMm } from "../../../sdks";
import {
  DEGENERATE_AREA_MM2,
  ensureCcwRing,
  ringSignedArea,
} from "../../pcb-geometry/ring-utils";
import type { RingBounds } from "../../pcb-geometry/pad-outline";
import { CONNECT_EPS_MM, GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import {
  pointToRingEdgeDistance,
  ringToRingClosestPoints,
} from "../../pcb-geometry/pcb-clearance-geometry";
import {
  segmentClosestPoints,
  segmentToSegmentDistance,
} from "../../pcb-geometry/pcb-trace-geometry";
import { projectPointToSegment } from "../../pcb-geometry/segment-predicates";
import {
  dilateWithTolerance,
  difference,
  erodeWithTolerance,
  perimeter,
  runKernelQuietly,
  splitIslands,
  union,
  type CopperIsland,
} from "./copper-geometry-kernel";

// --- Parameters (contract §5, §6) -------------------------------------------

/** `designRules.dfm.sliverWidthMm` default; the check caps it at the board minimum. */
export const DEFAULT_SLIVER_WIDTH_MM = 0.1;
/** `designRules.dfm.sliverMinLengthMm` default — 2 · `sliverWidthMm` (§6). */
export const DEFAULT_SLIVER_MIN_LENGTH_MM = 0.2;
/** `designRules.dfm.acuteAngleDeg` default (§6, OPEN_FINDINGS §6.8 "< 90°"). */
export const DEFAULT_ACUTE_ANGLE_DEG = 90;
/**
 * The angular tolerance of `TRACE_ACUTE_ANGLE` (§5.6). An angle is not a
 * length, so `below()` — whose epsilon is millimetres — must never judge it.
 */
export const ANGLE_EPS_DEG = 1e-6;

/**
 * `r = w/2 − EROSION_MARGIN_MM` (§5.2): the erosion radius sits one micron
 * inside the half width so a `w`-wide circumscribed stadium keeps a core 20
 * grid units across, robust against the 0.1 µm quantisation of a diagonal
 * strip (the pour's own `w − 0.002` precedent, contract 04 §7).
 */
export const EROSION_MARGIN_MM = 1e-3;
/**
 * Round-join chord budget for every offset in this kernel (§5.2): ≈50 chords
 * per full turn at r ≈ 0.05 mm, chord sag ≤ 1e-4 mm. Deliberately NOT the
 * pour's `ARC_TOLERANCE_MM` (0.005), which would make the join a 7-gon.
 */
export const SHAPE_ARC_TOLERANCE_MM = 1e-4;
/** Bisection step `δ` on the erosion radius (§5.3); the neck is exact to `2δ`. */
export const BISECTION_STEP_MM = 1e-4;
/**
 * Mean-thickness floor (§5.4). A NUMERICAL-RESIDUE bound, not a physical one:
 * the re-sampled arcs of the opening leave bands of thickness ≤ sag + grid =
 * 2e-4 mm along every curved boundary, and this is five times that.
 */
export const SLIVER_THICKNESS_FLOOR_MM = 1e-3;
/**
 * How far the opening is over-dilated before the residual is taken (§5.4).
 *
 * `R = P − O` on a 0.1 µm integer grid leaves a hairline chain along every
 * boundary the two shapes do not quantise identically — a straight edge at
 * 22.5° is off by up to one grid unit, a re-sampled arc by up to its chord sag.
 * Those filaments carry no area but a LOT of perimeter, and `length =
 * perimeter/2` then reads a 45° corner's 0.176 mm residual as 1.14 mm and
 * reports it. Over-dilating by `sag + grid` erases them; a real sliver loses
 * 2e-4 mm of thickness, a fifth of the floor it is judged against.
 */
export const SLIVER_RESIDUE_EPS_MM = 2e-4;

/** Input vertices above which a unit is skipped with an explicit report (§5.5). */
export const COPPER_SHAPE_VERTEX_BUDGET = 250_000;
/** Necks located per group before the remainder becomes an explicit count (§5.5). */
export const MAX_NECKS_PER_UNIT = 64;
/** Erosions one unit may spend locating necks before it stops (§5.5). */
export const MAX_EROSIONS_PER_UNIT = 600;
/**
 * Boundary edge-pair comparisons one unit may spend before it gives up (§5.5).
 *
 * The vertex budget bounds the INPUT; it does not bound the work, because two
 * nested 8 192-vertex annuli are only 32 768 vertices and still make the
 * component merge quadratic. Grouping goes through a segment grid now, so the
 * normal cost is `O(n + m)`, but a degenerate shape that defeats the grid must
 * still stop and SAY it stopped rather than run for seconds (Astra run 2 #5).
 */
export const MAX_EDGE_COMPARISONS_PER_UNIT = 2_000_000;

/**
 * The three engineering limits of §5.5, overridable ONLY so a unit test can
 * provoke `COPPER_SHAPE_UNCHECKED` without a 250 000-vertex fixture.
 */
export interface CopperShapeBudgets {
  vertexBudget: number;
  maxNecksPerUnit: number;
  maxErosionsPerUnit: number;
  maxEdgeComparisonsPerUnit: number;
}

export const DEFAULT_COPPER_SHAPE_BUDGETS: CopperShapeBudgets = {
  vertexBudget: COPPER_SHAPE_VERTEX_BUDGET,
  maxNecksPerUnit: MAX_NECKS_PER_UNIT,
  maxErosionsPerUnit: MAX_EROSIONS_PER_UNIT,
  maxEdgeComparisonsPerUnit: MAX_EDGE_COMPARISONS_PER_UNIT,
};

/**
 * One unit's geometric work allowance, charged per boundary edge-pair
 * comparison and checkpointed as it is spent. Exhausting it is a REPORTED
 * outcome, never a silent partial answer, so it leaves by exception.
 */
export interface ShapeWork {
  remaining: number;
  tick?: (() => void) | undefined;
}

/** The work allowance ran out; the caller owes a `COPPER_SHAPE_UNCHECKED`. */
export class CopperShapeBudgetError extends Error {
  constructor(readonly limit: number) {
    super(`[copper-shape] edge-comparison budget ${limit} exhausted`);
    this.name = "CopperShapeBudgetError";
  }
}

function spendWork(work: ShapeWork | undefined, amount: number): void {
  if (!work) return;
  work.remaining -= amount;
  if (work.remaining <= 0) throw new CopperShapeBudgetError(0);
}

// --- Units (§5.1) -----------------------------------------------------------

/**
 * One piece of copper as it enters the union: an anchor the report can hang a
 * violation off, a total sort key, and its rings ALREADY oriented (outer CCW,
 * holes CW). Orientation is the caller's job because only the caller knows
 * which ring is a hole (the S5 winding lesson: a mirrored placement's pad ring
 * is CW as built and would cancel against overlapping copper under NonZero).
 */
export interface CopperShapeItem {
  /** Canonical total order of the union's inputs (§5.1, last paragraph). */
  key: string;
  anchor: DrcAnchor;
  /** `[outer CCW, ...holes CW]` in mm. */
  rings: PcbPointMm[][];
}

/** Every piece of copper of one net (or one null-net component) on one layer. */
export interface CopperUnit {
  layer: PcbCopperLayerId;
  netId: string | null;
  /** `{kind:"net"}` for a net unit, else the minimum item anchor (§5.3). */
  anchor: DrcAnchor;
  /** The unioned copper, outers CCW and holes CW (NonZero). */
  paths: PathsD;
  /** Vertices the unit's INPUT carried — what the budget judges (§5.5). */
  inputVertexCount: number;
  /** `anchorKey`s of the items that built it, ascending and unique. */
  itemKeys: string[];
}

/** A unit the kernel refused to build — never a silent pass (§5.5). */
export interface CopperUnitSkip {
  layer: PcbCopperLayerId;
  netId: string | null;
  anchor: DrcAnchor;
  reason: "budget" | "kernel" | "work";
  inputVertexCount: number;
}

export interface CopperUnitsInput {
  layer: PcbCopperLayerId;
  /** Net-bound copper by net id. Item order is irrelevant; the kernel sorts. */
  byNet: ReadonlyMap<string, readonly CopperShapeItem[]>;
  /** Unassigned copper on the layer — split into geometric components (§5.1). */
  nullNet: readonly CopperShapeItem[];
  budgets: CopperShapeBudgets;
  /** `anchorKey` of a `DrcAnchor` — injected so the kernel stays DRC-agnostic. */
  anchorKeyOf: (anchor: DrcAnchor) => string;
}

export interface CopperUnitsResult {
  units: CopperUnit[];
  skipped: CopperUnitSkip[];
}

/** Rings → flat Clipper paths, in the item's own ring order. */
function itemPaths(item: CopperShapeItem): PathsD {
  const out: PathsD = [];
  for (const ring of item.rings) {
    if (ring.length < 3) continue;
    out.push(ring.map((p) => ({ x: p.x, y: p.y })));
  }
  return out;
}

function vertexCount(items: readonly CopperShapeItem[]): number {
  let n = 0;
  for (const item of items) for (const ring of item.rings) n += ring.length;
  return n;
}

/** Ascending, unique anchor keys — the unit's `itemKeys`. */
function anchorKeysOf(
  items: readonly CopperShapeItem[],
  anchorKeyOf: (a: DrcAnchor) => string,
): string[] {
  return [...new Set(items.map((i) => anchorKeyOf(i.anchor)))].sort();
}

/** The item whose `anchorKey` is smallest — the unit anchor of a null unit. */
function minAnchor(
  items: readonly CopperShapeItem[],
  anchorKeyOf: (a: DrcAnchor) => string,
): DrcAnchor {
  let best = items[0]!;
  let bestKey = anchorKeyOf(best.anchor);
  for (const item of items.slice(1)) {
    const key = anchorKeyOf(item.anchor);
    if (key < bestKey) {
      best = item;
      bestKey = key;
    }
  }
  return best.anchor;
}

/**
 * Every unit on one layer (§5.1): one per net, plus one per geometric component
 * of the unassigned copper (two overlapping unassigned pads are ONE piece of
 * copper; two unrelated ones are two units).
 *
 * The vertex budget is judged on the INPUT, before the union, so a unit that
 * cannot be afforded is never built; a null-net set over budget is refused
 * whole, because its components are only known after the union it cannot pay
 * for. A `CopperKernelError` from the union lands in `skipped` too — a throw
 * must never read as "no problem here" (§5.5).
 */
export function buildCopperUnits(input: CopperUnitsInput): CopperUnitsResult {
  const { layer, byNet, nullNet, budgets, anchorKeyOf } = input;
  const units: CopperUnit[] = [];
  const skipped: CopperUnitSkip[] = [];

  for (const netId of [...byNet.keys()].sort()) {
    const items = [...byNet.get(netId)!].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    if (items.length === 0) continue;
    const anchor: DrcAnchor = { kind: "net", netId };
    const inputVertexCount = vertexCount(items);
    if (inputVertexCount > budgets.vertexBudget) {
      skipped.push({ layer, netId, anchor, reason: "budget", inputVertexCount });
      continue;
    }
    let paths: PathsD;
    try {
      paths = runKernelQuietly(() => union(...items.map(itemPaths)));
    } catch {
      skipped.push({ layer, netId, anchor, reason: "kernel", inputVertexCount });
      continue;
    }
    if (paths.length === 0) continue;
    units.push({
      layer,
      netId,
      anchor,
      paths,
      inputVertexCount,
      itemKeys: anchorKeysOf(items, anchorKeyOf),
    });
  }

  if (nullNet.length > 0) {
    const items = [...nullNet].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    const inputVertexCount = vertexCount(items);
    const anchor = minAnchor(items, anchorKeyOf);
    if (inputVertexCount > budgets.vertexBudget) {
      skipped.push({
        layer,
        netId: null,
        anchor,
        reason: "budget",
        inputVertexCount,
      });
    } else {
      const work: ShapeWork = {
        remaining: budgets.maxEdgeComparisonsPerUnit,
      };
      try {
        const groups = runKernelQuietly(() =>
          groupComponents(union(...items.map(itemPaths)), work),
        );
        for (const group of groups) {
          const members = itemsInGroup(items, group);
          // A component always came from at least one item; the fallback keeps
          // the anchor total if a quantisation edge hides the assignment.
          const owned = members.length > 0 ? members : items;
          units.push({
            layer,
            netId: null,
            anchor: minAnchor(owned, anchorKeyOf),
            paths: group.paths,
            inputVertexCount: vertexCount(owned),
            itemKeys: anchorKeysOf(owned, anchorKeyOf),
          });
        }
      } catch (error) {
        skipped.push({
          layer,
          netId: null,
          anchor,
          reason: error instanceof CopperShapeBudgetError ? "work" : "kernel",
          inputVertexCount,
        });
      }
    }
  }

  return { units, skipped };
}

/**
 * The items whose copper lies in `group`. Two tests, because neither alone is
 * total: RING DISTANCE catches an item whose boundary is part of the group's
 * (the common case, where a vertex that quantised onto a boundary still lands
 * right, since distinct groups are farther apart than `CONNECT_EPS_MM` by
 * construction), and CONTAINMENT catches an item strictly INSIDE the group —
 * a 0.5 mm pad swallowed by a 2 mm one, whose rings never come near each other
 * and which used to be dropped from its own unit's anchor set (R2 #4).
 */
function itemsInGroup(
  items: readonly CopperShapeItem[],
  group: CopperGroup,
): CopperShapeItem[] {
  const out: CopperShapeItem[] = [];
  for (const item of items) {
    const outer = item.rings[0];
    if (!outer || outer.length < 3) continue;
    if (boxGap(boundsOf(outer), group.bounds) > CONNECT_EPS_MM) continue;
    if (itemGroupDistance(outer, group) <= CONNECT_EPS_MM) {
      out.push(item);
      continue;
    }
    if (outer.some((v) => groupContains(group, v))) out.push(item);
  }
  return out;
}

function itemGroupDistance(
  outer: readonly PcbPointMm[],
  group: CopperGroup,
): number {
  const b = boundsOf(outer);
  let best = Infinity;
  for (const island of group.islands) {
    const islandOuter = ringOf(island.paths[0]);
    if (islandOuter.length < 3) continue;
    if (boxGap(b, boundsOf(islandOuter)) > CONNECT_EPS_MM) continue;
    const d = ringToRingClosestPoints(outer, islandOuter).distance;
    if (d < best) best = d;
    if (best <= CONNECT_EPS_MM) return best;
  }
  return best;
}

// --- Groups (§5.1, last paragraph) ------------------------------------------

/**
 * A connected piece of copper: the components Clipper emitted PLUS the merge of
 * any whose outer rings touch within `CONNECT_EPS_MM`. Clipper can emit two
 * rectangles that meet at a corner as two paths, and a point contact is a
 * zero-width neck, not two pieces of copper.
 */
export interface CopperGroup {
  /** Every island's `[outer, ...holes]`, concatenated. */
  paths: PathsD;
  /** Canonically ordered (bounds, then area, then smallest vertex). */
  islands: readonly CopperIsland[];
  bounds: RingBounds;
  areaMm2: number;
  /** Lexicographically smallest outer-ring vertex — the last tie-breaker. */
  minVertex: PcbPointMm;
}

function ringOf(path: PathsD[number] | undefined): PcbPointMm[] {
  return path ? path.map((p) => ({ x: p.x, y: p.y })) : [];
}

function boundsOf(ring: readonly PcbPointMm[]): RingBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function mergeBounds(a: RingBounds, b: RingBounds): RingBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Box-to-box minimum gap (0 when they overlap) — the O(1) prefilter. */
function boxGap(a: RingBounds, b: RingBounds): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
  return Math.hypot(dx, dy);
}

/** Lexicographically smallest vertex of a ring set — a total shape key. */
function minVertexOf(paths: PathsD): PcbPointMm {
  let best: PcbPointMm = { x: Infinity, y: Infinity };
  for (const path of paths) {
    for (const p of path) {
      if (p.x < best.x || (p.x === best.x && p.y < best.y)) best = { x: p.x, y: p.y };
    }
  }
  return best;
}

function compareBounds(a: RingBounds, b: RingBounds): number {
  if (a.minX !== b.minX) return a.minX - b.minX;
  if (a.minY !== b.minY) return a.minY - b.minY;
  if (a.maxX !== b.maxX) return a.maxX - b.maxX;
  return a.maxY - b.maxY;
}

function compareVertex(a: PcbPointMm, b: PcbPointMm): number {
  return a.x - b.x || a.y - b.y;
}

/**
 * The canonical order of anything the report enumerates: bounding box, then
 * area, then the lexicographically smallest vertex (R2 #10). Every coordinate
 * came off the 0.1 µm Clipper grid, so on disjoint copper this is TOTAL — and
 * unlike a bare bounds comparison it never falls back to the order Clipper
 * happened to emit its paths in (contract 06 §7).
 */
function compareIslands(a: CopperIsland, b: CopperIsland): number {
  return (
    compareBounds(boundsOf(ringOf(a.paths[0])), boundsOf(ringOf(b.paths[0]))) ||
    a.areaMm2 - b.areaMm2 ||
    compareVertex(minVertexOf(a.paths), minVertexOf(b.paths))
  );
}

function compareGroups(a: CopperGroup, b: CopperGroup): number {
  return (
    compareBounds(a.bounds, b.bounds) ||
    a.areaMm2 - b.areaMm2 ||
    compareVertex(a.minVertex, b.minVertex)
  );
}

/** Islands in canonical order — the ONE ordering every first-wins loop uses. */
export function sortIslands(islands: CopperIsland[]): CopperIsland[] {
  return [...islands].sort(compareIslands);
}

/**
 * Components of `paths`, merged across `CONNECT_EPS_MM` contacts.
 *
 * The merge is a SWEEP, not the all-pairs loop it started as (R2 #9): islands
 * are visited in ascending `minX` and an active list drops everything whose
 * `maxX` fell behind, so only x-overlapping boxes ever reach
 * `ringToRingClosestPoints`. Cost is `O(n log n)` plus one ring-distance call
 * per x-overlapping, y-overlapping box pair — on copper that is a constant per
 * island, against the `O(n²)` box tests a 60-core chain used to pay on every
 * one of its ~600 erosions.
 */
/**
 * A uniform grid over one island's boundary segments — the reason grouping is
 * not `O(n·m)` any more (Astra run 2 #5). Two concentric 8 192-vertex annuli
 * nest, so the `minX` sweep keeps both active and the ring-to-ring distance
 * used to walk 67 million edge pairs; the grid turns that into one pass over
 * each boundary. A segment too large to file goes to `oversized` and is
 * returned by every query, so a degenerate ring degrades to the full scan
 * rather than to a wrong answer (the broad phase's fail-open rule, 08 §2).
 */
interface SegmentGrid {
  /** `[ax, ay, bx, by]` per segment. */
  segments: number[];
  cellMm: number;
  cells: Map<string, number[]>;
  oversized: number[];
}

/** Cells one segment may occupy before it is filed as oversized. */
const MAX_GRID_CELLS_PER_SEGMENT = 64;

function buildSegmentGrid(paths: PathsD): SegmentGrid {
  const segments: number[] = [];
  let totalLength = 0;
  let count = 0;
  for (const path of paths) {
    const ring = ringOf(path);
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      segments.push(a.x, a.y, b.x, b.y);
      totalLength += Math.hypot(b.x - a.x, b.y - a.y);
      count += 1;
    }
  }
  // Four mean segment lengths per cell: dense enough that a query touches a
  // handful of cells, coarse enough that filing one segment is O(1).
  const mean = count > 0 ? totalLength / count : 1;
  const cellMm = Math.max(1e-3, mean * 4);
  const cells = new Map<string, number[]>();
  const oversized: number[] = [];
  for (let s = 0; s < count; s += 1) {
    const ax = segments[s * 4]!;
    const ay = segments[s * 4 + 1]!;
    const bx = segments[s * 4 + 2]!;
    const by = segments[s * 4 + 3]!;
    const x0 = Math.floor(Math.min(ax, bx) / cellMm);
    const x1 = Math.floor(Math.max(ax, bx) / cellMm);
    const y0 = Math.floor(Math.min(ay, by) / cellMm);
    const y1 = Math.floor(Math.max(ay, by) / cellMm);
    if (
      !Number.isFinite(x0) ||
      !Number.isFinite(y1) ||
      (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_GRID_CELLS_PER_SEGMENT
    ) {
      oversized.push(s);
      continue;
    }
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const key = `${cx},${cy}`;
        const list = cells.get(key);
        if (list) list.push(s);
        else cells.set(key, [s]);
      }
    }
  }
  return { segments, cellMm, cells, oversized };
}

/**
 * True when any segment of `paths` comes within `maxMm` of the grid's boundary.
 * Every edge pair actually compared is charged to `work`.
 */
function gridWithin(
  grid: SegmentGrid,
  paths: PathsD,
  maxMm: number,
  work: ShapeWork | undefined,
): boolean {
  const seen = new Set<number>();
  for (const path of paths) {
    const ring = ringOf(path);
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const p0 = ring[i]!;
      const p1 = ring[(i + 1) % ring.length]!;
      const x0 = Math.floor((Math.min(p0.x, p1.x) - maxMm) / grid.cellMm);
      const x1 = Math.floor((Math.max(p0.x, p1.x) + maxMm) / grid.cellMm);
      const y0 = Math.floor((Math.min(p0.y, p1.y) - maxMm) / grid.cellMm);
      const y1 = Math.floor((Math.max(p0.y, p1.y) + maxMm) / grid.cellMm);
      seen.clear();
      const candidates: number[] = [];
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_GRID_CELLS_PER_SEGMENT) {
        for (let cx = x0; cx <= x1; cx += 1) {
          for (let cy = y0; cy <= y1; cy += 1) {
            const list = grid.cells.get(`${cx},${cy}`);
            if (!list) continue;
            for (const s of list) if (!seen.has(s)) {
              seen.add(s);
              candidates.push(s);
            }
          }
        }
      } else {
        for (let s = 0; s < grid.segments.length / 4; s += 1) candidates.push(s);
      }
      for (const s of grid.oversized) if (!seen.has(s)) candidates.push(s);
      spendWork(work, candidates.length);
      for (const s of candidates) {
        const q0 = { x: grid.segments[s * 4]!, y: grid.segments[s * 4 + 1]! };
        const q1 = { x: grid.segments[s * 4 + 2]!, y: grid.segments[s * 4 + 3]! };
        if (segmentToSegmentDistance(p0, p1, q0, q1) <= maxMm) return true;
      }
    }
  }
  return false;
}

/** Islands are checkpointed in blocks, so a huge grouping stays cancellable. */
const GROUPING_TICK_EVERY = 64;

export function groupComponents(
  paths: PathsD,
  work?: ShapeWork,
): CopperGroup[] {
  const islands = sortIslands(splitIslands(paths));
  if (islands.length === 0) return [];
  const outers = islands.map((i) => ringOf(i.paths[0]));
  const bounds = outers.map(boundsOf);
  const grids: Array<SegmentGrid | undefined> = islands.map(() => undefined);
  const gridOf = (i: number): SegmentGrid => {
    let g = grids[i];
    if (!g) {
      g = buildSegmentGrid(islands[i]!.paths);
      grids[i] = g;
    }
    return g;
  };

  const parent = islands.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    let cur = i;
    while (parent[cur] !== root) {
      const next = parent[cur]!;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };

  const order = islands.map((_, i) => i);
  order.sort((x, y) => bounds[x]!.minX - bounds[y]!.minX || x - y);
  const active: number[] = [];
  let visited = 0;
  for (const i of order) {
    visited += 1;
    const bi = bounds[i]!;
    // Drop everything that can no longer reach `i` in x.
    for (let a = active.length - 1; a >= 0; a -= 1) {
      if (bounds[active[a]!]!.maxX < bi.minX - CONNECT_EPS_MM) {
        active.splice(a, 1);
      }
    }
    for (const j of active) {
      if (find(i) === find(j)) continue;
      if (boxGap(bi, bounds[j]!) > CONNECT_EPS_MM) continue;
      // EVERY ring of both islands, not just the outers: a component sitting
      // inside another's hole touches it on the HOLE ring, and the outer-ring
      // test never sees that contact.
      if (gridWithin(gridOf(j), islands[i]!.paths, CONNECT_EPS_MM, work)) {
        parent[find(i)] = find(j);
      }
    }
    active.push(i);
    if (work?.tick && visited % GROUPING_TICK_EVERY === 0) work.tick();
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < islands.length; i += 1) {
    const root = find(i);
    const list = byRoot.get(root);
    if (list) list.push(i);
    else byRoot.set(root, [i]);
  }
  const groups: CopperGroup[] = [];
  for (const members of byRoot.values()) {
    members.sort((x, y) => x - y);
    const groupPaths: PathsD = [];
    let box = bounds[members[0]!]!;
    let areaMm2 = 0;
    const groupIslands: CopperIsland[] = [];
    for (const i of members) {
      groupIslands.push(islands[i]!);
      for (const p of islands[i]!.paths) groupPaths.push(p);
      box = mergeBounds(box, bounds[i]!);
      areaMm2 += islands[i]!.areaMm2;
    }
    groups.push({
      paths: groupPaths,
      islands: groupIslands,
      bounds: box,
      areaMm2,
      minVertex: minVertexOf(groupPaths),
    });
  }
  groups.sort(compareGroups);
  return groups;
}

/** Bounds of one island's outer ring. */
function islandBounds(island: CopperIsland): RingBounds {
  return boundsOf(ringOf(island.paths[0]));
}

// --- Necks and slivers: the hybrid enumeration (§5.3, §5.4) -----------------

export interface CopperNeck {
  /** The connection width: `2ρ` from a bisection, `τ` from a channel. */
  widthMm: number;
  /** A point ON the copper of the neck. */
  locationMm: PcbPointMm;
}

export interface CopperSliver {
  /** Mean thickness `τ = 2·area/perimeter`; for an annulus, the radial one. */
  thicknessMm: number;
  /** `perimeter/2` — exactly the corner-residual length of the §5.4 table. */
  lengthMm: number;
  areaMm2: number;
  locationMm: PcbPointMm;
}

export interface NeckBudget {
  /** Erosions the unit may still spend; decremented in place. */
  remaining: number;
}

/** What stopped the enumeration — named in the truncation report (R2 #8). */
export type ShapeTruncation = "none" | "neckCap" | "erosionBudget";

export interface AnalyseGroupOptions {
  budgets: CopperShapeBudgets;
  /** Shared across every group of one unit (§5.5: 600 erosions per UNIT). */
  budget: NeckBudget;
  /** Shared across every group of one unit, like `budget`. */
  work: ShapeWork;
  minLengthMm: number;
  /** Execution checkpoint, once per erosion (contract 09 §6). */
  tick?: () => void;
  stepMm?: number;
  arcToleranceMm?: number;
}

export interface ShapeFindings {
  /** Located necks, narrowest first (§5.3). */
  necks: CopperNeck[];
  slivers: CopperSliver[];
  /** Necks known to exist that were not located (§5.5). */
  unlocatedCount: number;
  /** `unlocatedCount` is a LOWER bound, not an exact remainder (R2 #8). */
  unlocatedIsLowerBound: boolean;
  truncation: ShapeTruncation;
  /** Components of `E(r)`: `k`. */
  coreCount: number;
  /**
   * False when the unit's erosion budget was already spent before this group's
   * FIRST erosion (Astra run 2 #6): the group was never looked at, which is a
   * different report from "looked at and truncated".
   */
  examined: boolean;
}

/**
 * How near a residual component must lie to an opening component to count as
 * touching it. `R = P − O` shares its boundary with `O` exactly, so the true
 * distance is 0; two grid units is the quantisation allowance.
 */
const TOUCH_EPS_MM = 2e-4;

/**
 * Everything §5.3 and §5.4 say about ONE connected piece of copper, in one
 * pass over the ONE erosion and the ONE opening the two rules share.
 *
 * THE HYBRID ENUMERATION (R2 blockers 1 and 2). The bisection alone cuts on the
 * CORE COUNT, so it sees only the widest cut that separates two cores: two
 * parallel bridges of 0.05 and 0.08 mm between the same pair of lobes split the
 * cores at ρ = 0.04 and the 0.05 mm bridge is never reported. And where it does
 * fire, the pair's closest points can sit in empty board — a curved or
 * dog-legged channel gets a marker off its own copper and then a SECOND verdict
 * as a sliver. So the residual does the work the erosion cannot:
 *
 *  (i)  a component `c` of `R = P − O` that touches TWO OR MORE components of
 *       `O` IS a neck: a channel narrower than `w` joining two cores. Parallel
 *       bridges are separate components of `R`, so each reports its own width,
 *       and a curved channel is its own component, so its marker is on it.
 *       `measuredMm = τ(c) = 2·area/perimeter`, the MEAN channel width.
 *  (ii) a neck SHORTER than twice the opening's disc reach is invisible to (i):
 *       `O` bridges it and the two cores land in one opening component. Those —
 *       and only those — go to the bisection + MST machinery, which is exact
 *       (`2ρ`) and whose `4δ` location rule is sound precisely because such a
 *       neck is short. Every other group pays NO bisection erosions at all.
 *  (iii) the residual components that are not necks under (i) are classified as
 *       slivers, so no piece of copper carries two verdicts.
 *
 * Stated limit: a sub-`w` bridge SHORTER than twice the disc reach, in parallel
 * with a wider short bridge, is still unresolved — (i) cannot see either (one
 * opening component) and (ii)'s bisection finds only the wider cut.
 */
export function analyseGroup(
  group: CopperGroup,
  radiusMm: number,
  options: AnalyseGroupOptions,
): ShapeFindings {
  const step = options.stepMm ?? BISECTION_STEP_MM;
  const tolerance = options.arcToleranceMm ?? SHAPE_ARC_TOLERANCE_MM;
  const { budget, budgets, work } = options;

  // The INITIAL erosion is charged and CHECKED like every other one (Astra run
  // 2 #6): 601 disconnected pads used to buy 601 erosions past a 600 budget,
  // and report nothing at all.
  if (budget.remaining <= 0) {
    return {
      necks: [],
      slivers: [],
      unlocatedCount: 0,
      unlocatedIsLowerBound: false,
      truncation: "erosionBudget",
      coreCount: 0,
      examined: false,
    };
  }
  budget.remaining -= 1;
  options.tick?.();
  const eroded = erodeWithTolerance(group.paths, radiusMm, tolerance);
  const cores = groupComponents(eroded, work);
  // The opening, over-dilated by one grid allowance so `R` carries no
  // perimeter-only filament along a boundary the two shapes quantise apart.
  const opening = dilateWithTolerance(
    eroded,
    radiusMm + SLIVER_RESIDUE_EPS_MM,
    tolerance,
  );
  const openings = groupComponents(opening, work);
  const residual = difference(group.paths, opening);
  const residuals =
    residual.length === 0 ? [] : sortIslands(splitIslands(residual));

  // Which opening component swallowed each core. `E ⊆ O`, so box containment
  // is sound and total.
  const coresOfOpening = new Map<number, number[]>();
  const openingOfCore: number[] = [];
  for (let i = 0; i < cores.length; i += 1) {
    const owner = containingComponent(cores[i]!, openings);
    openingOfCore.push(owner);
    const list = coresOfOpening.get(owner);
    if (list) list.push(i);
    else coresOfOpening.set(owner, [i]);
  }

  // --- (i) channel necks ---------------------------------------------------
  // A union-find over the CORES records which connections the residual has
  // already explained. Whatever it leaves unexplained is a neck the opening
  // hides — a short throat it bridged, or a corner contact it cut in two —
  // and only that pays for the bisection.
  const explained = cores.map((_, i) => i);
  const findCore = (i: number): number => {
    let root = i;
    while (explained[root] !== root) root = explained[root]!;
    return root;
  };
  const unionCores = (i: number, j: number): void => {
    const ri = findCore(i);
    const rj = findCore(j);
    if (ri !== rj) explained[ri] = rj;
  };

  const necks: CopperNeck[] = [];
  const isNeck = residuals.map(() => false);
  for (let i = 0; i < residuals.length; i += 1) {
    const c = residuals[i]!;
    if (c.areaMm2 < DEGENERATE_AREA_MM2) continue;
    const per = perimeter(c.paths);
    if (per <= 0) continue;
    const box = islandBounds(c);
    // Only a residual whose box reaches TWO opening components can join two
    // cores; on a plain pour that is false for every corner leftover, which is
    // what keeps the exact test off the hot path.
    const candidates: number[] = [];
    for (let o = 0; o < openings.length; o += 1) {
      if (boxGap(box, openings[o]!.bounds) <= TOUCH_EPS_MM) candidates.push(o);
    }
    if (candidates.length < 2) continue;
    const touched: number[] = [];
    for (const o of candidates) {
      if (ringsWithin(c.paths, openings[o]!, TOUCH_EPS_MM, work)) touched.push(o);
    }
    if (touched.length < 2) continue;
    isNeck[i] = true;
    const locationMm = interiorPoint(c);
    necks.push({
      widthMm: localCopperWidth(
        group,
        c,
        locationMm,
        2 * (radiusMm + EROSION_MARGIN_MM),
        (2 * c.areaMm2) / per,
      ),
      locationMm,
    });
    // The channel explains ONLY the connection BETWEEN the opening components
    // it touches — one representative core each — never the connections AMONG
    // the cores inside one of them (Astra run 2 #1). An opening component that
    // swallowed two cores hides a short neck of its own, and unioning its
    // members here made that neck invisible to the bisection.
    const reps = touched
      .map((o) => (coresOfOpening.get(o) ?? [])[0])
      .filter((x): x is number => x !== undefined);
    for (let x = 1; x < reps.length; x += 1) unionCores(reps[0]!, reps[x]!);
  }

  // --- (ii) the necks the residual could not explain -----------------------
  const classes = new Set<number>();
  for (let i = 0; i < cores.length; i += 1) classes.add(findCore(i));
  // The group is ONE connected piece of copper, so every class beyond the first
  // is joined to the rest by a neck nobody has named yet.
  const expectedCuts = Math.max(0, classes.size - 1);

  let truncation: ShapeTruncation = "none";
  let located = 0;
  if (expectedCuts > 0) {
    const bisected = bisectNecks(group, radiusMm, cores, findCore, unionCores, {
      step,
      tolerance,
      budget,
      budgets,
      work,
      tick: options.tick,
    });
    for (const neck of bisected.necks) necks.push(neck);
    located = bisected.necks.length;
    if (bisected.exhausted) truncation = "erosionBudget";
  }

  // --- (iii) slivers over what is left -------------------------------------
  const neckLocations = necks.map((n) => n.locationMm);
  const slivers: CopperSliver[] = [];
  for (let i = 0; i < residuals.length; i += 1) {
    if (isNeck[i]) continue;
    const c = residuals[i]!;
    if (c.areaMm2 < DEGENERATE_AREA_MM2) continue;
    const per = perimeter(c.paths);
    if (per <= 0) continue;
    const thicknessMm = (2 * c.areaMm2) / per;
    if (thicknessMm <= SLIVER_THICKNESS_FLOOR_MM) continue;
    const lengthMm = per / 2;
    if (lengthMm < options.minLengthMm) continue;
    if (neckLocations.some((p) => islandContains(c, p))) continue;
    slivers.push({
      thicknessMm,
      lengthMm,
      areaMm2: c.areaMm2,
      locationMm: interiorPoint(c),
    });
  }

  // Narrowest first, with a total tie-break so the cap never depends on the
  // order Clipper emitted its paths in (contract 06 §7).
  necks.sort(
    (p, q) =>
      p.widthMm - q.widthMm ||
      p.locationMm.x - q.locationMm.x ||
      p.locationMm.y - q.locationMm.y,
  );
  let unlocatedCount = Math.max(0, expectedCuts - located);
  let unlocatedIsLowerBound = truncation === "erosionBudget";
  if (necks.length > budgets.maxNecksPerUnit) {
    // The cap is the LAST thing applied, so its remainder is exact.
    unlocatedCount += necks.length - budgets.maxNecksPerUnit;
    necks.length = budgets.maxNecksPerUnit;
    if (truncation === "none") truncation = "neckCap";
  }
  if (unlocatedCount === 0) {
    truncation = "none";
    unlocatedIsLowerBound = false;
  }
  return {
    necks,
    slivers,
    unlocatedCount,
    unlocatedIsLowerBound,
    truncation,
    coreCount: cores.length,
    examined: true,
  };
}

/** True when any ring of `paths` comes within `maxMm` of any ring of `group`. */
function ringsWithin(
  paths: PathsD,
  group: CopperGroup,
  maxMm: number,
  work?: ShapeWork,
): boolean {
  return gridWithin(groupGrid(group), paths, maxMm, work);
}

/** One segment grid per group, built on first use and cached on the group. */
const GROUP_GRIDS = new WeakMap<CopperGroup, SegmentGrid>();
function groupGrid(group: CopperGroup): SegmentGrid {
  let g = GROUP_GRIDS.get(group);
  if (!g) {
    g = buildSegmentGrid(group.paths);
    GROUP_GRIDS.set(group, g);
  }
  return g;
}

/**
 * A point ON the copper of `island` that represents it: its area centroid when
 * that lies inside, otherwise the boundary point nearest the centroid. A curved
 * or dog-legged channel has its centroid in empty board, and a DRC marker that
 * is not on the copper it names is the bug R2 #1 reported.
 */
function interiorPoint(island: CopperIsland): PcbPointMm {
  const centroid = islandCentroid(island);
  if (islandContains(island, centroid)) return centroid;
  let best = centroid;
  let bestDistance = Infinity;
  for (const path of island.paths) {
    const ring = ringOf(path);
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const hit = projectPointToSegment(
        centroid,
        ring[i]!,
        ring[(i + 1) % ring.length]!,
      );
      if (hit.distance < bestDistance) {
        bestDistance = hit.distance;
        best = { x: hit.x, y: hit.y };
      }
    }
  }
  return best;
}

/** How far the chord probe steps off a wall before casting (one grid unit). */
const CHORD_STEP_MM = 1e-4;

/**
 * The LOCAL copper width at a channel neck's marker — what `measuredMm` reports
 * for a kind-1 neck.
 *
 * NOT the residual's mean thickness `τ = 2·area/perimeter`: a channel loses its
 * two ends to the opening's disc reach and gains their perimeter, so `τ` reads a
 * straight 0.096 mm web as 0.080 and a 0.05 mm one as 0.047. `τ` stays the right
 * measure for a SLIVER, whose whole area is the feature.
 *
 * Measured as the CHORD of `P` through the marker along the wall normal, not as
 * `2 · d(marker, ∂P)`: the marker is the residual's centroid only when that lies
 * inside it, and a curved or dog-legged channel falls back to the nearest
 * boundary point, where `2 · d` is zero and "the distance to ∂P excluding this
 * edge" is the NEXT edge of the same wall on any polyline-approximated arc. The
 * chord is position-independent — from anywhere on the normal, the two casts sum
 * to the same width — so both markers give the same answer.
 *
 * Falls back to `τ` when the probe cannot be placed inside the copper, or when
 * the chord comes out at or above `w`: a kind-1 neck is sub-`w` copper by
 * construction, so a wider reading means the nearest residual edge was an END
 * of the channel and the normal ran along it instead of across it.
 */
function localCopperWidth(
  group: CopperGroup,
  residual: CopperIsland,
  marker: PcbPointMm,
  widthLimitMm: number,
  fallbackMm: number,
): number {
  const normal = inwardNormalAt(residual, marker);
  if (!normal) return fallbackMm;
  let origin = {
    x: marker.x + normal.x * CHORD_STEP_MM,
    y: marker.y + normal.y * CHORD_STEP_MM,
  };
  if (!groupContains(group, origin)) {
    origin = {
      x: marker.x - normal.x * CHORD_STEP_MM,
      y: marker.y - normal.y * CHORD_STEP_MM,
    };
  }
  if (!groupContains(group, origin)) return fallbackMm;
  const forward = rayToBoundary(group.paths, origin, normal);
  const back = rayToBoundary(group.paths, origin, {
    x: -normal.x,
    y: -normal.y,
  });
  if (!Number.isFinite(forward) || !Number.isFinite(back)) return fallbackMm;
  const width = forward + back;
  if (!(width > 0) || width >= widthLimitMm) return fallbackMm;
  return width;
}

/** Distance from `p` to the nearest EDGE of `paths` (inside or out). */
function distanceToBoundary(paths: PathsD, p: PcbPointMm): number {
  let best = Infinity;
  for (const path of paths) {
    const ring = ringOf(path);
    if (ring.length < 2) continue;
    const d = pointToRingEdgeDistance(p, ring);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Unit normal pointing INTO the copper at the residual edge `p` lies on. Rings
 * come out of `splitIslands` with the solid on the LEFT of the direction of
 * travel — outer CCW, holes CW — so the left normal is the inward one for both.
 */
function inwardNormalAt(
  island: CopperIsland,
  p: PcbPointMm,
): PcbPointMm | null {
  let best: PcbPointMm | null = null;
  let bestDistance = Infinity;
  for (const path of island.paths) {
    const ring = ringOf(path);
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const hit = projectPointToSegment(p, a, b);
      if (hit.distance >= bestDistance) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= GEOM_EPS_MM) continue;
      bestDistance = hit.distance;
      best = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    }
  }
  return best;
}

/** First strictly positive hit of the ray `origin + t·dir` on `∂paths`. */
function rayToBoundary(
  paths: PathsD,
  origin: PcbPointMm,
  dir: PcbPointMm,
): number {
  let best = Infinity;
  for (const path of paths) {
    const ring = ringOf(path);
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = dir.x * ey - dir.y * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const qx = a.x - origin.x;
      const qy = a.y - origin.y;
      const t = (qx * ey - qy * ex) / denom;
      const u = (qx * dir.y - qy * dir.x) / denom;
      // `u` is closed at both ends so a hit exactly at a vertex still counts.
      if (t <= 0 || u < 0 || u > 1) continue;
      if (t < best) best = t;
    }
  }
  return best;
}

interface BisectOptions {
  step: number;
  tolerance: number;
  budget: NeckBudget;
  budgets: CopperShapeBudgets;
  work: ShapeWork;
  tick?: (() => void) | undefined;
}

/**
 * The §5.3 bisection, restricted to the core pairs an opening component
 * RECONNECTED (case (ii)). `c(ρ)` is the count over the whole group — a
 * transition anywhere moves it — but only pairs whose cores share an opening
 * component are emitted, because only those are the short necks this machinery
 * is sound for.
 *
 * The pairs come from CONNECTIVITY, not from §5.3's `4δ` gap alone: two cores
 * that shared a component of `E(lo)` are exactly the ones this threshold
 * separated. A minimum spanning tree over each such family yields
 * `(cores − 1)` necks, never the `O(n²)` pairs a simultaneous three-way split
 * would otherwise emit.
 */
function bisectNecks(
  group: CopperGroup,
  radiusMm: number,
  finalCores: readonly CopperGroup[],
  findCore: (i: number) => number,
  unionCores: (i: number, j: number) => void,
  options: BisectOptions,
): { necks: CopperNeck[]; exhausted: boolean } {
  const { step, tolerance, budget, budgets, work } = options;
  const erodeAt = (rho: number): CopperGroup[] => {
    budget.remaining -= 1;
    options.tick?.();
    return groupComponents(erodeWithTolerance(group.paths, rho, tolerance), work);
  };
  // A core of a LATER erosion CONTAINS the final cores inside it (`E(r) ⊆
  // E(ρ)` for ρ < r); its representative is the first of them in canonical
  // order, which is what the "already explained" test is keyed on.
  const representative = (core: CopperGroup): number | undefined => {
    for (let i = 0; i < finalCores.length; i += 1) {
      const b = core.bounds;
      const f = finalCores[i]!.bounds;
      if (f.minX < b.minX || f.maxX > b.maxX || f.minY < b.minY || f.maxY > b.maxY) {
        continue;
      }
      return i;
    }
    return undefined;
  };

  const necks: CopperNeck[] = [];
  const k = finalCores.length;
  let lo = 0;
  let before: CopperGroup[] = [group];
  let exhausted = false;
  while (
    necks.length < budgets.maxNecksPerUnit &&
    budget.remaining > 0 &&
    before.length < k &&
    lo < radiusMm
  ) {
    let a = lo;
    let b = radiusMm;
    while (b - a > step) {
      if (budget.remaining <= 0) {
        exhausted = true;
        break;
      }
      const mid = (a + b) / 2;
      if (erodeAt(mid).length > before.length) b = mid;
      else a = mid;
    }
    if (exhausted || budget.remaining <= 0) {
      exhausted = true;
      break;
    }
    const rho = b;
    const locateAt = Math.min(rho + step, radiusMm);
    const after = locateAt >= radiusMm ? [...finalCores] : erodeAt(locateAt);
    // The neck lies in the copper the erosion REMOVED — inside `P` and outside
    // every core (Astra run 2 #4). Plain "inside P" let a midpoint land deep
    // inside a thick frame that merely happened to be the nearest ring.
    const inRemoved = (p: PcbPointMm): boolean => {
      if (!groupContains(group, p)) return false;
      for (const core of after) if (groupContains(core, p)) return false;
      return true;
    };
    for (const neck of separationNecks(
      before,
      after,
      2 * rho,
      4 * step,
      inRemoved,
      representative,
      findCore,
      unionCores,
      work,
    )) {
      necks.push(neck);
      if (necks.length >= budgets.maxNecksPerUnit) break;
    }
    lo = locateAt;
    before = after;
  }
  return { necks, exhausted };
}

/**
 * One neck per newly split pair: group the `after` cores by the `before`
 * component that contained them, then keep a minimum spanning tree of each such
 * family — but only over pairs whose cores share an OPENING component, which is
 * the case (ii) restriction.
 */
function separationNecks(
  before: readonly CopperGroup[],
  after: readonly CopperGroup[],
  widthMm: number,
  shortGapMm: number,
  inside: (p: PcbPointMm) => boolean,
  representative: (core: CopperGroup) => number | undefined,
  findCore: (i: number) => number,
  unionCores: (i: number, j: number) => void,
  work?: ShapeWork,
): CopperNeck[] {
  const families = new Map<number, number[]>();
  for (let i = 0; i < after.length; i += 1) {
    const owner = containingComponent(after[i]!, before);
    const list = families.get(owner);
    if (list) list.push(i);
    else families.set(owner, [i]);
  }

  const out: CopperNeck[] = [];
  for (const owner of [...families.keys()].sort((x, y) => x - y)) {
    const members = families.get(owner)!;
    if (members.length < 2) continue;
    const edges: Array<{
      i: number;
      j: number;
      ri: number;
      rj: number;
      distance: number;
      point: PcbPointMm;
    }> = [];
    for (let x = 0; x < members.length; x += 1) {
      for (let y = x + 1; y < members.length; y += 1) {
        const i = members[x]!;
        const j = members[y]!;
        const ri = representative(after[i]!);
        const rj = representative(after[j]!);
        // Only a connection the residual did NOT already name (§5.3 (ii)).
        if (ri === undefined || rj === undefined) continue;
        if (findCore(ri) === findCore(rj)) continue;
        const located = locatePair(after[i]!, after[j]!, shortGapMm, inside, work);
        edges.push({ i, j, distance: located.distance, point: located.point, ri, rj });
      }
    }
    edges.sort(
      (p, q) =>
        p.distance - q.distance ||
        p.point.x - q.point.x ||
        p.point.y - q.point.y,
    );
    const parent = new Map<number, number>(members.map((m) => [m, m]));
    const find = (i: number): number => {
      let root = i;
      while (parent.get(root) !== root) root = parent.get(root)!;
      return root;
    };
    for (const edge of edges) {
      const ri = find(edge.i);
      const rj = find(edge.j);
      if (ri === rj) continue;
      if (findCore(edge.ri) === findCore(edge.rj)) continue;
      parent.set(ri, rj);
      unionCores(edge.ri, edge.rj);
      out.push({ widthMm, locationMm: edge.point });
    }
  }
  return out;
}

/**
 * The index of the component of `candidates` that contains `core`. A contained
 * set's bounding box is contained too, so box containment is a sound and total
 * first filter; ties go to the tightest box, then to the canonical order — the
 * list is sorted, so first-wins never follows Clipper's emit order (R2 #10).
 */
function containingComponent(
  core: CopperGroup,
  candidates: readonly CopperGroup[],
): number {
  let best = -1;
  let bestSpan = Infinity;
  for (let i = 0; i < candidates.length; i += 1) {
    const b = candidates[i]!.bounds;
    const c = core.bounds;
    if (c.minX < b.minX || c.maxX > b.maxX || c.minY < b.minY || c.maxY > b.maxY) {
      continue;
    }
    const span = (b.maxX - b.minX) * (b.maxY - b.minY);
    if (span < bestSpan) {
      bestSpan = span;
      best = i;
    }
  }
  if (best >= 0) return best;
  let nearest = 0;
  let nearestGap = Infinity;
  for (let i = 0; i < candidates.length; i += 1) {
    const gap = boxGap(core.bounds, candidates[i]!.bounds);
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = i;
    }
  }
  return nearest;
}

/** PIP tests one constrained search may spend before it gives up (§5.3). */
const MAX_LOCATION_PROBES = 4096;

/**
 * Where two cores are joined. The closest points of two cores can face each
 * other across an EMPTY slit that is nearer than the copper that actually
 * joins them (the U-shaped remote connector), so the answer must have its
 * midpoint in the copper — unless the gap is already within the `4δ` band of
 * §5.3, where a local pinch's midpoint sits exactly ON the boundary (a corner
 * contact) and no containment test can be trusted.
 */
function locatePair(
  a: CopperGroup,
  b: CopperGroup,
  shortGapMm: number,
  inside: (p: PcbPointMm) => boolean,
  work?: ShapeWork,
): { distance: number; point: PcbPointMm } {
  const unconstrained = closestPair(a, b, null, work);
  if (unconstrained.distance <= shortGapMm) return unconstrained;
  if (inside(unconstrained.point)) return unconstrained;
  const constrained = closestPair(a, b, inside, work);
  return constrained.distance === Infinity ? unconstrained : constrained;
}

function closestPair(
  a: CopperGroup,
  b: CopperGroup,
  inside: ((p: PcbPointMm) => boolean) | null,
  work?: ShapeWork,
): { distance: number; point: PcbPointMm } {
  let best = Infinity;
  let point: PcbPointMm = { x: 0, y: 0 };
  let probes = 0;
  // EVERY ring of both cores, holes included (Astra run 2 #4): a core nested
  // in another's hole is nearest to it across that HOLE ring, and comparing
  // outer rings only put the marker deep inside the surrounding frame.
  for (const ia of a.islands) {
    for (const pa of ia.paths) {
      const ra = ringOf(pa);
      if (ra.length < 3) continue;
    for (const ib of b.islands) {
      for (const pb of ib.paths) {
      const rb = ringOf(pb);
      if (rb.length < 3) continue;
      spendWork(work, ra.length + rb.length);
      if (inside === null) {
        const cp = ringToRingClosestPoints(ra, rb);
        if (cp.distance < best) {
          best = cp.distance;
          point = { x: (cp.onA.x + cp.onB.x) / 2, y: (cp.onA.y + cp.onB.y) / 2 };
        }
        continue;
      }
      for (let i = 0; i < ra.length; i += 1) {
        const p0 = ra[i]!;
        const p1 = ra[(i + 1) % ra.length]!;
        for (let j = 0; j < rb.length; j += 1) {
          const q0 = rb[j]!;
          const q1 = rb[(j + 1) % rb.length]!;
          const cp = segmentClosestPoints(p0, p1, q0, q1);
          if (cp.distance >= best) continue;
          if (probes >= MAX_LOCATION_PROBES) return { distance: best, point };
          probes += 1;
          const mid = { x: (cp.a.x + cp.b.x) / 2, y: (cp.a.y + cp.b.y) / 2 };
          if (!inside(mid)) continue;
          best = cp.distance;
          point = mid;
        }
      }
      }
    }
    }
  }
  return { distance: best, point };
}

/** Point-in-copper for a whole group: inside an island, outside its holes. */
function groupContains(group: CopperGroup, point: PcbPointMm): boolean {
  const b = group.bounds;
  if (point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) {
    return false;
  }
  for (const island of group.islands) {
    if (islandContains(island, point)) return true;
  }
  return false;
}

/** Ray-cast containment in an island: inside the outer, outside every hole. */
function islandContains(island: CopperIsland, point: PcbPointMm): boolean {
  const rings = island.paths.map(ringOf);
  const outer = rings[0];
  if (!outer || outer.length < 3) return false;
  if (!pointInRing(point, outer)) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(point, rings[i]!)) return false;
  }
  return true;
}

function pointInRing(point: PcbPointMm, ring: readonly PcbPointMm[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const straddles = a.y > point.y !== b.y > point.y;
    if (
      straddles &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Area-weighted centroid over outer AND holes. Ring signed areas carry the
 * sign (outer CCW positive, hole CW negative), so a hole subtracts its own
 * moment — the centroid of an annulus lands at its centre, not on its rim.
 * Falls back to the outer ring's first vertex when the area cancels out.
 */
function islandCentroid(island: CopperIsland): PcbPointMm {
  let cx = 0;
  let cy = 0;
  let total = 0;
  for (const path of island.paths) {
    const ring = ringOf(path);
    if (ring.length < 3) continue;
    const signed = ringSignedArea(ring);
    if (Math.abs(signed) < Number.EPSILON) continue;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      const cross = p.x * q.y - q.x * p.y;
      mx += (p.x + q.x) * cross;
      my += (p.y + q.y) * cross;
    }
    cx += mx / 6;
    cy += my / 6;
    total += signed;
  }
  if (Math.abs(total) < Number.EPSILON) {
    const outer = ringOf(island.paths[0]);
    return outer[0] ?? { x: 0, y: 0 };
  }
  return { x: cx / total, y: cy / total };
}

// --- Ring orientation helper (§5.1) -----------------------------------------

/**
 * `[outer CCW, ...holes CW]` from a ring list whose first entry is the outer.
 * The NonZero union treats two opposite-winding rings as CANCELLING where they
 * overlap, so every ring that enters it as an independent solid must carry one
 * orientation and every hole the other (the S5 winding lesson, S4 Astra #1).
 */
export function orientIslandRings(
  rings: readonly (readonly PcbPointMm[])[],
): PcbPointMm[][] {
  const out: PcbPointMm[][] = [];
  for (let i = 0; i < rings.length; i += 1) {
    const ring = rings[i]!;
    if (ring.length < 3) continue;
    const ccw = ensureCcwRing(ring).map((p) => ({ x: p.x, y: p.y }));
    out.push(i === 0 ? ccw : ccw.reverse());
  }
  return out;
}
