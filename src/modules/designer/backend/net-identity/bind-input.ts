import type { ElectricalMember, ElectricalMemberKind } from "../../../../shared/electrical-identity";
import type { DerivedNetComponent } from "../projection-world";
import type { BindInput } from "./bind";
import { formatDurableNetId, seqOf, type ActiveNetRecord } from "./types";
import { requireValid, safeInteger } from "./validation";

export interface CanonicalComponent {
  component: DerivedNetComponent;
  members: ElectricalMember[];
  tokens: string[];
  lone: boolean;
}

const FIELDS: Array<["pinIds" | "wireIds" | "labelIds" | "primitiveIds", ElectricalMemberKind]> = [
  ["pinIds", "pin"], ["wireIds", "wire"], ["labelIds", "label"], ["primitiveIds", "primitive"],
];
const DERIVED_NAME_SOURCES = ["auto", "gnd", "pwr", "portal", "label"];
const NAME_SOURCES = [...DERIVED_NAME_SOURCES, "override"];

export function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function memberToken(member: ElectricalMember): string {
  return JSON.stringify([member.kind, member.id]);
}

function text(value: unknown, path: string): asserts value is string {
  requireValid(typeof value === "string" && value.trim().length > 0, path, "must be a non-blank string");
}

function canonicalMembers(values: readonly ElectricalMember[], path: string): ElectricalMember[] {
  requireValid(Array.isArray(values) && values.length > 0, path, "must contain members");
  const members = new Map<string, ElectricalMember>();
  for (const value of values) {
    requireValid(value && ["pin", "wire", "label", "primitive"].includes(value.kind), path, "invalid member kind");
    text(value.id, `${path}.id`);
    const member = { kind: value.kind, id: value.id }, token = memberToken(member);
    requireValid(!members.has(token), path, "duplicate member within record");
    members.set(token, member);
  }
  return [...members].sort(([a], [b]) => compareText(a, b)).map(([, member]) => member);
}

function canonicalComponent(value: DerivedNetComponent): CanonicalComponent {
  requireValid(value && typeof value === "object", "component", "must be an object");
  text(value.key, "component.key");
  text(value.legacyName, "component.legacyName");
  requireValid(DERIVED_NAME_SOURCES.includes(value.nameSource), "component.nameSource", "invalid derivation source");
  requireValid(value.nameSource === "auto" ? value.derivedName === null : typeof value.derivedName === "string" && value.derivedName.trim().length > 0,
    "component.derivedName", "must match the derivation source");
  const members: ElectricalMember[] = [];
  const component = { ...value };
  for (const [field, kind] of FIELDS) {
    requireValid(Array.isArray(value[field]), `component.${field}`, "must be an array");
    component[field] = [...value[field]].sort(compareText);
    for (const id of value[field]) members.push({ kind, id });
  }
  const canonical = canonicalMembers(members, "component.members");
  return { component, members: canonical, tokens: canonical.map(memberToken), lone: canonical.length === 1 && canonical[0]!.kind === "pin" };
}

function canonicalPrevious(value: ActiveNetRecord, salt: string): ActiveNetRecord {
  requireValid(value && typeof value === "object", "previousActive", "must contain records");
  text(value.id, "previousActive.id");
  const seq = seqOf(value.id);
  requireValid(seq !== null && value.id === formatDurableNetId(salt, seq), "previousActive.id", "must be an own-salt durable id");
  text(value.name, "previousActive.name");
  requireValid(NAME_SOURCES.includes(value.nameSource), "previousActive.nameSource", "invalid source");
  if (value.displayOverride !== undefined) text(value.displayOverride, "previousActive.displayOverride");
  return {
    id: value.id, name: value.name, nameSource: value.nameSource,
    members: canonicalMembers(value.members, "previousActive.members"),
    ...(value.displayOverride === undefined ? {} : { displayOverride: value.displayOverride }),
  };
}

function uniqueKeys<T>(values: readonly T[], key: (value: T) => string, path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const id = key(value);
    requireValid(!seen.has(id), path, "duplicate key or member");
    seen.add(id);
  }
}

export function prepareBindInput(input: BindInput): {
  components: CanonicalComponent[];
  previous: ActiveNetRecord[];
  nextSeq: number;
} {
  formatDurableNetId(input.salt, 1);
  requireValid(input.mode === "commit" || input.mode === "read", "mode", "must be commit or read");
  safeInteger(input.seqWatermark, "seqWatermark", 1);
  requireValid(typeof input.pinLabel === "function", "pinLabel", "must be a function");
  requireValid(input.dependentCount === undefined || typeof input.dependentCount === "function", "dependentCount", "must be a function");
  requireValid(input.priorOwner === undefined || input.priorOwner instanceof Map, "priorOwner", "must be a map");
  if (input.priorOwner) for (const [token, id] of input.priorOwner) {
    text(token, "priorOwner.token"); text(id, "priorOwner.id");
  }
  requireValid(Array.isArray(input.components) && Array.isArray(input.previousActive), "bind", "components and previousActive must be arrays");
  const components = input.components.map(canonicalComponent).sort((a, b) => compareText(a.component.key, b.component.key));
  const previous = input.previousActive.map((record) => canonicalPrevious(record, input.salt)).sort((a, b) => compareText(a.id, b.id));
  uniqueKeys(components, (value) => value.component.key, "components");
  uniqueKeys(components.flatMap((value) => value.members), memberToken, "components.members");
  uniqueKeys(previous, (value) => value.id, "previousActive");
  const maxPrior = previous.reduce((max, record) => Math.max(max, seqOf(record.id)!), 0);
  const nextSeq = Math.max(input.mode === "commit" ? input.seqWatermark : 1, maxPrior + 1);
  safeInteger(nextSeq, "nextSeq", 1);
  return { components, previous, nextSeq };
}
