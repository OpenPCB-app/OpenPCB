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
import { MentionRegistry } from "../mentions";
import { getKicadFixtureDir } from "./helpers/kicad-fixtures";

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  const dbFile = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  process.env.OPENPCB_DB_PATH = dbFile;
}

async function createRuntimeAndServer() {
  // The library module registers @mention providers on activate; the real boot
  // (runtime.ts) calls this before bootstrap. Idempotent — safe per test.
  MentionRegistry.init();
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

async function importFixtureComponent(
  server: ReturnType<typeof createHttpServer>,
): Promise<string> {
  const fixtureDir = getKicadFixtureDir();
  const symbolPath = path.resolve(fixtureDir, "simple_capacitor.kicad_sym");
  const footprintPath = path.resolve(fixtureDir, "C_0603_1608Metric.kicad_mod");
  const symbolContent = await Bun.file(symbolPath).text();
  const footprintContent = await Bun.file(footprintPath).text();

  const inspectResponse = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbolLibrary: {
          fileName: "C.kicad_sym",
          content: symbolContent,
        },
        footprints: [
          {
            fileName: "C_0603_1608Metric.kicad_mod",
            content: footprintContent,
          },
        ],
      }),
    }),
  );
  expect(inspectResponse.status).toBe(200);
  const inspectBody = (await inspectResponse.json()) as {
    data?: {
      symbols?: Array<{ id: string }>;
      footprints?: Array<{ id: string }>;
    };
  };

  const symbolId = inspectBody.data?.symbols?.[0]?.id;
  const footprintId = inspectBody.data?.footprints?.[0]?.id;
  if (!symbolId || !footprintId) {
    throw new Error("Fixture inspect must return symbol and footprint ids");
  }

  const commitResponse = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbolLibrary: {
          fileName: "C.kicad_sym",
          content: symbolContent,
        },
        footprints: [
          {
            fileName: "C_0603_1608Metric.kicad_mod",
            content: footprintContent,
          },
        ],
        selection: {
          symbolId,
          footprintId,
        },
        component: {
          name: "Hardening Test Capacitor",
          description: "Designer command hardening test component",
        },
      }),
    }),
  );
  expect(commitResponse.status).toBe(201);
  const commitBody = (await commitResponse.json()) as {
    data?: { componentId?: string };
  };
  const componentId = commitBody.data?.componentId;
  if (!componentId) {
    throw new Error("Fixture commit must return componentId");
  }
  return componentId;
}

async function importDrawnWireableComponent(
  server: ReturnType<typeof createHttpServer>,
): Promise<string> {
  const response = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/drawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        drawnSymbol: {
          source: {
            name: "DrawnWireable",
            unitCount: 1,
            referenceText: "U?",
            valueText: "DrawnWireable",
            pins: [
              {
                id: "pin-1",
                name: "A",
                number: "1",
                electricalType: "passive",
                positionMm: { x: -2, y: 0 },
                lengthMm: 1,
                rotationDeg: 0,
                unit: 1,
                hidden: false,
              },
              {
                id: "pin-2",
                name: "B",
                number: "2",
                electricalType: "passive",
                positionMm: { x: 2, y: 0 },
                lengthMm: 1,
                rotationDeg: 180,
                unit: 1,
                hidden: false,
              },
            ],
            graphics: [
              {
                unit: 1,
                graphic: {
                  kind: "rect",
                  x: -1,
                  y: -0.8,
                  width: 2,
                  height: 1.6,
                  fill: "none",
                  strokeWidthMm: 0.12,
                },
              },
            ],
            warnings: [],
          },
          referencePrefix: "U",
        },
        footprintMode: "none",
        component: {
          name: "Drawn Wireable Component",
          description: "Used by designer hardening tests",
        },
      }),
    }),
  );

  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    data?: { componentId?: string };
  };
  const componentId = body.data?.componentId;
  if (!componentId) {
    throw new Error("Drawn import must return component id");
  }

  return componentId;
}

describe("designer commands hardening", () => {
  test("replays same commandId idempotently without duplicate entities", async () => {
    isolateTestDb("designer-hardening-idempotent");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importFixtureComponent(server);

    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Idempotency" });

    const envelope: DesignerCommandEnvelope = {
      commandId: "cmd-idempotent-place",
      sessionId: "test-session",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 1_000_000, y: 2_000_000 },
      },
    };

    const first = await designerSdk.dispatchCommand(design.id, envelope);
    expect(first.ok).toBe(true);

    const second = await designerSdk.dispatchCommand(design.id, envelope);
    expect(second.ok).toBe(true);
    if (second.ok && first.ok) {
      expect(second.revision).toBe(first.revision);
      expect(second.createdEntityId).toBe(first.createdEntityId);
      expect(second.idempotent).toBe(true);
    }

    const projection = await designerSdk.getSchematicProjection(design.id);
    expect(projection?.parts.length).toBe(1);
  });

  test("rejects commandId reuse with a different payload", async () => {
    isolateTestDb("designer-hardening-idempotent-mismatch");
    const { moduleRuntime } = await createRuntimeAndServer();

    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({
      name: "Idempotency mismatch",
    });

    const commandId = "cmd-reused-with-different-payload";
    const first = await designerSdk.dispatchCommand(design.id, {
      commandId,
      sessionId: "mismatch",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "upsert_label",
        text: "NET_A",
        positionNm: { x: 0, y: 0 },
      },
    });
    expect(first.ok).toBe(true);

    const second = await designerSdk.dispatchCommand(design.id, {
      commandId,
      sessionId: "mismatch",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "upsert_label",
        text: "NET_B",
        positionNm: { x: 1_000_000, y: 0 },
      },
    });

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("REVISION_CONFLICT");
    }
    const projection = await designerSdk.getSchematicProjection(design.id);
    expect(projection?.labels.length).toBe(1);
    expect(projection?.labels[0]?.text).toBe("NET_A");
  });

  test("supports undo and redo for schematic commands", async () => {
    isolateTestDb("designer-hardening-undo-redo");
    const { moduleRuntime } = await createRuntimeAndServer();

    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({ name: "Undo redo" });

    const emptyHistory = await designerSdk.getHistory(design.id, "history");
    expect(emptyHistory.canUndo).toBe(false);
    expect(emptyHistory.canRedo).toBe(false);

    const createLabel = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "history",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "upsert_label",
        text: "UNDO_ME",
        positionNm: { x: 1_000_000, y: 2_000_000 },
      },
    });
    expect(createLabel.ok).toBe(true);

    const afterCommandHistory = await designerSdk.getHistory(
      design.id,
      "history",
    );
    expect(afterCommandHistory.canUndo).toBe(true);
    expect(afterCommandHistory.canRedo).toBe(false);

    const undo = await designerSdk.undo(design.id, "history");
    expect(undo.ok).toBe(true);
    if (undo.ok) {
      expect(undo.revision).toBe(2);
      expect(undo.history.canUndo).toBe(false);
      expect(undo.history.canRedo).toBe(true);
    }
    const afterUndo = await designerSdk.getSchematicProjection(design.id);
    expect(afterUndo?.labels.length).toBe(0);

    const redo = await designerSdk.redo(design.id, "history");
    expect(redo.ok).toBe(true);
    if (redo.ok) {
      expect(redo.revision).toBe(3);
      expect(redo.history.canUndo).toBe(true);
      expect(redo.history.canRedo).toBe(false);
    }
    const afterRedo = await designerSdk.getSchematicProjection(design.id);
    expect(afterRedo?.labels.length).toBe(1);
    expect(afterRedo?.labels[0]?.text).toBe("UNDO_ME");
  });

  test("supports undo and redo through HTTP routes", async () => {
    isolateTestDb("designer-hardening-http-undo-redo");
    const { moduleRuntime, server } = await createRuntimeAndServer();

    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({ name: "HTTP undo redo" });
    const envelope: DesignerCommandEnvelope = {
      commandId: crypto.randomUUID(),
      sessionId: "http-history",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "upsert_label",
        text: "HTTP_NET",
        positionNm: { x: 1_000_000, y: 1_000_000 },
      },
    };

    const commandResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/commands`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope),
        },
      ),
    );
    expect(commandResponse.status).toBe(200);

    const historyResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/history?sessionId=http-history`,
      ),
    );
    expect(historyResponse.status).toBe(200);
    const historyBody = (await historyResponse.json()) as {
      data?: { history?: { canUndo?: boolean; canRedo?: boolean } };
    };
    expect(historyBody.data?.history?.canUndo).toBe(true);
    expect(historyBody.data?.history?.canRedo).toBe(false);

    // HTTP history requires expectedRevision (OPENPCB-103): without it the
    // request is a 400 and no history entry is consumed.
    for (const direction of ["undo", "redo"]) {
      const missing = await server.fetch(
        new Request(
          `http://localhost/api/modules/designer/designs/${design.id}/history/${direction}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: "http-history" }),
          },
        ),
      );
      expect(missing.status).toBe(400);
    }
    expect(await designerSdk.getHistory(design.id, "http-history")).toMatchObject({
      undoDepth: 1,
      redoDepth: 0,
    });
    expect((await designerSdk.getSchematicProjection(design.id))?.revision).toBe(1);

    const undoResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/history/undo`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "http-history", expectedRevision: 1 }),
        },
      ),
    );
    expect(undoResponse.status).toBe(200);
    const afterUndo = await designerSdk.getSchematicProjection(design.id);
    expect(afterUndo?.labels.length).toBe(0);

    const redoResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/history/redo`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "http-history", expectedRevision: 2 }),
        },
      ),
    );
    expect(redoResponse.status).toBe(200);
    const afterRedo = await designerSdk.getSchematicProjection(design.id);
    expect(afterRedo?.labels.length).toBe(1);
    expect(afterRedo?.labels[0]?.text).toBe("HTTP_NET");
  });

  test("hydrates undo history from persisted session snapshot", async () => {
    isolateTestDb("designer-hardening-persisted-history");
    const firstRuntime = await createRuntimeAndServer();
    const designerSdk = firstRuntime.moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({
      name: "Persisted history",
    });

    const command = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "persisted-history",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "upsert_label",
        text: "PERSISTED_NET",
        positionNm: { x: 1_000_000, y: 1_000_000 },
      },
    });
    expect(command.ok).toBe(true);

    const secondRuntime = await createRuntimeAndServer();
    const rehydratedSdk = secondRuntime.moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const history = await rehydratedSdk.getHistory(
      design.id,
      "persisted-history",
    );
    expect(history.canUndo).toBe(true);
    expect(history.undoDepth).toBe(1);

    const undo = await rehydratedSdk.undo(design.id, "persisted-history");
    expect(undo.ok).toBe(true);
    const afterUndo = await rehydratedSdk.getSchematicProjection(design.id);
    expect(afterUndo?.labels.length).toBe(0);
  });

  test("returns revision conflict on stale baseRevision", async () => {
    isolateTestDb("designer-hardening-conflict");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importFixtureComponent(server);

    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Conflict" });
    const result = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "test-session",
      aggregateId: design.id,
      baseRevision: 999,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 0, y: 0 },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REVISION_CONFLICT");
      if (result.code === "REVISION_CONFLICT") {
        expect(result.conflict.actual).toBe(0);
      }
    }
  });

  test("rejects malformed command envelope over HTTP", async () => {
    isolateTestDb("designer-hardening-malformed");
    const { moduleRuntime, server } = await createRuntimeAndServer();

    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({ name: "Malformed" });

    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/commands`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "missing-command-id",
            aggregateId: design.id,
            baseRevision: 0,
            issuedAt: "not-a-number",
            command: {
              type: "place_part",
              componentId: "abc",
              positionNm: { x: 0, y: 0 },
            },
          }),
        },
      ),
    );

    expect(response.status).toBe(400);
  });

  test("supports move/rotate/mirror commands with transformed pin positions", async () => {
    isolateTestDb("designer-hardening-transform-commands");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);

    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({ name: "Transforms" });

    const place = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "transform",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 0, y: 0 },
      },
    });
    expect(place.ok).toBe(true);
    if (!place.ok || !place.createdEntityId) {
      throw new Error("place_part must return createdEntityId");
    }

    const projectionAfterPlace = await designerSdk.getSchematicProjection(
      design.id,
    );
    const partAfterPlace = projectionAfterPlace?.parts.find(
      (part) => part.id === place.createdEntityId,
    );
    expect(partAfterPlace).not.toBeNull();
    const firstPin = partAfterPlace?.pins[0];
    expect(firstPin).toBeDefined();
    if (!partAfterPlace || !firstPin) {
      throw new Error("Placed part must expose pins for transform checks");
    }

    const rotate = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "transform",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "rotate_part",
        partId: partAfterPlace.id,
        rotationDeg: 90,
      },
    });
    expect(rotate.ok).toBe(true);

    const move = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "transform",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: {
        type: "move_part",
        partId: partAfterPlace.id,
        positionNm: { x: 10_000_000, y: 20_000_000 },
      },
    });
    expect(move.ok).toBe(true);

    const mirror = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "transform",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: {
        type: "mirror_part",
        partId: partAfterPlace.id,
        mirrored: true,
      },
    });
    expect(mirror.ok).toBe(true);

    const projectionAfterTransform = await designerSdk.getSchematicProjection(
      design.id,
    );
    const partAfterTransform = projectionAfterTransform?.parts.find(
      (part) => part.id === partAfterPlace.id,
    );
    expect(partAfterTransform?.rotationDeg).toBe(90);
    expect(partAfterTransform?.mirrored).toBe(true);
    expect(partAfterTransform?.positionNm.x).toBe(10_000_000);
    expect(partAfterTransform?.positionNm.y).toBe(20_000_000);

    const transformedPin = partAfterTransform?.pins.find(
      (pin) => pin.id === firstPin.id,
    );
    expect(transformedPin).toBeDefined();
    expect(transformedPin?.worldPositionNm.x).not.toBe(
      firstPin.worldPositionNm.x,
    );
    expect(transformedPin?.worldPositionNm.y).not.toBe(
      firstPin.worldPositionNm.y,
    );
  });

  test("creates, updates and deletes labels", async () => {
    isolateTestDb("designer-hardening-label-commands");
    const { moduleRuntime } = await createRuntimeAndServer();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Labels" });
    const createLabel = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "label",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "upsert_label",
        text: "NET_A",
        positionNm: { x: 1_000_000, y: 2_000_000 },
      },
    });
    expect(createLabel.ok).toBe(true);
    if (!createLabel.ok || !createLabel.createdEntityId) {
      throw new Error("upsert_label create must return label id");
    }

    const updateLabel = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "label",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "upsert_label",
        labelId: createLabel.createdEntityId,
        text: "NET_B",
        positionNm: { x: 3_000_000, y: 4_000_000 },
      },
    });
    expect(updateLabel.ok).toBe(true);

    const projection = await designerSdk.getSchematicProjection(design.id);
    const label = projection?.labels.find(
      (entry) => entry.id === createLabel.createdEntityId,
    );
    expect(label?.text).toBe("NET_B");
    expect(label?.positionNm.x).toBe(3_000_000);
    expect(label?.positionNm.y).toBe(4_000_000);

    const deleteLabel = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "label",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: {
        type: "delete_entity",
        entityKind: "label",
        entityId: createLabel.createdEntityId,
      },
    });
    expect(deleteLabel.ok).toBe(true);

    const afterDelete = await designerSdk.getSchematicProjection(design.id);
    expect(afterDelete?.labels.length).toBe(0);
  });

  test("deleting part cascades connected wires", async () => {
    isolateTestDb("designer-hardening-delete-cascade");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Cascade delete" });
    const placeA = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "cascade",
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

    const placeB = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "cascade",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 8_000_000, y: 0 },
      },
    });
    expect(placeB.ok).toBe(true);

    const placed = await designerSdk.getSchematicProjection(design.id);
    const pinA = placed?.parts[0]?.pins[0];
    const pinB = placed?.parts[1]?.pins[0];
    if (!pinA || !pinB || !placeA.ok || !placeA.createdEntityId) {
      throw new Error("Expected two placed parts with first pins");
    }

    const createWire = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "cascade",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: pinA.id,
        targetPinId: pinB.id,
      },
    });
    expect(createWire.ok).toBe(true);

    const deletePart = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "cascade",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: {
        type: "delete_entity",
        entityKind: "part",
        entityId: placeA.createdEntityId,
      },
    });
    expect(deletePart.ok).toBe(true);

    const afterDelete = await designerSdk.getSchematicProjection(design.id);
    expect(afterDelete?.parts.length).toBe(1);
    expect(afterDelete?.wires.length).toBe(0);
  });

  test("move re-route: pin-to-pin wires avoid obstacles, waypointed wires keep interior points", async () => {
    isolateTestDb("designer-hardening-move-reroute");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Move reroute" });
    const dispatch = async (
      baseRevision: number,
      command: DesignerCommandEnvelope["command"],
    ) => {
      const result = await designerSdk.dispatchCommand(design.id, {
        commandId: crypto.randomUUID(),
        sessionId: "move-reroute",
        aggregateId: design.id,
        baseRevision,
        issuedAt: Date.now(),
        command,
      });
      expect(result.ok).toBe(true);
      return result;
    };

    const placeA = await dispatch(0, {
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    await dispatch(1, {
      type: "place_part",
      componentId,
      positionNm: { x: 20_000_000, y: 0 },
    });

    const placed = await designerSdk.getSchematicProjection(design.id);
    const partA = placed?.parts[0];
    const partB = placed?.parts[1];
    const aRight = partA?.pins[1]; // (2mm, 0)
    const aLeft = partA?.pins[0]; // (-2mm, 0)
    const bLeft = partB?.pins[0]; // (18mm, 0)
    const bRight = partB?.pins[1]; // (22mm, 0)
    if (!partA || !aRight || !aLeft || !bLeft || !bRight || !placeA.ok) {
      throw new Error("Expected two placed parts with pins");
    }

    // Pin-to-pin wire without waypoints → auto-routed (straight, 2 points).
    const autoWire = await dispatch(2, {
      type: "create_wire",
      sourcePinId: aRight.id,
      targetPinId: bLeft.id,
    });
    // Waypointed wire with a deliberate jog through (x, 8mm).
    await dispatch(3, {
      type: "create_wire",
      sourcePinId: aLeft.id,
      targetPinId: bRight.id,
      pointsNm: [
        { ...aLeft.worldPositionNm },
        { x: aLeft.worldPositionNm.x, y: 8_000_000 },
        { x: bRight.worldPositionNm.x, y: 8_000_000 },
        { ...bRight.worldPositionNm },
      ],
    });

    // Blocker part sitting on the straight wire's line.
    await dispatch(4, {
      type: "place_part",
      componentId,
      positionNm: { x: 10_000_000, y: 0 },
    });
    // Nudge part A up 1 mm — the straight wire must re-route AROUND the
    // blocker; the waypointed wire must keep its interior jog verbatim.
    if (!placeA.createdEntityId) throw new Error("Expected part A id");
    await dispatch(5, {
      type: "move_part",
      partId: placeA.createdEntityId,
      positionNm: { x: 0, y: 1_000_000 },
    });

    const after = await designerSdk.getSchematicProjection(design.id);
    if (!autoWire.ok || !autoWire.createdEntityId) {
      throw new Error("Expected auto wire id");
    }
    const rerouted = after?.wires.find(
      (wire) => wire.id === autoWire.createdEntityId,
    );
    if (!rerouted) throw new Error("Expected rerouted wire");
    // Endpoints follow the moved pin.
    expect(rerouted.pointsNm[0]).toEqual({ x: 2_000_000, y: 1_000_000 });
    expect(rerouted.pointsNm[rerouted.pointsNm.length - 1]).toEqual({
      x: 18_000_000,
      y: 0,
    });
    // Blocker pin bbox (8mm..12mm, y=0) inflated by the router margin
    // (1.27mm) — no rerouted segment may cross its strict interior.
    const rect = {
      minX: 8_000_000 - 1_270_000,
      minY: -1_270_000,
      maxX: 12_000_000 + 1_270_000,
      maxY: 1_270_000,
    };
    const hitsRect = (a: { x: number; y: number }, b: typeof a): boolean => {
      if (a.y === b.y) {
        if (!(rect.minY < a.y && a.y < rect.maxY)) return false;
        const lo = Math.min(a.x, b.x);
        const hi = Math.max(a.x, b.x);
        return Math.max(lo, rect.minX) < Math.min(hi, rect.maxX);
      }
      if (a.x === b.x) {
        if (!(rect.minX < a.x && a.x < rect.maxX)) return false;
        const lo = Math.min(a.y, b.y);
        const hi = Math.max(a.y, b.y);
        return Math.max(lo, rect.minY) < Math.min(hi, rect.maxY);
      }
      return false;
    };
    for (let i = 1; i < rerouted.pointsNm.length; i += 1) {
      expect(hitsRect(rerouted.pointsNm[i - 1]!, rerouted.pointsNm[i]!)).toBe(
        false,
      );
    }

    const waypointed = after?.wires.find(
      (wire) => wire.id !== autoWire.createdEntityId,
    );
    if (!waypointed) throw new Error("Expected waypointed wire");
    // Interior jog preserved verbatim; endpoint follows the moved pin.
    expect(
      waypointed.pointsNm.some(
        (p) => p.x === -2_000_000 && p.y === 8_000_000,
      ),
    ).toBe(true);
    expect(
      waypointed.pointsNm.some((p) => p.x === 22_000_000 && p.y === 8_000_000),
    ).toBe(true);
    expect(waypointed.pointsNm[0]).toEqual({ x: -2_000_000, y: 1_000_000 });
  });

  test("update_wire_geometry replaces a wire's polyline, forces endpoints onto pins, and is undoable", async () => {
    isolateTestDb("designer-update-wire-geometry");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Segment drag" });
    const dispatch = async (
      baseRevision: number,
      command: DesignerCommandEnvelope["command"],
    ) => {
      const result = await designerSdk.dispatchCommand(design.id, {
        commandId: crypto.randomUUID(),
        sessionId: "seg-drag",
        aggregateId: design.id,
        baseRevision,
        issuedAt: Date.now(),
        command,
      });
      expect(result.ok).toBe(true);
      return result;
    };

    await dispatch(0, {
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    await dispatch(1, {
      type: "place_part",
      componentId,
      positionNm: { x: 20_000_000, y: 0 },
    });

    const placed = await designerSdk.getSchematicProjection(design.id);
    const aRight = placed?.parts[0]?.pins[1]; // (2mm, 0)
    const bLeft = placed?.parts[1]?.pins[0]; // (18mm, 0)
    if (!aRight || !bLeft) throw new Error("Expected two placed parts with pins");

    // Straight pin-to-pin wire (2 points).
    const wire = await dispatch(2, {
      type: "create_wire",
      sourcePinId: aRight.id,
      targetPinId: bLeft.id,
    });
    if (!wire.ok || !wire.createdEntityId) throw new Error("Expected wire id");

    const beforeWire = (await designerSdk.getSchematicProjection(design.id))
      ?.wires.find((w) => w.id === wire.createdEntityId);
    expect(beforeWire?.pointsNm.length).toBe(2);

    // Drag the segment up into a staple. Deliberately send WRONG endpoints to
    // prove the backend forces them back onto the pins.
    await dispatch(3, {
      type: "update_wire_geometry",
      wireId: wire.createdEntityId,
      pointsNm: [
        { x: 999, y: 999 },
        { x: 2_000_000, y: 6_000_000 },
        { x: 18_000_000, y: 6_000_000 },
        { x: 888, y: 888 },
      ],
    });

    const stapled = (await designerSdk.getSchematicProjection(design.id))
      ?.wires.find((w) => w.id === wire.createdEntityId);
    expect(stapled?.pointsNm).toEqual([
      { x: 2_000_000, y: 0 }, // forced back to source pin
      { x: 2_000_000, y: 6_000_000 },
      { x: 18_000_000, y: 6_000_000 },
      { x: 18_000_000, y: 0 }, // forced back to target pin
    ]);

    // Undo restores the prior 2-point geometry.
    const undo = await designerSdk.undo(design.id, "seg-drag");
    expect(undo.ok).toBe(true);
    const afterUndo = (await designerSdk.getSchematicProjection(design.id))
      ?.wires.find((w) => w.id === wire.createdEntityId);
    expect(afterUndo?.pointsNm.length).toBe(2);

    // A malformed (diagonal) interior is repaired into an orthogonal path
    // rather than persisted verbatim.
    const repaired = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "seg-drag",
      aggregateId: design.id,
      baseRevision: undo.ok ? undo.revision : 4,
      issuedAt: Date.now(),
      command: {
        type: "update_wire_geometry",
        wireId: wire.createdEntityId,
        pointsNm: [
          { x: 2_000_000, y: 0 },
          { x: 10_000_000, y: 5_000_000 }, // diagonal → repaired
          { x: 18_000_000, y: 0 },
        ],
      },
    });
    expect(repaired.ok).toBe(true);
    const repairedWire = (await designerSdk.getSchematicProjection(design.id))
      ?.wires.find((w) => w.id === wire.createdEntityId);
    const pts = repairedWire?.pointsNm ?? [];
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < pts.length; i += 1) {
      const orthogonal =
        pts[i - 1]!.x === pts[i]!.x || pts[i - 1]!.y === pts[i]!.y;
      expect(orthogonal).toBe(true);
    }
  });

  test("update_wire_geometry survives the HTTP command parser (fields not dropped)", async () => {
    isolateTestDb("designer-update-wire-geometry-http");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({ name: "Segment drag HTTP" });

    await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "seg-http",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: { type: "place_part", componentId, positionNm: { x: 0, y: 0 } },
    });
    await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "seg-http",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 20_000_000, y: 0 },
      },
    });
    const placed = await designerSdk.getSchematicProjection(design.id);
    const aRight = placed?.parts[0]?.pins[1];
    const bLeft = placed?.parts[1]?.pins[0];
    if (!aRight || !bLeft) throw new Error("Expected pins");
    const wire = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "seg-http",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: aRight.id,
        targetPinId: bLeft.id,
      },
    });
    if (!wire.ok || !wire.createdEntityId) throw new Error("Expected wire id");

    const envelope: DesignerCommandEnvelope = {
      commandId: crypto.randomUUID(),
      sessionId: "seg-http",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: {
        type: "update_wire_geometry",
        wireId: wire.createdEntityId,
        pointsNm: [
          { x: 2_000_000, y: 0 },
          { x: 2_000_000, y: 6_000_000 },
          { x: 18_000_000, y: 6_000_000 },
          { x: 18_000_000, y: 0 },
        ],
      },
    };
    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/commands`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope),
        },
      ),
    );
    expect(response.status).toBe(200);

    const after = (await designerSdk.getSchematicProjection(design.id))?.wires.find(
      (w) => w.id === wire.createdEntityId,
    );
    // wireId + pointsNm survived the parser → the staple was applied.
    expect(after?.pointsNm).toEqual([
      { x: 2_000_000, y: 0 },
      { x: 2_000_000, y: 6_000_000 },
      { x: 18_000_000, y: 6_000_000 },
      { x: 18_000_000, y: 0 },
    ]);
  });

  test("auto-route with no clean escape persists routeStatus 'colliding' and survives undo/redo", async () => {
    isolateTestDb("designer-hardening-colliding-flag");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Colliding flag" });
    let revision = 0;
    const dispatch = async (command: DesignerCommandEnvelope["command"]) => {
      const result = await designerSdk.dispatchCommand(design.id, {
        commandId: crypto.randomUUID(),
        sessionId: "colliding",
        aggregateId: design.id,
        baseRevision: revision,
        issuedAt: Date.now(),
        command,
      });
      expect(result.ok).toBe(true);
      revision += 1;
      return result;
    };

    const placeA = await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 20_000_000, y: 0 },
    });
    // Wall ring around part B: horizontal walls above/below, rotated walls
    // left/right — inflated pin bboxes overlap at the corners, sealing the box.
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 20_000_000, y: 4_000_000 },
    });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 20_000_000, y: -4_000_000 },
    });
    const left = await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 16_000_000, y: 0 },
    });
    if (!left.ok || !left.createdEntityId) throw new Error("left wall id");
    await dispatch({
      type: "rotate_part",
      partId: left.createdEntityId,
      rotationDeg: 90,
    });
    const right = await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 24_000_000, y: 0 },
    });
    if (!right.ok || !right.createdEntityId) throw new Error("right wall id");
    await dispatch({
      type: "rotate_part",
      partId: right.createdEntityId,
      rotationDeg: 90,
    });

    const placed = await designerSdk.getSchematicProjection(design.id);
    const pinA = placed?.parts[0]?.pins[1]; // (2mm, 0)
    const pinB = placed?.parts[1]?.pins[0]; // (18mm, 0) — inside the ring
    if (!pinA || !pinB || !placeA.ok) throw new Error("Expected pins");

    const wire = await dispatch({
      type: "create_wire",
      sourcePinId: pinA.id,
      targetPinId: pinB.id,
    });
    if (!wire.ok || !wire.createdEntityId) throw new Error("Expected wire id");

    const after = await designerSdk.getSchematicProjection(design.id);
    const created = after?.wires.find((w) => w.id === wire.createdEntityId);
    expect(created?.routeStatus).toBe("colliding");

    // Undo removes the wire, redo restores it WITH the diagnostic flag.
    const undo = await designerSdk.undo(design.id, "colliding");
    expect(undo.ok).toBe(true);
    const afterUndo = await designerSdk.getSchematicProjection(design.id);
    expect(afterUndo?.wires.length).toBe(0);

    const redo = await designerSdk.redo(design.id, "colliding");
    expect(redo.ok).toBe(true);
    const afterRedo = await designerSdk.getSchematicProjection(design.id);
    const restored = afterRedo?.wires.find(
      (w) => w.id === wire.createdEntityId,
    );
    expect(restored?.routeStatus).toBe("colliding");
  });

  test("move re-route: co-moving wires ignore each other's stale paths (no phantom-wall detours)", async () => {
    isolateTestDb("designer-hardening-sibling-reroute");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Sibling reroute" });
    let revision = 0;
    const dispatch = async (command: DesignerCommandEnvelope["command"]) => {
      const result = await designerSdk.dispatchCommand(design.id, {
        commandId: crypto.randomUUID(),
        sessionId: "sibling-reroute",
        aggregateId: design.id,
        baseRevision: revision,
        issuedAt: Date.now(),
        command,
      });
      expect(result.ok).toBe(true);
      revision += 1;
      return result;
    };

    const placeA = await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 20_000_000, y: 0 },
    });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 20_000_000, y: 6_000_000 },
    });
    const placed = await designerSdk.getSchematicProjection(design.id);
    const aLeft = placed?.parts[0]?.pins[0]; // (-2mm, 0)
    const aRight = placed?.parts[0]?.pins[1]; // (2mm, 0)
    const bLeft = placed?.parts[1]?.pins[0]; // (18mm, 0)
    const cLeft = placed?.parts[2]?.pins[0]; // (18mm, 6mm)
    if (!aLeft || !aRight || !bLeft || !cLeft || !placeA.ok) {
      throw new Error("Expected placed parts with pins");
    }

    const wire1 = await dispatch({
      type: "create_wire",
      sourcePinId: aRight.id,
      targetPinId: bLeft.id,
    });
    await dispatch({
      type: "create_wire",
      sourcePinId: aLeft.id,
      targetPinId: cLeft.id,
    });

    // Move part A up: both wires re-route together. wire1's only clean simple
    // route (VH) crosses wire2's STALE pre-move path — which must not count
    // as an obstacle, or wire1 detours absurdly.
    if (!placeA.createdEntityId) throw new Error("Expected part A id");
    await dispatch({
      type: "move_part",
      partId: placeA.createdEntityId,
      positionNm: { x: 0, y: 10_000_000 },
    });

    const after = await designerSdk.getSchematicProjection(design.id);
    if (!wire1.ok || !wire1.createdEntityId) throw new Error("wire1 id");
    const rerouted = after?.wires.find((w) => w.id === wire1.createdEntityId);
    expect(rerouted?.pointsNm).toEqual([
      { x: 2_000_000, y: 10_000_000 },
      { x: 2_000_000, y: 0 },
      { x: 18_000_000, y: 0 },
    ]);
  });

  test("rejects a duplicate wire between the same two pins (either orientation)", async () => {
    isolateTestDb("designer-hardening-duplicate-wire");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Duplicate wire" });
    for (const [index, x] of [0, 8_000_000].entries()) {
      const placed = await designerSdk.dispatchCommand(design.id, {
        commandId: crypto.randomUUID(),
        sessionId: "dup-wire",
        aggregateId: design.id,
        baseRevision: index,
        issuedAt: Date.now(),
        command: { type: "place_part", componentId, positionNm: { x, y: 0 } },
      });
      expect(placed.ok).toBe(true);
    }
    const placed = await designerSdk.getSchematicProjection(design.id);
    const pinA = placed?.parts[0]?.pins[0];
    const pinA2 = placed?.parts[0]?.pins[1];
    const pinB = placed?.parts[1]?.pins[0];
    if (!pinA || !pinA2 || !pinB) throw new Error("Expected pins");

    const first = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "dup-wire",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: pinA.id,
        targetPinId: pinB.id,
      },
    });
    expect(first.ok).toBe(true);

    const sameOrientation = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "dup-wire",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: pinA.id,
        targetPinId: pinB.id,
      },
    });
    expect(sameOrientation.ok).toBe(false);
    if (!sameOrientation.ok) {
      expect(sameOrientation.code).toBe("INVALID_WIRE_PATH");
    }

    const reversed = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "dup-wire",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: pinB.id,
        targetPinId: pinA.id,
      },
    });
    expect(reversed.ok).toBe(false);

    const distinctPair = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "dup-wire",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: pinA2.id,
        targetPinId: pinB.id,
      },
    });
    expect(distinctPair.ok).toBe(true);

    const projection = await designerSdk.getSchematicProjection(design.id);
    expect(projection?.wires.length).toBe(2);
  });

  test("creates wire junction from pin to existing wire", async () => {
    isolateTestDb("designer-hardening-wire-junction");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Wire junction" });
    const placeA = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "wire-junction",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 0, y: 0 },
      },
    });
    const placeB = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "wire-junction",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 8_000_000, y: 0 },
      },
    });
    expect(placeA.ok).toBe(true);
    expect(placeB.ok).toBe(true);

    const afterPlacement = await designerSdk.getSchematicProjection(design.id);
    const sourceA = afterPlacement?.parts[0]?.pins[0];
    const branchSource = afterPlacement?.parts[0]?.pins[1];
    const targetB = afterPlacement?.parts[1]?.pins[0];
    if (!sourceA || !targetB || !branchSource) {
      throw new Error("Expected pins for wire junction test");
    }

    const createWire = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "wire-junction",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: sourceA.id,
        targetPinId: targetB.id,
      },
    });
    expect(createWire.ok).toBe(true);
    if (!createWire.ok || !createWire.createdEntityId) {
      throw new Error("Expected first wire id");
    }

    const createJunction = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "wire-junction",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: {
        type: "create_wire_junction",
        sourcePinId: branchSource.id,
        wireId: createWire.createdEntityId,
        targetPointNm: { x: 4_000_000, y: 0 },
      },
    });
    expect(createJunction.ok).toBe(true);

    // The tap splits the wire in two at a junction node + adds the branch.
    const afterJunction = await designerSdk.getSchematicProjection(design.id);
    expect(afterJunction?.wires.length).toBe(3);
    expect(afterJunction?.junctions).toContainEqual({ xNm: 4_000_000, yNm: 0 });
    const junctionNode = afterJunction?.primitives.find(
      (p) => p.kind === "junction",
    );
    expect(junctionNode?.positionNm).toEqual({ x: 4_000_000, y: 0 });
    expect(afterJunction?.nets.length).toBeGreaterThan(0);
    expect(afterJunction?.nets.some((net) => net.wireIds.length === 3)).toBe(
      true,
    );
    const anchorWire = afterJunction?.wires.find(
      (wire) => wire.id === createWire.createdEntityId,
    );
    expect(anchorWire?.targetPinId).toBe(`primitive:${junctionNode?.id}`);
    expect(
      anchorWire?.pointsNm[anchorWire.pointsNm.length - 1],
    ).toEqual({ x: 4_000_000, y: 0 });
  });

  test("junction split: two disjoint halves + branch, undoable, draggable, cascade-deletable", async () => {
    isolateTestDb("designer-hardening-junction-split");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Junction split" });
    let revision = 0;
    const dispatch = async (command: DesignerCommandEnvelope["command"]) => {
      const result = await designerSdk.dispatchCommand(design.id, {
        commandId: crypto.randomUUID(),
        sessionId: "junction-split",
        aggregateId: design.id,
        baseRevision: revision,
        issuedAt: Date.now(),
        command,
      });
      expect(result.ok).toBe(true);
      revision += 1;
      return result;
    };

    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 20_000_000, y: 0 },
    });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 10_000_000, y: 6_000_000 },
    });
    const placed = await designerSdk.getSchematicProjection(design.id);
    const pinA = placed?.parts[0]?.pins[1]; // (2mm, 0)
    const pinB = placed?.parts[1]?.pins[0]; // (18mm, 0)
    const branchPin = placed?.parts[2]?.pins[0]; // (8mm, 6mm)
    if (!pinA || !pinB || !branchPin) throw new Error("Expected pins");

    const wire = await dispatch({
      type: "create_wire",
      sourcePinId: pinA.id,
      targetPinId: pinB.id,
    });
    if (!wire.ok || !wire.createdEntityId) throw new Error("Expected wire id");

    await dispatch({
      type: "create_wire_junction",
      sourcePinId: branchPin.id,
      wireId: wire.createdEntityId,
      targetPointNm: { x: 10_000_000, y: 0 },
    });

    const after = await designerSdk.getSchematicProjection(design.id);
    const junction = after?.primitives.find((p) => p.kind === "junction");
    if (!junction) throw new Error("Expected junction node");
    const junctionPinId = `primitive:${junction.id}`;
    expect(junction.positionNm).toEqual({ x: 10_000_000, y: 0 });
    expect(after?.wires.length).toBe(3);
    expect(after?.junctions).toContainEqual({ xNm: 10_000_000, yNm: 0 });

    const w1 = after?.wires.find((w) => w.id === wire.createdEntityId);
    const w2 = after?.wires.find(
      (w) => w.sourcePinId === junctionPinId && w.targetPinId === pinB.id,
    );
    const branch = after?.wires.find(
      (w) => w.sourcePinId === branchPin.id && w.targetPinId === junctionPinId,
    );
    if (!w1 || !w2 || !branch) throw new Error("Expected all three wires");
    expect(w1.targetPinId).toBe(junctionPinId);
    expect(w1.pointsNm).toEqual([
      { x: 2_000_000, y: 0 },
      { x: 10_000_000, y: 0 },
    ]);
    expect(w2.pointsNm).toEqual([
      { x: 10_000_000, y: 0 },
      { x: 18_000_000, y: 0 },
    ]);

    // No overlapping duplicate segment across the three wires (audit §4.5).
    const segmentKey = (a: { x: number; y: number }, b: typeof a) => {
      const [p, q] = a.x < b.x || (a.x === b.x && a.y < b.y) ? [a, b] : [b, a];
      return `${p.x}:${p.y}|${q.x}:${q.y}`;
    };
    const seen = new Set<string>();
    for (const w of [w1, w2, branch]) {
      for (let i = 1; i < w.pointsNm.length; i += 1) {
        const key = segmentKey(w.pointsNm[i - 1]!, w.pointsNm[i]!);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }

    // All three wires + all three pins share one net.
    const net = after?.nets.find((n) => n.wireIds.includes(w1.id));
    expect(net?.wireIds.sort()).toEqual([w1.id, w2.id, branch.id].sort());
    expect(net?.pinIds).toContain(pinA.id);
    expect(net?.pinIds).toContain(pinB.id);
    expect(net?.pinIds).toContain(branchPin.id);

    // Single undo restores the pre-tap state (one wire, no junction node).
    const undo = await designerSdk.undo(design.id, "junction-split");
    expect(undo.ok).toBe(true);
    revision += 1;
    const afterUndo = await designerSdk.getSchematicProjection(design.id);
    expect(afterUndo?.wires.length).toBe(1);
    expect(afterUndo?.wires[0]?.pointsNm).toEqual([
      { x: 2_000_000, y: 0 },
      { x: 18_000_000, y: 0 },
    ]);
    expect(
      afterUndo?.primitives.some((p) => p.kind === "junction"),
    ).toBe(false);

    const redo = await designerSdk.redo(design.id, "junction-split");
    expect(redo.ok).toBe(true);
    revision += 1;
    const afterRedo = await designerSdk.getSchematicProjection(design.id);
    expect(afterRedo?.wires.length).toBe(3);
    expect(afterRedo?.primitives.some((p) => p.kind === "junction")).toBe(
      true,
    );

    // Dragging the junction node re-routes all three wires to it.
    await dispatch({
      type: "move_primitive",
      primitiveId: junction.id,
      positionNm: { x: 10_000_000, y: 2_000_000 },
    });
    const afterMove = await designerSdk.getSchematicProjection(design.id);
    for (const w of afterMove?.wires ?? []) {
      const touches = [w.pointsNm[0], w.pointsNm[w.pointsNm.length - 1]].some(
        (p) => p?.x === 10_000_000 && p?.y === 2_000_000,
      );
      expect(touches).toBe(true);
    }

    // Deleting the junction node cascades its three wires.
    await dispatch({
      type: "delete_entity",
      entityKind: "primitive",
      entityId: junction.id,
    });
    const afterDelete = await designerSdk.getSchematicProjection(design.id);
    expect(afterDelete?.wires.length).toBe(0);
    expect(
      afterDelete?.primitives.some((p) => p.kind === "junction"),
    ).toBe(false);
  });

  test("junction tap on a wire endpoint connects to the endpoint pin without splitting", async () => {
    isolateTestDb("designer-hardening-junction-endpoint");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Junction endpoint" });
    let revision = 0;
    const dispatch = async (command: DesignerCommandEnvelope["command"]) => {
      const result = await designerSdk.dispatchCommand(design.id, {
        commandId: crypto.randomUUID(),
        sessionId: "junction-endpoint",
        aggregateId: design.id,
        baseRevision: revision,
        issuedAt: Date.now(),
        command,
      });
      expect(result.ok).toBe(true);
      revision += 1;
      return result;
    };

    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 20_000_000, y: 0 },
    });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 10_000_000, y: 6_000_000 },
    });
    const placed = await designerSdk.getSchematicProjection(design.id);
    const pinA = placed?.parts[0]?.pins[1];
    const pinB = placed?.parts[1]?.pins[0]; // (18mm, 0)
    const branchPin = placed?.parts[2]?.pins[0];
    if (!pinA || !pinB || !branchPin) throw new Error("Expected pins");

    const wire = await dispatch({
      type: "create_wire",
      sourcePinId: pinA.id,
      targetPinId: pinB.id,
    });
    if (!wire.ok || !wire.createdEntityId) throw new Error("Expected wire id");

    // Tap exactly on the wire's target endpoint.
    await dispatch({
      type: "create_wire_junction",
      sourcePinId: branchPin.id,
      wireId: wire.createdEntityId,
      targetPointNm: { x: 18_000_000, y: 0 },
    });

    const after = await designerSdk.getSchematicProjection(design.id);
    expect(after?.wires.length).toBe(2);
    expect(after?.primitives.some((p) => p.kind === "junction")).toBe(false);
    const branch = after?.wires.find((w) => w.id !== wire.createdEntityId);
    expect(branch?.sourcePinId).toBe(branchPin.id);
    expect(branch?.targetPinId).toBe(pinB.id);
  });

  test("moves connected wire endpoints when moving part", async () => {
    isolateTestDb("designer-hardening-wire-stretch");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Wire stretch" });
    const placeA = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "wire-stretch",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 0, y: 0 },
      },
    });
    const placeB = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "wire-stretch",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 8_000_000, y: 0 },
      },
    });
    expect(placeA.ok).toBe(true);
    expect(placeB.ok).toBe(true);
    if (!placeA.ok || !placeA.createdEntityId) {
      throw new Error("Expected placed part id for stretch test");
    }

    const afterPlacement = await designerSdk.getSchematicProjection(design.id);
    const source = afterPlacement?.parts[0]?.pins[0];
    const target = afterPlacement?.parts[1]?.pins[0];
    if (!source || !target) {
      throw new Error("Expected pins for wire stretch test");
    }

    const createWire = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "wire-stretch",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: source.id,
        targetPinId: target.id,
      },
    });
    expect(createWire.ok).toBe(true);

    const move = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "wire-stretch",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: {
        type: "move_part",
        partId: placeA.createdEntityId,
        positionNm: { x: 0, y: 2_000_000 },
      },
    });
    expect(move.ok).toBe(true);

    const afterMove = await designerSdk.getSchematicProjection(design.id);
    const movedPart = afterMove?.parts.find(
      (part) => part.id === placeA.createdEntityId,
    );
    const movedSource = movedPart?.pins.find((pin) => pin.id === source.id);
    const movedWire = afterMove?.wires[0];

    expect(movedSource).toBeDefined();
    expect(movedWire).toBeDefined();
    expect(movedWire?.pointsNm[0]?.x).toBe(movedSource?.worldPositionNm.x);
    expect(movedWire?.pointsNm[0]?.y).toBe(movedSource?.worldPositionNm.y);
  });

  test("auto_arrange_schematic groups connected parts, preserves connectivity, one undo step", async () => {
    isolateTestDb("designer-auto-arrange");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Arrange" });
    await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "arrange",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: { type: "place_part", componentId, positionNm: { x: 0, y: 0 } },
    });
    await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "arrange",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 100_000_000, y: 50_000_000 },
      },
    });
    const placed = await designerSdk.getSchematicProjection(design.id);
    const source = placed?.parts[0]?.pins[0];
    const target = placed?.parts[1]?.pins[0];
    if (!source || !target) throw new Error("Expected two placed parts");
    await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "arrange",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: source.id,
        targetPinId: target.id,
      },
    });

    const before = await designerSdk.getSchematicProjection(design.id);
    const beforePos = new Map(
      before!.parts.map((p) => [p.id, { ...p.positionNm }]),
    );

    const arrange = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "arrange",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: { type: "auto_arrange_schematic" },
    });
    expect(arrange.ok).toBe(true);
    if (!arrange.ok) throw new Error("arrange failed");
    expect(arrange.revision).toBe(4); // single revision bump

    const after = await designerSdk.getSchematicProjection(design.id);
    const a = after!.parts[0]!;
    const b = after!.parts[1]!;
    // Connected pair grouped within a couple of cells.
    const groupDist =
      Math.abs(a.positionNm.x - b.positionNm.x) +
      Math.abs(a.positionNm.y - b.positionNm.y);
    expect(groupDist).toBeLessThan(60_000_000);
    // At least one part actually moved from its scattered start.
    const moved = after!.parts.some((p) => {
      const prev = beforePos.get(p.id)!;
      return prev.x !== p.positionNm.x || prev.y !== p.positionNm.y;
    });
    expect(moved).toBe(true);
    // Connectivity preserved: wire endpoints still sit on the pins.
    const wire = after!.wires[0]!;
    const srcPin = after!.parts
      .flatMap((p) => p.pins)
      .find((pin) => pin.id === wire.sourcePinId)!;
    expect(wire.pointsNm[0]!.x).toBe(srcPin.worldPositionNm.x);
    expect(wire.pointsNm[0]!.y).toBe(srcPin.worldPositionNm.y);

    // One undo restores the pre-arrange positions.
    const undo = await designerSdk.undo(design.id, "arrange");
    expect(undo.ok).toBe(true);
    const restored = await designerSdk.getSchematicProjection(design.id);
    for (const p of restored!.parts) {
      expect(p.positionNm).toEqual(beforePos.get(p.id)!);
    }
  });

  test("auto_arrange_schematic slides a connected GND flag with its pin", async () => {
    isolateTestDb("designer-arrange-flag-follow");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Flag follow" });
    let rev = 0;
    const dispatch = async (command: DesignerCommandEnvelope["command"]) => {
      const res = await designerSdk.dispatchCommand(design.id, {
        commandId: crypto.randomUUID(),
        sessionId: "flag",
        aggregateId: design.id,
        baseRevision: rev,
        issuedAt: Date.now(),
        command,
      });
      if (!res.ok) throw new Error(`dispatch failed: ${res.code}`);
      rev = res.revision;
      return res;
    };

    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 120_000_000, y: 60_000_000 },
    });
    const placed = await designerSdk.getSchematicProjection(design.id);
    const a = placed!.parts[0]!;
    const b = placed!.parts[1]!;
    // Signal wire so A + B cluster and arrange actually moves A.
    await dispatch({
      type: "create_wire",
      sourcePinId: a.pins[1]!.id,
      targetPinId: b.pins[0]!.id,
    });
    // GND flag on A.pin0, offset 8mm below, then wire pin → flag.
    const pin0 = a.pins[0]!;
    const gnd = await dispatch({
      type: "place_gnd_port",
      positionNm: {
        x: pin0.worldPositionNm.x,
        y: pin0.worldPositionNm.y + 8_000_000,
      },
    });
    const gndId = gnd.createdEntityId!;
    await dispatch({
      type: "create_wire",
      sourcePinId: pin0.id,
      targetPinId: `primitive:${gndId}`,
    });

    const before = await designerSdk.getSchematicProjection(design.id);
    const pinBefore = before!.parts
      .flatMap((p) => p.pins)
      .find((p) => p.id === pin0.id)!.worldPositionNm;
    const gndBefore = before!.primitives.find(
      (p) => p.id === gndId,
    )!.positionNm;

    await dispatch({ type: "auto_arrange_schematic" });

    const after = await designerSdk.getSchematicProjection(design.id);
    const pinAfter = after!.parts
      .flatMap((p) => p.pins)
      .find((p) => p.id === pin0.id)!.worldPositionNm;
    const gndAfter = after!.primitives.find((p) => p.id === gndId)!.positionNm;

    // The pin moved, and the flag moved by the SAME delta (stayed glued to it).
    expect(pinAfter.x !== pinBefore.x || pinAfter.y !== pinBefore.y).toBe(true);
    expect(gndAfter.x - gndBefore.x).toBe(pinAfter.x - pinBefore.x);
    expect(gndAfter.y - gndBefore.y).toBe(pinAfter.y - pinBefore.y);
  });

  test("repairs non-Manhattan wire paths into orthogonal geometry", async () => {
    isolateTestDb("designer-hardening-invalid-wire-path");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({
      name: "Invalid wire path",
    });
    const placeA = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "invalid-wire",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 0, y: 0 },
      },
    });
    const placeB = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "invalid-wire",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 8_000_000, y: 0 },
      },
    });
    expect(placeA.ok).toBe(true);
    expect(placeB.ok).toBe(true);

    const projection = await designerSdk.getSchematicProjection(design.id);
    const pinA = projection?.parts[0]?.pins[0];
    const pinB = projection?.parts[1]?.pins[0];
    if (!pinA || !pinB) {
      throw new Error("Expected pin data for invalid path test");
    }

    const repaired = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "invalid-wire",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: {
        type: "create_wire",
        sourcePinId: pinA.id,
        targetPinId: pinB.id,
        pointsNm: [
          pinA.worldPositionNm,
          {
            x: pinA.worldPositionNm.x + 100_000,
            y: pinA.worldPositionNm.y + 100_000,
          },
          pinB.worldPositionNm,
        ],
      },
    });

    // Non-orthogonal caller paths are now repaired (not rejected).
    expect(repaired.ok).toBe(true);
    if (repaired.ok && repaired.createdEntityId) {
      const proj = await designerSdk.getSchematicProjection(design.id);
      const wire = proj?.wires.find((w) => w.id === repaired.createdEntityId);
      const pts = wire?.pointsNm ?? [];
      expect(pts.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
      expect(pts[0]).toEqual(pinA.worldPositionNm);
      expect(pts[pts.length - 1]).toEqual(pinB.worldPositionNm);
    }
  });
});
