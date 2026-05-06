import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerCommandEnvelope, DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
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

describe("designer PCB phase 1", () => {
  test("creates default PCB board with new designs", async () => {
    isolateTestDb("designer-pcb-default");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "PCB Default" });
    const projection = await designerSdk.getPcbProjection(design.id);

    expect(projection?.board.outline.widthMm).toBe(100);
    expect(projection?.board.outline.heightMm).toBe(80);
    expect(projection?.board.activeLayer).toBe("F.Cu");
  });

  test("auto-heals missing PCB board settings for old designs", async () => {
    isolateTestDb("designer-pcb-heal");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "PCB Heal" });
    getSharedSqlite()
      .query("delete from designer_pcb_entities where design_id = ?")
      .run(design.id);

    const projection = await designerSdk.getPcbProjection(design.id);

    expect(projection?.board.outline.widthMm).toBe(100);
    expect(projection?.board.outline.heightMm).toBe(80);
  });

  test("updates PCB board size through command pipeline", async () => {
    isolateTestDb("designer-pcb-update");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "PCB Update" });
    const envelope: DesignerCommandEnvelope = {
      commandId: "cmd-pcb-board-size",
      sessionId: "pcb-test",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "pcb_set_board_settings",
        widthMm: 120,
        heightMm: 60,
      },
    };

    const result = await designerSdk.dispatchCommand(design.id, envelope);
    const projection = await designerSdk.getPcbProjection(design.id);

    expect(result.ok).toBe(true);
    expect(projection?.board.outline.widthMm).toBe(120);
    expect(projection?.board.outline.heightMm).toBe(60);
  });

  test("rejects invalid PCB board size", async () => {
    isolateTestDb("designer-pcb-invalid");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "PCB Invalid" });
    const result = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-pcb-invalid-size",
      sessionId: "pcb-test",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "pcb_set_board_settings",
        widthMm: 0,
        heightMm: 60,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_PCB_BOARD_SETTINGS");
  });

  test("serves PCB projection over HTTP", async () => {
    isolateTestDb("designer-pcb-http");
    const { moduleRuntime, server } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({ name: "PCB HTTP" });

    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/projection/pcb`,
      ),
    );
    const body = (await response.json()) as {
      data?: { projection?: { board?: { outline?: { widthMm?: number } } } };
    };

    expect(response.status).toBe(200);
    expect(body.data?.projection?.board?.outline?.widthMm).toBe(100);
  });

  test("PCB board size undo/redo via separate session", async () => {
    isolateTestDb("designer-pcb-undo");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "PCB Undo" });
    const pcbSession = "designer-pcb-session";

    // Change board size
    const changeResult = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-pcb-resize",
      sessionId: pcbSession,
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "pcb_set_board_settings",
        widthMm: 150,
        heightMm: 100,
      },
    });
    expect(changeResult.ok).toBe(true);

    const afterChange = await designerSdk.getPcbProjection(design.id);
    expect(afterChange?.board.outline.widthMm).toBe(150);
    expect(afterChange?.board.outline.heightMm).toBe(100);

    // Undo
    const undoResult = await designerSdk.undo(design.id, pcbSession);
    expect(undoResult.ok).toBe(true);

    const afterUndo = await designerSdk.getPcbProjection(design.id);
    expect(afterUndo?.board.outline.widthMm).toBe(100);
    expect(afterUndo?.board.outline.heightMm).toBe(80);

    // Redo
    const redoResult = await designerSdk.redo(design.id, pcbSession);
    expect(redoResult.ok).toBe(true);

    const afterRedo = await designerSdk.getPcbProjection(design.id);
    expect(afterRedo?.board.outline.widthMm).toBe(150);
    expect(afterRedo?.board.outline.heightMm).toBe(100);
  });
});

async function importFixtureComponent(
  server: ReturnType<typeof createHttpServer>,
): Promise<string> {
  const symbolPath = path.resolve(
    import.meta.dir,
    "../../../../data/C.kicad_sym",
  );
  const footprintPath = path.resolve(
    import.meta.dir,
    "../../../../data/C_1210_3225Metric.kicad_mod",
  );
  const symbolContent = await Bun.file(symbolPath).text();
  const footprintContent = await Bun.file(footprintPath).text();

  const inspect = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbolLibrary: { fileName: "C.kicad_sym", content: symbolContent },
        footprints: [
          {
            fileName: "C_1210_3225Metric.kicad_mod",
            content: footprintContent,
          },
        ],
      }),
    }),
  );
  const inspectBody = (await inspect.json()) as {
    data?: {
      symbols?: Array<{ id: string }>;
      footprints?: Array<{ id: string }>;
    };
  };
  const symbolId = inspectBody.data?.symbols?.[0]?.id;
  const footprintId = inspectBody.data?.footprints?.[0]?.id;
  if (!symbolId || !footprintId) throw new Error("inspect missing ids");

  const commit = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbolLibrary: { fileName: "C.kicad_sym", content: symbolContent },
        footprints: [
          {
            fileName: "C_1210_3225Metric.kicad_mod",
            content: footprintContent,
          },
        ],
        selection: { symbolId, footprintId },
        component: { name: "PCB Placement Test", description: "" },
      }),
    }),
  );
  const commitBody = (await commit.json()) as {
    data?: { componentId?: string };
  };
  const componentId = commitBody.data?.componentId;
  if (!componentId) throw new Error("commit missing componentId");
  return componentId;
}

describe("designer PCB placements", () => {
  test("move + rotate placement with undo/redo", async () => {
    isolateTestDb("designer-pcb-placement");
    const { moduleRuntime, server } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const componentId = await importFixtureComponent(server);
    const design = await designerSdk.createDesign({ name: "Place" });

    // Place a part in schematic
    const placeResult = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-place",
      sessionId: "designer-ui-session",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 0, y: 0 },
      },
    });
    expect(placeResult.ok).toBe(true);

    // Read PCB projection — auto-syncs placement from schematic
    const initial = await designerSdk.getPcbProjection(design.id);
    expect(initial?.placements).toHaveLength(1);
    const placement = initial!.placements[0]!;
    const baseRev = initial!.revision;
    const originalPos = { ...placement.positionMm };

    // Move placement
    const moveResult = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-move",
      sessionId: "designer-pcb-session",
      aggregateId: design.id,
      baseRevision: baseRev,
      issuedAt: Date.now(),
      command: {
        type: "pcb_move_placement",
        placementId: placement.id,
        positionMm: { x: 25, y: 30 },
      },
    });
    expect(moveResult.ok).toBe(true);
    if (!moveResult.ok) return;
    expect(moveResult.revision).toBe(baseRev + 1);

    const afterMove = await designerSdk.getPcbProjection(design.id);
    expect(afterMove?.placements[0]!.positionMm).toEqual({ x: 25, y: 30 });

    // Undo move
    const undo = await designerSdk.undo(design.id, "designer-pcb-session");
    expect(undo.ok).toBe(true);
    const afterUndo = await designerSdk.getPcbProjection(design.id);
    expect(afterUndo?.placements[0]!.positionMm).toEqual(originalPos);

    // Redo
    const redo = await designerSdk.redo(design.id, "designer-pcb-session");
    expect(redo.ok).toBe(true);
    const afterRedo = await designerSdk.getPcbProjection(design.id);
    expect(afterRedo?.placements[0]!.positionMm).toEqual({ x: 25, y: 30 });

    // Rotate
    const rotateResult = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-rotate",
      sessionId: "designer-pcb-session",
      aggregateId: design.id,
      baseRevision: afterRedo!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_rotate_placement",
        placementId: placement.id,
        rotationDeg: 90,
      },
    });
    expect(rotateResult.ok).toBe(true);
    const afterRotate = await designerSdk.getPcbProjection(design.id);
    expect(afterRotate?.placements[0]!.rotationDeg).toBe(90);
  });

  test("rejects move on unknown placement", async () => {
    isolateTestDb("designer-pcb-placement-missing");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Empty" });
    const result = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-move-missing",
      sessionId: "designer-pcb-session",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "pcb_move_placement",
        placementId: "does-not-exist",
        positionMm: { x: 0, y: 0 },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PCB_PLACEMENT_NOT_FOUND");
  });
});
