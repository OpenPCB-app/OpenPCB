import { createHash } from "node:crypto";
import { asc, eq, getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  designHeads, pcbEntities, schematicLabels, schematicParts, schematicPins,
  schematicPrimitives, schematicWires, sessionHistories,
} from "../schema";
import type { NetIdentityDb } from "./state-store";
import type { NetIdentityBackup } from "./types";
import { parseStoredJson, requireValid, safeInteger, validateBackup } from "./validation";

export const NET_IDENTITY_BACKUP_FORMAT = "openpcb.net-identity-backup/2";

export interface NetIdentityBackupSnapshot {
  format: typeof NET_IDENTITY_BACKUP_FORMAT;
  designId: string;
  revision: number;
  schematic: {
    parts: (typeof schematicParts.$inferSelect)[];
    pins: (typeof schematicPins.$inferSelect)[];
    wires: (typeof schematicWires.$inferSelect)[];
    labels: (typeof schematicLabels.$inferSelect)[];
    primitives: (typeof schematicPrimitives.$inferSelect)[];
  };
  pcbEntities: (typeof pcbEntities.$inferSelect)[];
  sessionHistories: (typeof sessionHistories.$inferSelect)[];
}

/** Capture before migration writes; ordering matches the frozen legacy fixtures. */
export function captureNetIdentityBackup(
  tx: NetIdentityDb, designId: string, timestamp: string,
): NetIdentityBackup {
  const head = tx.select().from(designHeads).where(eq(designHeads.id, designId)).get();
  requireValid(head, "backup.designId", "design does not exist");
  const payload: NetIdentityBackupSnapshot = {
    format: NET_IDENTITY_BACKUP_FORMAT,
    designId,
    revision: head.revision,
    schematic: {
      parts: tx.select().from(schematicParts).where(eq(schematicParts.designId, designId)).orderBy(asc(schematicParts.id)).all(),
      pins: tx.select().from(schematicPins).where(eq(schematicPins.designId, designId)).orderBy(asc(schematicPins.id)).all(),
      wires: tx.select().from(schematicWires).where(eq(schematicWires.designId, designId)).orderBy(asc(schematicWires.id)).all(),
      labels: tx.select().from(schematicLabels).where(eq(schematicLabels.designId, designId)).orderBy(asc(schematicLabels.id)).all(),
      primitives: tx.select().from(schematicPrimitives).where(eq(schematicPrimitives.designId, designId)).orderBy(asc(schematicPrimitives.id)).all(),
    },
    pcbEntities: tx.select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).orderBy(asc(pcbEntities.id)).all(),
    sessionHistories: tx.select().from(sessionHistories).where(eq(sessionHistories.designId, designId)).orderBy(asc(sessionHistories.id)).all(),
  };
  const payloadJson = JSON.stringify(payload);
  const backup: NetIdentityBackup = {
    designId, schemaVersion: 1, revision: head.revision, payloadJson,
    sha256: createHash("sha256").update(payloadJson, "utf8").digest("hex"),
    createdAt: timestamp,
  };
  parseNetIdentityBackup(backup, designId);
  return backup;
}

/** Pure validation; opaque JSON columns are never parsed or normalized. */
export function parseNetIdentityBackup(
  backup: NetIdentityBackup, designId: string,
): NetIdentityBackupSnapshot {
  validateBackup(backup);
  requireValid(backup.designId === designId, "backup.designId", "belongs to another design");
  const payload = object(parseStoredJson(backup.payloadJson, "backup.payloadJson"), "backup.payload");
  requireValid(payload.format === NET_IDENTITY_BACKUP_FORMAT, "backup.format", "unsupported backup format");
  requireValid(payload.designId === designId, "backup.payload.designId", "belongs to another design");
  safeInteger(payload.revision, "backup.payload.revision");
  requireValid(payload.revision === backup.revision, "backup.revision", "does not match payload revision");
  const schematic = object(payload.schematic, "backup.schematic");
  validateRows(schematic.parts, schematicParts, designId, "schematic.parts");
  validateRows(schematic.pins, schematicPins, designId, "schematic.pins");
  validateRows(schematic.wires, schematicWires, designId, "schematic.wires");
  validateRows(schematic.labels, schematicLabels, designId, "schematic.labels");
  validateRows(schematic.primitives, schematicPrimitives, designId, "schematic.primitives");
  validateRows(payload.pcbEntities, pcbEntities, designId, "pcbEntities");
  validateRows(payload.sessionHistories, sessionHistories, designId, "sessionHistories");
  const snapshot = payload as unknown as NetIdentityBackupSnapshot;
  validateRelations(snapshot);
  return snapshot;
}

function object(value: unknown, path: string): Record<string, unknown> {
  requireValid(value !== null && typeof value === "object" && !Array.isArray(value), path, "must be an object");
  return value as Record<string, unknown>;
}

function validateRows(value: unknown, table: SQLiteTable, designId: string, path: string): void {
  requireValid(Array.isArray(value), path, "must be an array");
  const columns = getTableColumns(table);
  const ids = new Set<string>();
  value.forEach((value, index) => {
    const at = `${path}[${index}]`;
    const row = object(value, at);
    requireValid(typeof row.id === "string" && row.id.trim().length > 0, `${at}.id`, "must be a non-blank id");
    requireValid(row.designId === designId, `${at}.designId`, "belongs to another design");
    requireValid(!ids.has(row.id), `${at}.id`, "duplicate row id");
    ids.add(row.id);
    requireValid(Object.keys(row).every((key) => Object.hasOwn(columns, key)), at, "contains unsupported columns");
    for (const [key, column] of Object.entries(columns)) {
      requireValid(Object.hasOwn(row, key), `${at}.${key}`, "missing required raw column");
      const entry = row[key];
      if (entry === null && !column.notNull) continue;
      if (column.dataType === "number") {
        requireValid(typeof entry === "number" && Number.isSafeInteger(entry), `${at}.${key}`, "must be a safe integer");
      } else {
        requireValid(typeof entry === "string", `${at}.${key}`, "must be a string");
      }
    }
  });
}

function validateRelations(snapshot: NetIdentityBackupSnapshot): void {
  const parts = new Set(snapshot.schematic.parts.map((row) => row.id));
  for (const pin of snapshot.schematic.pins) {
    requireValid(parts.has(pin.partId), `schematic.pins.${pin.id}.partId`, "owning part is missing from backup");
  }
  uniqueKeys(snapshot.schematic.parts.map((row) => row.reference), "schematic.parts.reference");
  uniqueKeys(snapshot.schematic.pins.map((row) => JSON.stringify([row.partId, row.originPinKey])), "schematic.pins.partOriginKey");
  uniqueKeys(snapshot.sessionHistories.map((row) => row.sessionId), "sessionHistories.sessionId");
}

function uniqueKeys(values: string[], path: string): void {
  requireValid(new Set(values).size === values.length, path, "duplicate unique key");
}
