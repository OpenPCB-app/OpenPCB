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

const SESSION = "free-pads-session";

describe("designer PCB free pads + manual vias (F5)", () => {
  test("add SMD free pad surfaces in projection", async () => {
    isolateTestDb("free-pad-smd");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Free pad SMD" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-1", SESSION, 0, {
        type: "pcb_add_free_pad",
        centerMm: { x: 10, y: 5 },
        rotationDeg: 0,
        padType: "smd",
        shape: "rect",
        widthMm: 1.2,
        heightMm: 0.6,
        layer: "F.Cu",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.freePads).toHaveLength(1);
    expect(proj?.freePads[0]).toMatchObject({
      centerMm: { x: 10, y: 5 },
      padType: "smd",
      shape: "rect",
      drillMm: null,
    });
  });

  test("STD plated through-pad requires drillMm", async () => {
    isolateTestDb("free-pad-std-drill");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Free pad STD" });
    const bad = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-bad", SESSION, 0, {
        type: "pcb_add_free_pad",
        centerMm: { x: 0, y: 0 },
        rotationDeg: 0,
        padType: "std",
        shape: "circle",
        widthMm: 1.8,
        heightMm: 1.8,
        layer: "F.Cu",
      }),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.code).toBe("INVALID_PCB_FREE_PAD");

    const good = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-good", SESSION, 0, {
        type: "pcb_add_free_pad",
        centerMm: { x: 0, y: 0 },
        rotationDeg: 0,
        padType: "std",
        shape: "circle",
        widthMm: 1.8,
        heightMm: 1.8,
        drillMm: 0.9,
        layer: "F.Cu",
      }),
    );
    expect(good.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.freePads[0]?.drillMm).toBe(0.9);
  });

  test("drill larger than pad rejected", async () => {
    isolateTestDb("free-pad-drill-too-big");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Drill too big" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-1", SESSION, 0, {
        type: "pcb_add_free_pad",
        centerMm: { x: 0, y: 0 },
        rotationDeg: 0,
        padType: "hole",
        shape: "circle",
        widthMm: 1.0,
        heightMm: 1.0,
        drillMm: 2.0,
        layer: "F.Cu",
      }),
    );
    expect(result.ok).toBe(false);
  });

  test("update free pad net assignment", async () => {
    isolateTestDb("free-pad-net");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Net assign" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add", SESSION, 0, {
        type: "pcb_add_free_pad",
        centerMm: { x: 0, y: 0 },
        rotationDeg: 0,
        padType: "smd",
        shape: "rect",
        widthMm: 1,
        heightMm: 1,
        layer: "F.Cu",
        netId: null,
      }),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const proj1 = await sdk.getPcbProjection(design.id);
    const upd = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-upd", SESSION, proj1!.revision, {
        type: "pcb_update_free_pad",
        freePadId: add.createdEntityId!,
        netId: "net-vcc",
      }),
    );
    expect(upd.ok).toBe(true);
    const proj2 = await sdk.getPcbProjection(design.id);
    expect(proj2?.freePads[0]?.netId).toBe("net-vcc");
  });

  test("delete free pad removes from projection", async () => {
    isolateTestDb("free-pad-delete");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Delete" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add", SESSION, 0, {
        type: "pcb_add_free_pad",
        centerMm: { x: 0, y: 0 },
        rotationDeg: 0,
        padType: "smd",
        shape: "rect",
        widthMm: 1,
        heightMm: 1,
        layer: "F.Cu",
      }),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    let proj = await sdk.getPcbProjection(design.id);
    await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-del", SESSION, proj!.revision, {
        type: "pcb_delete_free_pad",
        freePadId: add.createdEntityId!,
      }),
    );
    proj = await sdk.getPcbProjection(design.id);
    expect(proj?.freePads).toEqual([]);
  });

  test("undo restores free pad add (history wiring)", async () => {
    isolateTestDb("free-pad-undo");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Undo pad" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add", SESSION, 0, {
        type: "pcb_add_free_pad",
        centerMm: { x: 3, y: 2 },
        rotationDeg: 0,
        padType: "smd",
        shape: "rect",
        widthMm: 1,
        heightMm: 1,
        layer: "F.Cu",
      }),
    );
    expect(add.ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.freePads).toHaveLength(1);
    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.freePads).toHaveLength(0);
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.freePads).toHaveLength(1);
  });

  test("manual via tagged provenance=manual", async () => {
    isolateTestDb("manual-via");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Manual via" });
    const proj0 = await sdk.getPcbProjection(design.id);
    const netClassId = proj0!.board.netClasses[0]!.id;
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-1", SESSION, 0, {
        type: "pcb_add_manual_via",
        centerMm: { x: 15, y: 12 },
        netId: null,
        netClassId,
      }),
    );
    expect(result.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.vias).toHaveLength(1);
    expect(proj?.vias[0]?.provenance).toBe("manual");
  });
});
