import type {
  DrcAnchor,
  DrcRuleCode,
  DrcSeverity,
  PcbCopperLayerId,
  PcbDrcRule,
  PcbPointMm,
} from "../../../../../sdks/designer";
import { splitSegmentAtRings } from "../../../../../shared/pcb-geometry/region-rings";
import type {
  ClearanceItem,
  ResolvedValue,
  RuleResolver,
} from "../../../../../shared/drc/rule-resolver";
import { FAB_PRESETS } from "../../pcb/fab-presets";
import {
  circleToPolygonDistance,
  polygonToPolygonDistance,
  polylineToPolygonDistance,
  segmentToRingClosestPoints,
} from "../../pcb/pcb-clearance-geometry";
import {
  distance,
  pointToPolylineDistance,
  polylineToPolylineClosestPoints,
  projectPointToSegment,
  segmentClosestPoints,
} from "../../pcb/pcb-trace-geometry";
import {
  aabbGap,
  layersOverlap,
  type DrcContext,
  type DrcTrace,
} from "../drc-context";
import { ruleSuffix } from "../rule-message";
import { DEFAULT_SEVERITY_BY_CODE, severityRank } from "../severity";
import type { DrcViolationDraft } from "../types";
import { anchorKey } from "../violation-id";

import { below, clearanceViolated, SHORT_EPS_MM } from "../../pcb/tolerance";

type Segment = { a: PcbPointMm; b: PcbPointMm };

function sameNet(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

function differentKnownNet(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

function midpoint(a: PcbPointMm, b: PcbPointMm): PcbPointMm {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * One evaluated spot on a pair: a gap, the requirement that holds THERE, and
 * the rule that set it. With no area rules a pair has exactly one candidate
 * and everything below degenerates to the pre-S6 single comparison.
 */
interface Candidate {
  gap: number;
  required: number;
  rule: PcbDrcRule | null;
  location: PcbPointMm;
  layer: PcbCopperLayerId;
}

interface PairVerdict {
  /** Smallest gap anywhere on the pair — the short and fab tiers use it. */
  minGap: number;
  minRequired: number;
  minLocation: PcbPointMm;
  minLayer: PcbCopperLayerId;
  /** The reported breach, or null when every candidate clears. */
  breach: {
    gap: number;
    /** The value reported and compared against; see `summarize`. */
    resolved: ResolvedValue;
    location: PcbPointMm;
    layer: PcbCopperLayerId;
    ruleSeverity: DrcSeverity;
  } | null;
}

/**
 * Reduce a pair's candidates to one verdict.
 *
 * `spatial` picks the witness with the largest deficit (contract §4.4 — ties by
 * candidate index, which the caller emits in the canonical orientation so
 * swapping the input arrays cannot move it) and reports THAT witness's
 * requirement. `layered` is the multi-layer aggregate (§4.3): the geometry is
 * one gap, so the reported layer is the first violated one in stackup order
 * and the requirement is the largest over every violated layer.
 *
 * Both take the MOST SEVERE severity input over every violating candidate, so
 * aggregation can never downgrade a breach (§7, Astra run 1 #4).
 */
function summarize(
  code: DrcRuleCode,
  candidates: readonly Candidate[],
  mode: "spatial" | "layered",
): PairVerdict {
  let min = candidates[0]!;
  for (const c of candidates) if (c.gap < min.gap) min = c;

  // The three things an aggregate needs, tracked separately because §4.3 takes
  // each from a DIFFERENT violated candidate.
  let first: Candidate | null = null; // first violated, in candidate order
  let strictest: Candidate | null = null; // largest requirement
  let witness: Candidate | null = null; // largest deficit
  let bestDeficit = -Infinity;
  let severity: DrcSeverity | null = null;
  for (const c of candidates) {
    if (!clearanceViolated(c.gap, c.required)) continue;
    const s = c.rule?.severity ?? DEFAULT_SEVERITY_BY_CODE[code];
    severity =
      severity === null || severityRank(s) > severityRank(severity) ? s : severity;
    if (first === null) first = c;
    if (strictest === null || c.required > strictest.required) strictest = c;
    const deficit = c.required - c.gap;
    if (witness === null || deficit > bestDeficit) {
      witness = c;
      bestDeficit = deficit;
    }
  }

  // `layered`: one gap across every shared layer, so the LAYER is the first
  // violated one in stackup order while the REQUIREMENT is the largest over
  // them (§4.3) — a strict B.Cu rule must not move the report off F.Cu, and an
  // F.Cu rule must not soften the number. `spatial`: one layer, many places, so
  // everything comes from the largest-deficit witness (§4.4).
  const reported = mode === "layered" ? first : witness;
  const value = mode === "layered" ? strictest : witness;
  return {
    minGap: min.gap,
    minRequired: min.required,
    minLocation: min.location,
    minLayer: min.layer,
    breach:
      reported === null || value === null || severity === null
        ? null
        : {
            gap: reported.gap,
            resolved: { mm: value.required, rule: value.rule },
            location: reported.location,
            layer: reported.layer,
            ruleSeverity: severity,
          },
  };
}

/**
 * Copper clearance + short detection for every copper pair kind on shared
 * layers (different nets). One geometric pass yields three outcomes per pair:
 *   gap ≤ SHORT_EPS (different known nets) → NET_SHORT_CIRCUIT (error)
 *   clearanceViolated(gap, required)       → <pair>_CLEARANCE  (error)
 *   below(gap, fabMin)                     → FAB_CLEARANCE     (warning)
 *
 * `required` comes from the ONE rule resolver (rule-semantics contract §4).
 * When a scoped `area` rule is in play the requirement is not constant over a
 * pair, so each trace is split at every area-ring crossing and the pair is
 * judged sub-segment by sub-segment — otherwise a relaxation around the
 * closest approach would hide a breach elsewhere on the same pair (§4.4).
 */
export function checkClearance(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const resolver = ctx.resolver;
  const fabMin =
    ctx.fabricator === "custom"
      ? 0
      : (FAB_PRESETS[ctx.fabricator]?.minClearanceMm ?? 0);

  const emit = (params: {
    netA: string | null;
    netB: string | null;
    verdict: PairVerdict;
    clearanceCode: DrcRuleCode;
    anchors: DrcAnchor[];
    label: string;
  }): void => {
    const { verdict, netA, netB } = params;
    // A short (different-net copper overlap) is flagged independent of the
    // configured clearance: a 0 mm rule (custom fab / no net class) must NOT
    // hide a dead short. Only when it is NOT a short do we fall through to the
    // clearance / fabricator comparisons.
    if (differentKnownNet(netA, netB) && verdict.minGap <= SHORT_EPS_MM) {
      out.push({
        code: "NET_SHORT_CIRCUIT",
        ruleClass: "connectivity",
        message: `Short circuit: ${params.label} on different nets overlap`,
        anchors: [
          ...params.anchors,
          { kind: "net", netId: netA! },
          { kind: "net", netId: netB! },
        ],
        locationMm: verdict.minLocation,
        layer: verdict.minLayer,
        measuredMm: Math.max(0, verdict.minGap),
        requiredMm: verdict.minRequired,
      });
    } else if (verdict.breach) {
      const b = verdict.breach;
      out.push({
        code: params.clearanceCode,
        ruleClass: "clearance",
        ruleSeverity: b.ruleSeverity,
        message: `Clearance ${b.gap.toFixed(3)} mm between ${params.label} is below the required ${b.resolved.mm.toFixed(3)} mm${ruleSuffix(b.resolved)}`,
        anchors: params.anchors,
        locationMm: b.location,
        layer: b.layer,
        measuredMm: b.gap,
        requiredMm: b.resolved.mm,
      });
    } else if (fabMin > 0 && below(verdict.minGap, fabMin)) {
      out.push({
        code: "FAB_CLEARANCE",
        ruleClass: "manufacturability",
        message: `Clearance ${verdict.minGap.toFixed(3)} mm between ${params.label} is below the fabricator minimum ${fabMin.toFixed(3)} mm`,
        anchors: params.anchors,
        locationMm: verdict.minLocation,
        layer: verdict.minLayer,
        measuredMm: verdict.minGap,
        requiredMm: fabMin,
      });
    }
  };

  /** Broad phase — `clearanceBound` is an upper bound of any resolvable value. */
  const farApart = (
    boundsA: DrcTrace["bounds"],
    boundsB: DrcTrace["bounds"],
    pairKind: Parameters<RuleResolver["clearanceBound"]>[0],
    netA: string | null,
    netB: string | null,
  ): boolean =>
    aabbGap(boundsA, boundsB) >
    Math.max(resolver.clearanceBound(pairKind, netA, netB), fabMin, SHORT_EPS_MM);

  // A trace whose AABB cannot reach any area polygon has a constant (zero)
  // area mask, so it never needs splitting; the cost of §4.4 is confined to
  // the pairs that actually meet an area (§13, Astra run 1 #15).
  const splitCache = new Map<string, Segment[]>();
  const needsSplit = (t: DrcTrace): boolean =>
    resolver.hasAreaRules && resolver.boundsMeetAnyArea(t.bounds);
  const segmentsOf = (t: DrcTrace): Segment[] => {
    const cached = splitCache.get(t.id);
    if (cached) return cached;
    const split = needsSplit(t);
    const segs: Segment[] = [];
    for (let i = 1; i < t.pointsMm.length; i += 1) {
      const p = t.pointsMm[i - 1]!;
      const q = t.pointsMm[i]!;
      if (!split) segs.push({ a: p, b: q });
      else for (const s of splitSegmentAtRings(p, q, resolver.areaRings)) segs.push(s);
    }
    splitCache.set(t.id, segs);
    return segs;
  };
  const item = (netId: string | null, pointMm: PcbPointMm): ClearanceItem => ({
    netId,
    pointMm,
  });

  // --- trace ↔ trace (same layer) ---
  for (let i = 0; i < ctx.traces.length; i += 1) {
    const a = ctx.traces[i]!;
    if (a.pointsMm.length < 2) continue;
    for (let j = i + 1; j < ctx.traces.length; j += 1) {
      const b = ctx.traces[j]!;
      if (b.pointsMm.length < 2) continue;
      if (a.layer !== b.layer) continue;
      if (sameNet(a.netId, b.netId)) continue;
      if (farApart(a.bounds, b.bounds, "traceToTrace", a.netId, b.netId)) continue;

      // Canonical orientation (§11), for BOTH branches: the item with the
      // smaller sorted anchor key leads. The split branch needs it for its
      // (u, v) tie-break, and the fast path needs it just as much — the kernel
      // tests its four endpoint candidates in a fixed order with a strict `<`,
      // so on a parallel partial overlap the tie between the two overlap ends
      // resolves to whichever end came from the first argument. Reversing the
      // input array would otherwise move the marker to the other end of the
      // overlap and with it the violation's 0.1 mm location bucket — a
      // different id for the same physical breach.
      const swap =
        anchorKey({ kind: "trace", traceId: a.id }) >
        anchorKey({ kind: "trace", traceId: b.id });
      const u = swap ? b : a;
      const v = swap ? a : b;
      const half = u.halfWidthMm + v.halfWidthMm;

      const candidates: Candidate[] = [];
      if (!needsSplit(u) && !needsSplit(v)) {
        // Fast path: the mask is 0 over both traces, so one resolution at the
        // representative points is exact — byte-identical to the pre-S6 pass.
        const closest = polylineToPolylineClosestPoints(u.pointsMm, v.pointsMm);
        const r = resolver.clearance(
          "traceToTrace",
          u.layer,
          item(u.netId, u.mid),
          item(v.netId, v.mid),
        );
        candidates.push({
          gap: closest.distance - half,
          required: r.mm,
          rule: r.rule,
          location: midpoint(closest.a, closest.b),
          layer: u.layer,
        });
      } else {
        for (const su of segmentsOf(u)) {
          const pu = item(u.netId, midpoint(su.a, su.b));
          for (const sv of segmentsOf(v)) {
            const r = resolver.clearance(
              "traceToTrace",
              u.layer,
              pu,
              item(v.netId, midpoint(sv.a, sv.b)),
            );
            const cp = segmentClosestPoints(su.a, su.b, sv.a, sv.b);
            candidates.push({
              gap: cp.distance - half,
              required: r.mm,
              rule: r.rule,
              location: midpoint(cp.a, cp.b),
              layer: u.layer,
            });
          }
        }
      }
      if (candidates.length === 0) continue;
      emit({
        netA: a.netId,
        netB: b.netId,
        verdict: summarize("TRACE_TO_TRACE_CLEARANCE", candidates, "spatial"),
        clearanceCode: "TRACE_TO_TRACE_CLEARANCE",
        anchors: [
          { kind: "trace", traceId: a.id },
          { kind: "trace", traceId: b.id },
        ],
        label: "two traces",
      });
    }
  }

  // --- trace ↔ pad (pad occupies the trace's layer) ---
  for (const t of ctx.traces) {
    if (t.pointsMm.length < 2) continue;
    for (const pad of ctx.pads) {
      if (!pad.layers.includes(t.layer)) continue;
      if (sameNet(t.netId, pad.netId)) continue;
      if (farApart(t.bounds, pad.bounds, "traceToPad", t.netId, pad.netId)) continue;
      const padItem = item(pad.netId, pad.center);
      const candidates: Candidate[] = [];
      if (!needsSplit(t) && !resolver.boundsMeetAnyArea(pad.bounds)) {
        const r = resolver.clearance(
          "traceToPad",
          t.layer,
          item(t.netId, t.mid),
          padItem,
        );
        candidates.push({
          gap: polylineToPolygonDistance(t.pointsMm, pad.ring) - t.halfWidthMm,
          required: r.mm,
          rule: r.rule,
          location: pad.center,
          layer: t.layer,
        });
      } else {
        for (const s of segmentsOf(t)) {
          const r = resolver.clearance(
            "traceToPad",
            t.layer,
            item(t.netId, midpoint(s.a, s.b)),
            padItem,
          );
          candidates.push({
            gap:
              segmentToRingClosestPoints(s.a, s.b, pad.ring).distance -
              t.halfWidthMm,
            required: r.mm,
            rule: r.rule,
            // The pad is one point of constant membership; its centre stays the
            // marker, so an area rule that changes no verdict changes no id.
            location: pad.center,
            layer: t.layer,
          });
        }
      }
      if (candidates.length === 0) continue;
      emit({
        netA: t.netId,
        netB: pad.netId,
        verdict: summarize("TRACE_TO_PAD_CLEARANCE", candidates, "spatial"),
        clearanceCode: "TRACE_TO_PAD_CLEARANCE",
        anchors: [{ kind: "trace", traceId: t.id }, pad.anchor],
        label: "trace and pad",
      });
    }
  }

  // --- trace ↔ via (via barrel crosses the trace's layer) ---
  for (const t of ctx.traces) {
    if (t.pointsMm.length < 2) continue;
    for (const vg of ctx.vias) {
      if (!vg.layers.includes(t.layer)) continue;
      if (sameNet(t.netId, vg.netId)) continue;
      if (farApart(t.bounds, vg.bounds, "traceToVia", t.netId, vg.netId)) continue;
      const viaItem = item(vg.netId, vg.center);
      const half = t.halfWidthMm + vg.radiusMm;
      const candidates: Candidate[] = [];
      if (!needsSplit(t) && !resolver.boundsMeetAnyArea(vg.bounds)) {
        const r = resolver.clearance(
          "traceToVia",
          t.layer,
          item(t.netId, t.mid),
          viaItem,
        );
        candidates.push({
          gap: pointToPolylineDistance(vg.center, t.pointsMm).distance - half,
          required: r.mm,
          rule: r.rule,
          location: vg.center,
          layer: t.layer,
        });
      } else {
        for (const s of segmentsOf(t)) {
          const r = resolver.clearance(
            "traceToVia",
            t.layer,
            item(t.netId, midpoint(s.a, s.b)),
            viaItem,
          );
          candidates.push({
            gap: projectPointToSegment(vg.center, s.a, s.b).distance - half,
            required: r.mm,
            rule: r.rule,
            location: vg.center,
            layer: t.layer,
          });
        }
      }
      if (candidates.length === 0) continue;
      emit({
        netA: t.netId,
        netB: vg.netId,
        verdict: summarize("TRACE_TO_VIA_CLEARANCE", candidates, "spatial"),
        clearanceCode: "TRACE_TO_VIA_CLEARANCE",
        anchors: [
          { kind: "trace", traceId: t.id },
          { kind: "via", viaId: vg.via.id },
        ],
        label: "trace and via",
      });
    }
  }

  /**
   * Pad↔pad, pad↔via and via↔via share one geometric gap across every shared
   * layer; only the RULE can vary per layer, so they resolve on each shared
   * layer in stackup order and aggregate (§4.3).
   */
  const layered = (
    pairKind: Parameters<RuleResolver["clearance"]>[0],
    code: DrcRuleCode,
    sharedLayers: readonly PcbCopperLayerId[],
    gap: number,
    a: ClearanceItem,
    b: ClearanceItem,
    location: PcbPointMm,
  ): PairVerdict => {
    const candidates: Candidate[] = sharedLayers.map((layer) => {
      const r: ResolvedValue = resolver.clearance(pairKind, layer, a, b);
      return { gap, required: r.mm, rule: r.rule, location, layer };
    });
    return summarize(code, candidates, "layered");
  };

  // --- via ↔ via (P2) ---
  for (let i = 0; i < ctx.vias.length; i += 1) {
    const a = ctx.vias[i]!;
    for (let j = i + 1; j < ctx.vias.length; j += 1) {
      const b = ctx.vias[j]!;
      if (!layersOverlap(a.layers, b.layers)) continue;
      if (sameNet(a.netId, b.netId)) continue;
      if (farApart(a.bounds, b.bounds, "viaToVia", a.netId, b.netId)) continue;
      const shared = a.layers.filter((l) => b.layers.includes(l));
      emit({
        netA: a.netId,
        netB: b.netId,
        verdict: layered(
          "viaToVia",
          "VIA_TO_VIA_CLEARANCE",
          shared,
          distance(a.center, b.center) - (a.radiusMm + b.radiusMm),
          item(a.netId, a.center),
          item(b.netId, b.center),
          midpoint(a.center, b.center),
        ),
        clearanceCode: "VIA_TO_VIA_CLEARANCE",
        anchors: [
          { kind: "via", viaId: a.via.id },
          { kind: "via", viaId: b.via.id },
        ],
        label: "two vias",
      });
    }
  }

  // --- pad ↔ pad (P2). Skip pads of the SAME footprint — intra-footprint pad
  // spacing is the footprint's responsibility, not board DRC. ---
  for (let i = 0; i < ctx.pads.length; i += 1) {
    const a = ctx.pads[i]!;
    for (let j = i + 1; j < ctx.pads.length; j += 1) {
      const b = ctx.pads[j]!;
      if (
        a.anchor.kind === "pad" &&
        b.anchor.kind === "pad" &&
        a.anchor.placementId === b.anchor.placementId
      ) {
        continue;
      }
      const shared = a.layers.filter((l) => b.layers.includes(l));
      if (shared.length === 0) continue;
      if (sameNet(a.netId, b.netId)) continue;
      if (farApart(a.bounds, b.bounds, "padToPad", a.netId, b.netId)) continue;
      emit({
        netA: a.netId,
        netB: b.netId,
        verdict: layered(
          "padToPad",
          "PAD_TO_PAD_CLEARANCE",
          shared,
          polygonToPolygonDistance(a.ring, b.ring),
          item(a.netId, a.center),
          item(b.netId, b.center),
          midpoint(a.center, b.center),
        ),
        clearanceCode: "PAD_TO_PAD_CLEARANCE",
        anchors: [a.anchor, b.anchor],
        label: "two pads",
      });
    }
  }

  // --- pad ↔ via (P2). Via barrel crosses a copper layer the pad occupies, on
  // different nets. circleToPolygonDistance is the exact circle-to-polygon gap;
  // the via has no dedicated rule, so the board floor reuses traceToViaMm. ---
  for (const pad of ctx.pads) {
    for (const vg of ctx.vias) {
      const shared = pad.layers.filter((l) => vg.layers.includes(l));
      if (shared.length === 0) continue;
      if (sameNet(pad.netId, vg.netId)) continue;
      if (farApart(pad.bounds, vg.bounds, "padToVia", pad.netId, vg.netId)) continue;
      emit({
        netA: pad.netId,
        netB: vg.netId,
        verdict: layered(
          "padToVia",
          "PAD_TO_VIA_CLEARANCE",
          shared,
          circleToPolygonDistance(vg.center, vg.radiusMm, pad.ring),
          item(pad.netId, pad.center),
          item(vg.netId, vg.center),
          vg.center,
        ),
        clearanceCode: "PAD_TO_VIA_CLEARANCE",
        anchors: [pad.anchor, { kind: "via", viaId: vg.via.id }],
        label: "pad and via",
      });
    }
  }

  return out;
}
