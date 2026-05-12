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
  const fixtureDir = path.resolve(
    import.meta.dir,
    "../../../modules/library/backend/infrastructure/parsers/kicad/__fixtures__",
  );
  const symbolPath = path.resolve(fixtureDir, "simple_capacitor.kicad_sym");
  const footprintPath = path.resolve(fixtureDir, "C_0603_1608Metric.kicad_mod");
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
            fileName: "C_0603_1608Metric.kicad_mod",
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
            fileName: "C_0603_1608Metric.kicad_mod",
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

  test("flip placement toggles layer + mirrored, preserves rotation/position", async () => {
    isolateTestDb("designer-pcb-flip");
    const { moduleRuntime, server } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const componentId = await importFixtureComponent(server);
    const design = await designerSdk.createDesign({ name: "Flip" });

    const placeResult = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-place",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: { type: "place_part", componentId, positionNm: { x: 0, y: 0 } },
    });
    expect(placeResult.ok).toBe(true);

    const initial = await designerSdk.getPcbProjection(design.id);
    const placement = initial!.placements[0]!;
    expect(placement.layer).toBe("F.Cu");
    expect(placement.mirrored).toBe(false);

    // Rotate so we can verify rotation is preserved across flip.
    const rotated = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-rot",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_rotate_placement",
        placementId: placement.id,
        rotationDeg: 90,
      },
    });
    expect(rotated.ok).toBe(true);
    const afterRot = await designerSdk.getPcbProjection(design.id);
    const beforeFlip = afterRot!.placements[0]!;

    // Flip
    const flipResult = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-flip",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: afterRot!.revision,
      issuedAt: Date.now(),
      command: { type: "pcb_flip_placement", placementId: placement.id },
    });
    expect(flipResult.ok).toBe(true);

    const afterFlip = await designerSdk.getPcbProjection(design.id);
    const flipped = afterFlip!.placements[0]!;
    expect(flipped.layer).toBe("B.Cu");
    expect(flipped.mirrored).toBe(true);
    expect(flipped.rotationDeg).toBe(beforeFlip.rotationDeg);
    expect(flipped.positionMm).toEqual(beforeFlip.positionMm);

    // Flip again — involutive
    const flipBack = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-flip-back",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: afterFlip!.revision,
      issuedAt: Date.now(),
      command: { type: "pcb_flip_placement", placementId: placement.id },
    });
    expect(flipBack.ok).toBe(true);
    const restored = (await designerSdk.getPcbProjection(design.id))!
      .placements[0]!;
    expect(restored.layer).toBe("F.Cu");
    expect(restored.mirrored).toBe(false);
    expect(restored.rotationDeg).toBe(beforeFlip.rotationDeg);

    // Undo restores B.Cu state
    const undo = await designerSdk.undo(design.id, "s");
    expect(undo.ok).toBe(true);
    const afterUndo = (await designerSdk.getPcbProjection(design.id))!
      .placements[0]!;
    expect(afterUndo.layer).toBe("B.Cu");
    expect(afterUndo.mirrored).toBe(true);

    // Redo flips back to F.Cu
    const redo = await designerSdk.redo(design.id, "s");
    expect(redo.ok).toBe(true);
    const afterRedo = (await designerSdk.getPcbProjection(design.id))!
      .placements[0]!;
    expect(afterRedo.layer).toBe("F.Cu");
    expect(afterRedo.mirrored).toBe(false);
  });

  test("flip rejects unknown placement id", async () => {
    isolateTestDb("designer-pcb-flip-missing");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Empty" });
    const result = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-flip-missing",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: { type: "pcb_flip_placement", placementId: "nope" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PCB_PLACEMENT_NOT_FOUND");
  });

  test("flip placements (group) flips each independently", async () => {
    isolateTestDb("designer-pcb-flip-group");
    const { moduleRuntime, server } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const componentId = await importFixtureComponent(server);
    const design = await designerSdk.createDesign({ name: "Group" });

    let rev = 0;
    for (let i = 0; i < 2; i++) {
      const r = await designerSdk.dispatchCommand(design.id, {
        commandId: `cmd-place-${i}`,
        sessionId: "s",
        aggregateId: design.id,
        baseRevision: rev,
        issuedAt: Date.now(),
        command: {
          type: "place_part",
          componentId,
          positionNm: { x: i * 1_000_000, y: 0 },
        },
      });
      expect(r.ok).toBe(true);
      if (r.ok) rev = r.revision;
    }
    const initial = await designerSdk.getPcbProjection(design.id);
    expect(initial!.placements).toHaveLength(2);
    const ids = initial!.placements.map((p) => p.id);
    const positionsBefore = initial!.placements.map((p) => ({
      ...p.positionMm,
    }));

    const result = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-group-flip",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: { type: "pcb_flip_placements", placementIds: ids },
    });
    expect(result.ok).toBe(true);

    const after = await designerSdk.getPcbProjection(design.id);
    for (let i = 0; i < after!.placements.length; i++) {
      const p = after!.placements[i]!;
      expect(p.layer).toBe("B.Cu");
      expect(p.mirrored).toBe(true);
      // Each flipped around its own origin: position unchanged.
      expect(p.positionMm).toEqual(positionsBefore[i]!);
    }
  });

  test("new PCB placements start on F.Cu even when activeLayer=B.Cu", async () => {
    isolateTestDb("designer-pcb-top-default");
    const { moduleRuntime, server } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const componentId = await importFixtureComponent(server);
    const design = await designerSdk.createDesign({ name: "AutoMirror" });

    // Place A while activeLayer is default (F.Cu)
    const placeA = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-A",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 0, y: 0 },
      },
    });
    expect(placeA.ok).toBe(true);
    const afterA = await designerSdk.getPcbProjection(design.id);
    const placementA = afterA!.placements[0]!;
    expect(placementA.layer).toBe("F.Cu");
    expect(placementA.mirrored).toBe(false);

    // Switch active layer to B.Cu
    const setLayer = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-active-bcu",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: afterA!.revision,
      issuedAt: Date.now(),
      command: { type: "pcb_set_active_layer", layer: "B.Cu" },
    });
    expect(setLayer.ok).toBe(true);
    const afterLayer = await designerSdk.getPcbProjection(design.id);

    // Placement A must NOT be retro-flipped.
    expect(afterLayer!.placements[0]!.layer).toBe("F.Cu");
    expect(afterLayer!.placements[0]!.mirrored).toBe(false);

    // Place B while activeLayer is B.Cu — new placements still start on top.
    const placeB = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-B",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: afterLayer!.revision,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 5_000_000, y: 0 },
      },
    });
    expect(placeB.ok).toBe(true);
    const afterB = await designerSdk.getPcbProjection(design.id);
    expect(afterB!.placements).toHaveLength(2);
    const onlyNew = afterB!.placements.find((p) => p.id !== placementA.id)!;
    expect(onlyNew.layer).toBe("F.Cu");
    expect(onlyNew.mirrored).toBe(false);
  });

  test("set visible layers persists and ensures activeLayer remains visible", async () => {
    isolateTestDb("designer-pcb-visible-layers");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Visibility" });
    const initial = await designerSdk.getPcbProjection(design.id);
    expect(initial!.board.activeLayer).toBe("F.Cu");

    const result = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-visible",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_set_visible_layers",
        // Intentionally exclude F.Cu (active) — store should re-add it.
        visibleLayers: ["B.Cu", "Edge.Cuts"],
      },
    });
    expect(result.ok).toBe(true);
    const after = await designerSdk.getPcbProjection(design.id);
    expect(after!.board.visibleLayers).toContain("F.Cu");
    expect(after!.board.visibleLayers).toContain("B.Cu");
    expect(after!.board.visibleLayers).toContain("Edge.Cuts");
  });

  test("setting active layer makes it visible", async () => {
    isolateTestDb("designer-pcb-active-visible");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "ActiveVisible" });
    const initial = await designerSdk.getPcbProjection(design.id);
    const hideBottom = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-hide-bottom",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: { type: "pcb_set_visible_layers", visibleLayers: ["F.Cu"] },
    });
    expect(hideBottom.ok).toBe(true);
    const hidden = await designerSdk.getPcbProjection(design.id);
    expect(hidden!.board.visibleLayers).not.toContain("B.Cu");

    const activateBottom = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-activate-bottom",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: hidden!.revision,
      issuedAt: Date.now(),
      command: { type: "pcb_set_active_layer", layer: "B.Cu" },
    });
    expect(activateBottom.ok).toBe(true);
    const after = await designerSdk.getPcbProjection(design.id);
    expect(after!.board.activeLayer).toBe("B.Cu");
    expect(after!.board.visibleLayers).toContain("B.Cu");
  });

  test("via accepts route-time diameter/drill overrides", async () => {
    isolateTestDb("designer-pcb-via-override");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Via" });
    const initial = await designerSdk.getPcbProjection(design.id);
    const netClassId = initial!.board.netClasses[0]!.id;

    const result = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-via",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_add_via",
        centerMm: { x: 10, y: 10 },
        netId: null,
        netClassId,
        diameterMmOverride: 0.9,
        drillMmOverride: 0.45,
      },
    });
    expect(result.ok).toBe(true);

    const after = await designerSdk.getPcbProjection(design.id);
    expect(after!.vias).toHaveLength(1);
    const via = after!.vias[0]!;
    expect(via.diameterMm).toBe(0.9);
    expect(via.drillMm).toBe(0.45);
  });

  test("via override rejects diameter <= drill", async () => {
    isolateTestDb("designer-pcb-via-override-bad");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Via" });
    const initial = await designerSdk.getPcbProjection(design.id);
    const netClassId = initial!.board.netClasses[0]!.id;

    const result = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-via-bad",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_add_via",
        centerMm: { x: 10, y: 10 },
        netId: null,
        netClassId,
        diameterMmOverride: 0.4,
        drillMmOverride: 0.5,
      },
    });
    expect(result.ok).toBe(false);
  });

  test("via override rejects board minimum violations", async () => {
    isolateTestDb("designer-pcb-via-override-minimum");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Via Min" });
    const initial = await designerSdk.getPcbProjection(design.id);
    const netClassId = initial!.board.netClasses[0]!.id;

    const result = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-via-min-bad",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_add_via",
        centerMm: { x: 10, y: 10 },
        netId: null,
        netClassId,
        diameterMmOverride: initial!.board.designRules.minimums.viaDiameterMm,
        drillMmOverride:
          initial!.board.designRules.minimums.viaDrillMm + 0.2,
      },
    });
    expect(result.ok).toBe(false);
  });
});
