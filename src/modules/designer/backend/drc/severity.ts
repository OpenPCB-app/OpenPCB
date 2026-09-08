import type { DrcRuleCode, DrcSeverity } from "../../../../sdks/designer";

/**
 * Per-code severity policy (DRC_HARDENING_PLAN.md P3). The default table is the
 * single source of truth; a board may override any code (or `"ignore"` it)
 * through `PcbBoardSettings.drcSeverityOverrides`. Defaults are aligned to
 * KiCad 9 where audit §8 documented one:
 *  - COPPER_TO_BOARD_EDGE → error (KiCad `copper_edge_clearance` default Error)
 *  - UNCONNECTED_NET → error (KiCad `unconnected_items` default Error)
 * NET_SHORT_CIRCUIT / the layer-invalid codes stay error and cannot be
 * downgraded (see NON_OVERRIDABLE below).
 */
export const DEFAULT_SEVERITY_BY_CODE: Record<DrcRuleCode, DrcSeverity> = {
  // clearance / shorts
  TRACE_TO_TRACE_CLEARANCE: "error",
  TRACE_TO_PAD_CLEARANCE: "error",
  TRACE_TO_VIA_CLEARANCE: "error",
  VIA_TO_VIA_CLEARANCE: "error",
  PAD_TO_PAD_CLEARANCE: "error",
  PAD_TO_VIA_CLEARANCE: "error",
  NET_SHORT_CIRCUIT: "error",
  COPPER_TO_BOARD_EDGE: "error",
  COPPER_OFF_BOARD: "error",
  // manufacturability minimums
  TRACE_WIDTH_MIN: "error",
  VIA_DIAMETER_MIN: "error",
  VIA_DRILL_MIN: "error",
  DRILL_SIZE_MIN: "error",
  ANNULAR_RING_MIN: "error",
  VIA_ASPECT_RATIO: "warning",
  HOLE_TO_HOLE: "warning",
  HOLE_TO_BOARD_EDGE: "warning",
  HOLE_OFF_BOARD: "error",
  // fab-capability warnings
  FAB_TRACE_WIDTH: "warning",
  FAB_CLEARANCE: "warning",
  FAB_DRILL: "warning",
  FAB_PAD: "warning",
  FAB_ANNULAR_RING: "warning",
  FAB_HOLE_TO_HOLE: "warning",
  // constraints / structural
  TRACE_LAYER_MISMATCH: "error",
  PAD_LAYER_MISMATCH: "error",
  VIA_LAYER_SPAN: "error",
  PLACED_PART_MISSING_FOOTPRINT: "error",
  BOARD_OUTLINE_INVALID: "error",
  OUTLINE_INTERNAL_RADIUS: "warning",
  OUTLINE_SLOT_WIDTH: "warning",
  // connectivity
  UNCONNECTED_NET: "error",
  ISOLATED_COPPER_ISLAND: "warning",
  // zones / keepouts (contract 03 §13.1)
  KEEPOUT_VIOLATION: "error",
  ZONE_OVERLAP: "error",
  ZONE_INVALID: "error",
  ZONE_EMPTY_FILL: "warning",
  ZONE_FILL_FAILED: "error",
  // net-class advisories
  NETCLASS_TRACE_WIDTH: "warning",
  NETCLASS_VIA_DIAMETER: "warning",
  NETCLASS_VIA_DRILL: "warning",
  // dfm advisories
  TRACK_DANGLING: "warning",
  VIA_DANGLING: "warning",
  // length / SI
  NET_LENGTH_OUT_OF_RANGE: "warning",
  // electrical (P10)
  CREEPAGE_DISTANCE: "error",
  TRACE_CURRENT_WIDTH: "warning",
  // signal integrity (P11)
  DIFF_PAIR_GAP: "error",
  DIFF_PAIR_SKEW: "warning",
  DIFF_PAIR_UNCOUPLED_LENGTH: "warning",
  // rule validity (rule-semantics contract §10)
  DRC_RULE_INVALID: "error",
  DRC_RULE_INEFFECTIVE: "warning",
};

const SEVERITY_RANK: Record<DrcSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

/**
 * Order for "the most severe of" — an aggregate over several violating layers
 * or witnesses must never downgrade the worst of them (contract §4.3, §4.4).
 */
export function severityRank(severity: DrcSeverity): number {
  return SEVERITY_RANK[severity];
}

/** Codes whose error severity is safety-critical and never overridable. */
export const NON_OVERRIDABLE = new Set<DrcRuleCode>([
  "NET_SHORT_CIRCUIT",
  "VIA_LAYER_SPAN",
  "PAD_LAYER_MISMATCH",
  "BOARD_OUTLINE_INVALID",
  // A zone/keepout the derivation refused is a fail-OPEN hazard: a dropped
  // keepout stops protecting anything, so the code cannot be silenced (§13.1).
  "ZONE_INVALID",
  // A bailed fill ships no copper at all (copper-pour contract §8): silencing
  // it would hide a plane that simply is not in the artwork.
  "ZONE_FILL_FAILED",
  // A rule that could not be compiled is excluded from resolution: a dropped
  // TIGHTENING rule is fail-open, so the user must see it (contract §10).
  "DRC_RULE_INVALID",
]);

/** Per-code severity overrides; `"ignore"` drops the violation entirely. */
export type DrcSeverityOverrides = Partial<
  Record<DrcRuleCode, DrcSeverity | "ignore">
>;

/**
 * Resolve the effective severity (or "ignore") for a code:
 *   override → per-rule severity (from a scoped rule) → default table.
 * Overrides on NON_OVERRIDABLE codes are discarded.
 */
export function resolveSeverity(
  code: DrcRuleCode,
  ruleSeverity: DrcSeverity | undefined,
  overrides: DrcSeverityOverrides | undefined,
): DrcSeverity | "ignore" {
  if (overrides && !NON_OVERRIDABLE.has(code)) {
    const o = overrides[code];
    if (o !== undefined) return o;
  }
  return ruleSeverity ?? DEFAULT_SEVERITY_BY_CODE[code];
}
