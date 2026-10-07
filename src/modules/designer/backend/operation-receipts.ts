import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerCommandEnvelope,
  DesignerDispatchResult,
  DesignerOperationIdentity,
  DesignerOperationReceipt,
  DesignerOperationReceiptLookup,
} from "../../../sdks/designer";
import { commandLog } from "./schema";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
type CommandLogRow = typeof commandLog.$inferSelect;

/** JSON object order must not change the identity of an immutable command. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

export function identityConflict(commandId: string): DesignerDispatchResult {
  return { ok: false, code: "OPERATION_IDENTITY_CONFLICT", commandId };
}

export function identityMatchesEnvelope(
  designId: string,
  envelope: DesignerCommandEnvelope,
  identity: DesignerOperationIdentity,
): boolean {
  return identity.designId === designId && envelope.aggregateId === designId &&
    identity.expectedRevision === envelope.baseRevision &&
    identityStringsValid(identity) && identity.expectedRevision !== null &&
    Number.isSafeInteger(identity.expectedRevision) && identity.expectedRevision >= 0;
}

export function identityStringsValid(identity: DesignerOperationIdentity): boolean {
  return [identity.actorScope, identity.operationId, identity.actionId,
    identity.toolName, identity.argumentFingerprint, identity.designId].every((value) =>
    typeof value === "string" && value.length > 0 && value.length <= 512);
}

export function operationRowMatches(
  row: CommandLogRow,
  identity: DesignerOperationIdentity,
  envelope?: DesignerCommandEnvelope,
): boolean {
  return row.operationIdentityJson === canonicalJson(identity) &&
    row.designId === identity.designId &&
    (!envelope || (row.sessionId === envelope.sessionId &&
      row.commandJson === canonicalJson(envelope.command)));
}

function rowReceipt(row: CommandLogRow): DesignerOperationReceipt {
  // Only this domain writes these values. Preserve the canonical result exactly,
  // including failures and future optional fields, rather than replay decorators.
  return {
    commandId: row.commandId,
    identity: JSON.parse(row.operationIdentityJson!) as DesignerOperationIdentity,
    command: JSON.parse(row.commandJson) as DesignerOperationReceipt["command"],
    sessionId: row.sessionId,
    result: JSON.parse(row.resultJson) as DesignerDispatchResult,
    committedAt: row.createdAt,
  };
}

export function readOperationReceipt(
  db: DbClient,
  commandId: string,
  identity: DesignerOperationIdentity,
): DesignerOperationReceiptLookup {
  const row = db.select().from(commandLog).where(eq(commandLog.commandId, commandId)).get();
  if (!row) return { status: "missing" };
  if (!operationRowMatches(row, identity)) return { status: "conflict" };
  return { status: "found", receipt: rowReceipt(row) };
}

export function listOperationReceipts(
  db: DbClient,
  actorScope: string,
  operationId: string,
): DesignerOperationReceipt[] {
  return db.select().from(commandLog).where(and(
    eq(commandLog.actorScope, actorScope), eq(commandLog.operationId, operationId),
  )).orderBy(asc(commandLog.createdAt), asc(commandLog.commandId)).all().map(rowReceipt);
}
