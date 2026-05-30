import type {
  DesignerPcbProjection,
  DrcReport,
  DrcRuleCode,
  DrcViolation,
} from "../../../../sdks/designer";
import { checkBoard } from "./checks/board";
import { checkClearance } from "./checks/clearance";
import { checkConnectivity } from "./checks/connectivity";
import { checkConstraints } from "./checks/constraints";
import { checkManufacturability } from "./checks/manufacturability";
import { checkStructural } from "./checks/structural";
import { buildDrcContext } from "./drc-context";
import type { DrcOptions } from "./types";
import { computeViolationId } from "./violation-id";

/**
 * DRC engine — pure function over the PCB projection, mirroring `runErc`.
 * Builds an mm-domain context, runs every check group, then assigns stable
 * ids, applies ignore/waive options, and tallies the summary.
 */
export function runDrc(
  projection: DesignerPcbProjection,
  options: DrcOptions = {},
): DrcReport {
  const ctx = buildDrcContext(projection);
  const ignored = new Set(options.ignoredRuleClasses ?? []);
  const waived = new Set(options.waivedIds ?? []);

  const drafts = [
    ...checkConstraints(ctx),
    ...checkStructural(ctx),
    ...checkManufacturability(ctx),
    ...checkClearance(ctx),
    ...checkConnectivity(ctx),
    ...checkBoard(ctx),
  ];

  const violations: DrcViolation[] = [];
  const countsByCode: Partial<Record<DrcRuleCode, number>> = {};
  let errors = 0;
  let warnings = 0;
  let infos = 0;

  for (const draft of drafts) {
    if (ignored.has(draft.ruleClass)) continue;
    const id = computeViolationId(draft.code, draft.anchors);
    const isWaived = waived.has(id);
    violations.push(
      isWaived ? { ...draft, id, waived: true } : { ...draft, id },
    );
    countsByCode[draft.code] = (countsByCode[draft.code] ?? 0) + 1;
    if (!isWaived) {
      if (draft.severity === "error") errors += 1;
      else if (draft.severity === "warning") warnings += 1;
      else infos += 1;
    }
  }

  return {
    designId: projection.designId,
    revision: projection.revision,
    violations,
    summary: { errors, warnings, infos },
    countsByCode,
  };
}
