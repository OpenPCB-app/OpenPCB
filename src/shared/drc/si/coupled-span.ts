import type { PcbCopperLayerId, PcbPointMm } from "../../../sdks/designer";
import { segmentClosestPoints } from "../../pcb-geometry/pcb-trace-geometry";
import {
  segmentSublevelInterval,
  type SublevelInterval,
} from "../../pcb-geometry/segment-sublevel";
import { DRC_EPS_MM } from "../../pcb-geometry/tolerance";
import { intersect, intersectLists, measure, merge, subtract } from "./intervals";

/**
 * The diff-pair coupled-span kernel (SI contract 14 §4.2). Pure: it takes both
 * members' 2D copper as polylines and the three window parameters, and never
 * defaults one of them — `couplingMaxGapMm` and the target gap are the rule
 * model's to resolve, not this file's.
 *
 * For member `M`, `g_M(s)` is the minimum over the PARTNER's copper segments on
 * the SAME layer of `dist(M(s), seg) − (w_M + w_seg)/2` (actual widths). Each
 * `{s : g_M(s) ≤ θ}` is the union over partner segments of one closed interval
 * from `segmentSublevelInterval` at radius `θ + halfSum`, so every set below is
 * exact — no sampling, no per-segment-pair "one closest point".
 *
 * `coupled` and `tight` are gate-free: coupled is "within G of ANY partner
 * copper", tight is a clearance-like fact. `wide` is NOT (§4.2 amendment):
 * off-band copper only counts where the partner runs BESIDE the source — a
 * near-parallel pair, measured on the perpendicular STRIP over the partner's own
 * span. An end cap or an outside corner puts the source through `(t + tol, G]`
 * on its way past, and that is a departure, not a pair routed at the wrong gap.
 * So a point can be coupled, outside the tolerance band, and still not wide.
 */
export interface CoupledPath {
  layer: PcbCopperLayerId;
  pointsMm: PcbPointMm[];
  halfWidthMm: number;
}

export interface CoupledSpanParams {
  /** Target centre-to-centre edge gap `t` (mm). */
  targetGapMm: number;
  /** Allowed deviation `tol` (mm, ≥ 0). */
  gapTolMm: number;
  /** Maximum gap `G` (mm) at which copper still counts as coupled. */
  couplingMaxGapMm: number;
  /**
   * Maximum folded direction angle (degrees) at which a partner segment counts
   * as running BESIDE the source for the `wide` measure. Anti-parallel folds to
   * 0. The rule model owns the value; this kernel never defaults it.
   */
  parallelMaxDeg: number;
}

export interface CoupledSpanMember {
  /** 2D copper length of this member (mm) — via barrels never enter here. */
  copperLengthMm: number;
  /** `{g ≤ G}`, merged and sorted, in arc length along this member's copper. */
  coupled: SublevelInterval[];
  coupledMm: number;
  /** `{g < t − tol}`. */
  tight: SublevelInterval[];
  tightMm: number;
  /** Near-parallel strips where `t + tol < g ≤ G`, less the in-band copper. */
  wide: SublevelInterval[];
  wideMm: number;
  /** `measure(tight ∪ wide)` — `DIFF_PAIR_GAP`'s off-tolerance coupled length. */
  offBandMm: number;
  /** `copperLengthMm − measure(coupled)`. */
  uncoupledMm: number;
  /** Minimum copper gap seen inside the candidate halo, `null` when none was. */
  minGapMm: number | null;
  /** The centreline point on THIS member where `minGapMm` is attained. */
  minGapPointMm: PcbPointMm | null;
  /** First arc length where `g` leaves the tolerance band inside `coupled`. */
  bandExitMm: number | null;
  bandExitPointMm: PcbPointMm | null;
}

export interface CoupledSpanReport {
  p: CoupledSpanMember;
  n: CoupledSpanMember;
}

/**
 * Both members, each measured against the other's copper. Symmetric by
 * construction: `coupledSpans(x, y, o).p` equals `coupledSpans(y, x, o).n`
 * byte for byte (contract 14 §4.2, critique #8).
 */
export function coupledSpans(
  pPaths: readonly CoupledPath[],
  nPaths: readonly CoupledPath[],
  params: CoupledSpanParams,
): CoupledSpanReport {
  return {
    p: measureMember(pPaths, nPaths, params),
    n: measureMember(nPaths, pPaths, params),
  };
}

/** A straight source sub-segment, carrying its offset in the member's walk. */
interface SourceSeg {
  a: PcbPointMm;
  b: PcbPointMm;
  hw: number;
  layer: PcbCopperLayerId;
  lenMm: number;
  /** Arc length from the start of the member's copper walk to `a`. */
  offMm: number;
}

interface TargetSeg {
  a: PcbPointMm;
  b: PcbPointMm;
  hw: number;
  layer: PcbCopperLayerId;
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function measureMember(
  self: readonly CoupledPath[],
  partner: readonly CoupledPath[],
  params: CoupledSpanParams,
): CoupledSpanMember {
  const { targetGapMm: t, gapTolMm: tol, couplingMaxGapMm: g } = params;
  const maxDeg = params.parallelMaxDeg;
  const sources = buildSources(self);
  const targets = buildTargets(partner);
  const copperLengthMm = sources.reduce((sum, s) => sum + s.lenMm, 0);

  const coupledRaw: SublevelInterval[] = [];
  const tightRaw: SublevelInterval[] = [];
  const innerRaw: SublevelInterval[] = [];
  const stripRaw: SublevelInterval[] = [];
  let minGap: { gapMm: number; pointMm: PcbPointMm } | null = null;

  // The widest set any verdict needs. `tight` is NOT bounded by G (contract
  // §4.2 states it unrestricted), so a table with `t − tol > G` must still see
  // its candidates; `t + tol` covers the band-inner set the same way.
  const haloMm = Math.max(g, t + tol, t - tol) + DRC_EPS_MM;

  for (const { src, tgt } of sweepPairs(sources, targets, haloMm)) {
    const halfSum = src.hw + tgt.hw;
    const target = { kind: "segment" as const, a: tgt.a, b: tgt.b };
    // The ONE comparison regime (contract 14 §4.2 / 06 §5): a gap within float
    // error of a limit falls on the non-violating side. `coupled` and the band
    // interior are `≤ limit + eps`, `tight` is `< limit − eps` (`below`).
    push(coupledRaw, src, segmentSublevelInterval(src.a, src.b, target, g + DRC_EPS_MM + halfSum));
    push(tightRaw, src, segmentSublevelInterval(src.a, src.b, target, t - tol - DRC_EPS_MM + halfSum));
    push(innerRaw, src, segmentSublevelInterval(src.a, src.b, target, t + tol + DRC_EPS_MM + halfSum));
    if (besideWithin(src.a, src.b, tgt.a, tgt.b, maxDeg)) {
      const strips = stripWide(src, tgt, t + tol + DRC_EPS_MM + halfSum, g + DRC_EPS_MM + halfSum);
      for (const strip of strips) push(stripRaw, src, strip);
    }

    const closest = segmentClosestPoints(src.a, src.b, tgt.a, tgt.b);
    const gapMm = closest.distance - halfSum;
    if (minGap === null || betterMin(gapMm, closest.a, minGap)) {
      minGap = { gapMm, pointMm: closest.a };
    }
  }

  const coupled = merge(coupledRaw);
  const tight = merge(tightRaw);
  // The strips carry the verdict; the global in-band set still vetoes it, so a
  // stretch the partner runs alongside at target is never wide because some
  // FURTHER partner run happens to be beside it too.
  const wide = subtract(merge(stripRaw), merge(innerRaw));
  const offBand = merge([...tight, ...wide]);
  // The exit is reported where it is observable — inside the coupled run. The
  // fallback matters only for the degenerate table where `tight` reaches past
  // `G` and nothing off-band is coupled.
  const exitAt = (intersectLists(offBand, coupled)[0] ?? offBand[0])?.s0 ?? null;

  return {
    copperLengthMm,
    coupled,
    coupledMm: measure(coupled),
    tight,
    tightMm: measure(tight),
    wide,
    wideMm: measure(wide),
    offBandMm: measure(offBand),
    // Floored: the coupled union is a subset of the walk by construction, but
    // summing its pieces can round a hair past the walk's own sum, and a
    // negative uncoupled length would reach the report as `measuredMm`.
    uncoupledMm: Math.max(0, copperLengthMm - measure(coupled)),
    minGapMm: minGap === null ? null : minGap.gapMm,
    minGapPointMm: minGap === null ? null : minGap.pointMm,
    bandExitMm: exitAt,
    bandExitPointMm: exitAt === null ? null : pointAt(sources, exitAt),
  };
}

function push(
  out: SublevelInterval[],
  src: SourceSeg,
  local: SublevelInterval | null,
): void {
  if (local) out.push({ s0: src.offMm + local.s0, s1: src.offMm + local.s1 });
}

/**
 * Folded-angle parallelism: is the angle between two segment DIRECTIONS at most
 * `maxDeg`, counting anti-parallel as parallel?
 *
 * Stated as `dot² ≥ cos²(maxDeg)·|a|²·|b|²` — squares only, no `atan2` and no
 * sign. Reversing either segment negates the dot product exactly, so `dot²` and
 * both squared lengths are bit-identical and the verdict CANNOT depend on the
 * direction the copper was authored in (Astra run 2 #1: an `atan2` fold flipped
 * at the boundary, and a 15.0°-adjacent partner reversed its `DIFF_PAIR_GAP`).
 * A tie at the boundary evaluates the same expression either way.
 *
 * `maxDeg` is clamped to [0°, 90°]: the angle is folded, so beyond 90° the
 * cosine squares back down and the test would invert.
 */
function besideWithin(
  a: PcbPointMm,
  b: PcbPointMm,
  c: PcbPointMm,
  d: PcbPointMm,
  maxDeg: number,
): boolean {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const cx = d.x - c.x;
  const cy = d.y - c.y;
  const la = ax * ax + ay * ay;
  const lc = cx * cx + cy * cy;
  if (la === 0 || lc === 0) return false;
  const clamped = maxDeg >= 90 ? 90 : maxDeg > 0 ? maxDeg : 0;
  const cosMax = Math.cos((clamped * Math.PI) / 180);
  const dot = ax * cx + ay * cy;
  return dot * dot >= cosMax * cosMax * la * lc;
}

/** `{s ∈ [0, len] : lo ≤ c0 + c1·s ≤ hi}` — one interval or null. */
function linearBand(
  c0: number,
  c1: number,
  lo: number,
  hi: number,
  len: number,
): SublevelInterval | null {
  if (lo > hi) return null;
  if (c1 === 0) return c0 >= lo && c0 <= hi ? { s0: 0, s1: len } : null;
  const t0 = (lo - c0) / c1;
  const t1 = (hi - c0) / c1;
  const s0 = Math.max(0, Math.min(t0, t1));
  const s1 = Math.min(len, Math.max(t0, t1));
  return s0 <= s1 ? { s0, s1 } : null;
}

/**
 * `{s : the perpendicular foot of M(s) lies on this partner segment AND its
 * perpendicular gap is in `(innerR, outerR]`}`, in the source's own arc length.
 *
 * Both the along-target coordinate and the SIGNED perpendicular offset are
 * affine in `s`, so each constraint is one linear band and the answer is exact.
 * It is a list, not one interval: a shallow crossing puts the source on both
 * sides of the partner's line, and the two off-band runs are then disjoint.
 * A degenerate partner segment has no side to run beside — it is a cap.
 */
function stripWide(
  src: SourceSeg,
  tgt: TargetSeg,
  innerR: number,
  outerR: number,
): SublevelInterval[] {
  const tx = tgt.b.x - tgt.a.x;
  const ty = tgt.b.y - tgt.a.y;
  const tlen = Math.hypot(tx, ty);
  if (tlen === 0) return [];
  const vx = tx / tlen;
  const vy = ty / tlen;
  const ux = (src.b.x - src.a.x) / src.lenMm;
  const uy = (src.b.y - src.a.y) / src.lenMm;
  const wx = src.a.x - tgt.a.x;
  const wy = src.a.y - tgt.a.y;
  const span = linearBand(wx * vx + wy * vy, ux * vx + uy * vy, 0, tlen, src.lenMm);
  if (!span) return [];
  const per0 = vx * wy - vy * wx;
  const per1 = vx * uy - vy * ux;
  const within = intersect(span, linearBand(per0, per1, -outerR, outerR, src.lenMm));
  if (!within) return [];
  const inner = linearBand(per0, per1, -innerR, innerR, src.lenMm);
  return inner ? subtract([within], [inner]) : [within];
}

/** Total order on (gap, x, y) so the witness cannot follow sweep order. */
function betterMin(
  gapMm: number,
  pointMm: PcbPointMm,
  best: { gapMm: number; pointMm: PcbPointMm },
): boolean {
  if (gapMm !== best.gapMm) return gapMm < best.gapMm;
  if (pointMm.x !== best.pointMm.x) return pointMm.x < best.pointMm.x;
  return pointMm.y < best.pointMm.y;
}

/**
 * Source sub-segments in walk order. Zero-length segments are skipped as
 * sources (contract 14 §1) — they carry no length and no direction; they are
 * NOT skipped as targets, where they are point targets (§4.1, Astra #10).
 */
function buildSources(paths: readonly CoupledPath[]): SourceSeg[] {
  const out: SourceSeg[] = [];
  let offMm = 0;
  for (const path of paths) {
    for (let i = 1; i < path.pointsMm.length; i += 1) {
      const a = path.pointsMm[i - 1]!;
      const b = path.pointsMm[i]!;
      const lenMm = Math.hypot(b.x - a.x, b.y - a.y);
      if (lenMm === 0) continue;
      out.push({ a, b, hw: path.halfWidthMm, layer: path.layer, lenMm, offMm });
      offMm += lenMm;
    }
  }
  return out;
}

/**
 * Partner sub-segments, each stored with its LEXICOGRAPHICALLY SMALLER endpoint
 * leading (contract 06 §7's canonical orientation). The measures are affine in
 * the endpoint they are anchored to, so authoring the same copper backwards
 * would otherwise shift every strip and closest-point by a few ulps; with the
 * canonical lead, reversing a partner polyline is byte-identical, not merely
 * equal to within float noise.
 */
function buildTargets(paths: readonly CoupledPath[]): TargetSeg[] {
  const out: TargetSeg[] = [];
  for (const path of paths) {
    for (let i = 1; i < path.pointsMm.length; i += 1) {
      const first = path.pointsMm[i - 1]!;
      const second = path.pointsMm[i]!;
      const leads = first.x !== second.x ? first.x < second.x : first.y <= second.y;
      out.push({
        a: leads ? first : second,
        b: leads ? second : first,
        hw: path.halfWidthMm,
        layer: path.layer,
      });
    }
  }
  return out;
}

/**
 * Same-layer candidate pairs, by a sorted-bounds sweep with the halo baked into
 * the source boxes (contract 14 §4.2, Astra #15). A source box inflated by
 * `halo + hwSource` and a target box inflated by `hwTarget` that do not meet
 * bound a copper gap above `halo`, so no near pair can be skipped.
 */
function* sweepPairs(
  sources: readonly SourceSeg[],
  targets: readonly TargetSeg[],
  haloMm: number,
): Generator<{ src: SourceSeg; tgt: TargetSeg }> {
  if (sources.length === 0 || targets.length === 0) return;
  const byLayer = new Map<PcbCopperLayerId, TargetSeg[]>();
  for (const tgt of targets) {
    const list = byLayer.get(tgt.layer);
    if (list) list.push(tgt);
    else byLayer.set(tgt.layer, [tgt]);
  }
  const srcByLayer = new Map<PcbCopperLayerId, SourceSeg[]>();
  for (const src of sources) {
    const list = srcByLayer.get(src.layer);
    if (list) list.push(src);
    else srcByLayer.set(src.layer, [src]);
  }

  for (const [layer, layerSources] of srcByLayer) {
    const layerTargets = byLayer.get(layer);
    if (!layerTargets) continue;
    const srcBoxes = layerSources.map((src) => ({
      src,
      box: boxOf(src.a, src.b, haloMm + src.hw),
    }));
    const tgtBoxes = layerTargets.map((tgt) => ({
      tgt,
      box: boxOf(tgt.a, tgt.b, tgt.hw),
    }));
    // Both dimensions prune: a route subdivided along ONE axis puts every box
    // in the same band on the other, and sweeping that one degrades to all
    // pairs (Astra run 2 #2 — 448 ms on a vertical route that costs 0.5 ms
    // rotated). The axis choice reorders the enumeration, never the emitted
    // SET: a pair is yielded iff both extents overlap, which is symmetric.
    const axis = sweepAxis(srcBoxes, tgtBoxes);
    const lo = axis === 0 ? (box: Box) => box.minX : (box: Box) => box.minY;
    const hi = axis === 0 ? (box: Box) => box.maxX : (box: Box) => box.maxY;
    const crossLo = axis === 0 ? (box: Box) => box.minY : (box: Box) => box.minX;
    const crossHi = axis === 0 ? (box: Box) => box.maxY : (box: Box) => box.maxX;
    srcBoxes.sort((x, y) => lo(x.box) - lo(y.box));
    tgtBoxes.sort((x, y) => lo(x.box) - lo(y.box));

    let next = 0;
    const active: { tgt: TargetSeg; box: Box }[] = [];
    for (const { src, box } of srcBoxes) {
      while (next < tgtBoxes.length && lo(tgtBoxes[next]!.box) <= hi(box)) {
        active.push(tgtBoxes[next]!);
        next += 1;
      }
      let keep = 0;
      for (let i = 0; i < active.length; i += 1) {
        const entry = active[i]!;
        // Sources are visited by ascending low edge, so a target that ends
        // before this source starts can never meet a later one either.
        if (hi(entry.box) < lo(box)) continue;
        active[keep] = entry;
        keep += 1;
        if (crossLo(entry.box) <= crossHi(box) && crossHi(entry.box) >= crossLo(box)) {
          yield { src, tgt: entry.tgt };
        }
      }
      active.length = keep;
    }
  }
}

/**
 * Which axis to sweep: the one where the expected active-set size — the summed
 * box extent divided by the spread the boxes cover — is SMALLER, i.e. where
 * `spread / Σextent` is larger. Summed extent alone would pick the wrong axis
 * for a finely subdivided route (thousands of narrow boxes stacked in one
 * band), and spread alone the wrong one for a few very wide boxes. Ties go to
 * x so the choice is a function of the input, not of iteration luck.
 */
function sweepAxis(
  sources: readonly { box: Box }[],
  targets: readonly { box: Box }[],
): 0 | 1 {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  for (const list of [sources, targets]) {
    for (const { box } of list) {
      if (box.minX < minX) minX = box.minX;
      if (box.maxX > maxX) maxX = box.maxX;
      if (box.minY < minY) minY = box.minY;
      if (box.maxY > maxY) maxY = box.maxY;
      sumX += box.maxX - box.minX;
      sumY += box.maxY - box.minY;
    }
  }
  const scoreX = sumX > 0 ? (maxX - minX) / sumX : Infinity;
  const scoreY = sumY > 0 ? (maxY - minY) / sumY : Infinity;
  return scoreY > scoreX ? 1 : 0;
}

function boxOf(a: PcbPointMm, b: PcbPointMm, inflateMm: number): Box {
  return {
    minX: Math.min(a.x, b.x) - inflateMm,
    maxX: Math.max(a.x, b.x) + inflateMm,
    minY: Math.min(a.y, b.y) - inflateMm,
    maxY: Math.max(a.y, b.y) + inflateMm,
  };
}

/** The centreline point at arc length `s` in the member's own walk. */
function pointAt(sources: readonly SourceSeg[], sMm: number): PcbPointMm | null {
  for (const src of sources) {
    if (sMm > src.offMm + src.lenMm) continue;
    const local = Math.max(0, sMm - src.offMm) / src.lenMm;
    return {
      x: src.a.x + (src.b.x - src.a.x) * local,
      y: src.a.y + (src.b.y - src.a.y) * local,
    };
  }
  const last = sources[sources.length - 1];
  return last ? last.b : null;
}
