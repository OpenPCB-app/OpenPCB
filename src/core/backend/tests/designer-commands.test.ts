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

    const undoResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/history/undo`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "http-history" }),
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
          body: JSON.stringify({ sessionId: "http-history" }),
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

    const afterJunction = await designerSdk.getSchematicProjection(design.id);
    expect(afterJunction?.wires.length).toBe(2);
    expect(afterJunction?.junctions).toContainEqual({ xNm: 4_000_000, yNm: 0 });
    expect(afterJunction?.nets.length).toBeGreaterThan(0);
    expect(afterJunction?.nets.some((net) => net.wireIds.length === 2)).toBe(
      true,
    );
    const anchorWire = afterJunction?.wires.find(
      (wire) => wire.id === createWire.createdEntityId,
    );
    expect(
      anchorWire?.pointsNm.some(
        (point) => point.x === 4_000_000 && point.y === 0,
      ),
    ).toBe(true);
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
