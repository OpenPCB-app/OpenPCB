import { eq } from "drizzle-orm";
import type { Logger } from "../../../../core/contracts/modules/backend-module";
import { designHeads } from "../schema";
import { captureNetIdentityBackup, parseNetIdentityBackup } from "./backup";
import { migrateDesignNetIdentity, NetIdentityMigrationError, type MigrationStage } from "./migrate";
import { legacyBackupSequenceWatermark } from "./migration-watermark";
import {
  readRawNetIdentityState, readNetIdentitySeqWatermark, writeNetIdentityState, type NetIdentityDb,
} from "./state-store";
import { NET_IDENTITY_MIGRATOR_VERSION, type NetIdentityStatus } from "./types";
import { parseStoredJson, requireValid, validateState } from "./validation";

type Result = NetIdentityStatus | "unmigrated";
type MigrationLogger = Pick<Logger, "warn" | "error">;
interface EnsureOptions { fault?: (stage: MigrationStage) => void }

function safeLog(logger: MigrationLogger, level: "warn" | "error", message: string, meta: unknown): void {
  try { logger[level](message, meta); } catch { /* Reporting must not make a design read fail. */ }
}

function stateSnapshot(db: NetIdentityDb, designId: string) {
  const raw = readRawNetIdentityState(db, designId);
  if (!raw) return { raw, state: null };
  const { activeJson, provenanceJson, ...fields } = raw;
  const state = validateState({
    ...fields, active: parseStoredJson(activeJson, "state.activeJson"),
    provenance: parseStoredJson(provenanceJson, "state.provenanceJson"),
  });
  requireValid(state.status === "active" || state.active.length === 0, "state.active", "nonactive state contains active identities");
  return { raw, state };
}

function probe(db: NetIdentityDb, designId: string) {
  const head = db.select().from(designHeads).where(eq(designHeads.id, designId)).get();
  return head ? { head, ...stateSnapshot(db, designId) } : null;
}

type Probe = NonNullable<ReturnType<typeof probe>>;

function causes(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [], seen = new Set<object>();
  let current = error;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    chain.push(record);
    current = record.cause;
  }
  return chain;
}

function transient(error: unknown): boolean {
  return causes(error).some(({ code }) => typeof code === "string" && (
    ["SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_IOERR", "SQLITE_READONLY", "SQLITE_CANTOPEN"].some((prefix) => code.startsWith(prefix)) ||
    code === "SQLITE_FULL" || code === "SQLITE_INTERRUPT"
  ));
}

function stateConstraint(error: unknown): boolean {
  return causes(error).some(({ code, message }) =>
    ["SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_PRIMARYKEY", "SQLITE_CONSTRAINT_UNIQUE"].includes(String(code)) &&
    message === "UNIQUE constraint failed: designer_net_identity_state.design_id");
}

function errorDetail(error: unknown): string {
  if (error instanceof NetIdentityMigrationError) return error.message;
  return `ensure: ${error instanceof Error ? error.message : String(error)}`;
}

function persistFailure(
  db: NetIdentityDb, designId: string, before: Probe, timestamp: string, lastError: string,
): Result {
  return db.transaction((raw) => {
    const tx = raw as NetIdentityDb, current = stateSnapshot(tx, designId);
    if (current.state?.status === "active") return "active";
    if (JSON.stringify(current.raw) !== JSON.stringify(before.raw)) return current.state?.status ?? "unmigrated";
    const head = tx.select().from(designHeads).where(eq(designHeads.id, designId)).get();
    if (!head || JSON.stringify(head) !== JSON.stringify(before.head)) return "unmigrated";
    const backup = captureNetIdentityBackup(tx, designId, timestamp);
    const snapshot = parseNetIdentityBackup(backup, designId);
    const nextSeq = legacyBackupSequenceWatermark(snapshot, readNetIdentitySeqWatermark(tx, designId));
    writeNetIdentityState(tx, {
      designId, schemaVersion: 1, status: "migration_failed", nextSeq, active: [],
      provenance: {
        ...current.state?.provenance, origin: "legacy-migration",
        createdAt: current.state?.provenance.createdAt ?? timestamp, migratorVersion: NET_IDENTITY_MIGRATOR_VERSION,
      },
      lastError, updatedAt: timestamp,
    });
    return "migration_failed";
  });
}

function failedAttempt(
  db: NetIdentityDb, designId: string, logger: MigrationLogger, before: Probe, timestamp: string, error: unknown,
): Result {
  if (transient(error)) {
    safeLog(logger, "warn", "Net identity migration temporarily unavailable", { designId, error });
    return "unmigrated";
  }
  if (stateConstraint(error)) return stateSnapshot(db, designId).state?.status ?? "unmigrated";
  const lastError = errorDetail(error);
  const result = persistFailure(db, designId, before, timestamp, lastError);
  if (result === "migration_failed") safeLog(logger, "error", "Net identity migration failed", { designId, lastError });
  return result;
}

function attempt(
  db: NetIdentityDb, designId: string, logger: MigrationLogger, before: Probe, options: EnsureOptions,
): Result {
  const timestamp = new Date().toISOString();
  try {
    db.transaction((tx) => migrateDesignNetIdentity(tx as NetIdentityDb, designId, { timestamp, ...options }));
    return "active";
  } catch (error) {
    return failedAttempt(db, designId, logger, before, timestamp, error);
  }
}

function run(
  db: NetIdentityDb, designId: string, logger: MigrationLogger, explicit: boolean, options: EnsureOptions,
): Result {
  try {
    const before = probe(db, designId);
    if (!before) return "unmigrated";
    const { state } = before;
    if (state?.status === "active") return "active";
    if (!explicit && state?.status === "legacy_restored") return "legacy_restored";
    if (!explicit && state?.status === "migration_failed" && state.provenance.migratorVersion >= NET_IDENTITY_MIGRATOR_VERSION) return "migration_failed";
    return attempt(db, designId, logger, before, options);
  } catch (error) {
    safeLog(logger, "warn", "Net identity unavailable; persisted state retained", { designId, error });
    return "unmigrated";
  }
}

/** Entry points remain usable in legacy mode when migration, storage, or logging fails. */
export function ensureNetIdentity(
  db: NetIdentityDb, designId: string, logger: MigrationLogger, options: EnsureOptions = {},
): Result {
  return run(db, designId, logger, false, options);
}

/** Explicit retries retain the old state and allocation history until migration commits. */
export function retryNetIdentityMigration(db: NetIdentityDb, designId: string, logger: MigrationLogger): Result {
  return run(db, designId, logger, true, {});
}
