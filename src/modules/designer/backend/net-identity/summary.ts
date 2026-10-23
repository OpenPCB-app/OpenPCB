import type { DesignerNetIdentitySummary, DesignerNetReferenceGroup, DesignerNetReferenceSite } from "../../../../sdks/designer/net-identity";
import type { DesignerSchematicProjection } from "../../../../sdks";
import { enumerateNetReferences, judgeNetReference, type NetReference, type NetReferenceSource } from "../../../../shared/electrical-identity/references";
import { resolveIdentityMode, type IdentityMode } from "./mode";
import { netReferenceProvenance } from "./reference-key";
import { readNetIdentityQuarantine, readNetIdentityRetired, type NetIdentityDb } from "./state-store";
import { groupEvidence, provenanceKey, type SummaryEvidence } from "./summary-evidence";
import { isDurableNetIdOf, isLoneNetId, NetIdentityStateInvalidError } from "./types";

function baseSummary(mode: IdentityMode): DesignerNetIdentitySummary {
  const state = mode.state;
  return {
    status: state?.status ?? "unmigrated", mode: mode.mode,
    origin: state?.provenance.origin ?? null, lastError: state?.lastError ?? mode.unavailable ?? null,
    historiesArchived: state?.provenance.migration?.historiesArchived ?? null,
    groups: [], orphanedCopperCount: 0, inertRuleReferenceCount: 0, exportBlocked: mode.mode === "legacy",
  };
}

function groupKey(ref: NetReference): string {
  return JSON.stringify(ref.netId === null ? ["name", ref.netName] : ["id", ref.netId]);
}

function siteKey(ref: NetReference, includeNetId: boolean): string {
  const provenance = netReferenceProvenance(ref)!;
  return JSON.stringify([provenance.refKind, provenance.refId, ...(includeNetId ? [ref.netId] : [])]);
}

function referenceGroup(refs: NetReference[], evidence: SummaryEvidence): DesignerNetReferenceGroup {
  const traceIds = new Set<string>(), viaIds = new Set<string>(), zoneIds = new Set<string>(), freePadIds = new Set<string>();
  const disabledZoneIds = new Set<string>(), rules = new Map<string, DesignerNetReferenceSite>();
  for (const ref of refs) {
    const site = ref.site;
    switch (site.kind) {
      case "trace": traceIds.add(site.traceId); break;
      case "via": viaIds.add(site.viaId); break;
      case "freePad": freePadIds.add(site.freePadId); break;
      case "zone": (ref.refClass === "inert-copper" ? disabledZoneIds : zoneIds).add(site.zoneId); break;
      default: rules.set(siteKey(ref, true), { ...site });
    }
  }
  return {
    netId: refs[0]!.netId, ...groupEvidence(refs, evidence),
    copper: { traceIds: [...traceIds].sort(), viaIds: [...viaIds].sort(), zoneIds: [...zoneIds].sort(), freePadIds: [...freePadIds].sort() },
    disabledZoneIds: [...disabledZoneIds].sort(), rules: [...rules].sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0).map(([, site]) => site),
  };
}

function durableSummary(base: DesignerNetIdentitySummary, source: NetReferenceSource, evidence: SummaryEvidence): DesignerNetIdentitySummary {
  const groups = new Map<string, NetReference[]>(), copper = new Set<string>(), rules = new Set<string>();
  for (const ref of enumerateNetReferences(source)) {
    const verdict = judgeNetReference(ref, evidence.active);
    if (verdict === "bound" || verdict === "none") continue;
    const key = groupKey(ref), group = groups.get(key) ?? [];
    group.push(ref); groups.set(key, group);
    if (ref.refClass === "copper") copper.add(siteKey(ref, false));
    if (ref.refClass === "rule") rules.add(siteKey(ref, true));
  }
  return {
    ...base, groups: [...groups].sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0)
      .map(([, refs]) => referenceGroup(refs, evidence)),
    orphanedCopperCount: copper.size, inertRuleReferenceCount: rules.size,
    exportBlocked: copper.size > 0 || rules.size > 0,
  };
}

/** Reads authored declarations without filling zones, repairing metadata, or binding names. */
export function buildNetIdentitySummary(
  db: NetIdentityDb, designId: string, schematic: DesignerSchematicProjection, source: NetReferenceSource,
): DesignerNetIdentitySummary {
  const mode = resolveIdentityMode(db, designId), base = baseSummary(mode);
  if (mode.mode === "legacy") return base;
  try {
    return durableSummary(base, source, {
      active: new Set(schematic.nets.filter((net) => isDurableNetIdOf(net.id, designId) || isLoneNetId(net.id)).map((net) => net.id)),
      retired: new Map(readNetIdentityRetired(db, designId).map((row) => [row.netId, row])),
      quarantine: new Map(readNetIdentityQuarantine(db, designId).map((row) => [provenanceKey(row), row])),
      nets: schematic.nets,
    });
  } catch (error) {
    if (!(error instanceof NetIdentityStateInvalidError)) throw error;
    return baseSummary({ mode: "legacy", state: null, unavailable: error.message });
  }
}
