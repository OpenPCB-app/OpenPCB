/**
 * The ONE resolver from stored rules to the number a check compares against
 * (rule-semantics contract §3, §4, §5, §6). Batch DRC, the pour, live DRC and
 * the route obstacles all build one of these per projection; there is no
 * second clearance formula anywhere.
 *
 * Resolution (Altium-style first match, with a KiCad floor):
 *   1. Explicit tier — enabled, valid rules in ORDER (priority desc, array
 *      index asc); the FIRST whose scopes all match wins and CAN relax below
 *      the implicit tier.
 *   2. Implicit tier — max(board[pairKind], netClass(a), netClass(b)).
 *   3. Absolute floor — max(value, minimums.clearanceMm ?? 0).
 *
 * Scalar kinds share the shape with the board minimum as their floor, so a
 * scalar rule can only tighten (§5.1).
 */
import type {
  DrcPairKind,
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbDrcRule,
  PcbNetClass,
  PcbPointMm,
} from "../../sdks/designer";
import { resolveNetClassId } from "../pcb-areas/net-class-resolver";
import {
  discOverlapsRing,
  ringsOverlapPositiveArea,
  stadiumOverlapsRing,
} from "../pcb-geometry/area-overlap";
import { pointInPolygon, pointToRingEdgeDistance } from "../pcb-geometry/pcb-clearance-geometry";
import { boundsMeet, type RingBounds } from "../pcb-geometry/region-rings";
import { GEOM_EPS_MM } from "../pcb-geometry/tolerance";
import {
  boardClearanceByPairKind,
  boardMinimumFor,
  compileRuleSet,
  POUR_KINDS,
  type CompiledRule,
  type CompiledRuleSet,
  type RuleProblem,
  type ScalarRuleKind,
} from "./rule-compile";
import { buildVoltageModel, type VoltageTerm } from "./voltage-term";

export type { VoltageTerm } from "./voltage-term";

export {
  boardMinimumFor,
  copperToHoleClearanceMm,
  DEFAULT_HOLE_TO_HOLE_MM,
  DEFAULT_POUR_TO_COPPER_MM,
  MAX_AREA_POLYGONS,
  POUR_KINDS,
  SCALAR_RULE_KINDS,
  type RuleProblem,
  type RuleProblemReason,
  type ScalarRuleKind,
} from "./rule-compile";

/** One side of a clearance pair, at the point its area membership is judged. */
export interface ClearanceItem {
  netId: string | null;
  pointMm: PcbPointMm;
  /**
   * The item's copper is UNCOVERED on this pair's layer (electrical contract 13
   * §1.2): an exposed conductor is an uncoated one whatever the board-level
   * coating declaration says, so it forces the B2 column. Absent = not exposed.
   */
  exposed?: boolean;
}

/**
 * The non-pour side of a pour pair. A `pointMm` of `null` — and the whole
 * obstacle being `null` — mean "there is no evaluation point", which is the
 * zone–zone case (§6 rule 3): another zone's copper is wherever its fill ends
 * up, so `pourToPour` resolves with both masks 0 and is symmetric by
 * construction. `null` additionally drops the net (no second net to scope on).
 */
export type PourObstacle =
  | { netId: string | null; pointMm: PcbPointMm | null; exposed?: boolean }
  | null;

/**
 * The copper (or, for a drilled hole, the DRILL) an `area` scope is tested
 * against — a hole has no copper, so an area-scoped `holeToHole` rule must see
 * its drill disc or slot stadium (§4.2, Astra run 1 #5).
 */
export type ScalarGeometry =
  | { kind: "segment"; a: PcbPointMm; b: PcbPointMm; halfWidthMm: number }
  | {
      kind: "polyline";
      pointsMm: readonly PcbPointMm[];
      halfWidthMm: number;
    }
  | { kind: "ring"; ring: readonly PcbPointMm[] }
  | { kind: "disc"; center: PcbPointMm; radiusMm: number };

export interface ScalarItem {
  netId: string | null;
  /** Every copper layer the item occupies (§4.2 layer row). */
  layers: readonly PcbCopperLayerId[];
  geometry: ScalarGeometry;
}

/**
 * The number a check compares against, and the rule that set it — with the two
 * CONSTITUENTS it is the maximum of (electrical contract 13 §3.1). A consumer
 * that only sizes a halo reads `mm`; the pair judge reports each constituent as
 * its own row, with its own id, waiver and severity (§3.3).
 */
export interface ResolvedValue {
  /** `max(ordinaryMm, voltage?.mm ?? 0)`. */
  mm: number;
  rule: PcbDrcRule | null;
  /** `max(explicit-or-implicit rule value, floorMm)` — the pre-S13 `mm`. */
  ordinaryMm: number;
  /**
   * The IPC-2221 conductor spacing this pair's declared potentials require, or
   * `null` when neither side declares one. NOT RELAXABLE: an explicit scoped
   * rule sets `ordinaryMm` and can lower it below the implicit tier, but it is
   * outside this term's maximum (§3.1). There is no scoped constraint kind for
   * voltage — a board that wants a looser spacing changes the declared voltage,
   * which is visible in the data.
   */
  voltage: VoltageTerm | null;
}

export interface RuleResolver {
  netClassIdOf(netId: string | null): string;
  netClassClearanceMm(netId: string | null): number;
  clearance(
    pairKind: DrcPairKind,
    layer: PcbCopperLayerId,
    a: ClearanceItem,
    b: ClearanceItem,
  ): ResolvedValue;
  /**
   * Pour-side clearance (§6 rule 2): the max of the resolution with both masks
   * 0 and the resolution at the obstacle's point. An area RELAXATION around
   * the obstacle therefore never reaches a fill (the masks-0 term dominates),
   * while an area TIGHTENING widens the whole halo — conservative in both
   * directions, because a pour has no single evaluation point.
   *
   * An obstacle with no `pointMm` (or no obstacle at all) resolves with both
   * masks 0 and nothing else — the ZONE–ZONE form (§6 rule 3). It has to be a
   * separate case rather than "pass the other zone's centroid": a centroid is
   * not a point of the other zone's copper, and an area-scoped `pourToPour`
   * rule evaluated at one of the two centroids makes `c(Z, Z')` disagree with
   * `c(Z', Z)`.
   */
  clearancePour(
    pairKind: DrcPairKind,
    layer: PcbCopperLayerId,
    pourNetId: string | null,
    obstacle: PourObstacle,
  ): ResolvedValue;
  /** Upper bound of any value `clearance` can return for this pair (§4.4). */
  clearanceBound(
    pairKind: DrcPairKind,
    aNetId: string | null,
    bNetId: string | null,
  ): number;
  /**
   * The pair's clearance with every AREA mask 0 — the value `clearance`
   * returns anywhere outside every rule area. It is the SAME
   * `resolveWithMasks(..., 0, ..., 0)` term `clearancePour` already computes,
   * so there is no second resolution path: a `net` / `netClass` / `layer` /
   * `pairKind`-scoped rule is honoured in full (its scopes hold wherever the
   * route is), and only an `area` scope is dropped.
   *
   * The route obstacle builder needs it because it resolves a rect AT THE
   * OBSTACLE (live-parity contract 07 §5, Astra run 1 #4): an `area` rule that
   * relaxes the pair around the obstacle must not shrink the rect below what
   * the pair requires when the routed trace itself sits OUTSIDE that area. An
   * area TIGHTENING at the obstacle is larger and still wins.
   */
  clearanceOutsideAreas(
    pairKind: DrcPairKind,
    layer: PcbCopperLayerId,
    aNetId: string | null,
    bNetId: string | null,
    exposedA?: boolean,
    exposedB?: boolean,
  ): ResolvedValue;
  /**
   * The widest voltage term ANY declared class could impose against `netId` on
   * `layer` — the conservative bound a route whose own net is not yet assigned
   * resolves with (13 §3.2 c). The route walks farther than it might need,
   * never closer than it must. 0 when no class declares a potential.
   */
  maxVoltageTermMm(
    layer: PcbCopperLayerId,
    netId: string | null,
    exposed: boolean,
  ): number;
  /** Any class declares a potential; false ⇒ no pair carries the term (§2). */
  hasVoltageTerms: boolean;
  /**
   * Malformed ELECTRICAL input — a non-finite or inverted voltage interval, a
   * non-positive temperature rise or copper weight (§2). Same shape as
   * {@link problems}, reported by `checks/rules.ts` as `DRC_RULE_INVALID`; the
   * constituent each one feeds is absent for the run rather than assessed on
   * garbage.
   */
  electricalProblems: readonly RuleProblem[];
  scalar(kind: ScalarRuleKind, item: ScalarItem): ResolvedValue;
  /** `holeToHole` is the one scalar kind evaluated on a PAIR of items (§5.1). */
  scalarPair(
    kind: "holeToHole",
    a: ScalarItem,
    b: ScalarItem,
  ): ResolvedValue;
  /** Area bitmask of a single point, closed at GEOM_EPS_MM (§4.2). */
  areaMaskForPoint(p: PcbPointMm): number;
  /** False ⇒ no rule's area scope can reach this AABB; masks are 0 over it. */
  boundsMeetAnyArea(bounds: RingBounds): boolean;
  hasAreaRules: boolean;
  /** Canonicalised, CCW area polygons — the split lines of §4.4. */
  areaRings: readonly (readonly PcbPointMm[])[];
  problems: readonly RuleProblem[];
  floorMm: number;
  boardClearanceByPairKind: Record<DrcPairKind, number>;
}

export interface CreateRuleResolverOptions {
  /**
   * The stackup's copper layers, in order. REQUIRED: a consumer that forgets
   * the stackup would silently accept every `layer` scope as unknown-but-fine.
   */
  validCopperLayers: readonly PcbCopperLayerId[];
  /** Absent ⇒ no `unknown_net` problems are reported (§2.1). */
  knownNetIds?: ReadonlySet<string>;
}

export function createRuleResolver(
  board: PcbBoardSettings,
  netNames: Record<string, string>,
  opts: CreateRuleResolverOptions,
): RuleResolver {
  const compiled: CompiledRuleSet = compileRuleSet(board, opts);
  const boardClearance = boardClearanceByPairKind(board.designRules);
  const floorMm = board.designRules.minimums.clearanceMm ?? 0;
  const classById = new Map<string, PcbNetClass>(
    board.netClasses.map((c) => [c.id, c]),
  );

  const classIdByNet = new Map<string, string>();
  const netClassIdOf = (netId: string | null): string => {
    // A null net has no class: no scope matches it and it contributes 0 (§4.5).
    if (!netId) return "";
    const cached = classIdByNet.get(netId);
    if (cached !== undefined) return cached;
    const id = resolveNetClassId(
      netNames[netId] ?? "",
      board.netClasses,
      board.perNetClassAssignments,
      netId,
    );
    classIdByNet.set(netId, id);
    return id;
  };

  const clearanceByNet = new Map<string, number>();
  const netClassClearanceMm = (netId: string | null): number => {
    if (!netId) return 0;
    const cached = clearanceByNet.get(netId);
    if (cached !== undefined) return cached;
    const value = classById.get(netClassIdOf(netId))?.clearanceMm ?? 0;
    clearanceByNet.set(netId, value);
    return value;
  };

  const areaMaskForPoint = (p: PcbPointMm): number => {
    if (!compiled.hasAreaRules) return 0;
    let mask = 0;
    for (let i = 0; i < compiled.areaRings.length; i += 1) {
      const ring = compiled.areaRings[i]!;
      // Closed set at GEOM_EPS_MM (§4.2): a point ON the ring is inside.
      if (
        pointInPolygon(p, ring) ||
        pointToRingEdgeDistance(p, ring) <= GEOM_EPS_MM
      ) {
        mask |= 1 << i;
      }
    }
    return mask;
  };

  const areaMaskForGeometry = (geometry: ScalarGeometry): number => {
    if (!compiled.hasAreaRules) return 0;
    let mask = 0;
    for (let i = 0; i < compiled.areaRings.length; i += 1) {
      if (geometryOverlapsRing(geometry, compiled.areaRings[i]!)) mask |= 1 << i;
    }
    return mask;
  };

  /**
   * The implicit tier of a pair, unfloored (§4 step 2). The ONE expression
   * `resolveWithMasks` falls back to and `clearanceBound` maxes over, so the
   * fallback and the bound cannot drift.
   */
  const implicitTier = (
    pairKind: DrcPairKind,
    aNetId: string | null,
    bNetId: string | null,
  ): number =>
    Math.max(
      boardClearance[pairKind] ?? 0,
      netClassClearanceMm(aNetId),
      netClassClearanceMm(bNetId),
    );

  // The board's voltage model (13 §2), built once beside the rule table.
  const voltages = buildVoltageModel(board, netClassIdOf);

  const clearanceMemo = new Map<string, ResolvedValue>();
  const resolveWithMasks = (
    pairKind: DrcPairKind,
    layer: PcbCopperLayerId,
    aNetId: string | null,
    maskA: number,
    bNetId: string | null,
    maskB: number,
    exposedA = false,
    exposedB = false,
  ): ResolvedValue => {
    // Length-prefixed net ids keep the key INJECTIVE for any string a net id
    // can be: with a plain separator, ("x", "y z") and ("x y", "z") would
    // share one cached verdict, and this memo decides legality.
    //
    // Exposure enters the key ONLY on a coated board (§3.1): uncoated, the
    // outer column is B2 whatever the mask does, so the two bits alias nothing
    // and the key — and with it every pre-S13 board's cache — is unchanged.
    const key = `${pairKind}|${layer}|${netKey(aNetId)}${netKey(bNetId)}${maskA}|${maskB}${
      voltages.coated ? `|${exposedA ? 1 : 0}${exposedB ? 1 : 0}` : ""
    }`;
    const cached = clearanceMemo.get(key);
    if (cached !== undefined) return cached;
    const implicit = implicitTier(pairKind, aNetId, bNetId);
    const classA = netClassIdOf(aNetId);
    const classB = netClassIdOf(bNetId);
    const isPour = POUR_KINDS.has(pairKind);
    let explicit: CompiledRule | null = null;
    for (const rule of compiled.clearanceRules) {
      if (isPour) {
        // Only an explicitly pour-scoped rule reaches a pour (§6 rule 1).
        if (!rule.pairKindSet || !rule.pairKindSet.has(pairKind)) continue;
      } else if (rule.pairKindSet && !rule.pairKindSet.has(pairKind)) {
        continue;
      }
      if (rule.layerSet && !rule.layerSet.has(layer)) continue;
      if (rule.netIdSet && !eitherNetMatches(rule.netIdSet, aNetId, bNetId)) {
        continue;
      }
      if (
        rule.netClassIdSet &&
        !(rule.netClassIdSet.has(classA) || rule.netClassIdSet.has(classB))
      ) {
        continue;
      }
      // Both points inside the SAME one of the rule's polygons (§4.2).
      if (rule.areaBits && (maskA & maskB & rule.areaBits) === 0) continue;
      explicit = rule;
      break;
    }
    const value = explicit ? explicit.valueMm : implicit;
    const ordinaryMm = Math.max(value, floorMm);
    // OUTSIDE the `max(value, floorMm)` step on purpose (§3.1): an explicit
    // scoped rule may relax the ordinary value below the implicit tier, but
    // never below the IPC-2221 table.
    const voltage = voltages.termFor(layer, aNetId, bNetId, exposedA, exposedB);
    const resolved: ResolvedValue = {
      mm: Math.max(ordinaryMm, voltage?.mm ?? 0),
      // A clamped rule still SET the value — it matched first and shadowed
      // everything below it, so its severity is the one that applies (§2.1).
      rule: explicit ? explicit.rule : null,
      ordinaryMm,
      voltage,
    };
    clearanceMemo.set(key, resolved);
    return resolved;
  };

  const clearance = (
    pairKind: DrcPairKind,
    layer: PcbCopperLayerId,
    a: ClearanceItem,
    b: ClearanceItem,
  ): ResolvedValue =>
    resolveWithMasks(
      pairKind,
      layer,
      a.netId,
      areaMaskForPoint(a.pointMm),
      b.netId,
      areaMaskForPoint(b.pointMm),
      a.exposed === true,
      b.exposed === true,
    );

  const resolveScalar = (
    kind: ScalarRuleKind,
    match: (rule: CompiledRule) => boolean,
  ): ResolvedValue => {
    const boardMin = boardMinimumFor(kind, board.designRules);
    // A scalar minimum is a DIMENSION, never a spacing between two conductors:
    // it carries no voltage constituent, so `ordinaryMm` IS `mm`.
    for (const rule of compiled.scalarRules[kind]) {
      if (!match(rule)) continue;
      const mm = Math.max(rule.valueMm, boardMin);
      return { mm, rule: rule.rule, ordinaryMm: mm, voltage: null };
    }
    return { mm: boardMin, rule: null, ordinaryMm: boardMin, voltage: null };
  };

  const scalar = (kind: ScalarRuleKind, item: ScalarItem): ResolvedValue => {
    const classId = netClassIdOf(item.netId);
    let itemMask: number | null = null;
    return resolveScalar(kind, (rule) => {
      if (rule.netIdSet && !(item.netId !== null && rule.netIdSet.has(item.netId))) {
        return false;
      }
      if (rule.netClassIdSet && !rule.netClassIdSet.has(classId)) return false;
      if (rule.layerSet && !item.layers.some((l) => rule.layerSet!.has(l))) {
        return false;
      }
      if (rule.areaBits) {
        if (itemMask === null) itemMask = areaMaskForGeometry(item.geometry);
        if ((itemMask & rule.areaBits) === 0) return false;
      }
      return true;
    });
  };

  const scalarPair = (
    kind: "holeToHole",
    a: ScalarItem,
    b: ScalarItem,
  ): ResolvedValue => {
    const classA = netClassIdOf(a.netId);
    const classB = netClassIdOf(b.netId);
    let maskA: number | null = null;
    let maskB: number | null = null;
    return resolveScalar(kind, (rule) => {
      if (rule.netIdSet && !eitherNetMatches(rule.netIdSet, a.netId, b.netId)) {
        return false;
      }
      if (
        rule.netClassIdSet &&
        !(rule.netClassIdSet.has(classA) || rule.netClassIdSet.has(classB))
      ) {
        return false;
      }
      if (
        rule.layerSet &&
        !a.layers.some((l) => rule.layerSet!.has(l)) &&
        !b.layers.some((l) => rule.layerSet!.has(l))
      ) {
        return false;
      }
      // `area` needs BOTH holes, in the same one of the rule's polygons (§5.1).
      if (rule.areaBits) {
        if (maskA === null) maskA = areaMaskForGeometry(a.geometry);
        if (maskB === null) maskB = areaMaskForGeometry(b.geometry);
        if ((maskA & maskB & rule.areaBits) === 0) return false;
      }
      return true;
    });
  };

  return {
    netClassIdOf,
    netClassClearanceMm,
    clearance,
    clearancePour(pairKind, layer, pourNetId, obstacle) {
      const obstacleNetId = obstacle ? obstacle.netId : null;
      // The POUR side carries no exposure of its own: the obstacle's is
      // conservative already (13 §3.2 — the fill input has no mask model), and
      // one exposed side is all the B2 column needs.
      const exposed = obstacle?.exposed === true;
      const unmasked = resolveWithMasks(
        pairKind,
        layer,
        pourNetId,
        0,
        obstacleNetId,
        0,
        false,
        exposed,
      );
      // No evaluation point ⇒ masks 0 is the whole answer (§6 rule 3).
      if (!obstacle || obstacle.pointMm === null) return unmasked;
      if (!compiled.hasAreaRules) return unmasked;
      const mask = areaMaskForPoint(obstacle.pointMm);
      if (mask === 0) return unmasked;
      const atObstacle = resolveWithMasks(
        pairKind,
        layer,
        pourNetId,
        mask,
        obstacleNetId,
        mask,
        false,
        exposed,
      );
      return atObstacle.mm > unmasked.mm ? atObstacle : unmasked;
    },
    clearanceBound(pairKind, aNetId, bNetId) {
      // B2 is the widest column ANY layer this pair can share admits (B1 and B4
      // are ≤ B2 row by row), so one lookup bounds the constituent whatever the
      // layer and the exposure turn out to be (13 §3.4). Without it every HV
      // pair wider than the ordinary bound is dropped before resolution.
      const voltage = voltages.termFor("F.Cu", aNetId, bNetId, true, true);
      return Math.max(
        implicitTier(pairKind, aNetId, bNetId),
        compiled.maxClearanceRuleMm,
        floorMm,
        voltage?.mm ?? 0,
      );
    },
    clearanceOutsideAreas(pairKind, layer, aNetId, bNetId, exposedA, exposedB) {
      return resolveWithMasks(
        pairKind,
        layer,
        aNetId,
        0,
        bNetId,
        0,
        exposedA === true,
        exposedB === true,
      );
    },
    maxVoltageTermMm: voltages.widestTermAgainstMm,
    hasVoltageTerms: voltages.hasDeclaredVoltage,
    electricalProblems: voltages.problems,
    scalar,
    scalarPair,
    areaMaskForPoint,
    boundsMeetAnyArea(bounds) {
      if (!compiled.hasAreaRules) return false;
      return compiled.areaBounds.some((b) => boundsMeet(bounds, b, GEOM_EPS_MM));
    },
    hasAreaRules: compiled.hasAreaRules,
    areaRings: compiled.areaRings,
    problems: compiled.problems,
    floorMm,
    boardClearanceByPairKind: boardClearance,
  };
}

/** Injective key fragment for a nullable net id (see the memo key above). */
function netKey(netId: string | null): string {
  return netId === null ? "-|" : `${netId.length}:${netId}|`;
}

/** `net` / `netClass` scopes are one-sided: EITHER item may satisfy (§4.2). */
function eitherNetMatches(
  set: ReadonlySet<string>,
  a: string | null,
  b: string | null,
): boolean {
  return (a !== null && set.has(a)) || (b !== null && set.has(b));
}

/** Open-interior overlap of a scalar item's geometry with an area polygon. */
function geometryOverlapsRing(
  geometry: ScalarGeometry,
  ring: readonly PcbPointMm[],
): boolean {
  switch (geometry.kind) {
    case "segment":
      return stadiumOverlapsRing(
        [geometry.a, geometry.b],
        geometry.halfWidthMm,
        ring,
      );
    case "polyline":
      return stadiumOverlapsRing(
        geometry.pointsMm,
        geometry.halfWidthMm,
        ring,
      );
    case "ring":
      return ringsOverlapPositiveArea(geometry.ring, ring);
    case "disc":
      return discOverlapsRing(geometry.center, geometry.radiusMm, ring);
  }
}
