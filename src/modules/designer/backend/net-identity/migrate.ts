import { eq } from "drizzle-orm";
import { migrateLegacyBoardFill } from "../pcb/pcb-store";
import { loadSchematicSource } from "../projection-read";
import { deriveNetsAndJunctions } from "../projection-world";
import { designHeads, sessionHistories } from "../schema";
import { asRecord } from "../value-guards";
import { captureNetIdentityBackup, parseNetIdentityBackup } from "./backup";
import { deriveMigrationIdentity, migrationReferenceContext, validateMigrationSource } from "./migration-context";
import { planLegacyNetReferences } from "./migration-plan";
import { legacyFillRowId, readNetIdentityMigrationSource } from "./migration-source";
import { legacyBackupSequenceWatermark } from "./migration-watermark";
import { migrationReferenceSource, validateMigrationPlan, validateSkippedBoardReferences, writeMigratedReferences } from "./migration-write";
import {
  readNetIdentityQuarantine, readNetIdentitySeqWatermark, readNetIdentityState,
  writeNetIdentityBackup, writeNetIdentityQuarantine, writeNetIdentityState, type NetIdentityDb,
} from "./state-store";
import { NET_IDENTITY_MIGRATOR_VERSION, type NetIdentityMigrationReport } from "./types";
import { requireValid, safeInteger } from "./validation";

export type MigrationStage = "backup" | "fill" | "derive" | "evidence" | "rewrite" | "quarantine" | "histories" | "state";
export interface NetIdentityMigrationOptions { timestamp: string; fault?: (stage: MigrationStage) => void }

export class NetIdentityMigrationError extends Error {
  constructor(readonly stage: MigrationStage, message: string, cause?: unknown) {
    super(`${stage}: ${message}`, { cause });
    this.name = "NetIdentityMigrationError";
  }
}

function stage<T>(name: MigrationStage, options: NetIdentityMigrationOptions, work: () => T): T {
  try {
    const result = work();
    options.fault?.(name);
    return result;
  } catch (cause) {
    throw new NetIdentityMigrationError(name, cause instanceof Error ? cause.message : String(cause), cause);
  }
}

function backupMigration(tx: NetIdentityDb, designId: string, timestamp: string) {
  requireValid(typeof timestamp === "string" && timestamp.trim().length > 0, "migration.timestamp", "must be a non-blank timestamp");
  const head = tx.select().from(designHeads).where(eq(designHeads.id, designId)).get();
  requireValid(head, "migration.designId", "no head");
  safeInteger(head.revision, "migration.revision");
  safeInteger(head.revision + 1, "migration.revision");
  const state = readNetIdentityState(tx, designId);
  requireValid(state?.status !== "active", "migration.state", "design identity is already active");
  requireValid(!state || state.active.length === 0, "migration.state", "nonactive state contains active identities");
  requireValid(readNetIdentityQuarantine(tx, designId).length === 0, "migration.quarantine", "preexisting quarantine evidence must not be overwritten");
  const backup = captureNetIdentityBackup(tx, designId, timestamp);
  const snapshot = parseNetIdentityBackup(backup, designId);
  const watermark = legacyBackupSequenceWatermark(snapshot, readNetIdentitySeqWatermark(tx, designId));
  writeNetIdentityBackup(tx, backup);
  return { snapshot, watermark, revisionBefore: head.revision };
}

function fillMigration(tx: NetIdentityDb, designId: string, timestamp: string) {
  let source = readNetIdentityMigrationSource(tx, designId, timestamp);
  validateMigrationSource(source);
  const viewState = asRecord(asRecord(source.board.storedRaw)?.viewState);
  const hasLegacyFill = viewState && ["copperFillLayers", "copperFillPourNetIds", "copperFillPadConnection"]
    .some((key) => viewState[key] !== undefined);
  if (source.board.status === "parsed" && hasLegacyFill) {
    const schematic = loadSchematicSource(tx, designId);
    requireValid(schematic, "migration.schematic", "design does not exist");
    const derived = deriveNetsAndJunctions(schematic.parts, schematic.wires, schematic.labels, schematic.primitives);
    migrateLegacyBoardFill(tx, designId, new Map(derived.nets.map((net) => [net.id, net.name])), timestamp, {
      rowIdForZone: (zoneId) => legacyFillRowId(designId, zoneId),
    });
    source = readNetIdentityMigrationSource(tx, designId, timestamp);
    validateMigrationSource(source);
  }
  return source;
}

/** Caller owns the transaction: every stage, including backup and legacy fill, rolls back together. */
export function migrateDesignNetIdentity(
  tx: NetIdentityDb, designId: string, options: NetIdentityMigrationOptions,
): NetIdentityMigrationReport {
  const { timestamp } = options;
  const backup = stage("backup", options, () => backupMigration(tx, designId, timestamp));
  const source = stage("fill", options, () => fillMigration(tx, designId, timestamp));
  const identity = stage("derive", options, () => deriveMigrationIdentity(tx, designId, backup.watermark, backup.snapshot));
  const context = stage("evidence", options, () => migrationReferenceContext(identity, source));
  const plan = stage("rewrite", options, () => {
    const activeIds = new Set(identity.bound.nets.map((net) => net.id));
    validateSkippedBoardReferences(source, activeIds);
    const references = migrationReferenceSource(source), result = planLegacyNetReferences(references, context);
    validateMigrationPlan(references, result, activeIds, designId, timestamp);
    writeMigratedReferences(tx, source, references, result, timestamp);
    return result;
  });
  stage("quarantine", options, () => {
    for (const row of plan.quarantines) writeNetIdentityQuarantine(tx, { ...row, designId, createdAt: timestamp });
  });
  stage("histories", options, () => { tx.delete(sessionHistories).where(eq(sessionHistories.designId, designId)).run(); });
  const report: NetIdentityMigrationReport = {
    schemaVersion: 1, migratorVersion: NET_IDENTITY_MIGRATOR_VERSION,
    revisionBefore: backup.revisionBefore, revisionAfter: backup.revisionBefore + 1,
    netsAllocated: identity.bound.createdIds.length, references: plan.references,
    historiesArchived: backup.snapshot.sessionHistories.length,
    boardSettings: source.board.status === "parsed" ? "migrated" : source.board.status,
  };
  stage("state", options, () => {
    tx.update(designHeads).set({ revision: report.revisionAfter, updatedAt: timestamp }).where(eq(designHeads.id, designId)).run();
    writeNetIdentityState(tx, {
      designId, schemaVersion: 1, status: "active", nextSeq: identity.bound.nextSeq, active: identity.bound.nextActive,
      provenance: { origin: "legacy-migration", createdAt: timestamp, migratorVersion: NET_IDENTITY_MIGRATOR_VERSION, migration: report },
      lastError: null, updatedAt: timestamp,
    });
  });
  return report;
}
