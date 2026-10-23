import { useEffect } from "react";
import { create } from "zustand";
import type { DesignerPcbProjection } from "../../../../sdks/designer";
import { Button } from "../../../../shared/frontend/ui/button";
import { netIdentityEventMessage } from "./event-message";
import { selectNetIdentityActivity, useNetIdentityActivityStore } from "./net-identity-activity-store";
import { activeNetChoices, inertAssignmentBindings, referenceGroupKey, repairLimitError,
  repairReadiness, suggestionBindings } from "./net-identity-model";
import { NetIdentityGroupRow } from "./NetIdentityGroupRow";
import { NetIdentityReceipt } from "./NetIdentityReceipt";
import { useNetIdentityPanel, type NetIdentityApi, type NetIdentityPanelActions } from "./use-net-identity-panel";

interface Props extends NetIdentityPanelActions {
  api: NetIdentityApi;
  scope: string;
  designId: string;
  revision: number | null;
  projection: DesignerPcbProjection | null;
  projectionError?: string | null;
  refreshProjection(revision?: number): Promise<DesignerPcbProjection>;
}
const useHistoryNotice = create<{ dismissed: ReadonlySet<string> }>(() => ({ dismissed: new Set() }));

function ArchivedHistoryNotice({ scope, designId, count }: { scope: string; designId: string; count: number | null }) {
  const key = JSON.stringify([scope, designId]);
  const dismissed = useHistoryNotice((state) => state.dismissed.has(key));
  if (!count || dismissed) return null;
  return <div className="rounded-control bg-status-warning-soft p-2">
    {count} undo {count === 1 ? "history was" : "histories were"} archived during migration.
    <Button size="sm" onClick={() => useHistoryNotice.setState((state) => ({ dismissed: new Set([...state.dismissed, key]) }))}>Dismiss archived history notice</Button>
  </div>;
}

function RecentNetChanges({ scope, designId }: { scope: string; designId: string }) {
  const entries = useNetIdentityActivityStore(selectNetIdentityActivity(scope, designId));
  useEffect(() => { useNetIdentityActivityStore.getState().markRead(scope, designId); }, [scope, designId, entries]);
  return <div className="space-y-1">
    <h4 className="font-medium">Recent net changes</h4>
    {entries.length === 0 ? <p className="text-text-tertiary">No net changes observed in this session.</p> :
      <ol>{[...entries].reverse().map((entry) => <li key={entry.id} className="border-t border-border-subtle py-1">
        <span className="text-text-tertiary">Revision {entry.revision} · {entry.source}: </span>
        {netIdentityEventMessage(entry.event)} {entry.event.hasDependents ? "Review copper and rules." : ""}
      </li>)}</ol>}
  </div>;
}

export function NetIdentityPanel(props: Props) {
  const panel = useNetIdentityPanel(props);
  const status = panel.status;
  const choices = activeNetChoices(props.projection), active = new Set(choices.map((net) => net.id));
  const readiness = repairReadiness(status, props.projection, props.designId, props.revision);
  const disabled = !!readiness || !!props.projectionError || panel.loading || panel.action.busy || panel.action.refreshFailed;
  const suggestions = suggestionBindings(status?.groups ?? [], active);
  const inert = inertAssignmentBindings(status?.groups ?? []);
  const bulkError = repairLimitError(suggestions) ?? repairLimitError(inert);
  return <section aria-label="Net identity" className="space-y-2 border-b border-border p-2 text-2xs text-text-secondary">
    <h3 className="font-medium text-text-strong">Net identity</h3>
    {panel.loading ? <p role="status">Loading identity status…</p> : null}
    <Button size="sm" disabled={panel.action.busy || panel.action.refreshFailed} onClick={() => void panel.refreshStatus()}>Refresh identity status and active nets</Button>
    {panel.error ? <div role="alert">{panel.error}</div> : null}
    {props.projectionError ? <div role="alert">Active nets unavailable: {props.projectionError}</div> : null}
    {status ? <>
      <div>Status: {status.status} · {status.mode} · revision {status.revision}</div>
      {status.lastError ? <div role="alert">{status.lastError}</div> : null}
      <ArchivedHistoryNotice scope={props.scope} designId={props.designId} count={status.historiesArchived} />
      <div>{status.orphanedCopperCount} unresolved enabled copper references · {status.inertRuleReferenceCount} inert rule references</div>
      {!readiness && !props.projectionError && status.groups.length === 0 ? <p>Identity references resolved.</p> : null}
      {status.status !== "active" ? <Button size="sm" disabled={panel.action.busy || panel.action.refreshFailed} onClick={() => void panel.migrate()}>Retry migration</Button> : null}
      {status.status === "active" && status.origin === "legacy-migration" ? <Button size="sm" disabled={panel.action.busy || panel.action.refreshFailed} onClick={() => void panel.restore()}>Restore original legacy backup</Button> : null}
      {readiness ? <p>{readiness}</p> : null}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={disabled || suggestions.length === 0 || !!repairLimitError(suggestions)} onClick={() => void panel.repair(suggestions)}>Accept all suggestions</Button>
        <Button size="sm" disabled={disabled || inert.length === 0 || !!repairLimitError(inert)} onClick={() => void panel.repair(inert)}>Drop all inert assignments</Button>
      </div>
      {bulkError ? <p role="alert">{bulkError}</p> : null}
      {status.groups.map((group) => <NetIdentityGroupRow key={referenceGroupKey(group)} group={group} choices={choices} disabled={disabled} onRepair={panel.repair} />)}
    </> : null}
    {panel.action.busy ? <p role="status">Updating identity…</p> : null}
    {panel.action.message ? <p role="status">{panel.action.message}</p> : null}
    {panel.action.receipt ? <NetIdentityReceipt receipt={panel.action.receipt} /> : null}
    {panel.action.error ? <div role="alert">{panel.action.refreshFailed ? "Applied; refresh failed: " : ""}{panel.action.error}</div> : null}
    {panel.action.refreshFailed ? <Button size="sm" disabled={panel.action.busy} onClick={() => void panel.retryRefresh()}>Retry refresh</Button> : null}
    <p className="text-text-tertiary">Identity status covers references only. DRC and manufacturing qualification remain separate.</p>
    <RecentNetChanges scope={props.scope} designId={props.designId} />
  </section>;
}
