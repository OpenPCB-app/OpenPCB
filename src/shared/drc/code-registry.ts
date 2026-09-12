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
  // Shorts fall out of the same geometric pass as the clearance verdicts —
  // except the COMPONENT short, which no single pair can see (13 §4.3).
  NET_SHORT_CIRCUIT: { checks: ["clearance-judge", "chain-short"] },
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
  // The IPC-2221 spacing CONSTITUENT of the pair judge since S13 (13 §3.3) —
  // the same geometric pass as the ordinary clearance verdict, not a second one.
  CREEPAGE_DISTANCE: { checks: ["clearance-judge"] },
  TRACE_CURRENT_WIDTH: { checks: ["electrical"] },
  DIFF_PAIR_GAP: { checks: ["signal-integrity"] },
  DIFF_PAIR_SKEW: { checks: ["signal-integrity"] },
  DIFF_PAIR_UNCOUPLED_LENGTH: { checks: ["signal-integrity"] },
  // structural / rule validity
  PLACED_PART_MISSING_FOOTPRINT: { checks: ["structural"] },
  NPTH_PAD_NET: { checks: ["structural"] },
  DRC_RULE_INVALID: { checks: ["rules"] },
  DRC_RULE_INEFFECTIVE: { checks: ["rules"] },
  // courtyards / silkscreen / solder mask (DFM contract 11 §2–§4)
  COURTYARD_OVERLAP: { checks: ["courtyard"] },
  COURTYARD_INVALID: { checks: ["courtyard"] },
  SILK_TO_MASK_CLEARANCE: { checks: ["silkscreen"] },
  SILK_TO_BOARD_EDGE: { checks: ["silkscreen"] },
  FAB_SILK_CLEARANCE: { checks: ["silkscreen"] },
  FAB_SILK_WIDTH: { checks: ["silkscreen"] },
  FAB_SILK_TEXT_HEIGHT: { checks: ["silkscreen"] },
  MASK_BRIDGE: { checks: ["solder-mask"] },
  FAB_MASK_BRIDGE: { checks: ["solder-mask"] },
  MASK_SLIVER: { checks: ["solder-mask"] },
  FAB_MASK_TO_COPPER: { checks: ["solder-mask"] },
  // copper shape (DFM contract 11 §5)
  COPPER_CONNECTION_WIDTH: { checks: ["copper-shape"] },
  COPPER_SLIVER: { checks: ["copper-shape"] },
  COPPER_SHAPE_UNCHECKED: { checks: ["copper-shape"] },
  TRACE_ACUTE_ANGLE: { checks: ["copper-shape"] },
  TRACE_OVERLAP: { checks: ["copper-shape"] },
  // board material (exact-geometry contract 12 §5)
  OUTLINE_MIN_WEB: { checks: ["manufacturability"] },
  // The ONE "the exact-geometry layer did not answer" code (12 §4, §5). It has
  // three homes because the exact layer has three: the web certificate
  // (`manufacturability`), an outline-simplicity recomputation that ran out of
  // its per-run budget (`outline`), and a board-edge verdict whose ambiguous
  // interval could not be resolved exactly (`board`). All three are the same
  // fact — a chord verdict stands where an exact one was owed — and all three
  // land on the single `boardEdge` anchor, so the report carries ONE note per
  // run with their messages merged.
  OUTLINE_WEB_UNCHECKED: { checks: ["manufacturability", "outline", "board"] },
};
