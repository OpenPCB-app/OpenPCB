import type { DesignerNetIdentityStatus, DesignerNetReferenceGroup, DesignerPcbProjection,
  DesignerPcbRebindNetReferencesCommand } from "../../../../sdks/designer";

export type NetRepairBinding = DesignerPcbRebindNetReferencesCommand["bindings"][number];
export const NET_REPAIR_LIMIT = 500;
export const NET_REPAIR_LIMIT_MESSAGE = "Choose at most 500 bindings per repair";

export function referenceGroupKey(group: DesignerNetReferenceGroup): string {
  return JSON.stringify(group.netId === null ? ["name", group.netName] : ["id", group.netId]);
}

export function bindingForGroup(group: DesignerNetReferenceGroup, toNetId: string | null): NetRepairBinding | null {
  if (group.netId === null && !group.netName?.trim()) return null;
  return group.netId === null
    ? { fromNetId: null, fromNetName: group.netName, toNetId }
    : { fromNetId: group.netId, toNetId };
}

export function isRuleOnlyGroup(group: DesignerNetReferenceGroup): boolean {
  return group.rules.length > 0 && group.copper.traceIds.length === 0 && group.copper.viaIds.length === 0 &&
    group.copper.freePadIds.length === 0 && group.copper.zoneIds.length === 0 && group.disabledZoneIds.length === 0;
}

export function suggestionBindings(groups: readonly DesignerNetReferenceGroup[], activeIds: ReadonlySet<string>): NetRepairBinding[] {
  return groups.flatMap((group) => {
    if (!group.suggestedNetId || !activeIds.has(group.suggestedNetId)) return [];
    const binding = bindingForGroup(group, group.suggestedNetId);
    return binding ? [binding] : [];
  });
}

export function inertAssignmentBindings(groups: readonly DesignerNetReferenceGroup[]): NetRepairBinding[] {
  return groups.filter(isRuleOnlyGroup).flatMap((group) => {
    const binding = bindingForGroup(group, null);
    return binding ? [binding] : [];
  });
}

export function repairLimitError(bindings: readonly NetRepairBinding[]): string | null {
  return bindings.length > NET_REPAIR_LIMIT ? NET_REPAIR_LIMIT_MESSAGE : null;
}

function persistedId(id: string): boolean {
  const durable = /^net:[a-z2-7]{10}:([1-9][0-9]*)$/.exec(id);
  return durable?.[0] === id && Number.isSafeInteger(Number(durable[1])) || /^nc:.+$/.exec(id)?.[0] === id;
}

export function repairReadiness(
  status: DesignerNetIdentityStatus | null, projection: DesignerPcbProjection | null,
  designId: string, revision: number | null,
): string | null {
  if (!status) return "Identity status is unavailable.";
  if (status.status !== "active" || status.mode !== "durable") return "Repair requires active durable identity.";
  if (revision === null || status.revision !== revision || projection?.designId !== designId || projection.revision !== revision) {
    return "Waiting for identity status and active nets at the current design revision.";
  }
  return null;
}

export function activeNetChoices(projection: DesignerPcbProjection | null): Array<{ id: string; name: string }> {
  return Object.entries(projection?.netNames ?? {}).filter(([id]) => persistedId(id)).map(([id, name]) => ({ id, name }));
}
