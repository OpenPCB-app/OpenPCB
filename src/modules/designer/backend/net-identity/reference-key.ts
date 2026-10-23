import type { NetReference } from "../../../../shared/electrical-identity/references";
import type { NetIdentityReferenceKind } from "./types";

export interface NetReferenceProvenance {
  refKind: NetIdentityReferenceKind;
  refId: string;
  legacyValue: string;
}

function siteIdentity(ref: NetReference): Omit<NetReferenceProvenance, "legacyValue"> {
  const site = ref.site;
  switch (site.kind) {
    case "trace": return { refKind: "trace", refId: site.traceId };
    case "via": return { refKind: "via", refId: site.viaId };
    case "freePad": return { refKind: "free_pad", refId: site.freePadId };
    case "zone": return { refKind: "zone", refId: site.zoneId };
    case "netClassAssignment": return { refKind: "net_class_assignment", refId: "perNetClassAssignments" };
    case "lengthGroup": return { refKind: "length_group", refId: site.groupId };
    case "diffPair": return { refKind: "diff_pair", refId: JSON.stringify([site.pairId, site.member]) };
    case "drcRule": return { refKind: "drc_rule", refId: JSON.stringify([site.ruleId, site.scopeIndex]) };
  }
}

/** Preserve the authored value exactly; normalization belongs only to lookup. */
export function netReferenceProvenance(ref: NetReference): NetReferenceProvenance | null {
  const legacyValue = ref.netId !== null ? ref.netId : ref.netName?.trim() ? ref.netName : null;
  return legacyValue === null ? null : { ...siteIdentity(ref), legacyValue };
}

/** Identical occurrences share a decision; distinct scopes and pair members do not. */
export function netReferenceDecisionKey(ref: NetReference): string {
  const { refKind, refId } = siteIdentity(ref);
  return JSON.stringify([refKind, refId, ref.netId, ref.netName]);
}
