import type {
  DesignerNetReferenceSite,
  PcbBoardSettings,
  PcbDiffPair,
  PcbDrcRule,
  PcbFreePad,
  PcbLengthMatchGroup,
  PcbTrace,
  PcbVia,
  PcbZone,
} from "../../sdks/designer";

/** `inert-copper` = a disabled zone: listed, never blocking. */
export type NetReferenceClass = "copper" | "inert-copper" | "rule";

export interface NetReference {
  netId: string | null;
  netName: string | null;
  refClass: NetReferenceClass;
  site: DesignerNetReferenceSite;
}

export interface NetReferenceSource {
  board: Pick<
    PcbBoardSettings,
    "perNetClassAssignments" | "lengthMatchGroups" | "diffPairs" | "drcRules"
  >;
  traces: readonly Pick<PcbTrace, "id" | "netId" | "netName">[];
  vias: readonly Pick<PcbVia, "id" | "netId" | "netName">[];
  freePads: readonly Pick<PcbFreePad, "id" | "netId">[];
  zones: readonly Pick<PcbZone, "id" | "netId" | "netName" | "enabled">[];
}

export type NetReferenceVerdict =
  | "none"
  | "bound"
  | "inactive"
  | "unresolved-name";

/**
 * `string`: bind to that id. `null`: unbind (copper loses its id and name, a
 * zone is also disabled; a rule entry is removed). `undefined`: leave as is.
 */
export type NetReferenceRewrite = (ref: NetReference) => string | null | undefined;

type CopperItem = { id: string; netId: string | null; netName?: string | null };
type ZoneItem = Pick<PcbZone, "id" | "netId" | "netName" | "enabled">;

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function hintOf(netName: string | null | undefined): string | null {
  return netName ?? null;
}

function copperRef(
  item: CopperItem,
  site: DesignerNetReferenceSite,
): NetReference {
  return { netId: item.netId, netName: hintOf(item.netName), refClass: "copper", site };
}

function zoneRef(zone: ZoneItem): NetReference {
  return {
    netId: zone.netId,
    netName: zone.netName,
    refClass: zone.enabled ? "copper" : "inert-copper",
    site: { kind: "zone", zoneId: zone.id },
  };
}

function ruleRef(netId: string, site: DesignerNetReferenceSite): NetReference {
  return { netId, netName: null, refClass: "rule", site };
}

function assignmentKeys(record: Record<string, string> | undefined): string[] {
  return Object.keys(record ?? {}).sort(compareText);
}

function groupRefs(group: PcbLengthMatchGroup): NetReference[] {
  return group.netIds.map((netId) =>
    ruleRef(netId, { kind: "lengthGroup", groupId: group.id }),
  );
}

function pairRefs(pair: PcbDiffPair): [NetReference, NetReference] {
  return [
    ruleRef(pair.pNetId, { kind: "diffPair", pairId: pair.id, member: "p" }),
    ruleRef(pair.nNetId, { kind: "diffPair", pairId: pair.id, member: "n" }),
  ];
}

function scopeRefs(rule: PcbDrcRule, scopeIndex: number): NetReference[] {
  const scope = rule.scopes[scopeIndex];
  if (scope?.kind !== "net") return [];
  return scope.netIds.map((netId) =>
    ruleRef(netId, { kind: "drcRule", ruleId: rule.id, scopeIndex }),
  );
}

/**
 * Every persisted net reference, one per copper item (net-less included) and
 * one per rule-side entry. Order: traces, vias, free pads, zones (source
 * order), net-class assignments (key, code-unit order), length groups, diff
 * pairs (p then n), DRC rule net scopes (source order).
 */
export function enumerateNetReferences(src: NetReferenceSource): NetReference[] {
  const refs: NetReference[] = [];
  for (const trace of src.traces) {
    refs.push(copperRef(trace, { kind: "trace", traceId: trace.id }));
  }
  for (const via of src.vias) {
    refs.push(copperRef(via, { kind: "via", viaId: via.id }));
  }
  for (const pad of src.freePads) {
    refs.push(copperRef(pad, { kind: "freePad", freePadId: pad.id }));
  }
  for (const zone of src.zones) refs.push(zoneRef(zone));
  for (const key of assignmentKeys(src.board.perNetClassAssignments)) {
    refs.push(ruleRef(key, { kind: "netClassAssignment" }));
  }
  for (const group of src.board.lengthMatchGroups ?? []) refs.push(...groupRefs(group));
  for (const pair of src.board.diffPairs ?? []) refs.push(...pairRefs(pair));
  for (const rule of src.board.drcRules ?? []) {
    rule.scopes.forEach((_, index) => refs.push(...scopeRefs(rule, index)));
  }
  return refs;
}

/**
 * The verdict depends only on the reference, never on its class; callers
 * decide what blocks (a disabled zone never does).
 */
export function judgeNetReference(
  ref: NetReference,
  activeIds: ReadonlySet<string>,
): NetReferenceVerdict {
  if (ref.netId !== null) return activeIds.has(ref.netId) ? "bound" : "inactive";
  return ref.netName !== null && ref.netName.trim().length > 0
    ? "unresolved-name"
    : "none";
}

/** `undefined` when unchanged, else the new id or null (null on a hint still drops the hint). */
function resolve(map: NetReferenceRewrite, ref: NetReference): string | null | undefined {
  const next = map(ref);
  return next === undefined || (next !== null && next === ref.netId) ? undefined : next;
}

function rewriteCopper<T extends CopperItem>(item: T, to: string | null | undefined): T {
  if (to === undefined) return item;
  if (to !== null) return { ...item, netId: to };
  if (item.netId === null && hintOf(item.netName) === null) return item;
  return "netName" in item
    ? { ...item, netId: null, netName: null }
    : { ...item, netId: null };
}

function rewriteZone<T extends ZoneItem>(zone: T, to: string | null | undefined): T {
  if (to === undefined) return zone;
  if (to !== null) return { ...zone, netId: to };
  if (zone.netId === null && zone.netName === null && !zone.enabled) return zone;
  return { ...zone, netId: null, netName: null, enabled: false };
}

/** Unchanged keys first; then rewritten keys in code-unit order, an existing target wins. */
function rewriteAssignments(
  record: Record<string, string> | undefined,
  map: NetReferenceRewrite,
): Record<string, string> | undefined {
  if (record === undefined) return undefined;
  const keys = assignmentKeys(record);
  const targets = keys.map((key) => resolve(map, ruleRef(key, { kind: "netClassAssignment" })));
  if (targets.every((target) => target === undefined)) return record;
  const next = new Map<string, string>();
  keys.forEach((key, index) => {
    if (targets[index] === undefined) next.set(key, record[key]!);
  });
  keys.forEach((key, index) => {
    const target = targets[index];
    if (typeof target === "string" && !next.has(target)) next.set(target, record[key]!);
  });
  const sorted = [...next.keys()].sort(compareText);
  return Object.fromEntries(sorted.map((key) => [key, next.get(key)!]));
}

/** Null drops an entry; the rest is deduplicated keeping first occurrences. */
function rewriteIdList(
  refs: readonly NetReference[],
  map: NetReferenceRewrite,
): string[] | undefined {
  const targets = refs.map((ref) => resolve(map, ref));
  if (targets.every((target) => target === undefined)) return undefined;
  const ids = refs.map((ref, index) => (targets[index] === undefined ? ref.netId : targets[index]));
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

function rewriteGroups(
  groups: readonly PcbLengthMatchGroup[] | undefined,
  map: NetReferenceRewrite,
): PcbLengthMatchGroup[] | undefined {
  if (groups === undefined) return undefined;
  const next: PcbLengthMatchGroup[] = [];
  for (const group of groups) {
    const netIds = rewriteIdList(groupRefs(group), map);
    if (netIds === undefined) next.push(group);
    else if (netIds.length > 0) next.push({ ...group, netIds });
  }
  return next;
}

function rewritePairs(
  pairs: readonly PcbDiffPair[] | undefined,
  map: NetReferenceRewrite,
): PcbDiffPair[] | undefined {
  if (pairs === undefined) return undefined;
  const next: PcbDiffPair[] = [];
  for (const pair of pairs) {
    const [pRef, nRef] = pairRefs(pair);
    const p = resolve(map, pRef);
    const n = resolve(map, nRef);
    if (p === undefined && n === undefined) {
      next.push(pair);
      continue;
    }
    const pNetId = p === undefined ? pair.pNetId : p;
    const nNetId = n === undefined ? pair.nNetId : n;
    if (pNetId !== null && nNetId !== null && pNetId !== nNetId) {
      next.push({ ...pair, pNetId, nNetId });
    }
  }
  return next;
}

/** A rule whose rewritten net scope ends up empty is removed: `[]` would mean "everything". */
function rewriteRules(
  rules: readonly PcbDrcRule[] | undefined,
  map: NetReferenceRewrite,
): PcbDrcRule[] | undefined {
  if (rules === undefined) return undefined;
  const next: PcbDrcRule[] = [];
  for (const rule of rules) {
    let changed = false;
    let emptied = false;
    const scopes = rule.scopes.map((scope, index) => {
      if (scope.kind !== "net") return scope;
      const netIds = rewriteIdList(scopeRefs(rule, index), map);
      if (netIds === undefined) return scope;
      changed = true;
      if (netIds.length === 0) emptied = true;
      return { ...scope, netIds };
    });
    if (!changed) next.push(rule);
    else if (!emptied) next.push({ ...rule, scopes });
  }
  return next;
}

function rewriteBoard<B extends NetReferenceSource["board"]>(
  board: B,
  map: NetReferenceRewrite,
): B {
  const next: B = { ...board };
  const fields = {
    perNetClassAssignments: rewriteAssignments(board.perNetClassAssignments, map),
    lengthMatchGroups: rewriteGroups(board.lengthMatchGroups, map),
    diffPairs: rewritePairs(board.diffPairs, map),
    drcRules: rewriteRules(board.drcRules, map),
  };
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    if (fields[key] !== undefined) Object.assign(next, { [key]: fields[key] });
  }
  return next;
}

/**
 * Pure: returns a new source, never mutates `src`; unchanged items keep their
 * identity. `map` is called once per reference, in `enumerateNetReferences`
 * order. Copper bound to an id keeps its `netName` (provenance); rule-side
 * collisions follow the rebind contract (§3.13: assignment target already
 * present wins, lists dedupe, a diff pair whose members collapse or unbind is
 * removed, a group or net-scoped rule left empty is removed).
 */
export function rewriteNetReferences<S extends NetReferenceSource>(
  src: S,
  map: NetReferenceRewrite,
): S {
  const traces = src.traces.map((trace) =>
    rewriteCopper(trace, resolve(map, copperRef(trace, { kind: "trace", traceId: trace.id }))),
  );
  const vias = src.vias.map((via) =>
    rewriteCopper(via, resolve(map, copperRef(via, { kind: "via", viaId: via.id }))),
  );
  const freePads = src.freePads.map((pad) =>
    rewriteCopper(pad, resolve(map, copperRef(pad, { kind: "freePad", freePadId: pad.id }))),
  );
  const zones = src.zones.map((zone) => rewriteZone(zone, resolve(map, zoneRef(zone))));
  const board = rewriteBoard(src.board, map);
  return { ...src, traces, vias, freePads, zones, board };
}
