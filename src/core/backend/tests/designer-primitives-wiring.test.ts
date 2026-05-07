import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerDispatchResult,
  DesignerSDK,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function isolate(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function boot(): Promise<{
  sdk: DesignerSDK;
  server: ReturnType<typeof createHttpServer>;
}> {
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
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  return { sdk, server };
}

async function importWireableComponent(
  server: ReturnType<typeof createHttpServer>,
): Promise<string> {
  const response = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/drawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        drawnSymbol: {
          source: {
            name: "WirePartA",
            unitCount: 1,
            referenceText: "U?",
            valueText: "WirePartA",
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
          name: "Wireable Primitive Test",
          description: "primitive wiring fixture",
        },
      }),
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { data?: { componentId?: string } };
  const id = body.data?.componentId;
  if (!id) throw new Error("expected componentId");
  return id;
}

let envelopeCounter = 0;
function envelope(
  designId: string,
  baseRevision: number,
  command: DesignerCommandEnvelope["command"],
  sessionId = "primitive-wiring",
): DesignerCommandEnvelope {
  envelopeCounter += 1;
  return {
    commandId: `cmd-prim-wire-${envelopeCounter}-${crypto.randomUUID()}`,
    sessionId,
    aggregateId: designId,
    baseRevision,
    issuedAt: Date.now(),
    command,
  };
}

function expectOk(result: DesignerDispatchResult): {
  revision: number;
  createdEntityId: string | null;
} {
  if (!result.ok) {
    throw new Error(
      `expected ok dispatch, got code=${result.code} payload=${JSON.stringify(result)}`,
    );
  }
  return { revision: result.revision, createdEntityId: result.createdEntityId };
}

describe("designer primitives wiring", () => {
  test("wire from part pin to GND primitive merges into 'GND' net", async () => {
    isolate("primitives-wire-gnd");
    const { sdk, server } = await boot();
    const componentId = await importWireableComponent(server);
    const design = await sdk.createDesign({ name: "Wire GND" });

    let rev = 0;
    rev = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "place_part",
          componentId,
          positionNm: { x: 0, y: 0 },
        }),
      ),
    ).revision;

    const placeGnd = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "place_gnd_port",
          // 5 mm to the right of pin-2 (which is at +2 mm world)
          positionNm: { x: 7_000_000, y: 0 },
        }),
      ),
    );
    rev = placeGnd.revision;
    const gndId = placeGnd.createdEntityId;
    expect(gndId).toBeTruthy();
    if (!gndId) return;

    const beforeWire = await sdk.getSchematicProjection(design.id);
    const pinB = beforeWire?.parts[0]?.pins.find((p) => p.number === "2");
    if (!pinB) throw new Error("expected pin-2 on placed part");

    const wireCreate = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "create_wire",
          sourcePinId: pinB.id,
          targetPinId: `primitive:${gndId}`,
        }),
      ),
    );
    rev = wireCreate.revision;
    expect(wireCreate.createdEntityId).toBeTruthy();

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.wires.length).toBe(1);
    const gndNet = projection?.nets.find((n) => n.name === "GND");
    expect(gndNet).toBeTruthy();
    expect(gndNet?.pinIds).toContain(pinB.id);
    expect(gndNet?.primitiveIds).toContain(gndId);
    expect(gndNet?.wireIds.length).toBe(1);
  });

  test("wire to PWR primitive forces net name to railText", async () => {
    isolate("primitives-wire-pwr");
    const { sdk, server } = await boot();
    const componentId = await importWireableComponent(server);
    const design = await sdk.createDesign({ name: "Wire PWR" });

    let rev = 0;
    rev = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "place_part",
          componentId,
          positionNm: { x: 0, y: 0 },
        }),
      ),
    ).revision;
    const placePwr = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "place_pwr_port",
          positionNm: { x: 7_000_000, y: 0 },
          railText: "+3V3",
        }),
      ),
    );
    rev = placePwr.revision;
    const pwrId = placePwr.createdEntityId;
    if (!pwrId) throw new Error("expected pwr id");

    const before = await sdk.getSchematicProjection(design.id);
    const pinB = before?.parts[0]?.pins.find((p) => p.number === "2");
    if (!pinB) throw new Error("expected pin-2");

    expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "create_wire",
          sourcePinId: pinB.id,
          targetPinId: `primitive:${pwrId}`,
        }),
      ),
    );

    const projection = await sdk.getSchematicProjection(design.id);
    const pwrNet = projection?.nets.find((n) => n.name === "+3V3");
    expect(pwrNet).toBeTruthy();
    expect(pwrNet?.pinIds).toContain(pinB.id);
    expect(pwrNet?.primitiveIds).toContain(pwrId);
  });

  test("deleting a primitive cascade-deletes wires connected to it", async () => {
    isolate("primitives-cascade-delete");
    const { sdk, server } = await boot();
    const componentId = await importWireableComponent(server);
    const design = await sdk.createDesign({ name: "Cascade" });

    let rev = 0;
    rev = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "place_part",
          componentId,
          positionNm: { x: 0, y: 0 },
        }),
      ),
    ).revision;
    const placeGnd = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "place_gnd_port",
          positionNm: { x: 7_000_000, y: 0 },
        }),
      ),
    );
    rev = placeGnd.revision;
    const gndId = placeGnd.createdEntityId;
    if (!gndId) throw new Error("expected gnd id");

    const before = await sdk.getSchematicProjection(design.id);
    const pinB = before?.parts[0]?.pins.find((p) => p.number === "2");
    if (!pinB) throw new Error("expected pin-2");

    rev = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "create_wire",
          sourcePinId: pinB.id,
          targetPinId: `primitive:${gndId}`,
        }),
      ),
    ).revision;

    rev = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "delete_entity",
          entityId: gndId,
          entityKind: "primitive",
        }),
      ),
    ).revision;

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.primitives.length).toBe(0);
    expect(projection?.wires.length).toBe(0);
  });

  test("moving a primitive reroutes its connected wire endpoint", async () => {
    isolate("primitives-move-wire");
    const { sdk, server } = await boot();
    const componentId = await importWireableComponent(server);
    const design = await sdk.createDesign({ name: "Move primitive" });

    let rev = 0;
    rev = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "place_part",
          componentId,
          positionNm: { x: 0, y: 0 },
        }),
      ),
    ).revision;
    const placeGnd = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "place_gnd_port",
          positionNm: { x: 7_000_000, y: 0 },
        }),
      ),
    );
    rev = placeGnd.revision;
    const gndId = placeGnd.createdEntityId;
    if (!gndId) throw new Error("expected gnd id");

    const before = await sdk.getSchematicProjection(design.id);
    const pinB = before?.parts[0]?.pins.find((p) => p.number === "2");
    if (!pinB) throw new Error("expected pin-2");

    rev = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "create_wire",
          sourcePinId: pinB.id,
          targetPinId: `primitive:${gndId}`,
        }),
      ),
    ).revision;

    const movedTo = { x: 7_000_000, y: 5_000_000 };
    rev = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, rev, {
          type: "move_primitive",
          primitiveId: gndId,
          positionNm: movedTo,
        }),
      ),
    ).revision;

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.wires.length).toBe(1);
    const wire = projection?.wires[0];
    expect(wire).toBeTruthy();
    if (!wire) return;
    const last = wire.pointsNm[wire.pointsNm.length - 1];
    expect(last).toEqual(movedTo);
    // Net is still GND-named because primitive is still on the wire.
    expect(projection?.nets.find((n) => n.name === "GND")).toBeTruthy();
  });
});
