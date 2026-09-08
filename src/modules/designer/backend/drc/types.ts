import type {
  DrcRuleClass,
  DrcSeverity,
  DrcViolation,
} from "../../../../sdks/designer";
import type { RawFootprintLookup } from "../pcb/courtyard";
import type { DrcSeverityOverrides } from "./severity";

/**
 * A violation before the engine resolves its severity and assigns its stable
 * id / waived flag. Checks emit FACTS — code, anchors, measured, required —
 * and never a severity literal (rule-semantics contract §7): the engine picks
 * `override → ruleSeverity → DEFAULT_SEVERITY_BY_CODE`. `ruleSeverity` is set
 * only when a scoped rule set the value the check compared against; for an
 * aggregate over several layers or witnesses it is the MOST severe of them, so
 * aggregation never downgrades. Non-waivability is likewise not a draft flag:
 * `NON_OVERRIDABLE` (severity.ts) is the single list.
 */
export type DrcViolationDraft = Omit<
  DrcViolation,
  "id" | "waived" | "severity"
> & {
  ruleSeverity?: DrcSeverity;
};

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
}
