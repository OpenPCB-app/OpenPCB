import type { RuleProblem } from "../rule-resolver";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/**
 * Rule-table validity (rule-semantics contract §2.1, §10). The resolver is the
 * only thing that knows which stored rules it could not apply; this check just
 * reports what it refused.
 *
 * `DRC_RULE_INVALID` is an error and non-overridable: the rule is excluded from
 * resolution, and a dropped TIGHTENING rule is fail-open — silently passing a
 * board because its strictest rule was malformed is the failure mode this
 * exists to stop. `DRC_RULE_INEFFECTIVE` is a warning: the rule still resolves,
 * just not with the number (or against the references) its author wrote.
 *
 * ONE violation per (code, rule id): a violation id hashes only its code and
 * anchors, so several problems on one rule — or several rows fighting over one
 * id — must share a message (in the resolver's array-then-reason order) rather
 * than emit colliding ids.
 */
export function checkRules(ctx: DrcContext): DrcViolationDraft[] {
  return [
    ...group(ctx.resolver.problems, "invalid").map(([id, problems]) => ({
      code: "DRC_RULE_INVALID" as const,
      message: `Rule "${labelOf(problems)}" cannot be applied: ${details(problems)}`,
      anchors: [{ kind: "rule" as const, ruleId: id }],
    })),
    ...group(ctx.resolver.problems, "ineffective").map(([id, problems]) => ({
      code: "DRC_RULE_INEFFECTIVE" as const,
      message: `Rule "${labelOf(problems)}" has no effect: ${details(problems)}`,
      anchors: [{ kind: "rule" as const, ruleId: id }],
    })),
  ];
}

/** Problems of one kind, bucketed by rule id, in first-seen order. */
function group(
  problems: readonly RuleProblem[],
  kind: RuleProblem["kind"],
): Array<[string, RuleProblem[]]> {
  const byId = new Map<string, RuleProblem[]>();
  for (const p of problems) {
    if (p.kind !== kind) continue;
    const bucket = byId.get(p.ruleId);
    if (bucket) bucket.push(p);
    else byId.set(p.ruleId, [p]);
  }
  return [...byId.entries()];
}

function labelOf(problems: readonly RuleProblem[]): string {
  const first = problems[0]!;
  return first.ruleName || first.ruleId;
}

function details(problems: readonly RuleProblem[]): string {
  return problems.map((p) => p.detail).join("; ");
}
