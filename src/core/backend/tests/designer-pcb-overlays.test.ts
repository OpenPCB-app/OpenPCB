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
  createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return { moduleRuntime };
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

const SESSION = "overlays-session";

describe("designer PCB overlay primitives (F5)", () => {
  test("add overlay text appears in projection", async () => {
    isolateTestDb("overlay-text-add");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Overlay text" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-1", SESSION, 0, {
        type: "pcb_add_overlay_text",
        layer: "F.SilkS",
        positionMm: { x: 10, y: 20 },
        text: "v1.0",
        fontSizeMm: 1.2,
        rotationDeg: 0,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.overlayTexts).toHaveLength(1);
    expect(proj?.overlayTexts[0]).toMatchObject({
      text: "v1.0",
      layer: "F.SilkS",
      fontSizeMm: 1.2,
      justify: "center",
      mirror: false,
    });
  });

  test("rejects empty text", async () => {
    isolateTestDb("overlay-text-empty");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Empty" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-bad", SESSION, 0, {
        type: "pcb_add_overlay_text",
        layer: "F.SilkS",
        positionMm: { x: 0, y: 0 },
        text: "x",
        fontSizeMm: -1,
        rotationDeg: 0,
      }),
    );
    expect(result.ok).toBe(false);
  });

  test("update overlay text patches fields", async () => {
    isolateTestDb("overlay-text-update");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Update text" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-a", SESSION, 0, {
        type: "pcb_add_overlay_text",
        layer: "F.SilkS",
        positionMm: { x: 0, y: 0 },
        text: "ABC",
        fontSizeMm: 1,
        rotationDeg: 0,
      }),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const proj1 = await sdk.getPcbProjection(design.id);
    const upd = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-u", SESSION, proj1!.revision, {
        type: "pcb_update_overlay_text",
        overlayTextId: add.createdEntityId!,
        text: "XYZ",
        layer: "B.SilkS",
      }),
    );
    expect(upd.ok).toBe(true);
    const proj2 = await sdk.getPcbProjection(design.id);
    expect(proj2?.overlayTexts[0]?.text).toBe("XYZ");
    expect(proj2?.overlayTexts[0]?.layer).toBe("B.SilkS");
  });

  test("add overlay rect shape with fill", async () => {
    isolateTestDb("overlay-rect");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Rect" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-r", SESSION, 0, {
        type: "pcb_add_overlay_shape",
        layer: "F.Fab",
        kind: "rect",
        pointsMm: [
          { x: 0, y: 0 },
          { x: 10, y: 5 },
        ],
        strokeWidthMm: 0.15,
        fill: "solid",
      }),
    );
    expect(result.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.overlayShapes).toHaveLength(1);
    expect(proj?.overlayShapes[0]?.kind).toBe("rect");
    expect(proj?.overlayShapes[0]?.fill).toBe("solid");
  });

  test("rejects shape with single point", async () => {
    isolateTestDb("overlay-shape-too-few");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Few pts" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-bad", SESSION, 0, {
        type: "pcb_add_overlay_shape",
        layer: "F.SilkS",
        kind: "polyline",
        pointsMm: [{ x: 0, y: 0 }],
        strokeWidthMm: 0.1,
      }),
    );
    expect(result.ok).toBe(false);
  });

  test("polyline preserves points", async () => {
    isolateTestDb("overlay-polyline");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Poly" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-p", SESSION, 0, {
        type: "pcb_add_overlay_shape",
        layer: "F.SilkS",
        kind: "polyline",
        pointsMm: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
        ],
        strokeWidthMm: 0.12,
      }),
    );
    expect(result.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.overlayShapes[0]?.pointsMm).toHaveLength(3);
  });

  test("delete overlay shape removes from projection", async () => {
    isolateTestDb("overlay-shape-delete");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Del" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-a", SESSION, 0, {
        type: "pcb_add_overlay_shape",
        layer: "F.SilkS",
        kind: "line",
        pointsMm: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        strokeWidthMm: 0.12,
      }),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const proj1 = await sdk.getPcbProjection(design.id);
    await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-d", SESSION, proj1!.revision, {
        type: "pcb_delete_overlay_shape",
        overlayShapeId: add.createdEntityId!,
      }),
    );
    const proj2 = await sdk.getPcbProjection(design.id);
    expect(proj2?.overlayShapes).toEqual([]);
  });

  test("undo restores overlay shape add (history wiring)", async () => {
    isolateTestDb("overlay-undo");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Undo overlay" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-a", SESSION, 0, {
        type: "pcb_add_overlay_shape",
        layer: "F.SilkS",
        kind: "line",
        pointsMm: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        strokeWidthMm: 0.12,
      }),
    );
    expect(add.ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.overlayShapes).toHaveLength(
      1,
    );
    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.overlayShapes).toHaveLength(
      0,
    );
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.overlayShapes).toHaveLength(
      1,
    );
  });

  test("lock + edit-locked rejected", async () => {
    isolateTestDb("overlay-lock");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Lock" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-a", SESSION, 0, {
        type: "pcb_add_overlay_text",
        layer: "F.SilkS",
        positionMm: { x: 0, y: 0 },
        text: "X",
        fontSizeMm: 1,
        rotationDeg: 0,
      }),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    let proj = await sdk.getPcbProjection(design.id);
    const lock = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-l", SESSION, proj!.revision, {
        type: "pcb_update_overlay_text",
        overlayTextId: add.createdEntityId!,
        locked: true,
      }),
    );
    expect(lock.ok).toBe(true);
    proj = await sdk.getPcbProjection(design.id);
    const blocked = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-b", SESSION, proj!.revision, {
        type: "pcb_update_overlay_text",
        overlayTextId: add.createdEntityId!,
        text: "Y",
      }),
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("INVALID_PCB_OVERLAY");
  });
});
