/**
 * Net identity persistence (H08, OPENPCB-56 §3.2): the state row, the
 * retirement ledger, quarantine provenance and the logical backup. This is the
 * single writer of those tables, so it enforces what must never be persisted:
 * a non-durable or foreign id in `active_json`, a member claimed twice, a seq
 * at or above `next_seq`, or `next_seq` moving backwards on an active design.
 *
 * Reads are deliberately looser where the design tolerates damage: a member in
 * two records (§5 #12, sanitised by the binder) and a corrupt `next_seq`
 * (§5 #11, repaired by the ledger watermark) are passed through. Structural
 * damage throws `NetIdentityStateError`; the caller decides the mode.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import {
  netIdentityBackups,
  netIdentityQuarantine,
  netIdentityRetired,
  netIdentityState,
  pcbEntities,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicPrimitives,
  schematicWires,
  sessionHistories,
} from "../schema";
import {
  NetIdentityStateError,
  QUARANTINE_REASONS,
  REF_KINDS,
  RETIREMENT_REASONS,
  STATUSES,
  compareText,
  isRecord,
  isStringArray,
  normalizeNextSeq,
  oneOf,
  parseActive,
  parseJson,
  parseProvenance,
  serializeActive,
  serializeProvenance,
  validateActive,
} from "./state-codec";
import {
  NET_IDENTITY_BACKUP_FORMAT,
  NET_IDENTITY_SCHEMA_VERSION,
  isDurableNetIdOf,
  seqOf,
  type NetIdentityBackup,
  type NetIdentityBackupPayload,
  type NetIdentityState,
  type NetRetirementReason,
  type QuarantineReason,
  type QuarantineRecord,
  type QuarantineRefKind,
  type RetiredNetRecord,
} from "./types";

export {
  NetIdentityStateError,
  type NetIdentityStateErrorReason,
} from "./state-codec";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

// --- state row ------------------------------------------------------------------

export function readNetIdentityState(db: DbClient, designId: string): NetIdentityState | null {
  const row = db.select().from(netIdentityState).where(eq(netIdentityState.designId, designId)).get();
  if (!row) return null;
  if (row.schemaVersion !== NET_IDENTITY_SCHEMA_VERSION) {
    throw new NetIdentityStateError(designId, "unsupported_schema_version", `schema_version ${row.schemaVersion}`);
  }
  if (!oneOf(STATUSES, row.status)) {
    throw new NetIdentityStateError(designId, "corrupt", `status ${JSON.stringify(row.status)}`);
  }
  return {
    designId,
    schemaVersion: NET_IDENTITY_SCHEMA_VERSION,
    status: row.status,
    nextSeq: normalizeNextSeq(row.nextSeq),
    active: parseActive(designId, row.activeJson),
    provenance: parseProvenance(designId, row.provenanceJson),
    lastError: row.lastError ?? null,
  };
}

function stateRow(state: NetIdentityState, timestamp: string) {
  validateActive(state);
  if (!oneOf(STATUSES, state.status)) throw new Error(`Unknown net identity status ${state.status}`);
  return {
    designId: state.designId,
    schemaVersion: NET_IDENTITY_SCHEMA_VERSION,
    status: state.status,
    nextSeq: state.nextSeq,
    activeJson: serializeActive(state.active),
    provenanceJson: serializeProvenance(state.provenance),
    lastError: state.lastError,
    updatedAt: timestamp,
  };
}

/**
 * Plain INSERT: a second writer for the same design hits the primary key
 * (`SQLITE_CONSTRAINT`), which is how a concurrent ensure is detected (§3.10.1).
 */
export function insertNetIdentityState(db: DbClient, state: NetIdentityState, timestamp: string): void {
  db.insert(netIdentityState).values(stateRow(state, timestamp)).run();
}

/** Rewrites an existing row. An active design's counter never moves backwards. */
export function replaceNetIdentityState(db: DbClient, state: NetIdentityState, timestamp: string): void {
  const next = stateRow(state, timestamp);
  const existing = db
    .select({ status: netIdentityState.status, nextSeq: netIdentityState.nextSeq })
    .from(netIdentityState)
    .where(eq(netIdentityState.designId, state.designId))
    .get();
  if (!existing) throw new Error(`No net identity state for design ${state.designId}`);
  if (existing.status === "active" && next.status === "active" && next.nextSeq < normalizeNextSeq(existing.nextSeq)) {
    throw new Error(`Refusing to move next_seq of ${state.designId} back to ${next.nextSeq}`);
  }
  db.update(netIdentityState).set(next).where(eq(netIdentityState.designId, state.designId)).run();
}

export function deleteNetIdentityState(db: DbClient, designId: string): void {
  db.delete(netIdentityState).where(eq(netIdentityState.designId, designId)).run();
}

// --- retirement ledger --------------------------------------------------------------

export interface RetiredNetInput {
  netId: string;
  reason: NetRetirementReason;
  successorIds: readonly string[];
  displayName: string | null;
  retiredAtRevision: number;
}

/** Upsert by `(design, net)`: a re-retired id keeps its `created_at`; `seq` derives from the id. */
export function upsertRetiredNets(
  db: DbClient,
  designId: string,
  entries: readonly RetiredNetInput[],
  timestamp: string,
): void {
  for (const entry of entries) {
    const seq = seqOf(entry.netId);
    if (seq === null || !isDurableNetIdOf(entry.netId, designId)) {
      throw new Error(`Refusing to retire non-durable or foreign id ${entry.netId}`);
    }
    if (!oneOf(RETIREMENT_REASONS, entry.reason) || !Number.isSafeInteger(entry.retiredAtRevision)) {
      throw new Error(`Refusing malformed retirement of ${entry.netId}`);
    }
    const update = {
      reason: entry.reason,
      successorIdsJson: JSON.stringify([...entry.successorIds]),
      displayName: entry.displayName,
      retiredAtRevision: entry.retiredAtRevision,
      updatedAt: timestamp,
    };
    db.insert(netIdentityRetired)
      .values({ designId, netId: entry.netId, seq, ...update, createdAt: timestamp })
      .onConflictDoUpdate({ target: [netIdentityRetired.designId, netIdentityRetired.netId], set: update })
      .run();
  }
}

function toRetiredRecord(row: typeof netIdentityRetired.$inferSelect): RetiredNetRecord {
  const successorIds = parseJson(row.designId, "successor_ids_json", row.successorIdsJson);
  if (!oneOf(RETIREMENT_REASONS, row.reason) || !isStringArray(successorIds)) {
    throw new NetIdentityStateError(row.designId, "corrupt", `ledger row ${row.netId} is malformed`);
  }
  return {
    designId: row.designId,
    netId: row.netId,
    seq: row.seq,
    reason: row.reason,
    successorIds,
    displayName: row.displayName ?? null,
    retiredAtRevision: row.retiredAtRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function readRetiredNet(db: DbClient, designId: string, netId: string): RetiredNetRecord | null {
  const row = db
    .select()
    .from(netIdentityRetired)
    .where(and(eq(netIdentityRetired.designId, designId), eq(netIdentityRetired.netId, netId)))
    .get();
  return row ? toRetiredRecord(row) : null;
}

export function listRetiredNets(db: DbClient, designId: string): RetiredNetRecord[] {
  return db
    .select()
    .from(netIdentityRetired)
    .where(eq(netIdentityRetired.designId, designId))
    .orderBy(asc(netIdentityRetired.seq), asc(netIdentityRetired.netId))
    .all()
    .map(toRetiredRecord);
}

export function deleteRetiredNets(db: DbClient, designId: string): void {
  db.delete(netIdentityRetired).where(eq(netIdentityRetired.designId, designId)).run();
}

/**
 * `max(next_seq, 1 + MAX(ledger seq))`, never below 1 — replaces passing the
 * whole ledger to the kernel. The ledger term defends against a corrupt
 * `next_seq` (§5 #11); the binder adds the active seqs.
 */
export function readSeqWatermark(db: DbClient, designId: string): number {
  const state = db
    .select({ nextSeq: netIdentityState.nextSeq })
    .from(netIdentityState)
    .where(eq(netIdentityState.designId, designId))
    .get();
  const ledger = db
    .select({ maxSeq: sql<number | null>`max(${netIdentityRetired.seq})` })
    .from(netIdentityRetired)
    .where(eq(netIdentityRetired.designId, designId))
    .get();
  const maxSeq = ledger?.maxSeq;
  const ledgerFloor = typeof maxSeq === "number" && Number.isSafeInteger(maxSeq) ? maxSeq + 1 : 1;
  return Math.max(normalizeNextSeq(state?.nextSeq), ledgerFloor);
}

// --- quarantine ------------------------------------------------------------------------

export interface QuarantineInput {
  refKind: QuarantineRefKind;
  refId: string;
  legacyValue: string;
  reason: QuarantineReason;
  candidates: readonly string[];
  suggestedNetId: string | null;
}

/** Immutable provenance: an existing `(kind, ref, legacy value)` row is never overwritten. */
export function insertQuarantineRecords(
  db: DbClient,
  designId: string,
  entries: readonly QuarantineInput[],
  timestamp: string,
): void {
  for (const entry of entries) {
    if (!oneOf(REF_KINDS, entry.refKind) || !oneOf(QUARANTINE_REASONS, entry.reason)) {
      throw new Error(`Refusing malformed quarantine row ${entry.refKind}/${entry.refId}`);
    }
    db.insert(netIdentityQuarantine)
      .values({
        designId,
        refKind: entry.refKind,
        refId: entry.refId,
        legacyValue: entry.legacyValue,
        reason: entry.reason,
        candidatesJson: JSON.stringify([...entry.candidates]),
        suggestedNetId: entry.suggestedNetId,
        createdAt: timestamp,
      })
      .onConflictDoNothing()
      .run();
  }
}

function toQuarantineRecord(row: typeof netIdentityQuarantine.$inferSelect): QuarantineRecord {
  const candidates = parseJson(row.designId, "candidates_json", row.candidatesJson);
  if (!oneOf(REF_KINDS, row.refKind) || !oneOf(QUARANTINE_REASONS, row.reason) || !isStringArray(candidates)) {
    throw new NetIdentityStateError(row.designId, "corrupt", `quarantine row ${row.refKind}/${row.refId} is malformed`);
  }
  return {
    designId: row.designId,
    refKind: row.refKind,
    refId: row.refId,
    legacyValue: row.legacyValue,
    reason: row.reason,
    candidates,
    suggestedNetId: row.suggestedNetId ?? null,
    createdAt: row.createdAt,
  };
}

export function listQuarantineRecords(db: DbClient, designId: string): QuarantineRecord[] {
  return db
    .select()
    .from(netIdentityQuarantine)
    .where(eq(netIdentityQuarantine.designId, designId))
    .orderBy(
      asc(netIdentityQuarantine.refKind),
      asc(netIdentityQuarantine.refId),
      asc(netIdentityQuarantine.legacyValue),
    )
    .all()
    .map(toQuarantineRecord);
}

export function deleteQuarantineRecords(db: DbClient, designId: string): void {
  db.delete(netIdentityQuarantine).where(eq(netIdentityQuarantine.designId, designId)).run();
}

// --- backup ----------------------------------------------------------------------------

/** Rows ordered by `id`, keys in the table's column order; a missing column is refused. */
function orderedRows(table: AnySQLiteTable, rows: ReadonlyArray<{ id: string }>): Record<string, unknown>[] {
  const keys = Object.keys(getTableColumns(table));
  return [...rows]
    .sort((first, second) => compareText(first.id, second.id))
    .map((row) => {
      const source = row as Record<string, unknown>;
      const ordered: Record<string, unknown> = {};
      for (const key of keys) {
        if (source[key] === undefined) throw new Error(`Backup row ${row.id} lacks column ${key}`);
        ordered[key] = source[key];
      }
      return ordered;
    });
}

/** The exact `payload_json` (§3.2): fixed key order, every array ordered by `id`. */
export function serializeNetIdentityBackupPayload(payload: NetIdentityBackupPayload): string {
  return JSON.stringify({
    format: NET_IDENTITY_BACKUP_FORMAT,
    designId: payload.designId,
    revision: payload.revision,
    schematic: {
      parts: orderedRows(schematicParts, payload.schematic.parts),
      pins: orderedRows(schematicPins, payload.schematic.pins),
      wires: orderedRows(schematicWires, payload.schematic.wires),
      labels: orderedRows(schematicLabels, payload.schematic.labels),
      primitives: orderedRows(schematicPrimitives, payload.schematic.primitives),
    },
    pcbEntities: orderedRows(pcbEntities, payload.pcbEntities),
    sessionHistories: orderedRows(sessionHistories, payload.sessionHistories),
  });
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** INSERT OR REPLACE on `(design, schema_version)`; returns the payload's sha256. */
export function writeNetIdentityBackup(db: DbClient, payload: NetIdentityBackupPayload, timestamp: string): string {
  const payloadJson = serializeNetIdentityBackupPayload(payload);
  const sha256 = sha256Hex(payloadJson);
  const row = { revision: payload.revision, payloadJson, sha256, createdAt: timestamp };
  db.insert(netIdentityBackups)
    .values({ designId: payload.designId, schemaVersion: NET_IDENTITY_SCHEMA_VERSION, ...row })
    .onConflictDoUpdate({ target: [netIdentityBackups.designId, netIdentityBackups.schemaVersion], set: row })
    .run();
  return sha256;
}

function verifiedPayload(row: typeof netIdentityBackups.$inferSelect): NetIdentityBackupPayload | null {
  if (sha256Hex(row.payloadJson) !== row.sha256) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.schematic)) return null;
  const { schematic } = parsed;
  const arrays = [
    schematic.parts, schematic.pins, schematic.wires, schematic.labels,
    schematic.primitives, parsed.pcbEntities, parsed.sessionHistories,
  ];
  const valid =
    parsed.format === NET_IDENTITY_BACKUP_FORMAT &&
    parsed.designId === row.designId &&
    parsed.revision === row.revision &&
    arrays.every((value) => Array.isArray(value));
  return valid ? (parsed as unknown as NetIdentityBackupPayload) : null;
}

export function readNetIdentityBackup(db: DbClient, designId: string): NetIdentityBackup | null {
  const row = db
    .select()
    .from(netIdentityBackups)
    .where(
      and(
        eq(netIdentityBackups.designId, designId),
        eq(netIdentityBackups.schemaVersion, NET_IDENTITY_SCHEMA_VERSION),
      ),
    )
    .get();
  if (!row) return null;
  const payload = verifiedPayload(row);
  return { ...row, verified: payload !== null, payload };
}
