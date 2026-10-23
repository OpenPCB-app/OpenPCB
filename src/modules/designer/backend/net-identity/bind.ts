import {
  reconcileElectricalIdentity,
  type ElectricalNetRetirement,
  type ElectricalNetTransition,
} from "../../../../shared/electrical-identity";
import type { DerivedNetComponent } from "../projection-world";
import { memberToken, prepareBindInput, type CanonicalComponent } from "./bind-input";
import { activeRecords, compareNetIds, nameBoundNets } from "./bind-names";
import { sanitizePreviousActive, type SanitizedMember } from "./bind-sanitize";
import { formatDurableNetId, isDurableNetId, seqOf, type ActiveNetRecord, type NetNameSource } from "./types";
import { requireValid, safeInteger } from "./validation";

export interface BindInput {
  components: readonly DerivedNetComponent[];
  previousActive: readonly ActiveNetRecord[];
  salt: string;
  seqWatermark: number;
  mode: "commit" | "read";
  pinLabel: (pinId: string) => string | undefined;
  dependentCount?: (netId: string) => number;
  priorOwner?: ReadonlyMap<string, string>;
}

export interface BoundNet {
  id: string;
  name: string;
  autoNamed: boolean;
  nameSource: NetNameSource;
  legacyRoot: string;
  pinIds: string[];
  wireIds: string[];
  labelIds: string[];
  primitiveIds: string[];
}

export interface BindResult {
  nets: BoundNet[];
  nextActive: ActiveNetRecord[];
  nextSeq: number;
  inSync: boolean;
  createdIds: string[];
  preservedIds: string[];
  retirements: ElectricalNetRetirement[];
  transitions: ElectricalNetTransition[];
  sanitized: SanitizedMember[];
}

function exactIdentities(
  components: readonly CanonicalComponent[],
  previous: readonly ActiveNetRecord[],
): Map<string, string> | null {
  const byFirst = new Map(previous.map((record) => [memberToken(record.members[0]!), record]));
  const ids = new Map<string, string>(), matched = new Set<string>();
  for (const component of components) {
    const record = byFirst.get(component.tokens[0]!);
    if (record && JSON.stringify(record.members.map(memberToken)) === JSON.stringify(component.tokens)) {
      ids.set(component.component.key, record.id);
      matched.add(record.id);
    } else if (component.lone) ids.set(component.component.key, `nc:${component.component.pinIds[0]!}`);
    else return null;
  }
  return matched.size === previous.length ? ids : null;
}

function dependentComparator(input: BindInput): (first: string, second: string) => number {
  const counts = new Map<string, number>();
  const count = (id: string): number => {
    if (!counts.has(id)) {
      const value = input.dependentCount ? input.dependentCount(id) : 0;
      safeInteger(value, "dependentCount", 0);
      counts.set(id, value);
    }
    return counts.get(id)!;
  };
  return (first, second) => count(second) - count(first) || seqOf(first)! - seqOf(second)!;
}

function unchangedRecords(previous: readonly ActiveNetRecord[], next: readonly ActiveNetRecord[]): boolean {
  if (previous.length !== next.length) return false;
  const byId = new Map(previous.map((record) => [record.id, record]));
  return next.every((record) => {
    const old = byId.get(record.id);
    return old !== undefined && old.name === record.name && old.nameSource === record.nameSource &&
      old.displayOverride === record.displayOverride &&
      JSON.stringify(old.members.map(memberToken)) === JSON.stringify(record.members.map(memberToken));
  });
}

export function bindNetIdentity(input: BindInput): BindResult {
  const prepared = prepareBindInput(input);
  const sanitized = sanitizePreviousActive(prepared.previous, input.priorOwner);
  const components = prepared.components, previous = sanitized.previous;
  let nextSeq = prepared.nextSeq, pending = 0;
  const lone = new Map(components.map((entry) => [entry.component.key, entry.lone]));
  const sources = new Map(previous.map((record) => [record.id, record.nameSource]));
  const exact = exactIdentities(components, previous);
  const reconciled = exact ? null : reconcileElectricalIdentity({
    previousActive: previous,
    currentComponents: components.map((entry) => ({ key: entry.component.key, members: entry.members })),
    successorPolicy: "inherit-most-pins", retiredIds: [],
    predecessorPriority: (id) => sources.get(id) === "auto" ? 0 : 1,
    comparePredecessors: dependentComparator(input),
    allocateId: ({ componentKey, members }) => {
      if (lone.get(componentKey)) return `nc:${members[0]!.id}`;
      if (input.mode === "read") return `pending:${pending++}`;
      requireValid(nextSeq < Number.MAX_SAFE_INTEGER, "nextSeq", "durable sequence exhausted");
      return formatDurableNetId(input.salt, nextSeq++);
    },
  });
  const ids = exact ?? reconciled!.componentNetIds;
  const nets = nameBoundNets(components, ids, previous, input);
  const nextActive = activeRecords(nets, components, previous);
  const createdIds = [...(reconciled?.createdIds ?? [])].filter(isDurableNetId).sort(compareNetIds);
  const preservedIds = [...(exact ? previous.map((record) => record.id) : reconciled!.preservedIds)].filter(isDurableNetId).sort(compareNetIds);
  const retirements = [...(reconciled?.retirements ?? [])], transitions = [...(reconciled?.transitions ?? [])];
  return {
    nets, nextActive, nextSeq, createdIds, preservedIds, retirements, transitions,
    sanitized: sanitized.sanitized,
    inSync: sanitized.sanitized.length === 0 && createdIds.length === 0 && retirements.length === 0 && transitions.length === 0 &&
      !nets.some((net) => net.id.startsWith("pending:")) && unchangedRecords(prepared.previous, nextActive),
  };
}
