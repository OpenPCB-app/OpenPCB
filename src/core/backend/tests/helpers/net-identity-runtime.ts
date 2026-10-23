import { afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../contracts/modules/backend-module";
import type { DesignerCommand, LibraryComponentPlacementDetail } from "../../../../sdks";
import { createDesignerStore } from "../../../../modules/designer/backend/store";
import { resetCaptureRuntimeForTesting } from "../../../../modules/designer/backend/capture";
import { designHeads } from "../../../../modules/designer/backend/schema";
import { readNetIdentityState } from "../../../../modules/designer/backend/net-identity/state-store";
import { createModuleDb } from "../../db/module-db-factory";
import { getSharedDb, getSharedSqlite, resetSharedSqliteForTesting } from "../../db/sqlite-client";
import { applyModuleMigrations } from "../../migrations/module-migrator";
import { ercPart } from "./erc-fixtures";

const oldPath = process.env.OPENPCB_DB_PATH;
const oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
const oldEnvironment = process.env.NODE_ENV;
const folders: string[] = [];

export function setupRuntimeCleanup(): void {
  afterEach(async () => {
    resetCaptureRuntimeForTesting();
    resetSharedSqliteForTesting();
    if (oldPath === undefined) delete process.env.OPENPCB_DB_PATH;
    else process.env.OPENPCB_DB_PATH = oldPath;
    if (oldCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
    else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = oldCapture;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnvironment;
    for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
  });
}

function component(): LibraryComponentPlacementDetail {
  const snapshot = ercPart([]);
  return { component: { id: "passive", name: "Passive", description: "", symbolId: "symbol",
    footprintId: "footprint", tags: [], isBuiltin: false },
    symbol: { ...snapshot.symbol, pins: [{ originPinKey: "1", number: "1", name: "Pin",
      localPositionMm: { x: 0, y: 0 }, electricalType: "passive", unit: 1 }] },
    footprint: snapshot.footprint, footprintVariants: [], resolvedAt: "2026-10-22T00:00:00.000Z" };
}

export async function openIdentityRuntime(file?: string) {
  if (!file) {
    const folder = await mkdtemp(path.join(os.tmpdir(), "net-identity-runtime-"));
    folders.push(folder);
    file = path.join(folder, "domain.sqlite");
  }
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = file;
  process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "0";
  const migration = await applyModuleMigrations("designer", path.resolve(import.meta.dir, "../../../../modules/designer/backend/migrations"));
  if (migration.failed) throw new Error(migration.failed.error);
  const errors: unknown[] = [];
  const library = { resolveComponentForPlacement: async () => component(), getDefaultFootprintRefs: async () => ({}) };
  const ctx: CoreBackendModuleContext = {
    moduleId: "designer", manifest: { id: "designer", label: "Designer", version: "0.1.0", apiVersion: 2,
      namespace: "openpcb.designer", kind: "space", enabled: true, availability: "all",
      sidebar: { label: "Designer", icon: "CircuitBoard", order: 1 },
      runtime: { backendEntry: "module.backend.ts", frontendEntry: "module.frontend.ts" }, dependsOn: [], defaultPinned: false },
    db: createModuleDb("designer"), sdk: { has: () => true, get: <T>() => library as unknown as T, registerValue: () => {} },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: (_message, meta) => { errors.push(meta); } },
  };
  return { store: createDesignerStore(ctx), file, errors };
}

export type IdentityRuntime = Awaited<ReturnType<typeof openIdentityRuntime>>;

export function body(designId: string, command: DesignerCommand, sessionId = "A") {
  const head = getSharedDb().select().from(designHeads).where(eq(designHeads.id, designId)).get()!;
  return { commandId: crypto.randomUUID(), sessionId, aggregateId: designId, baseRevision: head.revision,
    issuedAt: Date.now(), command };
}

export async function send(runtime: IdentityRuntime, designId: string, command: DesignerCommand, sessionId = "A") {
  const result = await runtime.store.dispatchCommand(designId, body(designId, command, sessionId));
  if (!result.ok) throw new Error(JSON.stringify({ result, errors: runtime.errors }));
  return result;
}

export async function placed(runtime: IdentityRuntime, designId: string, x: number, y: number) {
  const result = await send(runtime, designId, { type: "place_part", componentId: "passive", positionNm: { x, y } }, "setup");
  return { partId: result.createdEntityId!, pinId: `${result.createdEntityId}:1` };
}

export async function connected(runtime: IdentityRuntime, designId: string) {
  const ordered = [{ ...await placed(runtime, designId, 0, 0), x: 0 },
    { ...await placed(runtime, designId, 10_000_000, 0), x: 10_000_000 }].sort((a, b) => a.pinId.localeCompare(b.pinId));
  const first = ordered[0]!, second = ordered[1]!;
  const third = await placed(runtime, designId, second.x, 10_000_000);
  const wire = await send(runtime, designId, { type: "create_wire", sourcePinId: first.pinId, targetPinId: second.pinId }, "setup");
  return { first, second, third, wireId: wire.createdEntityId!, netId: identityState(designId).active[0]!.id };
}

export function identityState(designId: string) {
  return readNetIdentityState(getSharedDb(), designId)!;
}

export function rawRuntimeState(designId: string) {
  return ["design_heads", "schematic_parts", "schematic_pins", "schematic_wires", "schematic_labels", "schematic_primitives",
    "pcb_entities", "session_histories", "net_identity_state", "net_identity_retired"].map((table) =>
    getSharedSqlite().query(`SELECT * FROM designer_${table} WHERE ${table === "design_heads" ? "id" : "design_id"} = ? ORDER BY 1`).all(designId));
}
