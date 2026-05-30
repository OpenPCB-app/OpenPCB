import type { DrcRuleClass, DrcViolation } from "../../../../sdks/designer";

/** A violation before the engine assigns its stable id / waived flag. */
export type DrcViolationDraft = Omit<DrcViolation, "id" | "waived">;

/** Per-run engine options, sourced by the route from `board.viewState`. */
export interface DrcOptions {
  /** Rule-classes the user ignores wholesale — not emitted at all. */
  ignoredRuleClasses?: DrcRuleClass[];
  /** Stable ids of waived violations — emitted with `waived:true`, excluded from summary. */
  waivedIds?: string[];
}
