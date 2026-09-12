import type { PcbNetClass } from "../../../sdks/designer";
import { isInternalCopperLayer, requiredTraceWidthMm } from "../ipc2221-spacing";
import { below, type DrcContext, type LegalityContext } from "../drc-context";
import type { ItemSet } from "./clearance-judge";
import type { DrcViolationDraft } from "../types";

/**
 * The IPC-2221 current-versus-trace-width estimate (electrical contract 13 §5),
 * net-class driven (`currentA`) and resolved LIVE from each trace's TIER net
 * (§4.2) — so unassigned copper that extends a rated conductor is rated with
 * it, in batch and at the live gate alike.
 *
 * A per-item form (07 §3) rather than a whole-board check: `legality.ts`
 * dispatches it over the pending copper and over the existing items the pending
 * copper re-tiered, so `TRACE_CURRENT_WIDTH` is a live warning that comes out
 * of this same body instead of a second estimate.
 *
 * Malformed electrical input is REPORTED by `checks/rules.ts` as
 * `DRC_RULE_INVALID` and judged by nobody (§2, §5): the pre-S13 helper answered
 * a zero rise or copper weight with a 0 mm requirement, which every trace
 * passed. `requiredTraceWidthMm` now throws on such an input, so the two skips
 * below — the electrical block, then the class's own `currentA` — are also what
 * keep this check total.
 *
 * The IPC-2221 conductor SPACING verdict is no longer here. It is a
 * non-relaxable CONSTITUENT of the rule resolver (13 §3), reported by the pair
 * judge as its own `CREEPAGE_DISTANCE` row beside the ordinary clearance row —
 * so the copper pour, the route obstacles and the live gate inherit it by
 * construction instead of each deriving it, and a waiver of the clearance row
 * can no longer hide the IPC breach.
 */
export function currentItems(
  ctx: LegalityContext,
  items: ItemSet,
  opts: { out: DrcViolationDraft[] },
): void {
  const problems = ctx.resolver.electricalProblems;
  if (problems.some((p) => p.ruleId.startsWith("designRules.electrical."))) {
    return;
  }
  // The class's CURRENT declaration only (§5). A malformed voltage endpoint
  // costs that class its spacing constituent, not a current verdict it still
  // has every input for.
  const flagged = (cls: PcbNetClass): boolean =>
    problems.some((p) => p.ruleId === `netClass:${cls.id}:currentA`);

  const board = ctx.board;
  const elec = board.designRules.electrical;
  const tempRiseC = elec?.tempRiseC ?? 10;
  const outerOz = elec?.copperWeightOz ?? 1;
  const innerOz = elec?.innerCopperWeightOz ?? outerOz;
  const classById = new Map(board.netClasses.map((c) => [c.id, c]));

  for (const t of items.traces) {
    // The ONE net-class chain (contract 06 §1): the resolver's memoized live
    // resolution of the TIER net, never a second `resolveNetClassId` call.
    const cls = classById.get(ctx.resolver.netClassIdOf(ctx.tierNetOf(t)));
    const currentA = cls?.currentA;
    if (!cls || currentA === undefined || flagged(cls)) continue;
    // `!(x > 0)` and not `x <= 0`: an unrated, NaN or infinite current is
    // skipped, never a throw out of the helper.
    if (!(currentA > 0) || !Number.isFinite(currentA)) continue;
    const internal = isInternalCopperLayer(t.layer);
    const oz = internal ? innerOz : outerOz;
    const req = requiredTraceWidthMm(currentA, tempRiseC, oz, internal);
    if (!below(t.widthMm, req)) continue;
    opts.out.push({
      code: "TRACE_CURRENT_WIDTH",
      message: `Trace ${t.widthMm.toFixed(3)} mm is below the IPC-2221 minimum ${req.toFixed(3)} mm for ${currentA} A at ${tempRiseC} °C rise on ${oz} oz ${internal ? "inner" : "outer"} copper, assuming every segment carries the full class current`,
      anchors: [{ kind: "trace", traceId: t.id }],
      locationMm: t.mid,
      layer: t.layer,
      measuredMm: t.widthMm,
      requiredMm: req,
    });
  }
}

export function checkElectrical(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  currentItems(ctx, ctx, { out });
  return out;
}
