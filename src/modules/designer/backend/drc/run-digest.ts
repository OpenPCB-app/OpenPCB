/**
 * The digests and recorded settings that bind a persisted DRC result to the
 * board and rules it was computed over (H19 / OPENPCB-67 §3.5). The run
 * service stamps them at start; the manufacturing export gate recomputes them
 * from its snapshot and refuses on any mismatch.
 */
import { createHash } from "node:crypto";
import type {
  DesignerPcbProjection,
  DrcRuleCode,
  ManufacturingDrcEvidence,
} from "../../../../sdks/designer";
import { drcOptionsFromProjection } from "./drc-engine";
import { DEFAULT_SEVERITY_BY_CODE } from "./severity";

/**
 * The run join key's second half (execution contract 09 §5) and the stamp's
 * options digest. View-state suppressions bump the revision, so as a join key
 * the digest is insurance rather than the mechanism — but a rules-only change
 * that somehow kept the revision must still supersede.
 *
 * Byte-identical to the pre-H19 module-private `computeOptionsDigest`.
 */
export function computeDrcOptionsDigest(
  projection: DesignerPcbProjection,
): string {
  const payload = JSON.stringify({
    ...drcOptionsFromProjection(projection),
    severityOverrides: projection.board.drcSeverityOverrides ?? null,
  });
  return createHash("sha1").update(payload).digest("hex");
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The severity suppressions a run applies besides class ignores and waivers,
 * in the shape the export evidence displays. A code the severity table does
 * not know cannot suppress anything, so it is not listed.
 */
export function drcSeveritySettings(projection: DesignerPcbProjection): {
  severityOverrides: ManufacturingDrcEvidence["severityOverrides"];
  ruleSeverities: ManufacturingDrcEvidence["ruleSeverities"];
} {
  const severityOverrides: ManufacturingDrcEvidence["severityOverrides"] = [];
  const overrides = projection.board.drcSeverityOverrides ?? {};
  for (const [code, severity] of Object.entries(overrides)) {
    // The parser validates severities but not codes; `hasOwn` keeps a stale
    // or hostile key (`toString`) from reading the prototype.
    if (severity === undefined || !Object.hasOwn(DEFAULT_SEVERITY_BY_CODE, code)) {
      continue;
    }
    const known = code as DrcRuleCode;
    severityOverrides.push({
      code: known,
      severity,
      defaultSeverity: DEFAULT_SEVERITY_BY_CODE[known],
    });
  }
  severityOverrides.sort((a, b) => byCodeUnit(a.code, b.code));

  const ruleSeverities: ManufacturingDrcEvidence["ruleSeverities"] = [];
  for (const rule of projection.board.drcRules ?? []) {
    if (rule.severity === undefined) continue;
    ruleSeverities.push({ ruleId: rule.id, severity: rule.severity });
  }
  ruleSeverities.sort((a, b) => byCodeUnit(a.ruleId, b.ruleId));
  return { severityOverrides, ruleSeverities };
}
