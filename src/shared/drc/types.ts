import type {
  DrcPairKind,
  DrcRuleClass,
  DrcSeverity,
  DrcViolation,
} from "../../sdks/designer";
import type { RawFootprintLookup } from "../pcb-geometry/courtyard";
import type { DrcSeverityOverrides } from "./severity";

/**
 * A violation before the engine resolves its severity and assigns its stable
 * id / waived flag. Checks emit FACTS — code, anchors, measured, required —
 * and never a severity literal (rule-semantics contract §7): the engine picks
 * `override → ruleSeverity → DEFAULT_SEVERITY_BY_CODE`. `ruleSeverity` is set
 * only when a scoped rule set the value the check compared against; for an
 * aggregate over several layers or witnesses it is the MOST severe of them, so
 * aggregation never downgrades. Non-waivability is likewise not a draft flag:
 * `NON_OVERRIDABLE` (severity.ts) is the single list, and neither is the rule
 * class: it comes from `RULE_CLASS_BY_CODE` (contract 06 §6), so two emit sites
 * of one code cannot file it under two different classes.
 */
export type DrcViolationDraft = Omit<
  DrcViolation,
  "id" | "waived" | "severity" | "ruleClass"
> & {
  ruleSeverity?: DrcSeverity;
};

/**
 * Which enumeration the checks discover candidate pairs and edges with
 * (broad-phase contract 08 §3). `"exhaustive"` selects the pre-S9 loops, kept
 * verbatim as the oracle — tests and `scripts/drc-bench.ts` only: no env flag,
 * no HTTP option, no UI. Both modes produce byte-identical reports (§1).
 */
export type DrcBroadPhaseMode = "grid" | "exhaustive";

/**
 * Enumeration counters (contract 08 §7). Off by default, written by the
 * enumerations and the shared pair bodies, NEVER read by a check — a run with
 * stats must produce the same report as one without.
 */
export interface DrcRunStats {
  /** `farApart` calls: the pairs an enumeration offered the exact prefilter. */
  prefilterTests: number;
  /** Pairs that reached a per-pair body, by pair kind. */
  pairsJudged: Record<DrcPairKind, number>;
  /** Boundary-edge distance evaluations. */
  edgeTests: number;
}

export function createDrcRunStats(): DrcRunStats {
  return {
    prefilterTests: 0,
    pairsJudged: {
      traceToTrace: 0,
      traceToPad: 0,
      traceToVia: 0,
      padToPad: 0,
      padToVia: 0,
      viaToVia: 0,
      pourToTrace: 0,
      pourToPad: 0,
      pourToVia: 0,
      pourToPour: 0,
    },
    edgeTests: 0,
  };
}

/** Per-run engine options, sourced by the route from `board.viewState`. */
export interface DrcOptions {
  /** Rule-classes the user ignores wholesale — not emitted at all. */
  ignoredRuleClasses?: DrcRuleClass[];
  /** Stable ids of waived violations — emitted with `waived:true`, excluded from summary. */
  waivedIds?: string[];
  /** Per-code severity overrides (from board settings). `"ignore"` drops the code. */
  severityOverrides?: DrcSeverityOverrides;
  /**
   * Raw (KiCad-parsed) footprint lookup, so a placement's courtyard can be
   * recovered for the keepout `footprints` extent (contract §4). The KiCad
   * import drops `F.CrtYd`/`B.CrtYd` before persistence, so without this the
   * extent falls back to the preview bounds — still a superset, just coarser.
   */
  lookupRawFootprint?: RawFootprintLookup;
  /** Candidate discovery mode (contract 08 §3). Default `"grid"`. */
  broadPhase?: DrcBroadPhaseMode;
  /** Counter sink for the oracle harness and the bench; results-neutral. */
  stats?: DrcRunStats;
}
