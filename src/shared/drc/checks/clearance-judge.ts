// The per-pair bodies of the copper clearance check (live-parity contract 07
// §2 D3). `checks/clearance.ts` keeps the six batch loops and calls these;
// `judgeCopperPairs` enumerates pending × board pairs and calls the SAME ones,
// so a route's verdict, orientation, tier, marker and message are batch's by
// construction rather than by discipline.

import type {
  DrcAnchor,
  DrcRuleCode,
  DrcSeverity,
  PcbCopperLayerId,
  PcbDrcRule,
  PcbPointMm,
} from "../../../sdks/designer";
import { splitSegmentAtRings } from "../../pcb-geometry/region-rings";
import type {
  ClearanceItem,
  ResolvedValue,
  RuleResolver,
  VoltageTerm,
} from "../rule-resolver";
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
  fabMinClearanceMm,
  type DrcPad,
  type DrcTrace,
  type DrcViaGeom,
  type LegalityContext,
} from "../drc-context";
import { ruleSuffix } from "../rule-message";
import { DEFAULT_SEVERITY_BY_CODE, severityRank } from "../severity";
import type { DrcViolationDraft } from "../types";
import { anchorKey } from "../violation-id";

import {
  below,
  clearanceViolated,
  GEOM_EPS_MM,
  SHORT_EPS_MM,
} from "../../pcb-geometry/tolerance";

type Segment = { a: PcbPointMm; b: PcbPointMm };

/** The three copper item arrays a pair enumeration draws from. */
export interface ItemSet {
  traces: readonly DrcTrace[];
  pads: readonly DrcPad[];
  vias: readonly DrcViaGeom[];
}

export function sameNet(a: string | null, b: string | null): boolean {
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
export interface PairSide {
  anchor: DrcAnchor;
  marker: PcbPointMm;
  layer?: PcbCopperLayerId;
  noun: "trace" | "pad" | "via";
}

/** A null-net item (by anchor key) and the known nets its copper touches. */
export interface BridgeEntry {
  side: PairSide;
  nets: Set<string>;
}

export type BridgeMap = Map<string, BridgeEntry>;

/** "A and B", "A, B and C" — net NAMES, falling back to the id. */
export function netList(names: readonly string[]): string {
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
export function orient<T>(
  a: T,
  b: T,
  anchorA: DrcAnchor,
  anchorB: DrcAnchor,
): [T, T] {
  return anchorKey(anchorA) > anchorKey(anchorB) ? [b, a] : [a, b];
}

export function traceSide(t: DrcTrace): PairSide {
  return {
    anchor: { kind: "trace", traceId: t.id },
    marker: t.mid,
    layer: t.layer,
    noun: "trace",
  };
}

export function padSide(p: DrcPad): PairSide {
  return { anchor: p.anchor, marker: p.center, noun: "pad" };
}

export function viaSide(v: DrcViaGeom): PairSide {
  return {
    anchor: { kind: "via", viaId: v.via.id },
    marker: v.center,
    noun: "via",
  };
}

/**
 * One pad number can be several copper shapes with ONE anchor: the shape whose
 * marker sorts first (x, then y) represents the pin, so the draft's location
 * and id cannot follow the footprint's shape order (R1 #6).
 */
export function markerBefore(a: PcbPointMm, b: PcbPointMm): boolean {
  return a.x !== b.x ? a.x < b.x : a.y < b.y;
}

/**
 * One evaluated spot on a pair: a gap, the requirement that holds THERE, and
 * the rule that set it. With no area rules a pair has exactly one candidate
 * and everything below degenerates to the pre-S6 single comparison.
 */
interface Candidate {
  gap: number;
  /**
   * The ORDINARY constituent — `resolved.ordinaryMm` (electrical contract 13
   * §3.1). Named `required` because it is what every pre-S13 path compared
   * against, and those rows stay byte-identical.
   */
  required: number;
  rule: PcbDrcRule | null;
  /** Both constituents, as the resolver returned them for this spot. */
  resolved: ResolvedValue;
  location: PcbPointMm;
  layer: PcbCopperLayerId;
}

interface PairVerdict {
  /** Smallest gap anywhere on the pair — the short and fab tiers use it. */
  minGap: number;
  minRequired: number;
  minLocation: PcbPointMm;
  minLayer: PcbCopperLayerId;
  /** The reported ORDINARY breach, or null when every candidate clears. */
  breach: {
    gap: number;
    /** The value reported and compared against; see `summarize`. */
    resolved: ResolvedValue;
    location: PcbPointMm;
    layer: PcbCopperLayerId;
    ruleSeverity: DrcSeverity;
  } | null;
  /**
   * The IPC-2221 breach, aggregated INDEPENDENTLY of the ordinary one (§3.3):
   * its own row, its own id, its own waiver. A pair below both requirements
   * reports two rows, and waiving one never hides the other reason.
   */
  voltageBreach: {
    gap: number;
    voltage: VoltageTerm;
    location: PcbPointMm;
    layer: PcbCopperLayerId;
  } | null;
}

/** The two constituents a witness can be ranked on (electrical contract §3.3). */
const ordinaryOf = (c: Candidate): number => c.required;
const voltageOf = (c: Candidate): number => c.resolved.voltage!.mm;

/**
 * Total order on witnesses (Astra R2 #1). The largest deficit wins, but a tie
 * on the deficit used to keep the FIRST candidate in candidate order — and
 * candidate order is `segmentsOf(u) × segmentsOf(v)`, which follows the
 * canonical orientation, which follows the two items' IDS. A pending trace
 * whose two ends sit in two different area rules (0.5 mm at a 0.25 mm gap,
 * 0.75 mm at a 0.5 mm gap: equal deficits) therefore reported a different
 * `(measured, required, message)` depending on what the caller had named it.
 *
 * The tie-breaks are properties of the geometry alone: the stricter
 * requirement, then the tighter gap, then the smaller marker.
 */
function betterWitness(
  c: Candidate,
  best: Candidate,
  requiredOf: (x: Candidate) => number = ordinaryOf,
): boolean {
  const rc = requiredOf(c);
  const rb = requiredOf(best);
  const dc = rc - c.gap;
  const db = rb - best.gap;
  if (dc !== db) return dc > db;
  if (rc !== rb) return rc > rb;
  if (c.gap !== best.gap) return c.gap < best.gap;
  if (c.location.x !== best.location.x) return c.location.x < best.location.x;
  return c.location.y < best.location.y;
}

/**
 * Reduce a pair's candidates to one verdict.
 *
 * `spatial` picks the witness with the largest deficit (contract §4.4), ties
 * broken by `betterWitness` — a property of the geometry, never of candidate
 * order — and reports THAT witness's requirement. `layered` is the multi-layer
 * aggregate (§4.3): the geometry is one gap, so the reported layer is the first
 * violated one in STACKUP order (`sharedLayers` is a stackup-ordered
 * intersection whichever way the pair is passed, so it carries no id
 * dependence) and the requirement is the largest over every violated layer.
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
  let witness: Candidate | null = null; // largest deficit (total order below)
  let severity: DrcSeverity | null = null;
  for (const c of candidates) {
    if (!clearanceViolated(c.gap, c.required)) continue;
    const s = c.rule?.severity ?? DEFAULT_SEVERITY_BY_CODE[code];
    severity =
      severity === null || severityRank(s) > severityRank(severity) ? s : severity;
    if (first === null) first = c;
    if (strictest === null || c.required > strictest.required) strictest = c;
    if (witness === null || betterWitness(c, witness)) witness = c;
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
            resolved: {
              ...value.resolved,
              mm: value.required,
              rule: value.rule,
            },
            location: reported.location,
            layer: reported.layer,
            ruleSeverity: severity,
          },
    voltageBreach: summarizeVoltage(candidates, mode),
  };
}

/**
 * The IPC-2221 constituent's own aggregate (13 §3.3).
 *
 * `spatial` is the ordinary rule: the largest-deficit witness, ties broken by
 * `betterWitness` on the VOLTAGE deficit. `layered` is the pre-S13
 * `strictestSpacing` rule verbatim — the FIRST layer in stackup order attaining
 * the largest requirement, whether or not a looser layer is violated too — so
 * every pre-S13 `CREEPAGE_DISTANCE` id, which hashes the layer, is preserved
 * (Astra run 1 #11). A layered pair is ONE gap, so "strictest attained" and
 * "strictest violated" pick the same candidate; taking the strictest before the
 * comparison is what keeps the reported layer the pre-S13 one.
 */
function summarizeVoltage(
  candidates: readonly Candidate[],
  mode: "spatial" | "layered",
): PairVerdict["voltageBreach"] {
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (c.resolved.voltage === null) continue;
    if (mode === "layered") {
      if (best === null || voltageOf(c) > voltageOf(best)) best = c;
      continue;
    }
    if (!clearanceViolated(c.gap, voltageOf(c))) continue;
    if (best === null || betterWitness(c, best, voltageOf)) best = c;
  }
  if (best === null) return null;
  if (mode === "layered" && !clearanceViolated(best.gap, voltageOf(best))) {
    return null;
  }
  return {
    gap: best.gap,
    voltage: best.resolved.voltage!,
    location: best.location,
    layer: best.layer,
  };
}

/**
 * The `CREEPAGE_DISTANCE` draft for one pair's IPC-2221 constituent (13 §3.3,
 * §7). Its id is the unchanged pre-S13 derivation — code + SORTED anchors +
 * layer, never location-hashed — so a row that existed before the migration
 * keeps its id, its waiver and its severity override.
 */
function voltageDraft(
  anchors: readonly DrcAnchor[],
  breach: NonNullable<PairVerdict["voltageBreach"]>,
): DrcViolationDraft {
  const { voltage } = breach;
  // The exposure DECISION, not just its outcome (§7): on a coated board the
  // column is whichever exposure chose, so both readings name the reason. An
  // uncoated board had no decision to make and keeps the bare column.
  const coating =
    voltage.column === "B4"
      ? ", coated per design rule"
      : voltage.coated && voltage.column === "B2"
        ? ", exposed conductor"
        : "";
  const assumed = voltage.undeclared
    ? "; undeclared net assumed at reference"
    : "";
  return {
    code: "CREEPAGE_DISTANCE",
    message: `IPC-2221 spacing ${breach.gap.toFixed(3)} mm is below ${voltage.mm.toFixed(3)} mm for ${voltage.diffV.toFixed(0)} V (${voltage.column}${coating})${assumed}`,
    anchors: [...anchors],
    locationMm: breach.location,
    layer: breach.layer,
    measuredMm: breach.gap,
    requiredMm: voltage.mm,
  };
}

/** The `NET_SHORT_CIRCUIT` draft for one bridged null-net item (contract 06 §4). */
export function bridgeDraft(
  netNames: Record<string, string>,
  side: PairSide,
  nets: ReadonlySet<string>,
): DrcViolationDraft {
  const netIds = [...nets].sort();
  return {
    code: "NET_SHORT_CIRCUIT",
    message: `Short circuit: unassigned ${side.noun} bridges nets ${netList(
      netIds.map((netId) => netNames[netId] ?? netId),
    )}`,
    anchors: [
      side.anchor,
      ...netIds.map((netId): DrcAnchor => ({ kind: "net", netId })),
    ],
    locationMm: side.marker,
    ...(side.layer ? { layer: side.layer } : {}),
    // The bridge IS the contact — the gap that recorded it was ≤ SHORT_EPS.
    measuredMm: 0,
  };
}

/** The six per-pair bodies, plus the broad-phase test and the bridge ledger. */
export interface PairJudge {
  traceTrace(a: DrcTrace, b: DrcTrace): void;
  tracePad(t: DrcTrace, pad: DrcPad): void;
  traceVia(t: DrcTrace, vg: DrcViaGeom): void;
  viaVia(a: DrcViaGeom, b: DrcViaGeom): void;
  padPad(a: DrcPad, b: DrcPad): void;
  padVia(pad: DrcPad, vg: DrcViaGeom): void;
  /** `clearanceBound` is an upper bound of any resolvable value for the pair. */
  farApart(
    boundsA: DrcTrace["bounds"],
    boundsB: DrcTrace["bounds"],
    pairKind: Parameters<RuleResolver["clearanceBound"]>[0],
    netA: string | null,
    netB: string | null,
  ): boolean;
  /** Null-net item key → the known nets its copper touches. */
  bridges: BridgeMap;
  /** Emit one `NET_SHORT_CIRCUIT` per bridged item, in sorted key order. */
  flushBridges(filter?: (key: string, entry: BridgeEntry) => boolean): void;
}

export interface PairJudgeOptions {
  /** Shared ledger, so a second (completion) pass adds to the same sets. */
  bridges?: BridgeMap;
  /** Record bridges but emit nothing — the board-side completion pass (07 §4). */
  recordOnly?: boolean;
}

/**
 * Copper clearance + short detection for every copper pair kind on shared
 * layers (different nets). One geometric pass yields three ORDINARY TIERS per
 * pair, in this order — the first that fires is the only one of the three that
 * reports:
 *   gap ≤ SHORT_EPS (different known nets) → NET_SHORT_CIRCUIT (error)
 *   clearanceViolated(gap, required)       → <pair>_CLEARANCE  (error)
 *   below(gap, fabMin)                     → FAB_CLEARANCE     (warning)
 *
 * …plus, BESIDE whichever of the three fired, the IPC-2221 spacing CONSTITUENT
 * (electrical contract 13 §3.3): `CREEPAGE_DISTANCE`, aggregated independently,
 * with its own id, waiver and severity. A pair below both requirements reports
 * two rows, so waiving one never hides the other reason.
 *
 * Pads of ONE placement run the SHORT tier only (batch-DRC contract 06 §4):
 * spacing inside a footprint is the library's business, but a different-net
 * overlap inside one is a dead short on the finished board — symmetric with the
 * hole↔hole rule, which likewise keeps overlapping drills of one footprint. The
 * voltage constituent is the BOARD's business, so it applies there too, and it
 * is the one tier an inexact (`custom` / `trapezoid`) intra-footprint pair gets
 * at all — on the bounding rectangle, a declared superset (13 §3.3).
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
 * null-net items are the effective-net components' business (13 §4.3), emitted
 * by `checks/chain-short.ts` after both enumerations.
 */
export function createPairJudge(
  ctx: LegalityContext,
  out: DrcViolationDraft[],
  opts: PairJudgeOptions = {},
): PairJudge {
  const resolver = ctx.resolver;
  const fabMin = fabMinClearanceMm(ctx.fabricator);
  const bridges: BridgeMap = opts.bridges ?? new Map();
  const recordOnly = opts.recordOnly === true;

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
    /** The two TIER nets (13 §4.2) — `ctx.tierNetOf` of the two items. */
    tierA: string | null;
    tierB: string | null;
    verdict: PairVerdict;
    clearanceCode: DrcRuleCode;
    sideA: PairSide;
    sideB: PairSide;
    label: string;
    /**
     * Pads of one placement: the short tier is the only ORDINARY one that
     * applies. The IPC-2221 constituent applies regardless (13 §3.3).
     */
    shortTierOnly?: boolean;
  }): void => {
    const { verdict, netA, netB } = params;
    const anchors: DrcAnchor[] = [params.sideA.anchor, params.sideB.anchor];
    const touching = verdict.minGap <= SHORT_EPS_MM;
    // UNASSIGNED copper that TOUCHES other copper is an EXTENSION of it
    // (connectivity contract 01 §2, batch-DRC 06 §4), and a conductor cannot
    // violate clearance with the copper it is part of. So a touching pair with
    // an unassigned side reports NOTHING pairwise — no clearance tier, no fab
    // tier — whichever the other side is:
    //   · both unassigned  → one net-less conductor (a route's own via on its
    //     own runs); nothing to bank either, there is no net to bank.
    //   · one named        → the extension case: the touch is BANKED against
    //     the unassigned item, and the bridge pass turns two or more distinct
    //     banked nets into the one `NET_SHORT_CIRCUIT` that is the real fault.
    // Unassigned copper that is merely CLOSE (0 < gap < required) is still
    // judged: two separated pieces may well be two conductors.
    if (touching && (netA === null || netB === null)) {
      if (netA === null && netB !== null) recordBridge(params.sideA, netB);
      else if (netB === null && netA !== null) recordBridge(params.sideB, netA);
      return;
    }
    // SAME TIER NET (electrical contract 13 §4.2): unassigned copper that
    // extends a conductor IS that conductor, and a conductor has no clearance
    // — and no fabricator minimum — against itself. This is the false FAIL
    // B7-1 registered: a null trace merely close to other copper of the net it
    // extends used to report against it at the null tier.
    //
    // Placed AFTER the touch branch and before every other tier, exactly where
    // it can suppress no short: the short tier reads the ORIGINAL nets, and two
    // items with one non-null tier are either (null, named) or (null, null) —
    // `differentKnownNet` is false for both, so there was no short to hide.
    if (params.tierA !== null && params.tierA === params.tierB) return;
    if (recordOnly) return;
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
      // A short suppresses the ordinary clearance tier — it is the same
      // requirement, reported once — but NOT the IPC-2221 one: the pre-S13
      // check ran on its own pass and reported both, and a dead short between
      // two 230 V conductors is still an IPC-2221 breach.
      if (verdict.voltageBreach) {
        out.push(voltageDraft(anchors, verdict.voltageBreach));
      }
      return;
    }
    // Pads of ONE placement run the SHORT tier only — but the IPC-2221
    // constituent is the BOARD's business, not the library's, so it applies
    // inside a footprint too (§3.3).
    if (!params.shortTierOnly) {
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
    }
    // The second CONSTITUENT, always beside the first (§3.3): one row per
    // reason, so a waiver of the clearance row cannot hide the IPC breach.
    if (verdict.voltageBreach) {
      out.push(voltageDraft(anchors, verdict.voltageBreach));
    }
  };

  // A trace whose AABB cannot reach any area polygon has a constant (zero)
  // area mask, so it never needs splitting; the cost of §4.4 is confined to
  // the pairs that actually meet an area (§13, Astra run 1 #15).
  //
  // Keyed by OBJECT, not id: a pending trace legitimately reuses the id of the
  // board trace it replaces, and two different geometries must not share a
  // cached split (07 §2 D3).
  const splitCache = new Map<DrcTrace, Segment[]>();
  const needsSplit = (t: DrcTrace): boolean =>
    resolver.hasAreaRules && resolver.boundsMeetAnyArea(t.bounds);
  const segmentsOf = (t: DrcTrace): Segment[] => {
    const cached = splitCache.get(t);
    if (cached) return cached;
    const split = needsSplit(t);
    const segs: Segment[] = [];
    for (let i = 1; i < t.pointsMm.length; i += 1) {
      const p = t.pointsMm[i - 1]!;
      const q = t.pointsMm[i]!;
      if (!split) segs.push({ a: p, b: q });
      else for (const s of splitSegmentAtRings(p, q, resolver.areaRings)) segs.push(s);
    }
    splitCache.set(t, segs);
    return segs;
  };
  const item = (
    netId: string | null,
    pointMm: PcbPointMm,
    exposed: boolean,
  ): ClearanceItem => ({ netId, pointMm, exposed });

  /** One side of a layered pair, before the per-LAYER exposure is resolved. */
  interface LayeredSide {
    item: DrcPad | DrcViaGeom;
    netId: string | null;
    point: PcbPointMm;
  }

  /**
   * Pad↔pad, pad↔via and via↔via share one geometric gap across every shared
   * layer; only the RULE — and, since S13, the IPC-2221 column, which depends
   * on the face and on each item's exposure there (13 §1.2) — can vary per
   * layer, so they resolve on each shared layer in stackup order and aggregate
   * (§4.3).
   */
  const layered = (
    pairKind: Parameters<RuleResolver["clearance"]>[0],
    code: DrcRuleCode,
    sharedLayers: readonly PcbCopperLayerId[],
    g: PairGap,
    a: LayeredSide,
    b: LayeredSide,
  ): PairVerdict => {
    const candidates: Candidate[] = sharedLayers.map((layer) => {
      const r: ResolvedValue = resolver.clearance(
        pairKind,
        layer,
        item(a.netId, a.point, ctx.exposedOn(a.item, layer)),
        item(b.netId, b.point, ctx.exposedOn(b.item, layer)),
      );
      return {
        gap: g.gap,
        required: r.ordinaryMm,
        rule: r.rule,
        resolved: r,
        location: g.location,
        layer,
      };
    });
    return summarize(code, candidates, "layered");
  };

  return {
    traceTrace(a, b) {
      if (ctx.stats) ctx.stats.pairsJudged.traceToTrace += 1;
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
      // Every resolution site takes the TIER net (13 §4.2); `emit` below keeps
      // the originals for the touch branch, the short tier and the bridge.
      const tierU = ctx.tierNetOf(u);
      const tierV = ctx.tierNetOf(v);
      // A trace lives on ONE layer, so its exposure there is one lookup.
      const exposedU = ctx.exposedOn(u, u.layer);
      const exposedV = ctx.exposedOn(v, u.layer);

      const candidates: Candidate[] = [];
      if (!needsSplit(u) && !needsSplit(v)) {
        // Fast path: the mask is 0 over both traces, so one resolution at the
        // representative points is exact — byte-identical to the pre-S6 pass.
        const g = traceTraceGap(u, v);
        const r = resolver.clearance(
          "traceToTrace",
          u.layer,
          item(tierU, u.mid, exposedU),
          item(tierV, v.mid, exposedV),
        );
        candidates.push({
          gap: g.gap,
          required: r.ordinaryMm,
          rule: r.rule,
          resolved: r,
          location: g.location,
          layer: u.layer,
        });
      } else {
        for (const su of segmentsOf(u)) {
          const pu = item(tierU, midpoint(su.a, su.b), exposedU);
          for (const sv of segmentsOf(v)) {
            const r = resolver.clearance(
              "traceToTrace",
              u.layer,
              pu,
              item(tierV, midpoint(sv.a, sv.b), exposedV),
            );
            const g = segmentSegmentGap(su.a, su.b, sv.a, sv.b, half);
            candidates.push({
              gap: g.gap,
              required: r.ordinaryMm,
              rule: r.rule,
              resolved: r,
              location: g.location,
              layer: u.layer,
            });
          }
        }
      }
      if (candidates.length === 0) return;
      emit({
        netA: u.netId,
        netB: v.netId,
        tierA: tierU,
        tierB: tierV,
        verdict: summarize("TRACE_TO_TRACE_CLEARANCE", candidates, "spatial"),
        clearanceCode: "TRACE_TO_TRACE_CLEARANCE",
        sideA: traceSide(u),
        sideB: traceSide(v),
        label: "two traces",
      });
    },

    tracePad(t, pad) {
      if (ctx.stats) ctx.stats.pairsJudged.traceToPad += 1;
      const tierT = ctx.tierNetOf(t);
      const tierPad = ctx.tierNetOf(pad);
      // The pair is judged on the TRACE's layer, so both exposures are that
      // face's — one lookup each, whatever the pad's other layers do.
      const exposedT = ctx.exposedOn(t, t.layer);
      const padItem = item(tierPad, pad.center, ctx.exposedOn(pad, t.layer));
      const candidates: Candidate[] = [];
      if (!needsSplit(t) && !resolver.boundsMeetAnyArea(pad.bounds)) {
        const r = resolver.clearance(
          "traceToPad",
          t.layer,
          item(tierT, t.mid, exposedT),
          padItem,
        );
        const g = tracePadGap(t, pad);
        candidates.push({
          gap: g.gap,
          required: r.ordinaryMm,
          rule: r.rule,
          resolved: r,
          location: g.location,
          layer: t.layer,
        });
      } else {
        for (const s of segmentsOf(t)) {
          const r = resolver.clearance(
            "traceToPad",
            t.layer,
            item(tierT, midpoint(s.a, s.b), exposedT),
            padItem,
          );
          const g = segmentPadGap(s.a, s.b, t.halfWidthMm, pad);
          candidates.push({
            gap: g.gap,
            required: r.ordinaryMm,
            rule: r.rule,
            resolved: r,
            // The pad is one point of constant membership; its centre stays the
            // marker, so an area rule that changes no verdict changes no id.
            location: g.location,
            layer: t.layer,
          });
        }
      }
      if (candidates.length === 0) return;
      emit({
        netA: t.netId,
        netB: pad.netId,
        tierA: tierT,
        tierB: tierPad,
        verdict: summarize("TRACE_TO_PAD_CLEARANCE", candidates, "spatial"),
        clearanceCode: "TRACE_TO_PAD_CLEARANCE",
        sideA: traceSide(t),
        sideB: padSide(pad),
        label: "trace and pad",
      });
    },

    traceVia(t, vg) {
      if (ctx.stats) ctx.stats.pairsJudged.traceToVia += 1;
      const tierT = ctx.tierNetOf(t);
      const tierVia = ctx.tierNetOf(vg);
      const exposedT = ctx.exposedOn(t, t.layer);
      const viaItem = item(tierVia, vg.center, ctx.exposedOn(vg, t.layer));
      const candidates: Candidate[] = [];
      if (!needsSplit(t) && !resolver.boundsMeetAnyArea(vg.bounds)) {
        const r = resolver.clearance(
          "traceToVia",
          t.layer,
          item(tierT, t.mid, exposedT),
          viaItem,
        );
        const g = traceViaGap(t, vg);
        candidates.push({
          gap: g.gap,
          required: r.ordinaryMm,
          rule: r.rule,
          resolved: r,
          location: g.location,
          layer: t.layer,
        });
      } else {
        for (const s of segmentsOf(t)) {
          const r = resolver.clearance(
            "traceToVia",
            t.layer,
            item(tierT, midpoint(s.a, s.b), exposedT),
            viaItem,
          );
          const g = segmentViaGap(s.a, s.b, t.halfWidthMm, vg);
          candidates.push({
            gap: g.gap,
            required: r.ordinaryMm,
            rule: r.rule,
            resolved: r,
            location: g.location,
            layer: t.layer,
          });
        }
      }
      if (candidates.length === 0) return;
      emit({
        netA: t.netId,
        netB: vg.netId,
        tierA: tierT,
        tierB: tierVia,
        verdict: summarize("TRACE_TO_VIA_CLEARANCE", candidates, "spatial"),
        clearanceCode: "TRACE_TO_VIA_CLEARANCE",
        sideA: traceSide(t),
        sideB: viaSide(vg),
        label: "trace and via",
      });
    },

    viaVia(a, b) {
      if (ctx.stats) ctx.stats.pairsJudged.viaToVia += 1;
      const shared = a.layers.filter((l) => b.layers.includes(l));
      if (shared.length === 0) return;
      // Canonical orientation (§11), as trace↔trace already does: the item with
      // the smaller anchor key leads into BOTH the kernel and the resolver, so
      // reversing `ctx.vias` cannot move the gap, the marker or the requirement.
      const [u, v] = orient(
        a,
        b,
        { kind: "via", viaId: a.via.id },
        { kind: "via", viaId: b.via.id },
      );
      const tierU = ctx.tierNetOf(u);
      const tierV = ctx.tierNetOf(v);
      emit({
        netA: u.netId,
        netB: v.netId,
        tierA: tierU,
        tierB: tierV,
        verdict: layered(
          "viaToVia",
          "VIA_TO_VIA_CLEARANCE",
          shared,
          viaViaGap(u, v),
          { item: u, netId: tierU, point: u.center },
          { item: v, netId: tierV, point: v.center },
        ),
        clearanceCode: "VIA_TO_VIA_CLEARANCE",
        sideA: viaSide(u),
        sideB: viaSide(v),
        label: "two vias",
      });
    },

    padPad(a, b) {
      if (ctx.stats) ctx.stats.pairsJudged.padToPad += 1;
      const sameFootprint =
        a.anchor.kind === "pad" &&
        b.anchor.kind === "pad" &&
        a.anchor.placementId === b.anchor.placementId;
      const shared = a.layers.filter((l) => b.layers.includes(l));
      if (shared.length === 0) return;
      const [u, v] = orient(a, b, a.anchor, b.anchor);
      const tierU = ctx.tierNetOf(u);
      const tierV = ctx.tierNetOf(v);
      // A bounding-rectangle pad (`custom` / `trapezoid`) can "overlap" a
      // neighbour of its own footprint without any copper touching, and a
      // short is non-waivable — so such intra-footprint pairs stay unjudged
      // for the short, clearance and fab tiers, as before S7 (R1 #4).
      //
      // The IPC-2221 constituent DOES pass (13 §3.3): the bounding rectangle is
      // a declared SUPERSET of the pad, so a spacing verdict on it is the
      // false-fail direction, and dropping it would lose the pre-S13 coverage
      // of exactly these pads. Nothing else of the pair is reported, and the
      // gate is `hasVoltageTerms` so a board without voltages does no work.
      if (sameFootprint && !(a.exactShape && b.exactShape)) {
        if (recordOnly || !resolver.hasVoltageTerms) return;
        if (tierU !== null && tierU === tierV) return;
        const verdict = layered(
          "padToPad",
          "PAD_TO_PAD_CLEARANCE",
          shared,
          padPadGap(u, v),
          { item: u, netId: tierU, point: u.center },
          { item: v, netId: tierV, point: v.center },
        );
        if (verdict.voltageBreach) {
          out.push(
            voltageDraft([u.anchor, v.anchor], verdict.voltageBreach),
          );
        }
        return;
      }
      emit({
        netA: u.netId,
        netB: v.netId,
        tierA: tierU,
        tierB: tierV,
        verdict: layered(
          "padToPad",
          "PAD_TO_PAD_CLEARANCE",
          shared,
          padPadGap(u, v),
          { item: u, netId: tierU, point: u.center },
          { item: v, netId: tierV, point: v.center },
        ),
        clearanceCode: "PAD_TO_PAD_CLEARANCE",
        sideA: padSide(u),
        sideB: padSide(v),
        label: "two pads",
        ...(sameFootprint ? { shortTierOnly: true } : {}),
      });
    },

    padVia(pad, vg) {
      if (ctx.stats) ctx.stats.pairsJudged.padToVia += 1;
      // The pair is canonical BY CONSTRUCTION — the two sides have different
      // kinds, so `padViaGap` and the resolver always take the pad first
      // whatever order the arrays arrive in; there is nothing to sort. The via
      // has no dedicated rule, so the board floor reuses traceToViaMm.
      const shared = pad.layers.filter((l) => vg.layers.includes(l));
      if (shared.length === 0) return;
      const tierPad = ctx.tierNetOf(pad);
      const tierVia = ctx.tierNetOf(vg);
      emit({
        netA: pad.netId,
        netB: vg.netId,
        tierA: tierPad,
        tierB: tierVia,
        verdict: layered(
          "padToVia",
          "PAD_TO_VIA_CLEARANCE",
          shared,
          padViaGap(pad, vg),
          { item: pad, netId: tierPad, point: pad.center },
          { item: vg, netId: tierVia, point: vg.center },
        ),
        clearanceCode: "PAD_TO_VIA_CLEARANCE",
        sideA: padSide(pad),
        sideB: viaSide(vg),
        label: "pad and via",
      });
    },

    farApart(boundsA, boundsB, pairKind, netA, netB) {
      if (ctx.stats) ctx.stats.prefilterTests += 1;
      // The grace is what makes the prefilter CONSERVATIVE at the threshold
      // (Astra R2 #2). `aabbGap` is mathematically <= the true gap, but it is a
      // different float computation: two 0.2 mm traces exactly 200 100 nm apart
      // measure 9.9999999999993e-5 in the kernel (a short, <= SHORT_EPS) while
      // `aabbGap` lands on 1.00000000000655e-4 — a hair OVER the bound, so the
      // pair was skipped and neither batch nor the gate reported the short.
      // Half a nanometre of slack cannot admit a pair the exact tiers then
      // clear, and it costs nothing but a handful of extra kernel calls.
      //
      // A NULL side takes the board's widest clearance instead of the null
      // tier (13 §3.4): the net that judges such an item is its TIER net, a
      // per-ITEM fact this signature cannot carry — the six batch loops are the
      // frozen S9 oracle (08 §3) and pass the ORIGINAL nets. `maxClearanceBoundMm`
      // bounds every requirement any pair on this board can resolve to, and it
      // is already the halo the grid admitted the pair under, so the prefilter
      // stays conservative and drops no pair a tier would have judged.
      const bound =
        netA === null || netB === null
          ? ctx.maxClearanceBoundMm
          : resolver.clearanceBound(pairKind, netA, netB);
      return (
        aabbGap(boundsA, boundsB) >
        Math.max(bound, fabMin, SHORT_EPS_MM) + GEOM_EPS_MM
      );
    },

    bridges,

    flushBridges(filter) {
      // Keyed order, not visit order: which pair first touched an unassigned
      // item depends on the input arrays, and nothing downstream may.
      for (const key of [...bridges.keys()].sort()) {
        const entry = bridges.get(key)!;
        if (entry.nets.size < 2) continue;
        if (filter && !filter(key, entry)) continue;
        out.push(bridgeDraft(ctx.netNames, entry.side, entry.nets));
      }
    },
  };
}
