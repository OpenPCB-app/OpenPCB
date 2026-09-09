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
  midpoint,
  padPadGap,
  padViaGap,
  segmentPadGap,
  segmentSegmentGap,
  segmentViaGap,
  tracePadGap,
  traceTraceGap,
  traceViaGap,
  viaViaGap,
  type PairGap,
} from "../pair-gap";
import {
  aabbGap,
  layersOverlap,
  type DrcContext,
  type DrcPad,
  type DrcTrace,
  type DrcViaGeom,
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

/**
 * One side of a pair, as the null-net bridge aggregation needs to see it: the
 * anchor it is keyed and reported by, the marker the bridge draft locates (the
 * same marker the pair kinds already use — trace mid, pad / via centre) and the
 * noun its message reads with. `layer` is set for a trace only; a pad or a via
 * spans several layers, so the draft carries none.
 */
interface PairSide {
  anchor: DrcAnchor;
  marker: PcbPointMm;
  layer?: PcbCopperLayerId;
  noun: "trace" | "pad" | "via";
}

/** "A and B", "A, B and C" — net NAMES, falling back to the id. */
function netList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Canonical pair orientation (rule-semantics contract §11): the item with the
 * smaller anchor key leads. The kernels are not all symmetric — `padPadGap`
 * measures a disc against the OTHER pad's ring, so (disc, ring) and
 * (ring, disc) are two different computations — and neither is the resolver, so
 * without this the report would depend on the input array order.
 */
function orient<T>(a: T, b: T, anchorA: DrcAnchor, anchorB: DrcAnchor): [T, T] {
  return anchorKey(anchorA) > anchorKey(anchorB) ? [b, a] : [a, b];
}

function traceSide(t: DrcTrace): PairSide {
  return {
    anchor: { kind: "trace", traceId: t.id },
    marker: t.mid,
    layer: t.layer,
    noun: "trace",
  };
}

function padSide(p: DrcPad): PairSide {
  return { anchor: p.anchor, marker: p.center, noun: "pad" };
}

function viaSide(v: DrcViaGeom): PairSide {
  return {
    anchor: { kind: "via", viaId: v.via.id },
    marker: v.center,
    noun: "via",
  };
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
 * layers (different nets). One geometric pass yields three TIERS per pair, in
 * this order — the first that fires is the only one that reports:
 *   gap ≤ SHORT_EPS (different known nets) → NET_SHORT_CIRCUIT (error)
 *   clearanceViolated(gap, required)       → <pair>_CLEARANCE  (error)
 *   below(gap, fabMin)                     → FAB_CLEARANCE     (warning)
 *
 * Pads of ONE placement run the SHORT tier only (batch-DRC contract 06 §4):
 * spacing inside a footprint is the library's business, but a different-net
 * overlap inside one is a dead short on the finished board — symmetric with the
 * hole↔hole rule, which likewise keeps overlapping drills of one footprint.
 *
 * Every gap comes from `pair-gap.ts`, the ONE place a pair kind is turned into
 * a distance (contract 06 §3), so clearance, creepage and the copper-to-hole
 * check cannot measure the same geometry two ways.
 *
 * `required` comes from the ONE rule resolver (rule-semantics contract §4).
 * When a scoped `area` rule is in play the requirement is not constant over a
 * pair, so each trace is split at every area-ring crossing and the pair is
 * judged sub-segment by sub-segment — otherwise a relaxation around the
 * closest approach would hide a breach elsewhere on the same pair (§4.4).
 *
 * NULL-NET BRIDGES (contract 06 §4): pairwise, unassigned copper touching one
 * named net is a legitimate extension of it (connectivity contract §2) — but an
 * unassigned item touching TWO different known nets shorts them through itself,
 * and no single pair can see that. Every (null-net, named) touch is therefore
 * recorded against the null-net item, and after all six loops an item with two
 * or more distinct nets emits ONE `NET_SHORT_CIRCUIT`. Chains through two
 * null-net items are a stated limit (contract 06 §9).
 */
export function checkClearance(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const resolver = ctx.resolver;
  const fabMin =
    ctx.fabricator === "custom"
      ? 0
      : (FAB_PRESETS[ctx.fabricator]?.minClearanceMm ?? 0);

  // Null-net item (by anchor key) → the known nets its copper touches.
  const bridges = new Map<string, { side: PairSide; nets: Set<string> }>();
  // One pad number can be several copper shapes with ONE anchor: the shape
  // whose marker sorts first (x, then y) represents the pin, so the draft's
  // location and id cannot follow the footprint's shape order (R1 #6).
  const markerBefore = (a: PcbPointMm, b: PcbPointMm): boolean =>
    a.x !== b.x ? a.x < b.x : a.y < b.y;
  const recordBridge = (side: PairSide, netId: string): void => {
    const existing = bridges.get(anchorKey(side.anchor));
    if (!existing) {
      bridges.set(anchorKey(side.anchor), { side, nets: new Set([netId]) });
      return;
    }
    existing.nets.add(netId);
    if (markerBefore(side.marker, existing.side.marker)) existing.side = side;
  };

  const emit = (params: {
    netA: string | null;
    netB: string | null;
    verdict: PairVerdict;
    clearanceCode: DrcRuleCode;
    sideA: PairSide;
    sideB: PairSide;
    label: string;
    /** Pads of one placement: the short tier is the only one that applies. */
    shortTierOnly?: boolean;
  }): void => {
    const { verdict, netA, netB } = params;
    const anchors: DrcAnchor[] = [params.sideA.anchor, params.sideB.anchor];
    const touching = verdict.minGap <= SHORT_EPS_MM;
    // Exactly one side unassigned: pairwise this is an extension of the named
    // net, so nothing is reported HERE — it is banked for the bridge pass.
    if (touching) {
      if (netA === null && netB !== null) recordBridge(params.sideA, netB);
      else if (netB === null && netA !== null) recordBridge(params.sideB, netA);
    }
    // A short (different-net copper overlap) is flagged independent of the
    // configured clearance: a 0 mm rule (custom fab / no net class) must NOT
    // hide a dead short. Only when it is NOT a short do we fall through to the
    // clearance / fabricator comparisons.
    if (differentKnownNet(netA, netB) && touching) {
      out.push({
        code: "NET_SHORT_CIRCUIT",
        message: `Short circuit: ${params.label} on different nets overlap`,
        anchors: [
          ...anchors,
          { kind: "net", netId: netA! },
          { kind: "net", netId: netB! },
        ],
        locationMm: verdict.minLocation,
        layer: verdict.minLayer,
        measuredMm: Math.max(0, verdict.minGap),
        requiredMm: verdict.minRequired,
      });
      return;
    }
    if (params.shortTierOnly) return;
    if (verdict.breach) {
      const b = verdict.breach;
      out.push({
        code: params.clearanceCode,
        ruleSeverity: b.ruleSeverity,
        message: `Clearance ${b.gap.toFixed(3)} mm between ${params.label} is below the required ${b.resolved.mm.toFixed(3)} mm${ruleSuffix(b.resolved)}`,
        anchors,
        locationMm: b.location,
        layer: b.layer,
        measuredMm: b.gap,
        requiredMm: b.resolved.mm,
      });
    } else if (fabMin > 0 && below(verdict.minGap, fabMin)) {
      out.push({
        code: "FAB_CLEARANCE",
        message: `Clearance ${verdict.minGap.toFixed(3)} mm between ${params.label} is below the fabricator minimum ${fabMin.toFixed(3)} mm`,
        anchors,
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
      // different id for the same physical breach. The EMITTED sides follow the
      // same order, so the anchor array and the two net anchors of a short are
      // functions of the pair, not of `ctx.traces` (§7 byte identity).
      const [u, v] = orient(
        a,
        b,
        { kind: "trace", traceId: a.id },
        { kind: "trace", traceId: b.id },
      );
      const half = u.halfWidthMm + v.halfWidthMm;

      const candidates: Candidate[] = [];
      if (!needsSplit(u) && !needsSplit(v)) {
        // Fast path: the mask is 0 over both traces, so one resolution at the
        // representative points is exact — byte-identical to the pre-S6 pass.
        const g = traceTraceGap(u, v);
        const r = resolver.clearance(
          "traceToTrace",
          u.layer,
          item(u.netId, u.mid),
          item(v.netId, v.mid),
        );
        candidates.push({
          gap: g.gap,
          required: r.mm,
          rule: r.rule,
          location: g.location,
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
            const g = segmentSegmentGap(su.a, su.b, sv.a, sv.b, half);
            candidates.push({
              gap: g.gap,
              required: r.mm,
              rule: r.rule,
              location: g.location,
              layer: u.layer,
            });
          }
        }
      }
      if (candidates.length === 0) continue;
      emit({
        netA: u.netId,
        netB: v.netId,
        verdict: summarize("TRACE_TO_TRACE_CLEARANCE", candidates, "spatial"),
        clearanceCode: "TRACE_TO_TRACE_CLEARANCE",
        sideA: traceSide(u),
        sideB: traceSide(v),
        label: "two traces",
      });
    }
  }

  // --- trace ↔ pad (pad occupies the trace's layer) ---
  for (const t of ctx.traces) {
    if (t.pointsMm.length < 2) continue;
    const tSide = traceSide(t);
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
        const g = tracePadGap(t, pad);
        candidates.push({
          gap: g.gap,
          required: r.mm,
          rule: r.rule,
          location: g.location,
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
          const g = segmentPadGap(s.a, s.b, t.halfWidthMm, pad);
          candidates.push({
            gap: g.gap,
            required: r.mm,
            rule: r.rule,
            // The pad is one point of constant membership; its centre stays the
            // marker, so an area rule that changes no verdict changes no id.
            location: g.location,
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
        sideA: tSide,
        sideB: padSide(pad),
        label: "trace and pad",
      });
    }
  }

  // --- trace ↔ via (via barrel crosses the trace's layer) ---
  for (const t of ctx.traces) {
    if (t.pointsMm.length < 2) continue;
    const tSide = traceSide(t);
    for (const vg of ctx.vias) {
      if (!vg.layers.includes(t.layer)) continue;
      if (sameNet(t.netId, vg.netId)) continue;
      if (farApart(t.bounds, vg.bounds, "traceToVia", t.netId, vg.netId)) continue;
      const viaItem = item(vg.netId, vg.center);
      const candidates: Candidate[] = [];
      if (!needsSplit(t) && !resolver.boundsMeetAnyArea(vg.bounds)) {
        const r = resolver.clearance(
          "traceToVia",
          t.layer,
          item(t.netId, t.mid),
          viaItem,
        );
        const g = traceViaGap(t, vg);
        candidates.push({
          gap: g.gap,
          required: r.mm,
          rule: r.rule,
          location: g.location,
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
          const g = segmentViaGap(s.a, s.b, t.halfWidthMm, vg);
          candidates.push({
            gap: g.gap,
            required: r.mm,
            rule: r.rule,
            location: g.location,
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
        sideA: tSide,
        sideB: viaSide(vg),
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
    g: PairGap,
    a: ClearanceItem,
    b: ClearanceItem,
  ): PairVerdict => {
    const candidates: Candidate[] = sharedLayers.map((layer) => {
      const r: ResolvedValue = resolver.clearance(pairKind, layer, a, b);
      return {
        gap: g.gap,
        required: r.mm,
        rule: r.rule,
        location: g.location,
        layer,
      };
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
      // Canonical orientation (§11), as trace↔trace already does: the item with
      // the smaller anchor key leads into BOTH the kernel and the resolver, so
      // reversing `ctx.vias` cannot move the gap, the marker or the requirement.
      const [u, v] = orient(
        a,
        b,
        { kind: "via", viaId: a.via.id },
        { kind: "via", viaId: b.via.id },
      );
      emit({
        netA: u.netId,
        netB: v.netId,
        verdict: layered(
          "viaToVia",
          "VIA_TO_VIA_CLEARANCE",
          shared,
          viaViaGap(u, v),
          item(u.netId, u.center),
          item(v.netId, v.center),
        ),
        clearanceCode: "VIA_TO_VIA_CLEARANCE",
        sideA: viaSide(u),
        sideB: viaSide(v),
        label: "two vias",
      });
    }
  }

  // --- pad ↔ pad (P2). Pads of the SAME footprint run the short tier ONLY:
  // intra-footprint spacing is the library's responsibility, a different-net
  // overlap inside a footprint is still a dead short (contract 06 §4). ---
  for (let i = 0; i < ctx.pads.length; i += 1) {
    const a = ctx.pads[i]!;
    for (let j = i + 1; j < ctx.pads.length; j += 1) {
      const b = ctx.pads[j]!;
      const sameFootprint =
        a.anchor.kind === "pad" &&
        b.anchor.kind === "pad" &&
        a.anchor.placementId === b.anchor.placementId;
      // A bounding-rectangle pad (`custom` / `trapezoid`) can "overlap" a
      // neighbour of its own footprint without any copper touching, and a
      // short is non-waivable — so such intra-footprint pairs stay unjudged,
      // as before S7, until S11 models the true shape (R1 #4).
      if (sameFootprint && !(a.exactShape && b.exactShape)) continue;
      const shared = a.layers.filter((l) => b.layers.includes(l));
      if (shared.length === 0) continue;
      if (sameNet(a.netId, b.netId)) continue;
      if (farApart(a.bounds, b.bounds, "padToPad", a.netId, b.netId)) continue;
      const [u, v] = orient(a, b, a.anchor, b.anchor);
      emit({
        netA: u.netId,
        netB: v.netId,
        verdict: layered(
          "padToPad",
          "PAD_TO_PAD_CLEARANCE",
          shared,
          padPadGap(u, v),
          item(u.netId, u.center),
          item(v.netId, v.center),
        ),
        clearanceCode: "PAD_TO_PAD_CLEARANCE",
        sideA: padSide(u),
        sideB: padSide(v),
        label: "two pads",
        ...(sameFootprint ? { shortTierOnly: true } : {}),
      });
    }
  }

  // --- pad ↔ via (P2). Via barrel crosses a copper layer the pad occupies, on
  // different nets. The pair is canonical BY CONSTRUCTION — the two sides have
  // different kinds, so `padViaGap` and the resolver always take the pad first
  // whatever order `ctx.pads` / `ctx.vias` arrive in; there is nothing to sort.
  // The via has no dedicated rule, so the board floor reuses traceToViaMm. ---
  for (const pad of ctx.pads) {
    const pSide = padSide(pad);
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
          padViaGap(pad, vg),
          item(pad.netId, pad.center),
          item(vg.netId, vg.center),
        ),
        clearanceCode: "PAD_TO_VIA_CLEARANCE",
        sideA: pSide,
        sideB: viaSide(vg),
        label: "pad and via",
      });
    }
  }

  // --- null-net bridges (contract 06 §4) ---
  // Keyed order, not visit order: which pair first touched an unassigned item
  // depends on the input arrays, and nothing downstream may.
  for (const key of [...bridges.keys()].sort()) {
    const { side, nets } = bridges.get(key)!;
    if (nets.size < 2) continue;
    const netIds = [...nets].sort();
    out.push({
      code: "NET_SHORT_CIRCUIT",
      message: `Short circuit: unassigned ${side.noun} bridges nets ${netList(
        netIds.map((netId) => ctx.netNames[netId] ?? netId),
      )}`,
      anchors: [
        side.anchor,
        ...netIds.map((netId): DrcAnchor => ({ kind: "net", netId })),
      ],
      locationMm: side.marker,
      ...(side.layer ? { layer: side.layer } : {}),
      // The bridge IS the contact — the gap that recorded it was ≤ SHORT_EPS.
      measuredMm: 0,
    });
  }

  return out;
}
