import type { DesignerNetReferenceSite } from "../../sdks/designer/net-identity";
import type {
  PcbBoardSettings,
  PcbDrcRule,
  PcbDiffPair,
  PcbFreePad,
  PcbLengthMatchGroup,
  PcbTrace,
  PcbVia,
  PcbZone,
} from "../../sdks/designer";

export type NetReferenceClass = "copper" | "inert-copper" | "rule";

export interface NetReference {
  netId: string | null;
  netName: string | null;
  refClass: NetReferenceClass;
  site: DesignerNetReferenceSite;
}

export interface NetReferenceSource {
  board: Pick<PcbBoardSettings, "perNetClassAssignments" | "lengthMatchGroups" | "diffPairs" | "drcRules">;
  traces: readonly Pick<PcbTrace, "id" | "netId" | "netName">[];
  vias: readonly Pick<PcbVia, "id" | "netId" | "netName">[];
  freePads: readonly Pick<PcbFreePad, "id" | "netId">[];
  zones: readonly Pick<PcbZone, "id" | "netId" | "netName" | "enabled">[];
}

export type NetReferenceVerdict = "none" | "bound" | "inactive" | "unresolved-name";
type Rewrite = (reference: NetReference) => string | null | undefined;
type Decisions = ReadonlyMap<string, string | null>;
interface Entry { key: string; reference: NetReference }

function key(...parts: Array<string | number>): string {
  return JSON.stringify(parts);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function siteParts(site: DesignerNetReferenceSite): [string, string | number] {
  switch (site.kind) {
    case "trace": return [site.traceId, 0];
    case "via": return [site.viaId, 0];
    case "freePad": return [site.freePadId, 0];
    case "zone": return [site.zoneId, 0];
    case "netClassAssignment": return ["", 0];
    case "lengthGroup": return [site.groupId, 0];
    case "diffPair": return [site.pairId, site.member];
    case "drcRule": return [site.ruleId, site.scopeIndex];
  }
}

function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareText(a, b);
}

function compareEntries(a: Entry, b: Entry): number {
  const first = a.reference;
  const second = b.reference;
  const [firstId, firstMember] = siteParts(first.site);
  const [secondId, secondMember] = siteParts(second.site);
  const memberOrder = typeof firstMember === "number" && typeof secondMember === "number"
    ? firstMember - secondMember
    : compareText(String(firstMember), String(secondMember));
  return compareText(first.site.kind, second.site.kind) ||
    compareText(firstId, secondId) || memberOrder ||
    compareNullable(first.netId, second.netId) ||
    compareNullable(first.netName, second.netName) ||
    compareText(first.refClass, second.refClass);
}

function ruleEntry(entryKey: string, netId: string, site: DesignerNetReferenceSite): Entry {
  return { key: entryKey, reference: { netId, netName: null, refClass: "rule", site } };
}

function copperEntries(src: NetReferenceSource): Entry[] {
  return [
    ...src.traces.map((row, index) => ({ key: key("trace", index), reference: {
      netId: row.netId, netName: row.netName ?? null, refClass: "copper" as const,
      site: { kind: "trace" as const, traceId: row.id },
    } })),
    ...src.vias.map((row, index) => ({ key: key("via", index), reference: {
      netId: row.netId, netName: row.netName ?? null, refClass: "copper" as const,
      site: { kind: "via" as const, viaId: row.id },
    } })),
    ...src.freePads.map((row, index) => ({ key: key("freePad", index), reference: {
      netId: row.netId, netName: null, refClass: "copper" as const,
      site: { kind: "freePad" as const, freePadId: row.id },
    } })),
    ...src.zones.map((row, index) => ({ key: key("zone", index), reference: {
      netId: row.netId, netName: row.netName,
      refClass: row.enabled ? "copper" as const : "inert-copper" as const,
      site: { kind: "zone" as const, zoneId: row.id },
    } })),
  ];
}

function ruleEntries(board: NetReferenceSource["board"]): Entry[] {
  const entries: Entry[] = [];
  for (const netId of Object.keys(board.perNetClassAssignments ?? {})) {
    entries.push(ruleEntry(key("assignment", netId), netId, { kind: "netClassAssignment" }));
  }
  board.lengthMatchGroups?.forEach((group, index) => group.netIds.forEach((netId, member) => {
    entries.push(ruleEntry(key("length", index, member), netId, { kind: "lengthGroup", groupId: group.id }));
  }));
  board.diffPairs?.forEach((pair, index) => {
    for (const member of ["p", "n"] as const) {
      entries.push(ruleEntry(key("pair", index, member), member === "p" ? pair.pNetId : pair.nNetId,
        { kind: "diffPair", pairId: pair.id, member }));
    }
  });
  board.drcRules?.forEach((rule, index) => rule.scopes.forEach((scope, scopeIndex) => {
    if (scope.kind !== "net") return;
    scope.netIds.forEach((netId, member) => {
      entries.push(ruleEntry(key("rule", index, scopeIndex, member), netId,
        { kind: "drcRule", ruleId: rule.id, scopeIndex }));
    });
  }));
  return entries;
}

function entries(src: NetReferenceSource): Entry[] {
  return [...copperEntries(src), ...ruleEntries(src.board)].sort(compareEntries);
}

/** Includes every declared occurrence; duplicate members are not hidden. */
export function enumerateNetReferences(src: NetReferenceSource): NetReference[] {
  return entries(src).map((entry) => entry.reference);
}

export function judgeNetReference(
  ref: NetReference,
  activeIds: ReadonlySet<string>,
): NetReferenceVerdict {
  if (ref.netId !== null) return activeIds.has(ref.netId) ? "bound" : "inactive";
  return ref.netName?.trim() ? "unresolved-name" : "none";
}

function decision(decisions: Decisions, entryKey: string, original: string | null): string | null {
  return decisions.has(entryKey) ? decisions.get(entryKey)! : original;
}

function changed(decisions: Decisions, entryKey: string, original: string): boolean {
  return decisions.has(entryKey) && decisions.get(entryKey) !== original;
}

function rewriteCopper<T extends { netId: string | null; netName?: string | null }>(
  row: T,
  entryKey: string,
  decisions: Decisions,
): T {
  if (!decisions.has(entryKey)) return row;
  const netId = decisions.get(entryKey)!;
  return netId === null ? { ...row, netId, netName: null } : { ...row, netId };
}

function rewriteAssignments(
  assignments: Record<string, string>,
  decisions: Decisions,
): Record<string, string> {
  if (!Object.keys(assignments).some((id) => changed(decisions, key("assignment", id), id))) {
    return assignments;
  }
  const winners = new Map<string, string>();
  for (const source of Object.keys(assignments).sort(compareText)) {
    const destination = decision(decisions, key("assignment", source), source);
    if (destination === null) continue;
    // A destination's own surviving declaration outranks moved declarations.
    if (!winners.has(destination) || source === destination) {
      winners.set(destination, assignments[source]!);
    }
  }
  return Object.fromEntries([...winners.entries()].sort(([a], [b]) => compareText(a, b)));
}

function rewriteMembers(
  ids: readonly string[],
  decisions: Decisions,
  entryKey: (index: number) => string,
): string[] {
  const members = ids.map((id, index) => decision(decisions, entryKey(index), id))
    .filter((id): id is string => id !== null);
  return [...new Set(members)];
}

function rewriteGroups(groups: PcbLengthMatchGroup[], decisions: Decisions): PcbLengthMatchGroup[] {
  return groups.flatMap((group, index) => {
    if (!group.netIds.some((id, member) => changed(decisions, key("length", index, member), id))) {
      return [group];
    }
    const netIds = rewriteMembers(group.netIds, decisions, (member) => key("length", index, member));
    return netIds.length > 0 ? [{ ...group, netIds }] : [];
  });
}

function rewritePairs(pairs: PcbDiffPair[], decisions: Decisions): PcbDiffPair[] {
  return pairs.flatMap((pair, index) => {
    if (!changed(decisions, key("pair", index, "p"), pair.pNetId) &&
        !changed(decisions, key("pair", index, "n"), pair.nNetId)) return [pair];
    const pNetId = decision(decisions, key("pair", index, "p"), pair.pNetId);
    const nNetId = decision(decisions, key("pair", index, "n"), pair.nNetId);
    return pNetId !== null && nNetId !== null && pNetId !== nNetId
      ? [{ ...pair, pNetId, nNetId }]
      : [];
  });
}

function rewriteRules(rules: PcbDrcRule[], decisions: Decisions): PcbDrcRule[] {
  return rules.flatMap((rule, index) => {
    const touched = rule.scopes.some((scope, scopeIndex) => scope.kind === "net" &&
      scope.netIds.some((id, member) => changed(decisions, key("rule", index, scopeIndex, member), id)));
    if (!touched) return [rule];
    let emptyScope = false;
    const scopes = rule.scopes.map((scope, scopeIndex) => {
      if (scope.kind !== "net") return scope;
      const netIds = rewriteMembers(scope.netIds, decisions,
        (member) => key("rule", index, scopeIndex, member));
      if (netIds.length === 0) emptyScope = true;
      return { ...scope, netIds };
    });
    return emptyScope ? [] : [{ ...rule, scopes }];
  });
}

function rewriteBoard<T extends NetReferenceSource["board"]>(board: T, decisions: Decisions): T {
  return {
    ...board,
    ...(board.perNetClassAssignments !== undefined ? {
      perNetClassAssignments: rewriteAssignments(board.perNetClassAssignments, decisions),
    } : {}),
    ...(board.lengthMatchGroups !== undefined ? {
      lengthMatchGroups: rewriteGroups(board.lengthMatchGroups, decisions),
    } : {}),
    ...(board.diffPairs !== undefined ? { diffPairs: rewritePairs(board.diffPairs, decisions) } : {}),
    ...(board.drcRules !== undefined ? { drcRules: rewriteRules(board.drcRules, decisions) } : {}),
  };
}

/** Evaluate the complete snapshot before constructing any rewritten output. */
export function rewriteNetReferences<T extends NetReferenceSource>(src: T, map: Rewrite): T {
  const decisions = new Map<string, string | null>();
  for (const entry of entries(src)) {
    const next = map(entry.reference);
    if (next !== undefined) decisions.set(entry.key, next);
  }
  const copy = structuredClone(src);
  return {
    ...copy,
    board: rewriteBoard(copy.board, decisions),
    traces: copy.traces.map((row, index) => rewriteCopper(row, key("trace", index), decisions)),
    vias: copy.vias.map((row, index) => rewriteCopper(row, key("via", index), decisions)),
    freePads: copy.freePads.map((row, index) => ({
      ...row,
      netId: decision(decisions, key("freePad", index), row.netId),
    })),
    zones: copy.zones.map((row, index) => ({
      ...rewriteCopper(row, key("zone", index), decisions),
      ...(decisions.get(key("zone", index)) === null ? { enabled: false } : {}),
    })),
  };
}
