import type { DesignerNetDependents } from "../../../../sdks/designer/net-identity";
import {
  enumerateNetReferences, type NetReference, type NetReferenceSource,
} from "../../../../shared/electrical-identity/references";

export interface NetDependentsCensus {
  get(netId: string): DesignerNetDependents;
  count(netId: string): number;
}

interface Dependents {
  traces: Set<string>;
  vias: Set<string>;
  zones: Set<string>;
  freePads: Set<string>;
  netClassAssignment: boolean;
  lengthGroupIds: Set<string>;
  diffPairIds: Set<string>;
  drcRuleIds: Set<string>;
}

function emptyDependents(): Dependents {
  return {
    traces: new Set(), vias: new Set(), zones: new Set(), freePads: new Set(),
    netClassAssignment: false, lengthGroupIds: new Set(), diffPairIds: new Set(), drcRuleIds: new Set(),
  };
}

function addReference(row: Dependents, ref: NetReference): void {
  const site = ref.site;
  switch (site.kind) {
    case "trace": row.traces.add(site.traceId); break;
    case "via": row.vias.add(site.viaId); break;
    case "zone": row.zones.add(site.zoneId); break;
    case "freePad": row.freePads.add(site.freePadId); break;
    case "netClassAssignment": row.netClassAssignment = true; break;
    case "lengthGroup": row.lengthGroupIds.add(site.groupId); break;
    case "diffPair": row.diffPairIds.add(site.pairId); break;
    case "drcRule": row.drcRuleIds.add(site.ruleId); break;
  }
}

function count(row: Dependents): number {
  return row.traces.size + row.vias.size + row.zones.size + row.freePads.size +
    Number(row.netClassAssignment) + row.lengthGroupIds.size + row.diffPairIds.size + row.drcRuleIds.size;
}

function sorted(values: Set<string>): string[] {
  return [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function snapshot(row: Dependents): DesignerNetDependents {
  return {
    traces: row.traces.size, vias: row.vias.size, zones: row.zones.size, freePads: row.freePads.size,
    netClassAssignment: row.netClassAssignment,
    lengthGroupIds: sorted(row.lengthGroupIds), diffPairIds: sorted(row.diffPairIds), drcRuleIds: sorted(row.drcRuleIds),
  };
}

/** Counts declared ownership, including inactive ids and disabled zones. */
export function createNetDependentsCensus(source: NetReferenceSource): NetDependentsCensus {
  const byId = new Map<string, Dependents>();
  for (const ref of enumerateNetReferences(source)) {
    if (ref.netId === null) continue;
    const row = byId.get(ref.netId) ?? emptyDependents();
    addReference(row, ref);
    byId.set(ref.netId, row);
  }
  return {
    get: (netId) => snapshot(byId.get(netId) ?? emptyDependents()),
    count: (netId) => count(byId.get(netId) ?? emptyDependents()),
  };
}

/** Loader may read persisted rows or a post-patch history snapshot. */
export function lazyCensus(load: () => NetReferenceSource): NetDependentsCensus {
  let census: NetDependentsCensus | undefined;
  const get = (): NetDependentsCensus => census ??= createNetDependentsCensus(load());
  return {
    get: (netId) => get().get(netId),
    count: (netId) => get().count(netId),
  };
}
