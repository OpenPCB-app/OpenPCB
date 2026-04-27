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
  const symbolPath = path.resolve(import.meta.dir, "../../../../data/C.kicad_sym");
  const footprintPath = path.resolve(
    import.meta.dir,
    "../../../../data/C_1210_3225Metric.kicad_mod",
  );
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
            fileName: "C_1210_3225Metric.kicad_mod",
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
            fileName: "C_1210_3225Metric.kicad_mod",
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

    const projectionAfterPlace = await designerSdk.getSchematicProjection(design.id);
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

    const projectionAfterTransform = await designerSdk.getSchematicProjection(design.id);
    const partAfterTransform = projectionAfterTransform?.parts.find(
      (part) => part.id === partAfterPlace.id,
    );
    expect(partAfterTransform?.rotationDeg).toBe(90);
    expect(partAfterTransform?.mirrored).toBe(true);
    expect(partAfterTransform?.positionNm.x).toBe(10_000_000);
    expect(partAfterTransform?.positionNm.y).toBe(20_000_000);

    const transformedPin = partAfterTransform?.pins.find((pin) => pin.id === firstPin.id);
    expect(transformedPin).toBeDefined();
    expect(transformedPin?.worldPositionNm.x).not.toBe(firstPin.worldPositionNm.x);
    expect(transformedPin?.worldPositionNm.y).not.toBe(firstPin.worldPositionNm.y);
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
    const label = projection?.labels.find((entry) => entry.id === createLabel.createdEntityId);
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
    const anchorWire = afterJunction?.wires.find((wire) => wire.id === createWire.createdEntityId);
    expect(anchorWire?.pointsNm.some((point) => point.x === 4_000_000 && point.y === 0)).toBe(true);
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
    const movedPart = afterMove?.parts.find((part) => part.id === placeA.createdEntityId);
    const movedSource = movedPart?.pins.find((pin) => pin.id === source.id);
    const movedWire = afterMove?.wires[0];

    expect(movedSource).toBeDefined();
    expect(movedWire).toBeDefined();
    expect(movedWire?.pointsNm[0]?.x).toBe(movedSource?.worldPositionNm.x);
    expect(movedWire?.pointsNm[0]?.y).toBe(movedSource?.worldPositionNm.y);
  });

  test("rejects non-Manhattan wire paths", async () => {
    isolateTestDb("designer-hardening-invalid-wire-path");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importDrawnWireableComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "Invalid wire path" });
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

    const invalid = await designerSdk.dispatchCommand(design.id, {
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
          { x: pinA.worldPositionNm.x + 100_000, y: pinA.worldPositionNm.y + 100_000 },
          pinB.worldPositionNm,
        ],
      },
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.code).toBe("INVALID_WIRE_PATH");
    }
  });
});
