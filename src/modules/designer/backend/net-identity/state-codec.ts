/**
 * Internal JSON codec of the net identity state row (H08, OPENPCB-56 §3.2),
 * split from `state-store.ts`, which is the only importer. Parsing tolerates
 * what the design repairs later (a member in two records, §5 #12; a corrupt
 * `next_seq`, §5 #11) and throws `NetIdentityStateError` on structural damage.
 * Validation refuses everything that must never be persisted.
 */
import type {
  ElectricalMember,
  ElectricalMemberKind,
} from "../../../../shared/electrical-identity";
import {
  isDurableNetIdOf,
  seqOf,
  type ActiveNetRecord,
  type NetIdentityOrigin,
  type NetIdentityProvenance,
  type NetIdentityState,
  type NetIdentityStatus,
  type NetRetirementReason,
  type QuarantineReason,
  type QuarantineRefKind,
} from "./types";

export type NetIdentityStateErrorReason = "corrupt" | "unsupported_schema_version";

export class NetIdentityStateError extends Error {
  constructor(
    readonly designId: string,
    readonly reason: NetIdentityStateErrorReason,
    message: string,
  ) {
    super(`Net identity state of design ${designId} is unusable (${reason}): ${message}`);
    this.name = "NetIdentityStateError";
  }
}

export const STATUSES: readonly NetIdentityStatus[] = ["active", "migration_failed", "legacy_restored"];
const ORIGINS: readonly NetIdentityOrigin[] = ["native", "legacy-migration", "kicad-import"];
const MEMBER_KINDS: readonly ElectricalMemberKind[] = ["pin", "wire", "label", "primitive"];
export const RETIREMENT_REASONS: readonly NetRetirementReason[] = [
  "removed", "split", "merged", "reconfigured", "history",
];
export const QUARANTINE_REASONS: readonly QuarantineReason[] = [
  "root_only", "conflict", "short", "no_evidence", "stale_root",
  "unknown_name", "ambiguous_name", "assignment_conflict", "diff_pair_collapsed",
];
export const REF_KINDS: readonly QuarantineRefKind[] = [
  "trace", "via", "free_pad", "zone", "net_class_assignment",
  "length_group", "diff_pair", "drc_rule",
];

export function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function memberToken(member: ElectricalMember): string {
  return JSON.stringify([member.kind, member.id]);
}

export function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseJson(designId: string, field: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new NetIdentityStateError(designId, "corrupt", `${field} is not JSON`);
  }
}

/** A corrupt counter falls back to 1; the watermark and the binder restore the floor. */
export function normalizeNextSeq(raw: unknown): number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
}

function parseMember(designId: string, raw: unknown): ElectricalMember {
  if (!isRecord(raw) || !oneOf(MEMBER_KINDS, raw.kind) || typeof raw.id !== "string" || raw.id === "") {
    throw new NetIdentityStateError(designId, "corrupt", "active_json has a malformed member");
  }
  return { kind: raw.kind, id: raw.id };
}

function parseActiveRecord(designId: string, raw: unknown): ActiveNetRecord {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string" || !Array.isArray(raw.members)) {
    throw new NetIdentityStateError(designId, "corrupt", "active_json has a malformed record");
  }
  if (!isDurableNetIdOf(raw.id, designId)) {
    throw new NetIdentityStateError(designId, "corrupt", `active_json holds non-durable id ${raw.id}`);
  }
  if (raw.displayOverride !== undefined && typeof raw.displayOverride !== "string") {
    throw new NetIdentityStateError(designId, "corrupt", `record ${raw.id} has a malformed override`);
  }
  const record: ActiveNetRecord = {
    id: raw.id,
    name: raw.name,
    members: raw.members.map((member) => parseMember(designId, member)),
  };
  if (raw.displayOverride !== undefined) record.displayOverride = raw.displayOverride;
  return record;
}

export function parseActive(designId: string, raw: string): ActiveNetRecord[] {
  const parsed = parseJson(designId, "active_json", raw);
  if (!Array.isArray(parsed)) {
    throw new NetIdentityStateError(designId, "corrupt", "active_json is not an array");
  }
  const records = parsed.map((record) => parseActiveRecord(designId, record));
  const ids = new Set(records.map((record) => record.id));
  if (ids.size !== records.length) {
    throw new NetIdentityStateError(designId, "corrupt", "active_json repeats an id");
  }
  return records;
}

export function parseProvenance(designId: string, raw: string): NetIdentityProvenance {
  const parsed = parseJson(designId, "provenance_json", raw);
  if (
    !isRecord(parsed) ||
    !oneOf(ORIGINS, parsed.origin) ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.migratorVersion !== "number" ||
    !Number.isSafeInteger(parsed.migratorVersion) ||
    (parsed.migration !== undefined && !isRecord(parsed.migration)) ||
    (parsed.restoredAt !== undefined && typeof parsed.restoredAt !== "string")
  ) {
    throw new NetIdentityStateError(designId, "corrupt", "provenance_json is malformed");
  }
  const provenance: NetIdentityProvenance = {
    origin: parsed.origin,
    createdAt: parsed.createdAt,
    migratorVersion: parsed.migratorVersion,
  };
  if (parsed.migration !== undefined) {
    // Diagnostics written by this module only; shape-checked as an object.
    provenance.migration = parsed.migration as unknown as NetIdentityProvenance["migration"];
  }
  if (parsed.restoredAt !== undefined) provenance.restoredAt = parsed.restoredAt;
  return provenance;
}

export function validateActive(state: NetIdentityState): void {
  const fail = (message: string): never => {
    throw new Error(`Refusing to persist net identity of ${state.designId}: ${message}`);
  };
  if (!Number.isSafeInteger(state.nextSeq) || state.nextSeq < 1) fail(`next_seq ${state.nextSeq}`);
  if (state.status !== "active" && state.active.length > 0) fail(`status ${state.status} with active records`);
  const ids = new Set<string>();
  const owners = new Map<string, string>();
  for (const record of state.active) {
    if (!isDurableNetIdOf(record.id, state.designId)) fail(`non-durable or foreign id ${record.id}`);
    if (ids.has(record.id)) fail(`duplicate id ${record.id}`);
    ids.add(record.id);
    if ((seqOf(record.id) ?? Infinity) >= state.nextSeq) fail(`${record.id} is not below next_seq ${state.nextSeq}`);
    if (typeof record.name !== "string") fail(`record ${record.id} has no name`);
    if (record.displayOverride !== undefined && typeof record.displayOverride !== "string") {
      fail(`record ${record.id} has a malformed override`);
    }
    for (const member of record.members) {
      if (!oneOf(MEMBER_KINDS, member.kind) || typeof member.id !== "string" || member.id === "") {
        fail(`record ${record.id} has a malformed member`);
      }
      const token = memberToken(member);
      const owner = owners.get(token);
      if (owner !== undefined) fail(`member ${token} is in ${owner} and ${record.id}`);
      owners.set(token, record.id);
    }
  }
}

/** Canonical `active_json`: records by seq, members by token, fixed key order. */
export function serializeActive(active: readonly ActiveNetRecord[]): string {
  const records = [...active]
    .sort((first, second) => (seqOf(first.id) ?? 0) - (seqOf(second.id) ?? 0))
    .map((record) => {
      const members = [...record.members]
        .sort((first, second) => compareText(memberToken(first), memberToken(second)))
        .map((member) => ({ kind: member.kind, id: member.id }));
      return record.displayOverride === undefined
        ? { id: record.id, name: record.name, members }
        : { id: record.id, name: record.name, members, displayOverride: record.displayOverride };
    });
  return JSON.stringify(records);
}

export function serializeProvenance(provenance: NetIdentityProvenance): string {
  if (!oneOf(ORIGINS, provenance.origin) || !Number.isSafeInteger(provenance.migratorVersion)) {
    throw new Error(`Refusing to persist malformed net identity provenance`);
  }
  const ordered: NetIdentityProvenance = {
    origin: provenance.origin,
    createdAt: provenance.createdAt,
    migratorVersion: provenance.migratorVersion,
  };
  if (provenance.migration !== undefined) ordered.migration = provenance.migration;
  if (provenance.restoredAt !== undefined) ordered.restoredAt = provenance.restoredAt;
  return JSON.stringify(ordered);
}
