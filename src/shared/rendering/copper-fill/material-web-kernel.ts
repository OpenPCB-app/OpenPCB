// The board-MATERIAL web kernel (docs/pcb-hardening/12-exact-geometry-contract.md §5).
//
// The copper-shape twin of `copper-shape-kernel.ts`, and deliberately a
// separate file: it shares that kernel's erosion / opening / residual
// machinery but classifies the residual by a different rule, and folding it in
// would have pushed a 1 565-line module past another 150.
//
// Backend-safe (no `three`), fail-closed: every Clipper primitive it calls
// rethrows `CopperKernelError` and the work allowance leaves by
// `CopperShapeBudgetError`, which the caller turns into an explicit
// `OUTLINE_WEB_UNCHECKED` rather than a silent pass (§5.2).

import type { PathsD } from "clipper2-ts";
import type { PcbPointMm } from "../../../sdks";
import {
  DEGENERATE_AREA_MM2,
  ensureCcwRing,
} from "../../pcb-geometry/ring-utils";
import {
  type ExactRing,
  pointToPrimDistance,
} from "../../pcb-geometry/exact-arcs";
import {
  exactContourBounds,
  exactRingSignedArea,
} from "../../pcb-geometry/exact-contour";
import { pointInExactRing } from "../../pcb-geometry/exact-ring";
import {
  type ExactEntry,
  exactEntryOf,
  ringPairDistance,
} from "../../pcb-geometry/exact-simplicity";
import {
  type ExactBudget,
  ExactBudgetExceeded,
} from "../../pcb-geometry/region-exact";
import { DRC_EPS_MM } from "../../pcb-geometry/tolerance";
import type { RingBounds } from "../../pcb-geometry/pad-outline";
import {
  type CopperIsland,
  difference,
  dilateWithTolerance,
  erodeWithTolerance,
  perimeter,
  splitIslands,
} from "./copper-geometry-kernel";
import {
  analyseGroup,
  buildSegmentGrid,
  type CopperGroup,
  type CopperShapeBudgets,
  EROSION_MARGIN_MM,
  gridWithin,
  groupComponents,
  interiorPoint,
  islandContains,
  type NeckBudget,
  type SegmentGrid,
  SHAPE_ARC_TOLERANCE_MM,
  type ShapeTruncation,
  type ShapeWork,
  SLIVER_RESIDUE_EPS_MM,
  sortIslands,
} from "./copper-shape-kernel";

/**
 * Primitive comparisons the RING-PAIR arm may spend over the whole board
 * (§5.1). Bounds-swept, so a normal outline spends a few hundred; this bounds
 * the pathological one.
 */
const MATERIAL_RING_PAIR_BUDGET = 500_000;

/**
 * How much of the exact material area the 0.1 µm fill grid may lose before the
 * erosion answer stops being trustworthy (§5.1, Astra run 2 #D). Below this the
 * analysis reports that it did not answer rather than a verdict about a shape
 * the kernel never saw.
 */
const MATERIAL_GRID_AREA_FRACTION = 0.5;

/** The EXACT rings of the same shapes, outer then cutouts, in ring order. */
export interface MaterialExactRings {
  outer: ExactRing;
  holes: readonly ExactRing[];
}

/** The board material as the kernel reads it: fine chords, plus exact rings. */
export interface MaterialRings {
  outer: readonly PcbPointMm[];
  holes: readonly (readonly PcbPointMm[])[];
  /**
   * The same shapes as EXACT primitives. Absent ⇒ the ring-pair arm and the
   * pre-quantisation area check are skipped, which is only ever a test path.
   */
  exact?: MaterialExactRings;
}

/** One place the board material is narrower than the rule (§5.1). */
export interface MaterialWeb {
  /** The measured width of the web (mm) — never floored. */
  widthMm: number;
  locationMm: PcbPointMm;
  /**
   * True when the width is the EXACT distance between two boundary rings, which
   * carries no chord band at all; false for an erosion measurement.
   */
  exact: boolean;
}

export interface AnalyseMaterialOptions {
  budgets: CopperShapeBudgets;
  /** Erosions the whole material may spend, shared across its components. */
  budget: NeckBudget;
  work: ShapeWork;
  tick?: () => void;
  arcToleranceMm?: number;
}

export interface MaterialFindings {
  webs: MaterialWeb[];
  /**
   * No erosion core survived anywhere while the material has area: the WHOLE
   * board is narrower than `w` (Astra run 1 #5). Reported once, at `markerMm`.
   */
  emptyErosion: boolean;
  /** A point ON the material — the marker the empty erosion reports at. */
  markerMm: PcbPointMm;
  /** What stopped the enumeration, or "none". */
  truncation: ShapeTruncation;
  /** Necks known to exist that were not located. */
  unlocatedCount: number;
  /** The ring-pair arm ran out of its comparison budget (§5.1). */
  exactBudgetSpent: boolean;
  /**
   * The 0.1 µm fill grid lost more than {@link MATERIAL_GRID_AREA_FRACTION} of
   * the material's EXACT area, so the erosion arms saw a different shape.
   */
  gridLoss: boolean;
}

function boundsOfRing(ring: readonly PcbPointMm[]): RingBounds {
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

/** Box-to-box minimum gap (0 when they overlap) — the O(1) prefilter. */
function boxGap(a: RingBounds, b: RingBounds): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
  return Math.hypot(dx, dy);
}

/** The board material `M` = the outer contour minus its cutouts. */
function materialPaths(
  outer: readonly PcbPointMm[],
  holes: readonly (readonly PcbPointMm[])[],
): PathsD {
  if (outer.length < 3) return [];
  const subject: PathsD = [ensureCcwRing(outer).map((p) => ({ x: p.x, y: p.y }))];
  const clip: PathsD = holes
    .filter((h) => h.length >= 3)
    .map((h) => ensureCcwRing(h).map((p) => ({ x: p.x, y: p.y })));
  return clip.length === 0 ? subject : difference(subject, clip);
}

/**
 * Is `v` within `SLIVER_RESIDUE_EPS_MM` of ANY material boundary ring? `R =
 * M − O` shares its boundary with `M` exactly where it hugs a wall, so the true
 * distance there is 0; the epsilon is the quantisation allowance the opening was
 * over-dilated by.
 */
function pointOnBoundary(
  v: PcbPointMm,
  grids: ReadonlyArray<SegmentGrid | null>,
  boxes: readonly RingBounds[],
  work: ShapeWork,
): boolean {
  const dot: RingBounds = { minX: v.x, minY: v.y, maxX: v.x, maxY: v.y };
  const probe: PathsD = [
    [
      { x: v.x, y: v.y },
      { x: v.x, y: v.y },
    ],
  ];
  for (let r = 0; r < grids.length; r += 1) {
    const grid = grids[r];
    if (!grid) continue;
    if (boxGap(dot, boxes[r]!) > SLIVER_RESIDUE_EPS_MM) continue;
    if (gridWithin(grid, probe, SLIVER_RESIDUE_EPS_MM, work)) return true;
  }
  return false;
}

/**
 * How many CONNECTED COMPONENTS the residual's CONTACT with the material
 * boundary has (§5.1, amended). The contact set is the part of the residual's
 * own boundary within `SLIVER_RESIDUE_EPS_MM` of any ring — outer or cutout —
 * and the components are counted ALONG that boundary: two contact intervals
 * separated by an interval that lies on the erosion frontier are two
 * components.
 *
 * This SUBSUMES the distinct-ring rule and fixes what it missed:
 *
 *  - a corner residue touches its ring along ONE interval — not a web;
 *  - a thin strip running along a convex outer arc touches once — not a web;
 *  - a band between a cutout and the edge, or an annulus between two cutouts,
 *    has two intervals (on two rings) — a web;
 *  - a finger between two arms of ONE cutout touches that ring along TWO
 *    separate intervals, which the ring rule counted as one — a web.
 *
 * An edge counts as contact only when BOTH its endpoints are on a boundary, so
 * the count is a property of the curve, not of where the flattener put vertices.
 * A ring that is contact everywhere is ONE component (the run wraps).
 */
function contactRuns(
  island: CopperIsland,
  grids: ReadonlyArray<SegmentGrid | null>,
  boxes: readonly RingBounds[],
  work: ShapeWork,
): number {
  let runs = 0;
  for (const path of island.paths) {
    const n = path.length;
    if (n < 2) continue;
    const near: boolean[] = [];
    for (const v of path) {
      near.push(pointOnBoundary({ x: v.x, y: v.y }, grids, boxes, work));
    }
    const contact = near.map((on, i) => on && near[(i + 1) % n]!);
    let total = 0;
    for (const c of contact) if (c) total += 1;
    if (total === 0) continue;
    // Every edge in contact: one component that wraps the whole ring.
    if (total === n) {
      runs += 1;
    } else {
      for (let i = 0; i < n; i += 1) {
        if (contact[i] && !contact[(i - 1 + n) % n]) runs += 1;
      }
    }
    // Two is the whole verdict; a third component adds nothing.
    if (runs >= 2) return runs;
  }
  return runs;
}

/** The board material's area BEFORE the 0.1 µm fill grid (§5.1, Astra run 2 #D). */
function exactMaterialAreaMm2(exact: MaterialExactRings): number {
  let area = Math.abs(exactRingSignedArea(exact.outer));
  for (const hole of exact.holes) area -= Math.abs(exactRingSignedArea(hole));
  return area;
}

/** A ring-pair web, with the two rings it measured (for the dedupe below). */
interface RingPairWeb extends MaterialWeb {
  ringA: number;
  ringB: number;
}

/** A point that is board material: inside the outer ring, outside every hole. */
function inExactMaterial(exact: MaterialExactRings, p: PcbPointMm): boolean {
  if (pointInExactRing(exact.outer, p) === "outside") return false;
  for (const hole of exact.holes) {
    if (pointInExactRing(hole, p) === "inside") return false;
  }
  return true;
}

/**
 * §5.1 amended, ARM 3: the EXACT minimum distance between every pair of
 * DISTINCT boundary rings. Between two voids — or a void and the edge — the
 * material web IS that distance, and measuring it directly needs no erosion, so
 * it sees a throat SHORTER than the opening's disc reach: two Ø2 voids 2.9 mm
 * apart leave a 0.900 mm web whose residual the dilation splits into two
 * one-wall crescents, which arms 1 and 2 both miss (Astra run 2 #A).
 *
 * The connector must run through MATERIAL: two rings can be close across a
 * VOID (a cutout sitting in a concave bay of the outline), and a third cutout
 * lying between them is caught by its own two pairs.
 */
function ringPairWebs(
  exact: MaterialExactRings,
  widthMm: number,
): { webs: RingPairWeb[]; rings: ExactEntry[]; budgetSpent: boolean } {
  const rings = [exact.outer, ...exact.holes].map(exactEntryOf);
  const budget: ExactBudget = { comparisons: MATERIAL_RING_PAIR_BUDGET };
  const webs: RingPairWeb[] = [];
  try {
    for (let i = 0; i < rings.length; i += 1) {
      for (let j = i + 1; j < rings.length; j += 1) {
        const hit = ringPairDistance(rings[i]!, rings[j]!, widthMm, budget);
        if (!hit) continue;
        if (!(hit.distanceMm < widthMm - DRC_EPS_MM)) continue;
        // The material guard runs only on a TRUSTED witness — one that really
        // is midway between the two rings. A marker is a convenience; losing a
        // real web to a bad one is not acceptable, so an untrusted witness
        // reports without the guard.
        const half = hit.distanceMm / 2;
        const tol = DRC_EPS_MM + half;
        const trusted =
          Math.abs(pointRingDistance(rings[i]!, hit.at) - half) <= tol &&
          Math.abs(pointRingDistance(rings[j]!, hit.at) - half) <= tol;
        if (trusted && !inExactMaterial(exact, hit.at)) continue;
        webs.push({
          widthMm: hit.distanceMm,
          locationMm: hit.at,
          exact: true,
          ringA: i,
          ringB: j,
        });
      }
    }
  } catch (error) {
    if (!(error instanceof ExactBudgetExceeded)) throw error;
    return { webs, rings, budgetSpent: true };
  }
  return { webs, rings, budgetSpent: false };
}

/** Distance from a point to a ring's exact boundary. */
function pointRingDistance(ring: ExactEntry, p: PcbPointMm): number {
  let best = Infinity;
  for (const prim of ring.prims) {
    const d = pointToPrimDistance(p, prim);
    if (d < best) best = d;
  }
  return best;
}

/** The group with the largest area; ties go to the canonical order (§5). */
function largestGroup(groups: readonly CopperGroup[]): CopperGroup | null {
  let best: CopperGroup | null = null;
  for (const g of groups) if (!best || g.areaMm2 > best.areaMm2) best = g;
  return best;
}

/**
 * The board-material twin of `analyseGroup` (§5.1). Same erosion, same opening,
 * same residual — a different classification, because "narrow" means something
 * else for substrate than for copper:
 *
 *  - a NECK is what `analyseGroup` already finds: a channel joining two erosion
 *    cores, located and measured as `COPPER_CONNECTION_WIDTH` is. That is what
 *    catches the board's own waist, whose two walls are ONE ring;
 *  - an OPPOSING-WALL RESIDUAL is a component of `M − open(M)` whose CONTACT
 *    with the material boundary has TWO OR MORE CONNECTED COMPONENTS — a band
 *    between a cutout and the edge, an annulus between two cutouts, the throat
 *    between two separate cutouts the material still runs around (Astra run 1
 *    #4: the copper kernel's union-find sees ONE core there and reports
 *    nothing), and a finger between two arms of ONE cutout, which the earlier
 *    distinct-RING form of this rule counted as a single touch;
 *  - a residual whose contact is ONE component is NEVER a web: those are the
 *    opening's own leftovers at a convex corner or along a convex arc, and the
 *    copper criteria report four of them on a plain 10 × 10 roundrect (Astra
 *    run 1 #7). See {@link contactRuns}.
 *
 * No thickness floor and no length floor: `SLIVER_THICKNESS_FLOOR_MM` discarded
 * a 0.0005 mm-thick board strip as numerical residue (Astra run 1 #5), and a web
 * is a web at any length. Thickness is MEASURED (`2·area/perimeter`).
 */
export function analyseMaterialRegion(
  material: MaterialRings,
  widthMm: number,
  options: AnalyseMaterialOptions,
): MaterialFindings {
  const tolerance = options.arcToleranceMm ?? SHAPE_ARC_TOLERANCE_MM;
  const radiusMm = widthMm / 2 - EROSION_MARGIN_MM;
  const { budget, budgets, work } = options;
  const findings: MaterialFindings = {
    webs: [],
    emptyErosion: false,
    markerMm: { x: 0, y: 0 },
    truncation: "none",
    unlocatedCount: 0,
    exactBudgetSpent: false,
    gridLoss: false,
  };
  // ARM 3 first: it needs no erosion and cannot be defeated by the fill grid.
  const pairWebs: RingPairWeb[] = [];
  let pairRings: ExactEntry[] = [];
  if (material.exact) {
    const pairs = ringPairWebs(material.exact, widthMm);
    for (const web of pairs.webs) pairWebs.push(web);
    pairRings = pairs.rings;
    findings.exactBudgetSpent = pairs.budgetSpent;
    // A marker that is ON the material even when the fill grid keeps nothing.
    const box = exactContourBounds(material.exact.outer);
    if (Number.isFinite(box.minX) && Number.isFinite(box.maxX)) {
      findings.markerMm = {
        x: (box.minX + box.maxX) / 2,
        y: (box.minY + box.maxY) / 2,
      };
    }
  }
  // The area BEFORE quantisation: a 98 nm-wide board has 0.0098 mm² of material
  // and collapses to nothing on the kernel's 0.1 µm grid (Astra run 2 #D).
  const exactAreaMm2 = material.exact
    ? exactMaterialAreaMm2(material.exact)
    : null;
  const paths = materialPaths(material.outer, material.holes);
  if (paths.length === 0) {
    findings.webs = pairWebs;
    findings.emptyErosion =
      exactAreaMm2 !== null && exactAreaMm2 > DEGENERATE_AREA_MM2;
    return findings;
  }
  // Ring 0 is the outer contour and ring i+1 the i-th cutout — the DISTINCT
  // rings the opposing-wall rule counts. They are the AUTHORED rings, not the
  // material's own boundary, so a residual hugging one wall of one cutout can
  // never be mistaken for a web against another.
  const rings: ReadonlyArray<readonly PcbPointMm[]> = [
    material.outer,
    ...material.holes,
  ];
  const boxes = rings.map(boundsOfRing);
  const grids = rings.map((r) =>
    r.length >= 3 ? buildSegmentGrid([r.map((p) => ({ x: p.x, y: p.y }))]) : null,
  );

  const erosionWebs: MaterialWeb[] = [];
  const groups = groupComponents(paths, work);
  const marker = largestGroup(groups);
  if (marker?.islands[0]) findings.markerMm = interiorPoint(marker.islands[0]);
  let areaMm2 = 0;
  let cores = 0;
  for (const group of groups) {
    areaMm2 += group.areaMm2;
    // The necks: `analyseGroup` owns the erosion, the union-find and the
    // bisection, and every copper verdict it makes is unchanged. Slivers are
    // suppressed by an unreachable length floor — the classification below
    // replaces them, and one piece of material must carry one verdict.
    const found = analyseGroup(group, radiusMm, {
      budgets,
      budget,
      work,
      minLengthMm: Infinity,
      ...(options.tick ? { tick: options.tick } : {}),
      arcToleranceMm: tolerance,
    });
    cores += found.coreCount;
    findings.unlocatedCount += found.unlocatedCount;
    if (!found.examined) {
      findings.truncation = "erosionBudget";
      continue;
    }
    if (found.truncation !== "none" && findings.truncation === "none") {
      findings.truncation = found.truncation;
    }
    for (const neck of found.necks) {
      erosionWebs.push({
        widthMm: neck.widthMm,
        locationMm: neck.locationMm,
        exact: false,
      });
    }
    // The opposing-wall residuals. This repeats the two offsets `analyseGroup`
    // does not hand back — one board's worth of Clipper work per run, not one
    // per item.
    const eroded = erodeWithTolerance(group.paths, radiusMm, tolerance);
    const opening = dilateWithTolerance(
      eroded,
      radiusMm + SLIVER_RESIDUE_EPS_MM,
      tolerance,
    );
    const residual = difference(group.paths, opening);
    if (residual.length === 0) continue;
    for (const c of sortIslands(splitIslands(residual))) {
      if (c.areaMm2 < DEGENERATE_AREA_MM2) continue;
      const per = perimeter(c.paths);
      if (per <= 0) continue;
      if (found.necks.some((n) => islandContains(c, n.locationMm))) continue;
      if (contactRuns(c, grids, boxes, work) < 2) continue;
      erosionWebs.push({
        widthMm: (2 * c.areaMm2) / per,
        locationMm: interiorPoint(c),
        exact: false,
      });
    }
  }
  // A ring-pair row SUPERSEDES an erosion row measuring the SAME channel: one
  // web, one verdict, and the exact distance is the better of the two numbers.
  //
  // "The same channel" is judged by the two RINGS, not by marker proximity: the
  // closest approach of two parallel walls is an INTERVAL, and the ring pair
  // reports one witness on it while the erosion reports the residual's centroid
  // — metres apart on a long web. An erosion marker within `w` of BOTH rings of
  // a reported pair sits in that pair's channel.
  const supersededBy = (e: MaterialWeb): boolean =>
    pairWebs.some((q) => {
      const a = pairRings[q.ringA];
      const b = pairRings[q.ringB];
      if (!a || !b) return false;
      return (
        pointRingDistance(a, e.locationMm) <= widthMm &&
        pointRingDistance(b, e.locationMm) <= widthMm
      );
    });
  findings.webs = [...pairWebs, ...erosionWebs.filter((e) => !supersededBy(e))];
  const trueAreaMm2 = exactAreaMm2 ?? areaMm2;
  findings.emptyErosion = cores === 0 && trueAreaMm2 > DEGENERATE_AREA_MM2;
  // The grid kept a shape, but not THIS one: the erosion arms answered about
  // something else, and saying so is the only honest verdict (§5.1).
  findings.gridLoss =
    cores > 0 &&
    exactAreaMm2 !== null &&
    areaMm2 < MATERIAL_GRID_AREA_FRACTION * exactAreaMm2;
  return findings;
}
