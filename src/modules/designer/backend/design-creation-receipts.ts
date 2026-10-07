import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ModuleDbClient } from "../../../core/contracts/modules/backend-module";
import type {
  CreateDesignerDesignInput, DesignerDesignCreationReceipt,
  DesignerDesignCreationReceiptLookup, DesignerDesignCreationResult,
  DesignerOperationIdentity,
} from "../../../sdks/designer";
import { canonicalJson, identityStringsValid } from "./operation-receipts";
import { insertDesign } from "./design-initialization";
import { designCreationReceipts, designHeads } from "./schema";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
type ReceiptRow = typeof designCreationReceipts.$inferSelect;

function receiptFromRow(row: ReceiptRow): DesignerDesignCreationReceipt {
  return {
    identity: JSON.parse(row.identityJson) as DesignerOperationIdentity,
    input: JSON.parse(row.inputJson) as CreateDesignerDesignInput,
    design: JSON.parse(row.designJson) as DesignerDesignCreationReceipt["design"],
    committedAt: row.createdAt,
  };
}

export function readDesignCreationReceipt(
  db: DbClient, identity: DesignerOperationIdentity,
): DesignerDesignCreationReceiptLookup {
  const row = db.select().from(designCreationReceipts)
    .where(and(eq(designCreationReceipts.actionId, identity.actionId),
      eq(designCreationReceipts.actorScope, identity.actorScope))).get();
  if (!row) return { status: "missing" };
  if (row.identityJson !== canonicalJson(identity)) return { status: "conflict" };
  return { status: "found", receipt: receiptFromRow(row) };
}

export function listDesignCreationReceipts(
  db: DbClient, actorScope: string, operationId: string,
): DesignerDesignCreationReceipt[] {
  return db.select().from(designCreationReceipts).where(and(
    eq(designCreationReceipts.actorScope, actorScope),
    eq(designCreationReceipts.operationId, operationId),
  )).orderBy(asc(designCreationReceipts.createdAt), asc(designCreationReceipts.actionId))
    .all().map(receiptFromRow);
}

export function createDesignOperation(
  moduleDb: ModuleDbClient,
  input: CreateDesignerDesignInput,
  identity: DesignerOperationIdentity,
): DesignerDesignCreationResult {
  const failure: DesignerDesignCreationResult = {
    ok: false, code: "OPERATION_IDENTITY_CONFLICT", commandId: identity.actionId,
  };
  if (!identityStringsValid(identity) ||
    (identity.expectedRevision !== null && identity.expectedRevision !== 0)) return failure;
  return moduleDb.transaction((raw) => {
    const tx = raw as DbClient;
    const existing = tx.select().from(designCreationReceipts)
      .where(and(eq(designCreationReceipts.actionId, identity.actionId),
        eq(designCreationReceipts.actorScope, identity.actorScope))).get();
    if (existing) {
      if (existing.identityJson !== canonicalJson(identity) ||
        existing.inputJson !== canonicalJson(input)) return failure;
      return { ok: true, design: receiptFromRow(existing).design };
    }
    if (tx.select().from(designHeads).where(eq(designHeads.id, identity.designId)).get()) return failure;
    const timestamp = new Date().toISOString();
    const design = insertDesign(tx, input, identity.designId, timestamp);
    tx.insert(designCreationReceipts).values({
      actionId: identity.actionId, actorScope: identity.actorScope,
      operationId: identity.operationId, identityJson: canonicalJson(identity),
      inputJson: canonicalJson(input), designJson: JSON.stringify(design), createdAt: timestamp,
    }).run();
    return { ok: true, design };
  });
}
