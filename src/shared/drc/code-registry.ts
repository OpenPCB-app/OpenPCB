import type { DrcRuleCode } from "../../sdks/designer";

/**
 * Where each `DrcRuleCode` is emitted — the check-file basenames (no extension)
 * under `drc/checks/` that can produce it. Compiler-total, like the severity and
 * rule-class tables: a code with no home fails `tsc`, so a new code cannot ship
 * declared-but-unreachable (contract 06 §5). Most codes have exactly one emit
 * site; the few with several list all of them, because "one code, one check" is
 * a property to assert, not to assume.
 *
 * This table is the DECLARATION. The census test cross-checks it against the
 * files themselves, so a code that moves house without moving its entry fails.
 */
export const EMIT_SITE_BY_CODE: Record<DrcRuleCode, { checks: readonly string[] }> = {
  // clearance / shorts. The DRAFTS are pushed by the shared per-pair bodies in
  // `clearance-judge.ts` (07 §2 D3); `clearance.ts` holds the two enumerations
  // (the batch loops and `judgeCopperPairs`) and emits nothing itself.
  TRACE_TO_TRACE_CLEARANCE: { checks: ["clearance-judge"] },
  TRACE_TO_PAD_CLEARANCE: { checks: ["clearance-judge"] },
  TRACE_TO_VIA_CLEARANCE: { checks: ["clearance-judge"] },
  VIA_TO_VIA_CLEARANCE: { checks: ["clearance-judge"] },
  PAD_TO_PAD_CLEARANCE: { checks: ["clearance-judge"] },
  PAD_TO_VIA_CLEARANCE: { checks: ["clearance-judge"] },
  // Shorts fall out of the same geometric pass as the clearance verdicts.
  NET_SHORT_CIRCUIT: { checks: ["clearance-judge"] },
  FAB_CLEARANCE: { checks: ["clearance-judge"] },
  COPPER_TO_HOLE: { checks: ["copper-to-hole"] },
  // board edge / holes
  COPPER_TO_BOARD_EDGE: { checks: ["board"] },
  COPPER_OFF_BOARD: { checks: ["board"] },
  HOLE_TO_BOARD_EDGE: { checks: ["board"] },
  HOLE_OFF_BOARD: { checks: ["board"] },
  HOLE_TO_HOLE: { checks: ["board"] },
  FAB_HOLE_TO_HOLE: { checks: ["board"] },
  // constraints
  TRACE_LAYER_MISMATCH: { checks: ["constraints"] },
  PAD_LAYER_MISMATCH: { checks: ["constraints"] },
  VIA_LAYER_SPAN: { checks: ["constraints"] },
  NETCLASS_TRACE_WIDTH: { checks: ["netclass"] },
  NETCLASS_VIA_DIAMETER: { checks: ["netclass"] },
  NETCLASS_VIA_DRILL: { checks: ["netclass"] },
  NET_LENGTH_OUT_OF_RANGE: { checks: ["length"] },
  BOARD_OUTLINE_INVALID: { checks: ["outline"] },
  KEEPOUT_VIOLATION: { checks: ["keepouts"] },
  ZONE_OVERLAP: { checks: ["zones"] },
  // manufacturability
  TRACE_WIDTH_MIN: { checks: ["manufacturability"] },
  VIA_DIAMETER_MIN: { checks: ["manufacturability"] },
  VIA_DRILL_MIN: { checks: ["manufacturability"] },
  DRILL_SIZE_MIN: { checks: ["manufacturability"] },
  // Emitted twice by the same check — once for vias, once for pad drills.
  ANNULAR_RING_MIN: { checks: ["manufacturability"] },
  FAB_TRACE_WIDTH: { checks: ["manufacturability"] },
  FAB_DRILL: { checks: ["manufacturability"] },
  FAB_ANNULAR_RING: { checks: ["manufacturability"] },
  FAB_PAD: { checks: ["manufacturability"] },
  VIA_ASPECT_RATIO: { checks: ["manufacturability"] },
  VIA_TYPE_UNSUPPORTED: { checks: ["manufacturability"] },
  OUTLINE_INTERNAL_RADIUS: { checks: ["manufacturability"] },
  OUTLINE_SLOT_WIDTH: { checks: ["manufacturability"] },
  // connectivity / pours
  UNCONNECTED_NET: { checks: ["connectivity"] },
  ISOLATED_COPPER_ISLAND: { checks: ["copper-pour"] },
  ZONE_INVALID: { checks: ["zones"] },
  // A zone can pour nothing because the derivation refused its geometry
  // (`zones`) or because the fill kernel returned no island (`copper-pour`).
  ZONE_EMPTY_FILL: { checks: ["zones", "copper-pour"] },
  ZONE_FILL_FAILED: { checks: ["copper-pour"] },
  // dfm
  TRACK_DANGLING: { checks: ["dangling"] },
  VIA_DANGLING: { checks: ["dangling"] },
  // electrical / signal integrity
  CREEPAGE_DISTANCE: { checks: ["electrical"] },
  TRACE_CURRENT_WIDTH: { checks: ["electrical"] },
  DIFF_PAIR_GAP: { checks: ["signal-integrity"] },
  DIFF_PAIR_SKEW: { checks: ["signal-integrity"] },
  DIFF_PAIR_UNCOUPLED_LENGTH: { checks: ["signal-integrity"] },
  // structural / rule validity
  PLACED_PART_MISSING_FOOTPRINT: { checks: ["structural"] },
  NPTH_PAD_NET: { checks: ["structural"] },
  DRC_RULE_INVALID: { checks: ["rules"] },
  DRC_RULE_INEFFECTIVE: { checks: ["rules"] },
};
