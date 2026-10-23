import type { ReactElement } from "react";
import type { DrcRunEvidence } from "../../../../sdks";

export function DrcEvidenceSummary({
  evidence,
}: {
  evidence: DrcRunEvidence | undefined;
}): ReactElement {
  return (
    <div className="space-y-1 px-2 py-1 text-2xs text-text-tertiary">
      {evidence ? (
        <>
          <p>Batch execution: {evidence.executedStages.length} stages ran.</p>
          <p>
            Requested ignored classes: {evidence.ignoredRuleClasses.length}
            {evidence.ignoredRuleClasses.length > 0
              ? ` (${evidence.ignoredRuleClasses.join(", ")})`
              : ""}
            . Ignored codes: {evidence.ignoredRuleCodes.length}
            {evidence.ignoredRuleCodes.length > 0
              ? ` (${evidence.ignoredRuleCodes.join(", ")})`
              : ""}
            . Requested waiver IDs: {evidence.waivedIds.length}.
          </p>
          <p>Requested filters and waivers cannot suppress safety-critical findings.</p>
          {Object.keys(evidence.severityOverrides).length > 0 ? (
            <p>
              Requested severity overrides: {Object.entries(evidence.severityOverrides)
                .map(([code, severity]) => `${code}: ${severity}`)
                .join(", ")}.
            </p>
          ) : null}
          {evidence.limitations.length > 0 ? (
            <ul className="space-y-1 text-status-warning" aria-label="Assessment limitations">
              {evidence.limitations.map((limitation, index) => (
                <li key={`${limitation.code}:${index}`}>
                  {limitation.code}: {limitation.message}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p>Execution evidence unavailable for this report.</p>
      )}
      <p>
        Stage execution does not establish full geometry or standards coverage.
        This does not certify board manufacturability or electrical correctness.
      </p>
    </div>
  );
}
