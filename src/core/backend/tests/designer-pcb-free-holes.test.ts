import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerCommandEnvelope, DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createRuntime() {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return { moduleRuntime, server };
}

function envelope(
  designId: string,
  commandId: string,
  sessionId: string,
  baseRevision: number | null,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  return {
    commandId,
    sessionId,
    aggregateId: designId,
    baseRevision,
    issuedAt: Date.now(),
    command,
  };
}

const SESSION = "free-holes-session";

describe("designer PCB free holes (F5)", () => {
  test("add free hole appears in projection", async () => {
    isolateTestDb("free-hole-add");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Free hole add" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add-hole-1", SESSION, 0, {
        type: "pcb_add_free_hole",
        centerMm: { x: 12.5, y: 9 },
        drillMm: 3.2,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.freeHoles).toHaveLength(1);
    expect(proj?.freeHoles[0]).toMatchObject({
      centerMm: { x: 12.5, y: 9 },
      drillMm: 3.2,
      lockedAt: null,
    });
    expect(proj?.freeHoles[0]?.id).toBe(result.createdEntityId!);
  });

  test("rejects non-positive drill", async () => {
    isolateTestDb("free-hole-invalid-drill");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Invalid drill" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-bad", SESSION, 0, {
        type: "pcb_add_free_hole",
        centerMm: { x: 0, y: 0 },
        drillMm: 0,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_PCB_FREE_HOLE");
  });

  test("update free hole patches center and drill", async () => {
    isolateTestDb("free-hole-update");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Update" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add", SESSION, 0, {
        type: "pcb_add_free_hole",
        centerMm: { x: 5, y: 5 },
        drillMm: 2,
      }),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const holeId = add.createdEntityId!;
    const proj1 = await sdk.getPcbProjection(design.id);
    const update = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-up", SESSION, proj1!.revision, {
        type: "pcb_update_free_hole",
        freeHoleId: holeId,
        centerMm: { x: 20, y: 30 },
        drillMm: 4,
      }),
    );
    expect(update.ok).toBe(true);
    const proj2 = await sdk.getPcbProjection(design.id);
    expect(proj2?.freeHoles[0]).toMatchObject({
      centerMm: { x: 20, y: 30 },
      drillMm: 4,
    });
  });

  test("lock then update is rejected; unlock then update succeeds", async () => {
    isolateTestDb("free-hole-lock");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Lock" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add", SESSION, 0, {
        type: "pcb_add_free_hole",
        centerMm: { x: 1, y: 2 },
        drillMm: 1,
      }),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const holeId = add.createdEntityId!;
    let proj = await sdk.getPcbProjection(design.id);
    const lock = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-lock", SESSION, proj!.revision, {
        type: "pcb_update_free_hole",
        freeHoleId: holeId,
        locked: true,
      }),
    );
    expect(lock.ok).toBe(true);
    proj = await sdk.getPcbProjection(design.id);
    expect(proj?.freeHoles[0]?.lockedAt).not.toBeNull();
    const blocked = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-edit-locked", SESSION, proj!.revision, {
        type: "pcb_update_free_hole",
        freeHoleId: holeId,
        centerMm: { x: 9, y: 9 },
      }),
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("INVALID_PCB_FREE_HOLE");
    proj = await sdk.getPcbProjection(design.id);
    const unlock = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-unlock", SESSION, proj!.revision, {
        type: "pcb_update_free_hole",
        freeHoleId: holeId,
        locked: false,
        centerMm: { x: 9, y: 9 },
      }),
    );
    expect(unlock.ok).toBe(true);
    proj = await sdk.getPcbProjection(design.id);
    expect(proj?.freeHoles[0]?.lockedAt).toBeNull();
    expect(proj?.freeHoles[0]?.centerMm).toEqual({ x: 9, y: 9 });
  });

  test("delete free hole removes from projection", async () => {
    isolateTestDb("free-hole-delete");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Delete" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add", SESSION, 0, {
        type: "pcb_add_free_hole",
        centerMm: { x: 0, y: 0 },
        drillMm: 1.5,
      }),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    let proj = await sdk.getPcbProjection(design.id);
    const del = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-del", SESSION, proj!.revision, {
        type: "pcb_delete_free_hole",
        freeHoleId: add.createdEntityId!,
      }),
    );
    expect(del.ok).toBe(true);
    proj = await sdk.getPcbProjection(design.id);
    expect(proj?.freeHoles).toHaveLength(0);
  });

  test("undo restores then redo re-applies free hole add", async () => {
    isolateTestDb("free-hole-undo");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Undo hole" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add", SESSION, 0, {
        type: "pcb_add_free_hole",
        centerMm: { x: 4, y: 7 },
        drillMm: 2.0,
      }),
    );
    expect(add.ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.freeHoles).toHaveLength(1);

    const undo = await sdk.undo(design.id, SESSION);
    expect(undo.ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.freeHoles).toHaveLength(0);

    const redo = await sdk.redo(design.id, SESSION);
    expect(redo.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.freeHoles).toHaveLength(1);
    expect(proj?.freeHoles[0]).toMatchObject({
      centerMm: { x: 4, y: 7 },
      drillMm: 2.0,
    });
  });

  test("delete missing free hole returns NOT_FOUND", async () => {
    isolateTestDb("free-hole-delete-missing");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Delete missing" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-del-missing", SESSION, 0, {
        type: "pcb_delete_free_hole",
        freeHoleId: "no-such-id",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PCB_FREE_HOLE_NOT_FOUND");
  });
});
