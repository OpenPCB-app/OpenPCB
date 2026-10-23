import { eq } from "drizzle-orm";
import { AppError, NotFoundError, ValidationError } from "../../../../core/contracts/errors";
import type { Logger, ModuleRouterHandle } from "../../../../core/contracts/modules/backend-module";
import { loadSchematicProjection } from "../projection-read";
import { designHeads } from "../schema";
import { asRecord } from "../value-guards";
import { loadNetReferenceSource } from "./census-source";
import { retryNetIdentityMigration } from "./ensure";
import { restoreLegacyNetIdentity } from "./restore";
import type { NetIdentityDb } from "./state-store";
import { buildNetIdentitySummary } from "./summary";
import { NetIdentityStateInvalidError } from "./types";

interface RouteDependencies {
  db: NetIdentityDb;
  logger: Pick<Logger, "warn" | "error">;
  success: (data: unknown) => Response;
}

function requireDesign(db: NetIdentityDb, designId: string): number {
  const head = db.select({ revision: designHeads.revision }).from(designHeads)
    .where(eq(designHeads.id, designId)).get();
  if (!head) throw new NotFoundError(`Design '${designId}' not found`);
  return head.revision;
}

/** Status reads never ensure migration or populate PCB rows. */
function readStatus(db: NetIdentityDb, designId: string) {
  return db.transaction((raw) => {
    const tx = raw as NetIdentityDb;
    const revision = requireDesign(tx, designId);
    const schematic = loadSchematicProjection(tx, designId);
    if (!schematic) throw new NotFoundError(`Design '${designId}' not found`);
    return { revision, ...buildNetIdentitySummary(tx, designId, schematic, loadNetReferenceSource(tx, designId)) };
  });
}

async function restoreConfirmation(req: Request): Promise<boolean> {
  let body: unknown;
  try { body = await req.json(); }
  catch { throw new ValidationError("Request body must be valid JSON"); }
  const record = asRecord(body);
  if (!record) throw new ValidationError("Request body must be an object");
  if (Object.hasOwn(record, "confirmDiscardRevisions") && typeof record.confirmDiscardRevisions !== "boolean") {
    throw new ValidationError("confirmDiscardRevisions must be a boolean");
  }
  return record.confirmDiscardRevisions === true;
}

function restore(db: NetIdentityDb, designId: string, confirmDiscardRevisions: boolean): void {
  try {
    restoreLegacyNetIdentity(db, designId, { timestamp: new Date().toISOString(), confirmDiscardRevisions });
  } catch (error) {
    if (!(error instanceof NetIdentityStateInvalidError)) throw error;
    throw new AppError(error.message, 422, "Invalid net identity restore",
      "https://openpcb.dev/problems/net-identity-restore-invalid", { code: "NET_IDENTITY_RESTORE_INVALID" });
  }
}

export function registerNetIdentityRoutes(router: ModuleRouterHandle, dependencies: RouteDependencies): void {
  const { db, logger, success } = dependencies;
  const path = "/designs/:designId/net-identity";
  router.get(path, async ({ params }) => success(readStatus(db, params.getOrThrow("designId"))));
  router.post(`${path}/migrate`, async ({ params }) => {
    const designId = params.getOrThrow("designId");
    requireDesign(db, designId);
    retryNetIdentityMigration(db, designId, logger);
    return success(readStatus(db, designId));
  });
  router.post(`${path}/restore-legacy`, async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    requireDesign(db, designId);
    restore(db, designId, await restoreConfirmation(req));
    return success(readStatus(db, designId));
  });
}
