import { createHash } from "node:crypto";
import {
  isDurableNetIdOf, isLoneNetId, NetIdentityStateInvalidError, seqOf,
  type NetIdentityBackup, type NetIdentityProvenance, type NetIdentityQuarantineRecord,
  type NetIdentityRetiredRecord, type NetIdentityState,
} from "./types";

const QUARANTINE_REASONS = [
  "root_only", "conflict", "short", "no_evidence", "stale_root", "unknown_name",
  "ambiguous_name", "assignment_conflict", "diff_pair_collapsed",
];

export function requireValid(condition: unknown, path: string, detail: string): asserts condition {
  if (!condition) throw new NetIdentityStateInvalidError(path, detail);
}

function object(value: unknown, path: string): Record<string, unknown> {
  requireValid(value !== null && typeof value === "object" && !Array.isArray(value), path, "must be an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): asserts value is string {
  requireValid(typeof value === "string" && value.trim().length > 0, path, "must be a non-blank string");
}

export function safeInteger(value: unknown, path: string, minimum = 0): asserts value is number {
  requireValid(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum,
    path, `must be a safe integer >= ${minimum}`);
}

function memberOf(value: unknown, values: readonly string[], path: string): void {
  requireValid(typeof value === "string" && values.includes(value), path, "unsupported value");
}

function ownDurable(value: unknown, designId: string, path: string): asserts value is string {
  text(value, path);
  requireValid(isDurableNetIdOf(value, designId), path, "must be a durable id of this design");
}

function storedReference(value: unknown, designId: string, path: string): void {
  text(value, path);
  requireValid(isDurableNetIdOf(value, designId) || isLoneNetId(value), path,
    "must be an own-design durable or lone-pin id");
}

function references(value: unknown, designId: string, path: string): void {
  requireValid(Array.isArray(value), path, "must be an array");
  value.forEach((id, index) => storedReference(id, designId, `${path}[${index}]`));
}

export function parseStoredJson(value: string, path: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new NetIdentityStateInvalidError(path, "invalid JSON");
  }
}

export function encodeStoredJson(value: unknown, path: string): string {
  try {
    const json = JSON.stringify(value);
    requireValid(typeof json === "string", path, "must be JSON serializable");
    return json;
  } catch (error) {
    if (error instanceof NetIdentityStateInvalidError) throw error;
    throw new NetIdentityStateInvalidError(path, "must be JSON serializable");
  }
}

export function validateState(value: unknown): NetIdentityState {
  const state = object(value, "state");
  text(state.designId, "state.designId");
  requireValid(state.schemaVersion === 1, "state.schemaVersion", "unsupported schema version");
  memberOf(state.status, ["active", "migration_failed", "legacy_restored"], "state.status");
  safeInteger(state.nextSeq, "state.nextSeq", 1);
  text(state.updatedAt, "state.updatedAt");
  requireValid(state.lastError === null || typeof state.lastError === "string", "state.lastError", "must be a string or null");
  requireValid(Array.isArray(state.active), "state.active", "must be an array");
  const ids = new Set<string>();
  const ownedMembers = new Set<string>();
  state.active.forEach((value, index) => {
    const path = `state.active[${index}]`;
    const row = object(value, path);
    ownDurable(row.id, state.designId as string, `${path}.id`);
    requireValid(!ids.has(row.id), `${path}.id`, "duplicate active id");
    ids.add(row.id);
    text(row.name, `${path}.name`);
    memberOf(row.nameSource, ["auto", "override", "gnd", "pwr", "portal", "label"], `${path}.nameSource`);
    if (row.displayOverride !== undefined) text(row.displayOverride, `${path}.displayOverride`);
    requireValid(Array.isArray(row.members) && row.members.length > 0, `${path}.members`, "must be a non-empty array");
    const tokens = new Set<string>();
    row.members.forEach((value, memberIndex) => {
      const memberPath = `${path}.members[${memberIndex}]`;
      const member = object(value, memberPath);
      memberOf(member.kind, ["pin", "wire", "label", "primitive"], `${memberPath}.kind`);
      text(member.id, `${memberPath}.id`);
      const token = JSON.stringify([member.kind, member.id]);
      requireValid(!tokens.has(token), memberPath, "duplicate member within active record");
      requireValid(!ownedMembers.has(token), memberPath, "member belongs to multiple active records");
      tokens.add(token);
      ownedMembers.add(token);
    });
  });
  validateProvenance(state.provenance);
  return value as NetIdentityState;
}

function validateProvenance(value: unknown): NetIdentityProvenance {
  const row = object(value, "provenance");
  memberOf(row.origin, ["native", "legacy-migration", "kicad-import"], "provenance.origin");
  text(row.createdAt, "provenance.createdAt");
  safeInteger(row.migratorVersion, "provenance.migratorVersion", 1);
  if (row.restoredAt !== undefined) text(row.restoredAt, "provenance.restoredAt");
  if (row.migration !== undefined) validateMigration(row.migration);
  return value as NetIdentityProvenance;
}

function validateMigration(value: unknown): void {
  const row = object(value, "provenance.migration");
  requireValid(row.schemaVersion === 1, "migration.schemaVersion", "unsupported schema version");
  safeInteger(row.migratorVersion, "migration.migratorVersion", 1);
  for (const field of ["revisionBefore", "revisionAfter", "netsAllocated", "historiesArchived"]) {
    safeInteger(row[field], `migration.${field}`);
  }
  memberOf(row.boardSettings, ["migrated", "absent", "unparseable"], "migration.boardSettings");
  const refs = object(row.references, "migration.references");
  safeInteger(refs.total, "migration.references.total");
  const bound = object(refs.bound, "migration.references.bound");
  for (const field of ["rootAndContact", "rootAndPour", "contact", "nameHint", "autoNameHint"]) {
    safeInteger(bound[field], `migration.references.bound.${field}`);
  }
  const quarantined = object(refs.quarantined, "migration.references.quarantined");
  for (const [reason, count] of Object.entries(quarantined)) {
    memberOf(reason, QUARANTINE_REASONS, `migration.references.quarantined.${reason}`);
    safeInteger(count, `migration.references.quarantined.${reason}`);
  }
}

export function validateRetired(value: unknown): NetIdentityRetiredRecord {
  const row = object(value, "retired");
  text(row.designId, "retired.designId");
  ownDurable(row.netId, row.designId, "retired.netId");
  safeInteger(row.seq, "retired.seq", 1);
  requireValid(row.seq === seqOf(row.netId), "retired.seq", "does not match net id");
  memberOf(row.reason, ["removed", "split", "merged", "reconfigured", "history"], "retired.reason");
  references(row.successorIds, row.designId, "retired.successorIds");
  requireValid(row.displayName === null || typeof row.displayName === "string", "retired.displayName", "must be a string or null");
  safeInteger(row.retiredAtRevision, "retired.retiredAtRevision");
  text(row.createdAt, "retired.createdAt");
  text(row.updatedAt, "retired.updatedAt");
  return value as NetIdentityRetiredRecord;
}

export function validateQuarantine(value: unknown): NetIdentityQuarantineRecord {
  const row = object(value, "quarantine");
  text(row.designId, "quarantine.designId");
  memberOf(row.refKind, ["trace", "via", "free_pad", "zone", "net_class_assignment", "length_group", "diff_pair", "drc_rule"], "quarantine.refKind");
  text(row.refId, "quarantine.refId");
  text(row.legacyValue, "quarantine.legacyValue");
  memberOf(row.reason, QUARANTINE_REASONS, "quarantine.reason");
  references(row.candidates, row.designId, "quarantine.candidates");
  if (row.suggestedNetId !== null) storedReference(row.suggestedNetId, row.designId, "quarantine.suggestedNetId");
  text(row.createdAt, "quarantine.createdAt");
  return value as NetIdentityQuarantineRecord;
}

export function validateBackup(value: unknown): NetIdentityBackup {
  const row = object(value, "backup");
  text(row.designId, "backup.designId");
  requireValid(row.schemaVersion === 1, "backup.schemaVersion", "unsupported schema version");
  safeInteger(row.revision, "backup.revision");
  text(row.createdAt, "backup.createdAt");
  text(row.payloadJson, "backup.payloadJson");
  parseStoredJson(row.payloadJson, "backup.payloadJson");
  text(row.sha256, "backup.sha256");
  requireValid(/^[a-f0-9]{64}$/.test(row.sha256), "backup.sha256", "must be lowercase SHA-256 hex");
  const digest = createHash("sha256").update(row.payloadJson, "utf8").digest("hex");
  requireValid(digest === row.sha256, "backup.sha256", "payload checksum mismatch");
  return value as NetIdentityBackup;
}
