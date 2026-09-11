import type {
  DrcRuleClass,
  DrcRuleCode,
  DrcSeverity,
} from "../../sdks/designer";

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
  COPPER_TO_HOLE: "error",
  COPPER_OFF_BOARD: "error",
  // manufacturability minimums
  TRACE_WIDTH_MIN: "error",
  VIA_DIAMETER_MIN: "error",
  VIA_DRILL_MIN: "error",
  DRILL_SIZE_MIN: "error",
  ANNULAR_RING_MIN: "error",
  VIA_ASPECT_RATIO: "warning",
  VIA_TYPE_UNSUPPORTED: "error",
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
  NPTH_PAD_NET: "error",
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
  // DFM overlays (DFM contract 11 §7). Only the two that make a board
  // unbuildable are errors: parts that cannot both be placed, and a mask dam
  // the DESIGN rule says must exist. Everything else is a fab advisory.
  COURTYARD_OVERLAP: "error",
  COURTYARD_INVALID: "warning",
  SILK_TO_MASK_CLEARANCE: "warning",
  SILK_TO_BOARD_EDGE: "warning",
  FAB_SILK_CLEARANCE: "warning",
  FAB_SILK_WIDTH: "warning",
  FAB_SILK_TEXT_HEIGHT: "warning",
  MASK_BRIDGE: "error",
  FAB_MASK_BRIDGE: "warning",
  MASK_SLIVER: "warning",
  FAB_MASK_TO_COPPER: "warning",
  // copper shape (DFM contract 11 §5, §7)
  COPPER_CONNECTION_WIDTH: "error",
  COPPER_SLIVER: "warning",
  COPPER_SHAPE_UNCHECKED: "info",
  TRACE_ACUTE_ANGLE: "warning",
  TRACE_OVERLAP: "warning",
  // board material (exact-geometry contract 12 §5, §7)
  OUTLINE_MIN_WEB: "warning",
  OUTLINE_WEB_UNCHECKED: "info",
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
  // A trace keeps its declared layer un-clamped (unlike pads / vias, which are
  // checked on every valid layer when their declaration is off the stackup), so
  // an invalid-layer trace's copper collides with nothing: this code is the ONLY
  // guard that it exists at all. It cannot be waived or ignored (contract 06 §2).
  "TRACE_LAYER_MISMATCH",
]);

/**
 * Per-code rule class — the last per-code fact that used to be a literal on
 * every draft (contract 06 §6). Compiler-total, like the severity table: a new
 * code has no class until it is listed here. Checks emit FACTS; the engine
 * stamps the class, so two emit sites of one code can never disagree.
 */
export const RULE_CLASS_BY_CODE: Record<DrcRuleCode, DrcRuleClass> = {
  // clearance
  TRACE_TO_TRACE_CLEARANCE: "clearance",
  TRACE_TO_PAD_CLEARANCE: "clearance",
  TRACE_TO_VIA_CLEARANCE: "clearance",
  VIA_TO_VIA_CLEARANCE: "clearance",
  PAD_TO_PAD_CLEARANCE: "clearance",
  PAD_TO_VIA_CLEARANCE: "clearance",
  COPPER_TO_BOARD_EDGE: "clearance",
  HOLE_TO_HOLE: "clearance",
  COPPER_TO_HOLE: "clearance",
  // constraint
  TRACE_LAYER_MISMATCH: "constraint",
  PAD_LAYER_MISMATCH: "constraint",
  VIA_LAYER_SPAN: "constraint",
  NETCLASS_TRACE_WIDTH: "constraint",
  NETCLASS_VIA_DIAMETER: "constraint",
  NETCLASS_VIA_DRILL: "constraint",
  NET_LENGTH_OUT_OF_RANGE: "constraint",
  BOARD_OUTLINE_INVALID: "constraint",
  COPPER_OFF_BOARD: "constraint",
  KEEPOUT_VIOLATION: "constraint",
  ZONE_OVERLAP: "constraint",
  // connectivity
  UNCONNECTED_NET: "connectivity",
  NET_SHORT_CIRCUIT: "connectivity",
  // manufacturability
  TRACE_WIDTH_MIN: "manufacturability",
  VIA_DIAMETER_MIN: "manufacturability",
  VIA_DRILL_MIN: "manufacturability",
  DRILL_SIZE_MIN: "manufacturability",
  ANNULAR_RING_MIN: "manufacturability",
  FAB_TRACE_WIDTH: "manufacturability",
  FAB_CLEARANCE: "manufacturability",
  FAB_ANNULAR_RING: "manufacturability",
  FAB_DRILL: "manufacturability",
  FAB_HOLE_TO_HOLE: "manufacturability",
  FAB_PAD: "manufacturability",
  VIA_ASPECT_RATIO: "manufacturability",
  VIA_TYPE_UNSUPPORTED: "manufacturability",
  OUTLINE_INTERNAL_RADIUS: "manufacturability",
  OUTLINE_SLOT_WIDTH: "manufacturability",
  // structural
  PLACED_PART_MISSING_FOOTPRINT: "structural",
  NPTH_PAD_NET: "structural",
  ISOLATED_COPPER_ISLAND: "structural",
  ZONE_INVALID: "structural",
  ZONE_EMPTY_FILL: "structural",
  ZONE_FILL_FAILED: "structural",
  DRC_RULE_INVALID: "structural",
  DRC_RULE_INEFFECTIVE: "structural",
  // dfm — the S12 overlay codes (DFM contract 11 §7); all sixteen S12 codes
  // are class `dfm` and overridable.
  COURTYARD_OVERLAP: "dfm",
  COURTYARD_INVALID: "dfm",
  SILK_TO_MASK_CLEARANCE: "dfm",
  SILK_TO_BOARD_EDGE: "dfm",
  FAB_SILK_CLEARANCE: "dfm",
  FAB_SILK_WIDTH: "dfm",
  FAB_SILK_TEXT_HEIGHT: "dfm",
  MASK_BRIDGE: "dfm",
  FAB_MASK_BRIDGE: "dfm",
  MASK_SLIVER: "dfm",
  FAB_MASK_TO_COPPER: "dfm",
  HOLE_TO_BOARD_EDGE: "dfm",
  HOLE_OFF_BOARD: "dfm",
  TRACK_DANGLING: "dfm",
  VIA_DANGLING: "dfm",
  // electrical
  CREEPAGE_DISTANCE: "electrical",
  TRACE_CURRENT_WIDTH: "electrical",
  // signal integrity
  DIFF_PAIR_GAP: "signal-integrity",
  DIFF_PAIR_SKEW: "signal-integrity",
  DIFF_PAIR_UNCOUPLED_LENGTH: "signal-integrity",
  // copper shape (DFM contract 11 §7: all of S12's codes are class `dfm`)
  COPPER_CONNECTION_WIDTH: "dfm",
  COPPER_SLIVER: "dfm",
  COPPER_SHAPE_UNCHECKED: "dfm",
  TRACE_ACUTE_ANGLE: "dfm",
  TRACE_OVERLAP: "dfm",
  // board material (12 §5.2: a design rule on the milled shape, so it files
  // under `manufacturability` beside the other two outline advisories).
  OUTLINE_MIN_WEB: "manufacturability",
  OUTLINE_WEB_UNCHECKED: "manufacturability",
};

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
