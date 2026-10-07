import path from "node:path";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import type { DesignerCommandEnvelope, DesignerOperationIdentity } from "../../../sdks/designer";
import { createDesignerStore } from "../../../modules/designer/backend/store";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { createModuleDb } from "../db/module-db-factory";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { applyModuleMigrations } from "../migrations/module-migrator";

export async function openReceiptStore(
  file: string,
  afterCommandCommit?: (commandId: string) => void,
): Promise<ReturnType<typeof createDesignerStore>> {
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = file;
  process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "0";
  const report = await applyModuleMigrations("designer", path.resolve(
    import.meta.dir, "../../../modules/designer/backend/migrations",
  ));
  if (report.failed) throw new Error(report.failed.error);
  const ctx: CoreBackendModuleContext = {
    moduleId: "designer",
    manifest: {
      id: "designer", label: "Designer", version: "0.1.0", apiVersion: 2,
      namespace: "openpcb.designer", kind: "space", enabled: true,
      availability: "all", sidebar: { label: "Designer", icon: "CircuitBoard", order: 1 },
      runtime: { backendEntry: "module.backend.ts", frontendEntry: "module.frontend.ts" },
      dependsOn: [], defaultPinned: false,
    },
    db: createModuleDb("designer"),
    sdk: { has: () => false, get: () => null, registerValue: () => {} },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };
  return createDesignerStore(ctx, { afterCommandCommit });
}

export function receiptEnvelope(designId: string, commandId = "unit-1", baseRevision = 0): DesignerCommandEnvelope {
  return {
    commandId, sessionId: "receipt-session", aggregateId: designId,
    baseRevision, issuedAt: 1000,
    command: { type: "pcb_add_free_hole", centerMm: { x: 3, y: 4 }, drillMm: 1 },
  };
}

export function receiptIdentity(envelope: DesignerCommandEnvelope): DesignerOperationIdentity {
  return {
    actorScope: "local:chat-1", operationId: "operation-1", actionId: envelope.commandId,
    toolName: "designer_add_free_hole", argumentFingerprint: "arguments-sha256",
    designId: envelope.aggregateId, expectedRevision: envelope.baseRevision,
  };
}
