import { and, eq, inArray, ne } from "drizzle-orm";
import { AppError } from "../../../../core/contracts/errors";
import {
  designHeads, netIdentityQuarantine, pcbEntities, schematicLabels, schematicParts,
  schematicPins, schematicPrimitives, schematicWires, sessionHistories,
} from "../schema";
import { parseNetIdentityBackup, type NetIdentityBackupSnapshot } from "./backup";
import {
  readNetIdentityBackup, readNetIdentitySeqWatermark, readNetIdentityState,
  writeNetIdentityRetired, writeNetIdentityState, type NetIdentityDb,
} from "./state-store";
import { seqOf } from "./types";
import { requireValid, safeInteger } from "./validation";

interface RestoreOptions {
  timestamp: string;
  confirmDiscardRevisions: boolean;
}

export function restoreLegacyNetIdentity(
  db: NetIdentityDb, designId: string, options: RestoreOptions,
): { revision: number } {
  return db.transaction((raw) => restoreInTransaction(raw as NetIdentityDb, designId, options));
}

function restoreInTransaction(
  tx: NetIdentityDb, designId: string, options: RestoreOptions,
): { revision: number } {
  requireValid(typeof options.timestamp === "string" && options.timestamp.trim().length > 0, "restore.timestamp", "must be a non-blank timestamp");
  const state = readNetIdentityState(tx, designId);
  requireValid(state?.status === "active" && state.provenance.origin === "legacy-migration" && state.provenance.migration, "restore.state", "requires active legacy migration provenance");
  const backup = readNetIdentityBackup(tx, designId);
  requireValid(backup, "restore.backup", "backup does not exist");
  const snapshot = parseNetIdentityBackup(backup, designId);
  const migration = state.provenance.migration;
  requireValid(backup.revision === migration.revisionBefore, "restore.backup.revision", "does not match migration provenance");
  const head = tx.select().from(designHeads).where(eq(designHeads.id, designId)).get();
  requireValid(head, "restore.designId", "design does not exist");
  safeInteger(head.revision, "restore.revision");
  safeInteger(head.revision + 1, "restore.revision");
  requireValid(head.revision >= migration.revisionAfter, "restore.revision", "predates migration provenance");
  if (head.revision > migration.revisionAfter && options.confirmDiscardRevisions !== true) {
    throw new AppError("Restoring the legacy backup will discard edits made after migration.", 409,
      "Restore discards later edits", "https://openpcb.dev/problems/net-identity-restore-discards-edits");
  }
  assertNoForeignRows(tx, snapshot);
  const nextSeq = readNetIdentitySeqWatermark(tx, designId);
  const revision = head.revision + 1;
  replaceBackedRows(tx, snapshot);
  for (const active of state.active) {
    writeNetIdentityRetired(tx, {
      designId, netId: active.id, seq: seqOf(active.id)!, reason: "history",
      successorIds: [], displayName: active.name, retiredAtRevision: revision,
      createdAt: options.timestamp, updatedAt: options.timestamp,
    });
  }
  tx.delete(netIdentityQuarantine).where(eq(netIdentityQuarantine.designId, designId)).run();
  writeNetIdentityState(tx, {
    ...state, status: "legacy_restored", active: [], nextSeq,
    provenance: { ...state.provenance, restoredAt: options.timestamp },
    lastError: null, updatedAt: options.timestamp,
  });
  tx.update(designHeads).set({ revision, updatedAt: options.timestamp }).where(eq(designHeads.id, designId)).run();
  return { revision };
}

function assertNoForeignRows(tx: NetIdentityDb, snapshot: NetIdentityBackupSnapshot): void {
  for (const [table, rows] of [
    [schematicParts, snapshot.schematic.parts], [schematicPins, snapshot.schematic.pins],
    [schematicWires, snapshot.schematic.wires], [schematicLabels, snapshot.schematic.labels],
    [schematicPrimitives, snapshot.schematic.primitives], [pcbEntities, snapshot.pcbEntities],
    [sessionHistories, snapshot.sessionHistories],
  ] as const) {
    // Bound chunks avoid SQLite's variable limit on large backed-up designs.
    for (let index = 0; index < rows.length; index += 500) {
      const ids = rows.slice(index, index + 500).map((row) => row.id);
      const foreign = tx.select({ id: table.id }).from(table).where(and(
        inArray(table.id, ids), ne(table.designId, snapshot.designId),
      )).get();
      requireValid(!foreign, `restore.${table.id.name}`, "backup id belongs to another design");
    }
  }
}

function replaceBackedRows(tx: NetIdentityDb, snapshot: NetIdentityBackupSnapshot): void {
  for (const table of [
    schematicWires, schematicPins, schematicLabels, schematicPrimitives,
    schematicParts, pcbEntities, sessionHistories,
  ]) tx.delete(table).where(eq(table.designId, snapshot.designId)).run();
  for (const row of snapshot.schematic.parts) tx.insert(schematicParts).values(row).run();
  for (const row of snapshot.schematic.pins) tx.insert(schematicPins).values(row).run();
  for (const row of snapshot.schematic.labels) tx.insert(schematicLabels).values(row).run();
  for (const row of snapshot.schematic.primitives) tx.insert(schematicPrimitives).values(row).run();
  for (const row of snapshot.schematic.wires) tx.insert(schematicWires).values(row).run();
  for (const row of snapshot.pcbEntities) tx.insert(pcbEntities).values(row).run();
  for (const row of snapshot.sessionHistories) tx.insert(sessionHistories).values(row).run();
}
