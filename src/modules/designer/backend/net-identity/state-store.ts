import { and, asc, eq, max } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  netIdentityBackups, netIdentityQuarantine, netIdentityRetired, netIdentityState,
} from "../schema";
import {
  seqOf, type NetIdentityBackup, type NetIdentityQuarantineRecord,
  type NetIdentityRetiredRecord, type NetIdentityState,
} from "./types";
import {
  encodeStoredJson, parseStoredJson, requireValid, safeInteger,
  validateBackup, validateQuarantine, validateRetired, validateState,
} from "./validation";

export type NetIdentityDb = BetterSQLite3Database<Record<string, unknown>>;
export type RawNetIdentityState = typeof netIdentityState.$inferSelect;

/** Raw access lets later mode resolution report corruption without rewriting it. */
export function readRawNetIdentityState(db: NetIdentityDb, designId: string): RawNetIdentityState | null {
  return db.select().from(netIdentityState).where(eq(netIdentityState.designId, designId)).get() ?? null;
}

export function readNetIdentityState(db: NetIdentityDb, designId: string): NetIdentityState | null {
  const row = readRawNetIdentityState(db, designId);
  if (!row) return null;
  const { activeJson, provenanceJson, ...fields } = row;
  return validateState({
    ...fields,
    active: parseStoredJson(activeJson, "state.activeJson"),
    provenance: parseStoredJson(provenanceJson, "state.provenanceJson"),
  });
}

export function writeNetIdentityState(db: NetIdentityDb, state: NetIdentityState): void {
  validateState(state);
  const watermark = readNetIdentitySeqWatermark(db, state.designId);
  requireValid(state.nextSeq >= watermark, "state.nextSeq", "cannot lower allocation watermark");
  for (const row of state.active) {
    requireValid(seqOf(row.id)! < state.nextSeq, "state.nextSeq", "must exceed every active sequence");
  }
  const { active, provenance, ...fields } = state;
  const row = {
    ...fields,
    activeJson: encodeStoredJson(active, "state.activeJson"),
    provenanceJson: encodeStoredJson(provenance, "state.provenanceJson"),
  };
  db.insert(netIdentityState).values(row).onConflictDoUpdate({
    target: netIdentityState.designId, set: row,
  }).run();
}

/** Indexed ledger maximum plus active records protects a valid-but-low counter. */
export function readNetIdentitySeqWatermark(db: NetIdentityDb, designId: string): number {
  const state = readNetIdentityState(db, designId);
  const result = db.select({ maximum: max(netIdentityRetired.seq) }).from(netIdentityRetired)
    .where(eq(netIdentityRetired.designId, designId)).get();
  let watermark = state?.nextSeq ?? 1;
  const maxima = [result?.maximum, ...(state?.active.map((row) => seqOf(row.id)) ?? [])];
  for (const maximum of maxima) {
    if (maximum === null || maximum === undefined) continue;
    safeInteger(maximum, "sequence maximum", 1);
    safeInteger(maximum + 1, "sequence watermark", 1);
    watermark = Math.max(watermark, maximum + 1);
  }
  return watermark;
}

export function readNetIdentityRetired(db: NetIdentityDb, designId: string): NetIdentityRetiredRecord[] {
  return db.select().from(netIdentityRetired).where(eq(netIdentityRetired.designId, designId))
    .orderBy(asc(netIdentityRetired.seq)).all().map(({ successorIdsJson, ...row }) =>
      validateRetired({ ...row, successorIds: parseStoredJson(successorIdsJson, "retired.successorIdsJson") }));
}

export function writeNetIdentityRetired(db: NetIdentityDb, value: NetIdentityRetiredRecord): void {
  validateRetired(value);
  const { successorIds, ...fields } = value;
  const row = { ...fields, successorIdsJson: encodeStoredJson(successorIds, "retired.successorIdsJson") };
  db.insert(netIdentityRetired).values(row).onConflictDoUpdate({
    target: [netIdentityRetired.designId, netIdentityRetired.netId],
    set: { ...row, createdAt: undefined },
  }).run();
}

export function readNetIdentityQuarantine(db: NetIdentityDb, designId: string): NetIdentityQuarantineRecord[] {
  return db.select().from(netIdentityQuarantine).where(eq(netIdentityQuarantine.designId, designId))
    .orderBy(asc(netIdentityQuarantine.refKind), asc(netIdentityQuarantine.refId), asc(netIdentityQuarantine.legacyValue))
    .all().map(({ candidatesJson, ...row }) =>
      validateQuarantine({ ...row, candidates: parseStoredJson(candidatesJson, "quarantine.candidatesJson") }));
}

/** Provenance is immutable; duplicate keys must not overwrite prior evidence. */
export function writeNetIdentityQuarantine(db: NetIdentityDb, value: NetIdentityQuarantineRecord): void {
  validateQuarantine(value);
  const { candidates, ...fields } = value;
  db.insert(netIdentityQuarantine).values({
    ...fields, candidatesJson: encodeStoredJson(candidates, "quarantine.candidatesJson"),
  }).run();
}

export function readNetIdentityBackup(db: NetIdentityDb, designId: string, schemaVersion = 1): NetIdentityBackup | null {
  requireValid(schemaVersion === 1, "backup.schemaVersion", "unsupported schema version");
  const row = db.select().from(netIdentityBackups).where(and(
    eq(netIdentityBackups.designId, designId), eq(netIdentityBackups.schemaVersion, schemaVersion),
  )).get();
  return row ? validateBackup(row) : null;
}

/** A re-migration replaces its backup inside the caller's rollback-safe transaction. */
export function writeNetIdentityBackup(db: NetIdentityDb, value: NetIdentityBackup): void {
  validateBackup(value);
  db.insert(netIdentityBackups).values(value).onConflictDoUpdate({
    target: [netIdentityBackups.designId, netIdentityBackups.schemaVersion],
    set: value,
  }).run();
}

/** Caller supplies the surrounding design-deletion transaction. */
export function deleteDesignNetIdentity(db: NetIdentityDb, designId: string): void {
  db.delete(netIdentityQuarantine).where(eq(netIdentityQuarantine.designId, designId)).run();
  db.delete(netIdentityBackups).where(eq(netIdentityBackups.designId, designId)).run();
  db.delete(netIdentityRetired).where(eq(netIdentityRetired.designId, designId)).run();
  db.delete(netIdentityState).where(eq(netIdentityState.designId, designId)).run();
}
