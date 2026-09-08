import type { PcbNetClass } from "../../../../../sdks/designer";
import { resolveDiffPairs } from "../../pcb/diff-pair-resolver";
import { resolveNetClassId } from "../../pcb/net-class-resolver";
import {
  polylineLength,
  segmentToSegmentDistance,
  type Point,
} from "../../pcb/pcb-trace-geometry";
import { below, type DrcContext, type DrcTrace } from "../drc-context";
import type { DrcViolationDraft } from "../types";

const DEFAULT_GAP_TOL_MM = 0.05;
const DEFAULT_MAX_UNCOUPLED_MM = 15;
const DEFAULT_MAX_SKEW_MM = 0.5;
/** Max direction-angle (deg) for two segments to count as "coupled". */
const COUPLING_ANGLE_DEG = 15;

/**
 * Differential-pair checks (P11): coupled-gap deviation, intra-pair skew, and
 * uncoupled run length. Pairs come from `board.diffPairs` (explicit) plus the
 * name-convention resolver. Per-pair thresholds fall back to the nets' class
 * defaults, then to module defaults; everything is inert unless a pair exists.
 */
export function checkSignalIntegrity(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const board = ctx.projection.board;
  const pairs = resolveDiffPairs(board.diffPairs, ctx.netNames);
  if (pairs.length === 0) return out;

  const classById = new Map(board.netClasses.map((c) => [c.id, c]));
  const classOf = (netId: string): PcbNetClass | null => {
    const id = resolveNetClassId(
      ctx.netNames[netId] ?? "",
      board.netClasses,
      board.perNetClassAssignments,
      netId,
    );
    return classById.get(id) ?? null;
  };
  const tracesOfNet = (netId: string): DrcTrace[] =>
    ctx.traces.filter((t) => t.netId === netId && t.pointsMm.length >= 2);
  const netLength = (netId: string): number =>
    tracesOfNet(netId).reduce((sum, t) => sum + polylineLength(t.pointsMm), 0);

  for (const dp of pairs) {
    const pTraces = tracesOfNet(dp.pNetId);
    const nTraces = tracesOfNet(dp.nNetId);
    if (pTraces.length === 0 || nTraces.length === 0) continue; // unrouted

    const cls = classOf(dp.pNetId) ?? classOf(dp.nNetId);
    const targetGap = dp.gapMm ?? cls?.diffPairGapMm;
    const gapTol = dp.gapTolMm ?? DEFAULT_GAP_TOL_MM;
    const maxUncoupled = dp.maxUncoupledMm ?? DEFAULT_MAX_UNCOUPLED_MM;
    const maxSkew = dp.maxSkewMm ?? DEFAULT_MAX_SKEW_MM;
    const anchor = { kind: "diffPair" as const, pNetId: dp.pNetId, nNetId: dp.nNetId };

    // ── skew: |lenP − lenN| ──────────────────────────────────────────────
    const lenP = netLength(dp.pNetId);
    const lenN = netLength(dp.nNetId);
    const skew = Math.abs(lenP - lenN);
    if (skew > maxSkew) {
      out.push({
        code: "DIFF_PAIR_SKEW",
        ruleClass: "signal-integrity",
        message: `Diff-pair ${dp.name} length skew ${skew.toFixed(3)} mm exceeds ${maxSkew.toFixed(3)} mm`,
        anchors: [anchor],
        locationMm: pTraces[0]!.mid,
      });
    }

    // ── coupling: per (P-seg, N-seg) near-parallel overlap ────────────────
    let coupledLen = 0;
    let worstGapDev = 0;
    let worstGapPoint: Point = pTraces[0]!.mid;
    for (const pt of pTraces) {
      for (const nt of nTraces) {
        if (pt.layer !== nt.layer) continue;
        for (let i = 1; i < pt.pointsMm.length; i += 1) {
          const pa = pt.pointsMm[i - 1]!;
          const pb = pt.pointsMm[i]!;
          for (let j = 1; j < nt.pointsMm.length; j += 1) {
            const na = nt.pointsMm[j - 1]!;
            const nb = nt.pointsMm[j]!;
            if (!nearParallel(pa, pb, na, nb)) continue;
            const gap =
              segmentToSegmentDistance(pa, pb, na, nb) -
              (pt.halfWidthMm + nt.halfWidthMm);
            // Segments only couple when actually close: within the coupling
            // window (a few × the target gap, or an absolute fallback).
            const couplingMaxGap =
              targetGap !== undefined ? targetGap * 4 + 0.1 : 1.0;
            if (gap > couplingMaxGap) continue;
            const span = coupledOverlap(pa, pb, na, nb);
            if (span <= 0) continue;
            coupledLen += span;
            if (targetGap !== undefined) {
              const dev = Math.abs(gap - targetGap);
              if (dev > worstGapDev) {
                worstGapDev = dev;
                worstGapPoint = { x: (pa.x + na.x) / 2, y: (pa.y + na.y) / 2 };
              }
            }
          }
        }
      }
    }

    // ── gap deviation ────────────────────────────────────────────────────
    if (targetGap !== undefined && worstGapDev > gapTol) {
      out.push({
        code: "DIFF_PAIR_GAP",
        ruleClass: "signal-integrity",
        message: `Diff-pair ${dp.name} coupled gap deviates ${worstGapDev.toFixed(3)} mm from target ${targetGap.toFixed(3)} mm`,
        anchors: [anchor],
        locationMm: worstGapPoint,
      });
    }

    // ── uncoupled length ─────────────────────────────────────────────────
    const uncoupled = Math.max(lenP, lenN) - coupledLen;
    if (uncoupled > maxUncoupled) {
      out.push({
        code: "DIFF_PAIR_UNCOUPLED_LENGTH",
        ruleClass: "signal-integrity",
        message: `Diff-pair ${dp.name} has ${uncoupled.toFixed(2)} mm uncoupled (max ${maxUncoupled.toFixed(2)} mm)`,
        anchors: [anchor],
        locationMm: pTraces[0]!.mid,
      });
    }
  }

  return out;
}

function segAngle(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function nearParallel(pa: Point, pb: Point, na: Point, nb: Point): boolean {
  // Signed angle between directions, normalized to (-π, π], then folded to
  // [0, π/2] so anti-parallel (≈π) counts as parallel and the +179/−179 wrap
  // (≈2π raw) does not misclassify near-parallel segments as perpendicular.
  let d = segAngle(pa, pb) - segAngle(na, nb);
  d = Math.atan2(Math.sin(d), Math.cos(d)); // → (-π, π]
  d = Math.abs(d);
  if (d > Math.PI / 2) d = Math.PI - d; // fold anti-parallel
  return (d * 180) / Math.PI <= COUPLING_ANGLE_DEG;
}

/** Length of N's projection overlap onto P's direction (mm). */
function coupledOverlap(pa: Point, pb: Point, na: Point, nb: Point): number {
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  const ux = dx / len;
  const uy = dy / len;
  const proj = (q: Point) => (q.x - pa.x) * ux + (q.y - pa.y) * uy;
  const p0 = 0;
  const p1 = len;
  const n0 = proj(na);
  const n1 = proj(nb);
  const lo = Math.max(Math.min(p0, p1), Math.min(n0, n1));
  const hi = Math.min(Math.max(p0, p1), Math.max(n0, n1));
  return Math.max(0, hi - lo);
}
