import { record } from "../agentkit-projections";
export function RecoveringOutcome() {
  return <div role="status" className="rounded border border-status-warning/40 p-2 text-status-warning">
    Outcome unknown — recovering. This apply was started but its result is not recorded yet; it is reconciled from committed design receipts, never re-run. Apply and Reject stay disabled until then.
  </div>;
}
export function ProposalOutcome({ outcome }: { outcome: unknown }) {
  const value = record(outcome);
  if (typeof value.status !== "string") return null;
  const failures = Array.isArray(value.failedOps) ? value.failedOps.map(record) : [];
  let result: Record<string, unknown> = {};
  try { result = record(JSON.parse(typeof value.resultJson === "string" ? value.resultJson : "{}")); } catch { /* A malformed optional detail cannot turn a failed outcome into success. */ }
  const receipts = Array.isArray(result.receipts) ? result.receipts.map(record) : [];
  const creations = Array.isArray(result.creations) ? result.creations.map(record) : [];
  return <div role="status" className="space-y-1 rounded border border-border p-2 dark:border-border">
    <div>Outcome: {value.status}{typeof value.appliedOps === "number" ? ` · ${value.appliedOps} applied` : ""}</div>
    {failures.map((failure, index) => <div key={index} className="text-status-warning">Operation {String(failure.opIndex)}: {String(failure.error)}</div>)}
    {receipts.length || creations.length ? <details><summary className="cursor-pointer">Committed domain receipts</summary>
      {receipts.map((receipt, index) => { const applied = record(receipt.result); return <div key={index} className="break-all font-mono text-[10px]">{String(receipt.commandId)} · {applied.ok === true ? "committed" : "failed"}{typeof applied.revision === "number" ? ` · revision ${applied.revision}` : ""}{typeof applied.createdEntityId === "string" ? ` · entity ${applied.createdEntityId}` : ""}</div>; })}
      {creations.map((creation, index) => { const design = record(creation.design); return <div key={index} className="break-all font-mono text-[10px]">Created design {String(design.id ?? record(creation.identity).designId)}</div>; })}
    </details> : null}
  </div>;
}
