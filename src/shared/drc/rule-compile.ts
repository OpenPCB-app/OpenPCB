/**
 * Compilation and validity of the stored DRC rule table (rule-semantics
 * contract §2.1, §4.2, §4.6, §5.1). Pure: board settings in, a compiled rule
 * set plus the list of everything that could not be applied out.
 *
 * Two passes, and the order of each matters:
 *   1. ARRAY order — structural validity, scope shapes, unknown references and
 *      clamped values. This is the order `problems` is reported in (§11).
 *   2. ORDER (priority desc, array index asc) — area-polygon registration, so
 *      the 31 usable mask bits are handed out to the rules that resolve first
 *      and the 32nd distinct polygon invalidates its own rule instead of
 *      silently turning it global.
 */
import type {
  DrcPairKind,
  DrcRuleConstraint,
  DrcRuleScope,
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbDrcRule,
  PcbPointMm,
} from "../../sdks/designer";
import {
  boundsOfPoints,
  type RingBounds,
} from "../pcb-geometry/region-rings";
import {
  canonicalizeRing,
  DEGENERATE_AREA_MM2,
  ensureCcwRing,
  ringSignedArea,
} from "../pcb-geometry/ring-utils";
import { ringSelfIntersects } from "../pcb-geometry/segment-predicates";
import { below } from "../pcb-geometry/tolerance";

/** Every constraint kind that is not a pair clearance (contract §1). */
export type ScalarRuleKind = Exclude<DrcRuleConstraint["kind"], "clearance">;

export const SCALAR_RULE_KINDS: readonly ScalarRuleKind[] = [
  "trackWidth",
  "viaDiameter",
  "viaDrill",
  "annularRing",
  "holeToHole",
  "edgeClearance",
];

export const ALL_PAIR_KINDS: readonly DrcPairKind[] = [
  "traceToTrace",
  "traceToPad",
  "traceToVia",
  "padToPad",
  "padToVia",
  "viaToVia",
  "pourToTrace",
  "pourToPad",
  "pourToVia",
  "pourToPour",
];

/**
 * The pair kinds with a copper pour on one side. A scoped rule reaches one of
 * these ONLY through an explicit `pairKind` scope naming it (contract §6 rule
 * 1), so no rule written before S6 can change a fill.
 */
export const POUR_KINDS: ReadonlySet<DrcPairKind> = new Set<DrcPairKind>([
  "pourToTrace",
  "pourToPad",
  "pourToVia",
  "pourToPour",
]);

/** Pour clearance against foreign copper when the board omits the field (§6). */
export const DEFAULT_POUR_TO_COPPER_MM = 0.5;

/**
 * Copper-to-non-plated-drill clearance (mm): ONE value for DRC's
 * `COPPER_TO_HOLE` and the pour's NPTH halo, so the report and the artwork
 * agree by construction. No scoped rule reaches it — there is no hole pair kind
 * yet (S11) — so this is a board-field read, not a resolver path.
 */
export function copperToHoleClearanceMm(rules: PcbDesignRules): number {
  return rules.clearance.copperToHoleMm ?? rules.clearance.copperToBoardEdgeMm;
}

/** Board default for `minimums.holeToHoleMm` (§5.1). */
export const DEFAULT_HOLE_TO_HOLE_MM = 0.25;

/**
 * Usable area-mask bits. The mask is a JS number used with `&` / `|`, which
 * operate on int32 — bit 31 is the sign bit, so only 0..30 are safe (§4.6).
 */
export const MAX_AREA_POLYGONS = 31;

export type RuleProblemReason =
  // invalid — the rule is excluded from resolution entirely
  | "malformed"
  | "duplicate_id"
  | "area_polygon_invalid"
  | "area_limit"
  | "scope_kind_not_allowed"
  // ineffective — the rule still resolves, just not as its author wrote it
  | "unknown_net"
  | "unknown_net_class"
  | "unknown_layer"
  | "value_clamped";

export interface RuleProblem {
  ruleId: string;
  ruleName: string;
  /** Index in `board.drcRules`; also the reporting order (§11). */
  ruleIndex: number;
  kind: "invalid" | "ineffective";
  reason: RuleProblemReason;
  detail: string;
}

export interface CompiledRule {
  rule: PcbDrcRule;
  ruleIndex: number;
  /** `constraint.mm` for a clearance rule, `constraint.minMm` for a scalar. */
  valueMm: number;
  netIdSet: ReadonlySet<string> | null;
  netClassIdSet: ReadonlySet<string> | null;
  layerSet: ReadonlySet<PcbCopperLayerId> | null;
  /** Clearance rules only; `null` on a scalar rule (§5.2). */
  pairKindSet: ReadonlySet<DrcPairKind> | null;
  /** Bit per area polygon this rule owns; 0 = no area scope. */
  areaBits: number;
}

export interface CompiledRuleSet {
  clearanceRules: readonly CompiledRule[];
  scalarRules: Readonly<Record<ScalarRuleKind, readonly CompiledRule[]>>;
  /** Registered area polygons, canonicalised and counter-clockwise. */
  areaRings: readonly (readonly PcbPointMm[])[];
  areaBounds: readonly RingBounds[];
  hasAreaRules: boolean;
  /** Upper bound of any explicit clearance value; feeds `clearanceBound`. */
  maxClearanceRuleMm: number;
  problems: readonly RuleProblem[];
}

export interface CompileRuleSetOptions {
  validCopperLayers: readonly PcbCopperLayerId[];
  /** Absent = the compiler cannot judge net references (no `unknown_net`). */
  knownNetIds?: ReadonlySet<string>;
}

/** Board minimum a scalar kind is floored by (§5.1). */
export function boardMinimumFor(
  kind: ScalarRuleKind,
  rules: PcbDesignRules,
): number {
  switch (kind) {
    case "trackWidth":
      return rules.minimums.traceWidthMm;
    case "viaDiameter":
      return rules.minimums.viaDiameterMm;
    case "viaDrill":
      return rules.minimums.viaDrillMm;
    case "annularRing":
      return rules.minimums.annularRingMm;
    case "holeToHole":
      return rules.minimums.holeToHoleMm ?? DEFAULT_HOLE_TO_HOLE_MM;
    case "edgeClearance":
      return rules.clearance.copperToBoardEdgeMm;
  }
}

/** Board clearance per pair kind (§4.1 table). */
export function boardClearanceByPairKind(
  rules: PcbDesignRules,
): Record<DrcPairKind, number> {
  const clr = rules.clearance;
  const pour = clr.pourToCopperMm ?? DEFAULT_POUR_TO_COPPER_MM;
  return {
    traceToTrace: clr.traceToTraceMm,
    traceToPad: clr.traceToPadMm,
    traceToVia: clr.traceToViaMm,
    padToPad: clr.padToPadMm,
    // No pad-to-via board field exists; documented reuse, not new (§4.1).
    padToVia: clr.traceToViaMm,
    viaToVia: clr.viaToViaMm,
    pourToTrace: Math.max(pour, clr.traceToTraceMm),
    pourToPad: Math.max(pour, clr.traceToPadMm),
    pourToVia: Math.max(pour, clr.traceToViaMm),
    pourToPour: pour,
  };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isPointArray(v: unknown): v is readonly PcbPointMm[] {
  return (
    Array.isArray(v) &&
    v.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        Number.isFinite((p as PcbPointMm).x) &&
        Number.isFinite((p as PcbPointMm).y),
    )
  );
}

/** `null` when the scope is well-formed, else why it is not. */
function scopeShapeError(scope: DrcRuleScope): string | null {
  if (typeof scope !== "object" || scope === null) return "a scope is not an object";
  switch (scope.kind) {
    case "net":
      return isStringArray(scope.netIds) ? null : "net scope needs netIds: string[]";
    case "netClass":
      return isStringArray(scope.netClassIds)
        ? null
        : "netClass scope needs netClassIds: string[]";
    case "layer":
      return isStringArray(scope.layers) ? null : "layer scope needs layers: string[]";
    case "pairKind":
      if (!isStringArray(scope.pairKinds)) {
        return "pairKind scope needs pairKinds: string[]";
      }
      return scope.pairKinds.every((k) =>
        (ALL_PAIR_KINDS as readonly string[]).includes(k),
      )
        ? null
        : "pairKind scope names an unknown pair kind";
    case "area":
      return isPointArray(scope.polygonMm)
        ? null
        : "area scope needs polygonMm: {x,y}[]";
    default:
      return `unknown scope kind "${String((scope as { kind: unknown }).kind)}"`;
  }
}

/** `null` when the constraint is well-formed, else why it is not. */
function constraintError(constraint: DrcRuleConstraint): string | null {
  if (typeof constraint !== "object" || constraint === null) {
    return "constraint is not an object";
  }
  const kind = constraint.kind;
  const known =
    kind === "clearance" ||
    (SCALAR_RULE_KINDS as readonly string[]).includes(kind);
  if (!known) return `unknown constraint kind "${String(kind)}"`;
  const value =
    constraint.kind === "clearance" ? constraint.mm : constraint.minMm;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "constraint value is not a finite number";
  }
  if (value < 0) return `constraint value ${value} is negative`;
  return null;
}

/** A canonicalised, counter-clockwise ring, or why the polygon is unusable. */
function normalizeAreaRing(
  polygonMm: readonly PcbPointMm[],
): { ring: readonly PcbPointMm[] } | { error: string } {
  const canon = canonicalizeRing(polygonMm);
  if (canon.length < 3) return { error: "area polygon has fewer than 3 distinct points" };
  const area = Math.abs(ringSignedArea(canon));
  if (area < DEGENERATE_AREA_MM2) {
    return { error: `area polygon is degenerate (${area.toExponential(2)} mm²)` };
  }
  if (ringSelfIntersects(canon)) return { error: "area polygon self-intersects" };
  return { ring: ensureCcwRing(canon) };
}

const INEFFECTIVE_REASON_ORDER: readonly RuleProblemReason[] = [
  "unknown_net",
  "unknown_net_class",
  "unknown_layer",
  "value_clamped",
];

interface PendingRule {
  rule: PcbDrcRule;
  index: number;
  kind: "clearance" | ScalarRuleKind;
  valueMm: number;
  netIdSet: Set<string> | null;
  netClassIdSet: Set<string> | null;
  layerSet: Set<PcbCopperLayerId> | null;
  pairKindSet: Set<DrcPairKind> | null;
  areaRings: Array<readonly PcbPointMm[]>;
  areaBits: number;
  invalid: { reason: RuleProblemReason; detail: string } | null;
  ineffective: Array<{ reason: RuleProblemReason; detail: string }>;
}

function union<T>(cur: Set<T> | null, add: Iterable<T>): Set<T> {
  const out = cur ?? new Set<T>();
  for (const v of add) out.add(v);
  return out;
}

/** Priority is the primary sort key; a non-finite one cannot order anything. */
function priorityOf(rule: PcbDrcRule): number {
  return Number.isFinite(rule.priority) ? rule.priority : 0;
}

export function compileRuleSet(
  board: PcbBoardSettings,
  opts: CompileRuleSetOptions,
): CompiledRuleSet {
  const rules = board.drcRules ?? [];
  const validLayers = new Set<PcbCopperLayerId>(opts.validCopperLayers);
  const classIds = new Set(board.netClasses.map((c) => c.id));
  const floorMm = board.designRules.minimums.clearanceMm ?? 0;

  // Id ownership among the ENABLED rows only: the first enabled row to claim an
  // id keeps it, every later enabled claimant is invalid (§2.1). A disabled row
  // is absent — it owns nothing, so re-using its id is not a collision and must
  // not silently drop the rule that actually resolves.
  const firstIndexById = new Map<string, number>();
  rules.forEach((r, i) => {
    if (r?.enabled && isNonEmptyString(r.id) && !firstIndexById.has(r.id)) {
      firstIndexById.set(r.id, i);
    }
  });

  const pending: PendingRule[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!;
    // A disabled rule is neither invalid nor ineffective — it is absent (§2.1).
    if (!rule?.enabled) continue;
    const p = validateRule(rule, index, {
      firstIndexById,
      validLayers,
      classIds,
      knownNetIds: opts.knownNetIds,
      designRules: board.designRules,
      floorMm,
    });
    pending.push(p);
  }

  // Pass 2 — area registration in resolution ORDER, so the bits go to the
  // rules that would win a first-match race.
  const ordered = [...pending].sort(
    (x, y) => priorityOf(y.rule) - priorityOf(x.rule) || x.index - y.index,
  );
  const areaRings: Array<readonly PcbPointMm[]> = [];
  const areaBounds: RingBounds[] = [];
  const bitByRingKey = new Map<string, number>();
  for (const p of ordered) {
    if (p.invalid || p.areaRings.length === 0) continue;
    let bits = 0;
    for (const ring of p.areaRings) {
      const key = ringKey(ring);
      const existing = bitByRingKey.get(key);
      if (existing !== undefined) {
        bits |= existing;
        continue;
      }
      if (areaRings.length >= MAX_AREA_POLYGONS) {
        p.invalid = {
          reason: "area_limit",
          detail: `the compiled rule set already holds ${MAX_AREA_POLYGONS} distinct area polygons`,
        };
        bits = 0;
        break;
      }
      const bit = 1 << areaRings.length;
      areaRings.push(ring);
      areaBounds.push(boundsOfPoints(ring));
      bitByRingKey.set(key, bit);
      bits |= bit;
    }
    p.areaBits = bits;
  }

  const clearanceRules: CompiledRule[] = [];
  const scalarRules: Record<ScalarRuleKind, CompiledRule[]> = {
    trackWidth: [],
    viaDiameter: [],
    viaDrill: [],
    annularRing: [],
    holeToHole: [],
    edgeClearance: [],
  };
  let maxClearanceRuleMm = 0;
  for (const p of ordered) {
    if (p.invalid) continue;
    const compiled: CompiledRule = {
      rule: p.rule,
      ruleIndex: p.index,
      valueMm: p.valueMm,
      netIdSet: p.netIdSet,
      netClassIdSet: p.netClassIdSet,
      layerSet: p.layerSet,
      pairKindSet: p.pairKindSet,
      areaBits: p.areaBits,
    };
    if (p.kind === "clearance") {
      clearanceRules.push(compiled);
      if (p.valueMm > maxClearanceRuleMm) maxClearanceRuleMm = p.valueMm;
    } else {
      scalarRules[p.kind].push(compiled);
    }
  }

  // Reported in array order, then reason order (§11).
  const problems: RuleProblem[] = [];
  for (const p of pending) {
    const base = {
      // A row with no usable id still needs a distinct anchor, or two malformed
      // rows would hash to one violation id.
      ruleId: isNonEmptyString(p.rule.id) ? p.rule.id : `#${p.index}`,
      ruleName: typeof p.rule.name === "string" ? p.rule.name : "",
      ruleIndex: p.index,
    };
    if (p.invalid) {
      problems.push({ ...base, kind: "invalid", ...p.invalid });
      continue;
    }
    for (const reason of INEFFECTIVE_REASON_ORDER) {
      for (const issue of p.ineffective) {
        if (issue.reason === reason) {
          problems.push({ ...base, kind: "ineffective", ...issue });
        }
      }
    }
  }

  return {
    clearanceRules,
    scalarRules,
    areaRings,
    areaBounds,
    hasAreaRules: areaRings.length > 0,
    maxClearanceRuleMm,
    problems,
  };
}

/** Stable identity of an area polygon, so an identical ring reuses its bit. */
function ringKey(ring: readonly PcbPointMm[]): string {
  return ring.map((p) => `${p.x},${p.y}`).join(";");
}

interface ValidateContext {
  firstIndexById: Map<string, number>;
  validLayers: ReadonlySet<PcbCopperLayerId>;
  classIds: ReadonlySet<string>;
  knownNetIds: ReadonlySet<string> | undefined;
  designRules: PcbDesignRules;
  floorMm: number;
}

function validateRule(
  rule: PcbDrcRule,
  index: number,
  ctx: ValidateContext,
): PendingRule {
  const p: PendingRule = {
    rule,
    index,
    kind: "clearance",
    valueMm: 0,
    netIdSet: null,
    netClassIdSet: null,
    layerSet: null,
    pairKindSet: null,
    areaRings: [],
    areaBits: 0,
    invalid: null,
    ineffective: [],
  };
  const fail = (reason: RuleProblemReason, detail: string): PendingRule => {
    p.invalid = { reason, detail };
    return p;
  };

  if (!isNonEmptyString(rule.id)) return fail("malformed", "rule has no id");
  if (typeof rule.name !== "string") return fail("malformed", "rule has no name");
  if (ctx.firstIndexById.get(rule.id) !== index) {
    return fail(
      "duplicate_id",
      `id "${rule.id}" is already used by rule #${ctx.firstIndexById.get(rule.id)}`,
    );
  }
  const constraintProblem = constraintError(rule.constraint);
  if (constraintProblem !== null) return fail("malformed", constraintProblem);
  p.kind = rule.constraint.kind;
  p.valueMm =
    rule.constraint.kind === "clearance"
      ? rule.constraint.mm
      : rule.constraint.minMm;

  const scopes = Array.isArray(rule.scopes) ? rule.scopes : null;
  if (scopes === null) return fail("malformed", "scopes is not an array");

  const unknownNets: string[] = [];
  const unknownClasses: string[] = [];
  const unknownLayers: string[] = [];
  for (const scope of scopes) {
    const shapeProblem = scopeShapeError(scope);
    if (shapeProblem !== null) return fail("malformed", shapeProblem);
    switch (scope.kind) {
      case "net":
        p.netIdSet = union(p.netIdSet, scope.netIds);
        if (ctx.knownNetIds) {
          for (const id of scope.netIds) {
            if (!ctx.knownNetIds.has(id)) unknownNets.push(id);
          }
        }
        break;
      case "netClass":
        p.netClassIdSet = union(p.netClassIdSet, scope.netClassIds);
        for (const id of scope.netClassIds) {
          if (!ctx.classIds.has(id)) unknownClasses.push(id);
        }
        break;
      case "layer":
        p.layerSet = union(p.layerSet, scope.layers);
        for (const layer of scope.layers) {
          if (!ctx.validLayers.has(layer)) unknownLayers.push(layer);
        }
        break;
      case "pairKind":
        if (p.kind !== "clearance") {
          return fail(
            "scope_kind_not_allowed",
            `a pairKind scope has no meaning on a ${p.kind} rule`,
          );
        }
        p.pairKindSet = union(p.pairKindSet, scope.pairKinds);
        break;
      case "area": {
        const normalized = normalizeAreaRing(scope.polygonMm);
        if ("error" in normalized) {
          return fail("area_polygon_invalid", normalized.error);
        }
        p.areaRings.push(normalized.ring);
        break;
      }
    }
  }

  if (unknownNets.length > 0) {
    p.ineffective.push({
      reason: "unknown_net",
      detail: `net scope names ${unknownNets.length} net(s) this design does not have (${unknownNets.join(", ")})`,
    });
  }
  if (unknownClasses.length > 0) {
    p.ineffective.push({
      reason: "unknown_net_class",
      detail: `netClass scope names ${unknownClasses.length} class(es) this board does not have (${unknownClasses.join(", ")})`,
    });
  }
  if (unknownLayers.length > 0) {
    p.ineffective.push({
      reason: "unknown_layer",
      detail: `layer scope names ${unknownLayers.length} layer(s) this stackup does not have (${unknownLayers.join(", ")})`,
    });
  }
  // A clamped rule STAYS effective — it matches first and resolves as the
  // floor / minimum, shadowing lower-priority rules — but the number it
  // applies is not the one its author wrote (§2.1, Astra run 1 #7).
  const clampFloor =
    p.kind === "clearance"
      ? ctx.floorMm
      : boardMinimumFor(p.kind, ctx.designRules);
  if (below(p.valueMm, clampFloor)) {
    p.ineffective.push({
      reason: "value_clamped",
      detail: `value ${p.valueMm} mm is below the ${p.kind === "clearance" ? "floor" : "board minimum"} ${clampFloor} mm — resolves as ${clampFloor} mm`,
    });
  }
  return p;
}
