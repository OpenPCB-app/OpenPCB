interface ReportIdentity {
  designId: string;
  revision: number;
}

export type ValidationReportState =
  | "missing"
  | "previous"
  | "stale"
  | "unknown-revision"
  | "current";

export function validationReportState(params: {
  report: ReportIdentity | null;
  designId: string | null;
  revision: number | null;
  previous: boolean;
}): ValidationReportState {
  const { report, designId, revision, previous } = params;
  if (!report || !designId || report.designId !== designId) return "missing";
  if (revision === null) return "unknown-revision";
  if (report.revision !== revision) return "stale";
  return previous ? "previous" : "current";
}

export function validationReportNotice(
  kind: "ERC" | "DRC",
  state: ValidationReportState,
): string | null {
  if (state === "stale") {
    return `Previous ${kind} report: the design changed. Re-run ${kind}.`;
  }
  if (state === "previous") {
    return `Showing the previous ${kind} report, not the latest run's result.`;
  }
  if (state === "unknown-revision") {
    return `Previous ${kind} report: the current design revision is unavailable.`;
  }
  return null;
}
