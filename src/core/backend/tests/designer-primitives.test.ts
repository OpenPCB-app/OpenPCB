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

async function bootDesignerSdk(): Promise<DesignerSDK> {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const registry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({
    moduleRegistry: registry,
    workspaceRoot: repoRoot,
  });
  await runtime.bootstrap();
  // ensure http stack still composes correctly with primitive routes
  createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry: registry,
    moduleRuntime: runtime,
  });
  return runtime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
}

let envelopeCounter = 0;
function envelope(
  designId: string,
  baseRevision: number,
  command: DesignerCommandEnvelope["command"],
  sessionId = "primitives-test",
): DesignerCommandEnvelope {
  envelopeCounter += 1;
  return {
    commandId: `cmd-primitive-${envelopeCounter}-${crypto.randomUUID()}`,
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

describe("designer schematic primitives", () => {
  test("place_gnd_port creates a primitive and forces net name to 'GND'", async () => {
    isolate("primitives-gnd");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "GND test" });

    const r1 = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, 0, {
          type: "place_gnd_port",
          positionNm: { x: 0, y: 0 },
        }),
      ),
    );
    expect(r1.createdEntityId).toBeTruthy();

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection).not.toBeNull();
    expect(projection?.primitives.length).toBe(1);
    expect(projection?.primitives[0]?.kind).toBe("gnd");
    // Single isolated GND port is its own net named "GND"
    expect(projection?.nets.length).toBe(1);
    expect(projection?.nets[0]?.name).toBe("GND");
    expect(projection?.nets[0]?.primitiveIds.length).toBe(1);
  });

  test("place_pwr_port forces net name to railText", async () => {
    isolate("primitives-pwr");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "PWR test" });

    expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, 0, {
          type: "place_pwr_port",
          positionNm: { x: 5, y: 5 },
          railText: "+3V3",
        }),
      ),
    );

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.primitives[0]?.kind).toBe("pwr");
    expect(projection?.nets[0]?.name).toBe("+3V3");
  });

  test("two NET_PORTALs sharing portalText merge into one net", async () => {
    isolate("primitives-portals");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "Portal test" });

    let revision = 0;
    revision = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, revision, {
          type: "place_net_portal",
          positionNm: { x: 0, y: 0 },
          portalText: "EN",
        }),
      ),
    ).revision;
    revision = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, revision, {
          type: "place_net_portal",
          positionNm: { x: 1_000_000, y: 1_000_000 },
          portalText: "EN",
        }),
      ),
    ).revision;

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.primitives.length).toBe(2);
    // Two physically-disconnected portals with same text merge into one net
    expect(projection?.nets.length).toBe(1);
    expect(projection?.nets[0]?.name).toBe("EN");
    expect(projection?.nets[0]?.primitiveIds.length).toBe(2);
  });

  test("two PWR ports with different railText flag PWR_RAIL_CONFLICT but pick alphabetically first", async () => {
    isolate("primitives-pwr-conflict");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "PWR conflict" });

    // Stack two PWR ports at the SAME point so they share a net.
    let revision = 0;
    revision = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, revision, {
          type: "place_pwr_port",
          positionNm: { x: 0, y: 0 },
          railText: "VCC",
        }),
      ),
    ).revision;
    revision = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, revision, {
          type: "place_pwr_port",
          positionNm: { x: 0, y: 0 },
          railText: "+3V3",
        }),
      ),
    ).revision;

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.nets.length).toBe(1);
    // alphabetically: "+3V3" < "VCC"
    expect(projection?.nets[0]?.name).toBe("+3V3");
  });

  test("place_pwr_port with empty railText is rejected", async () => {
    isolate("primitives-pwr-empty");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "PWR empty" });

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, 0, {
        type: "place_pwr_port",
        positionNm: { x: 0, y: 0 },
        railText: "   ",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_PRIMITIVE");
    }
  });

  test("update_primitive_text rewrites the net name on the next projection", async () => {
    isolate("primitives-update-text");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "Update text" });

    let revision = 0;
    const placement = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, revision, {
          type: "place_pwr_port",
          positionNm: { x: 0, y: 0 },
          railText: "VCC",
        }),
      ),
    );
    revision = placement.revision;
    const primitiveId = placement.createdEntityId;
    expect(primitiveId).toBeTruthy();
    if (!primitiveId) return;

    revision = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, revision, {
          type: "update_primitive_text",
          primitiveId,
          text: "+5V",
        }),
      ),
    ).revision;

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.nets[0]?.name).toBe("+5V");
  });

  test("delete_entity removes a primitive", async () => {
    isolate("primitives-delete");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "Delete primitive" });

    let revision = 0;
    const placement = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, revision, {
          type: "place_gnd_port",
          positionNm: { x: 0, y: 0 },
        }),
      ),
    );
    revision = placement.revision;
    const primitiveId = placement.createdEntityId;
    expect(primitiveId).toBeTruthy();
    if (!primitiveId) return;

    revision = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, revision, {
          type: "delete_entity",
          entityId: primitiveId,
          entityKind: "primitive",
        }),
      ),
    ).revision;

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.primitives.length).toBe(0);
    expect(projection?.nets.length).toBe(0);
  });

  test("primitives never produce PCB placements", async () => {
    isolate("primitives-no-pcb");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "No PCB" });

    expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, 0, {
          type: "place_gnd_port",
          positionNm: { x: 0, y: 0 },
        }),
      ),
    );

    const pcb = await sdk.getPcbProjection(design.id);
    expect(pcb).not.toBeNull();
    expect(pcb?.placements.length).toBe(0);
  });

  test("HTTP POST /commands accepts each new primitive command type", async () => {
    isolate("primitives-http-route");
    const repoRoot = path.resolve(import.meta.dir, "../../..");
    const registry = new ModuleRouterRegistry();
    const runtime = new ModuleRuntime({
      moduleRegistry: registry,
      workspaceRoot: repoRoot,
    });
    await runtime.bootstrap();
    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
      moduleRegistry: registry,
      moduleRuntime: runtime,
    });
    const sdk = runtime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "HTTP route" });

    const post = async (
      baseRevision: number,
      command: DesignerCommandEnvelope["command"],
    ): Promise<Response> =>
      server.fetch(
        new Request(
          `http://localhost/api/modules/designer/designs/${design.id}/commands`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              commandId: `http-${crypto.randomUUID()}`,
              sessionId: "http-test",
              aggregateId: design.id,
              baseRevision,
              issuedAt: Date.now(),
              command,
            }),
          },
        ),
      );

    const r1 = await post(0, {
      type: "place_gnd_port",
      positionNm: { x: 0, y: 0 },
    });
    expect(r1.status).toBe(200);
    const r2 = await post(1, {
      type: "place_pwr_port",
      positionNm: { x: 1_000_000, y: 0 },
      railText: "+3V3",
    });
    expect(r2.status).toBe(200);
    const r3 = await post(2, {
      type: "place_net_portal",
      positionNm: { x: 2_000_000, y: 0 },
      portalText: "EN",
    });
    expect(r3.status).toBe(200);

    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.primitives.length).toBe(3);
  });

  test("place_*_port rejects non-finite coordinates with INVALID_PRIMITIVE", async () => {
    isolate("primitives-finite-point");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "finite-point test" });

    const gndNaN = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, 0, {
        type: "place_gnd_port",
        positionNm: { x: Number.NaN, y: 0 },
      }),
    );
    expect(gndNaN.ok).toBe(false);
    if (!gndNaN.ok) {
      expect(gndNaN.code).toBe("INVALID_PRIMITIVE");
    }

    const pwrInf = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, 0, {
        type: "place_pwr_port",
        positionNm: { x: 0, y: Number.POSITIVE_INFINITY },
        railText: "VCC",
      }),
    );
    expect(pwrInf.ok).toBe(false);
    if (!pwrInf.ok) {
      expect(pwrInf.code).toBe("INVALID_PRIMITIVE");
    }

    const portalNaN = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, 0, {
        type: "place_net_portal",
        positionNm: { x: Number.NaN, y: Number.NaN },
        portalText: "BUS",
      }),
    );
    expect(portalNaN.ok).toBe(false);
    if (!portalNaN.ok) {
      expect(portalNaN.code).toBe("INVALID_PRIMITIVE");
    }

    // No primitive rows should have been written.
    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.primitives.length).toBe(0);
  });

  test("move_primitive rejects non-finite coordinates", async () => {
    isolate("primitives-move-finite");
    const sdk = await bootDesignerSdk();
    const design = await sdk.createDesign({ name: "move finite test" });

    const placed = expectOk(
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, 0, {
          type: "place_gnd_port",
          positionNm: { x: 0, y: 0 },
        }),
      ),
    );
    expect(placed.createdEntityId).toBeTruthy();

    const moveNaN = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, placed.revision, {
        type: "move_primitive",
        primitiveId: placed.createdEntityId!,
        positionNm: { x: Number.NaN, y: 0 },
      }),
    );
    expect(moveNaN.ok).toBe(false);
    if (!moveNaN.ok) {
      expect(moveNaN.code).toBe("INVALID_PRIMITIVE");
    }

    // Position should remain at (0, 0) — the rejected move did not mutate.
    const projection = await sdk.getSchematicProjection(design.id);
    expect(projection?.primitives[0]?.positionNm).toEqual({ x: 0, y: 0 });
  });
});
