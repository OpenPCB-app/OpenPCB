import type { DesignerNetReferenceSite } from "../../../../sdks/designer/net-identity";
import {
  enumerateNetReferences, rewriteNetReferences, type NetReference, type NetReferenceSource,
} from "../../../../shared/electrical-identity/references";
import {
  classifyLegacyReference, type LegacyReferenceClassification, type LegacyReferenceContext,
} from "./migration-classify";
import {
  netReferenceDecisionKey, netReferenceProvenance, type NetReferenceProvenance,
} from "./reference-key";
import type { NetIdentityMigrationReport, QuarantineReason } from "./types";

type Decisions = Map<string, LegacyReferenceClassification>;
type Quarantine = NetReferenceProvenance & {
  reason: QuarantineReason;
  candidates: string[];
  suggestedNetId: string | null;
};

export interface LegacyNetReferencePlan<T extends NetReferenceSource = NetReferenceSource> {
  rewritten: T;
  decisions: ReadonlyMap<string, LegacyReferenceClassification>;
  quarantines: Quarantine[];
  references: NetIdentityMigrationReport["references"];
}

const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Classify the complete source before making any rewrite or collision decision. */
export function planLegacyNetReferences<T extends NetReferenceSource>(
  source: T, context: LegacyReferenceContext,
): LegacyNetReferencePlan<T> {
  const refs = enumerateNetReferences(source);
  const decisions: Decisions = new Map(refs.map((ref) => [
    netReferenceDecisionKey(ref), classifyLegacyReference(ref, context),
  ]));
  resolveAssignments(source, refs, decisions);
  resolvePairs(source, decisions);
  const rewritten = rewriteNetReferences(source, (ref) => {
    const decision = decisions.get(netReferenceDecisionKey(ref));
    return decision?.kind === "bound" ? decision.netId : undefined;
  });
  return {
    rewritten: clearAutoNames(source, rewritten, decisions),
    decisions,
    quarantines: collectQuarantines(refs, decisions),
    references: countReferences(refs, decisions),
  };
}

interface Assignment {
  ref: NetReference;
  source: string;
  classId: string;
}

function resolveAssignments(source: NetReferenceSource, refs: NetReference[], decisions: Decisions): void {
  const assignments: Assignment[] = refs.flatMap((ref) =>
    ref.site.kind === "netClassAssignment" && ref.netId !== null
      ? [{ ref, source: ref.netId, classId: source.board.perNetClassAssignments![ref.netId]! }]
      : []);
  // Quarantining a loser preserves its old key, which can reveal another collision.
  // Only bound decisions can be removed, so at most assignments.length are removed.
  let changed = true;
  while (changed) {
    changed = false;
    const groups = new Map<string, Assignment[]>();
    for (const assignment of assignments) {
      const decision = decisions.get(netReferenceDecisionKey(assignment.ref))!;
      const target = decision.kind === "bound" ? decision.netId : assignment.source;
      const group = groups.get(target) ?? [];
      group.push(assignment);
      groups.set(target, group);
    }
    for (const [target, group] of [...groups].sort(([a], [b]) => compareText(a, b))) {
      group.sort((a, b) => compareText(a.source, b.source));
      const winner = group.find((row) => row.source === target) ?? group[0]!;
      for (const assignment of group) {
        if (assignment.classId === winner.classId) continue;
        const key = netReferenceDecisionKey(assignment.ref);
        const decision = decisions.get(key)!;
        if (decision.kind !== "bound") continue;
        decisions.set(key, {
          kind: "quarantine", reason: "assignment_conflict",
          candidates: [decision.netId], suggestedNetId: decision.netId,
        });
        changed = true;
      }
    }
  }
}

function pairRef(pair: { id: string; pNetId: string; nNetId: string }, member: "p" | "n"): NetReference {
  return {
    netId: member === "p" ? pair.pNetId : pair.nNetId, netName: null, refClass: "rule",
    site: { kind: "diffPair", pairId: pair.id, member },
  };
}

function resolvePairs(source: NetReferenceSource, decisions: Decisions): void {
  const pairs = [...(source.board.diffPairs ?? [])].sort((a, b) =>
    compareText(a.id, b.id) || compareText(a.pNetId, b.pNetId) || compareText(a.nNetId, b.nNetId));
  // Duplicate pair ids can share member decisions; one collapse can expose another.
  let changed = true;
  while (changed) {
    changed = false;
    for (const pair of pairs) {
      const refs = [pairRef(pair, "p"), pairRef(pair, "n")];
      const current = refs.map((ref) => decisions.get(netReferenceDecisionKey(ref))!);
      if (!current.some((decision) => decision.kind === "bound")) continue;
      const targets = current.map((decision, index) => decision.kind === "bound" ? decision.netId : refs[index]!.netId);
      if (targets[0] !== targets[1]) continue;
      for (const ref of refs) decisions.set(netReferenceDecisionKey(ref), {
        kind: "quarantine", reason: "diff_pair_collapsed",
        candidates: [targets[0]!], suggestedNetId: null,
      });
      changed = true;
    }
  }
}

function clearName<T extends { netName?: string | null }>(
  row: T, original: { netId: string | null; netName?: string | null },
  site: DesignerNetReferenceSite, decisions: Decisions,
): T {
  const decision = decisions.get(netReferenceDecisionKey({
    site, netId: original.netId, netName: original.netName ?? null, refClass: "copper",
  }));
  return decision?.kind === "bound" && decision.method === "autoNameHint"
    ? { ...row, netName: null } : row;
}

function clearAutoNames<T extends NetReferenceSource>(source: T, rewritten: T, decisions: Decisions): T {
  return {
    ...rewritten,
    traces: rewritten.traces.map((row, index) => clearName(row, source.traces[index]!, { kind: "trace", traceId: row.id }, decisions)),
    vias: rewritten.vias.map((row, index) => clearName(row, source.vias[index]!, { kind: "via", viaId: row.id }, decisions)),
    zones: rewritten.zones.map((row, index) => clearName(row, source.zones[index]!, { kind: "zone", zoneId: row.id }, decisions)),
  };
}

function collectQuarantines(refs: NetReference[], decisions: Decisions): Quarantine[] {
  const rows = new Map<string, Quarantine>();
  for (const ref of refs) {
    const decision = decisions.get(netReferenceDecisionKey(ref))!;
    if (decision.kind !== "quarantine") continue;
    const provenance = netReferenceProvenance(ref);
    if (!provenance) continue;
    const key = JSON.stringify([provenance.refKind, provenance.refId, provenance.legacyValue]);
    rows.set(key, {
      ...provenance, reason: decision.reason,
      candidates: [...decision.candidates], suggestedNetId: decision.suggestedNetId,
    });
  }
  return [...rows].sort(([a], [b]) => compareText(a, b)).map(([, row]) => row);
}

function countReferences(refs: NetReference[], decisions: Decisions): NetIdentityMigrationReport["references"] {
  const bound = { rootAndContact: 0, rootAndPour: 0, contact: 0, nameHint: 0, autoNameHint: 0 };
  const quarantined = new Map<QuarantineReason, number>();
  for (const ref of refs) {
    const decision = decisions.get(netReferenceDecisionKey(ref))!;
    if (decision.kind === "bound") bound[decision.method]++;
    if (decision.kind === "quarantine") quarantined.set(decision.reason, (quarantined.get(decision.reason) ?? 0) + 1);
  }
  return {
    total: refs.length, bound,
    quarantined: Object.fromEntries([...quarantined].sort(([a], [b]) => compareText(a, b))),
  };
}
