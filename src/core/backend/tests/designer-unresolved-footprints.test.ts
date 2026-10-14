import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MentionRegistry } from "../mentions";

async function boot() {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `unresolved-fp-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return { moduleRuntime, server };
}

async function importNone(
  server: ReturnType<typeof createHttpServer>,
  name: string,
): Promise<string> {
  const pin = (id: string, n: string, x: number, rot: number) => ({
    id,
    name: n,
    number: n,
    electricalType: "passive",
    positionMm: { x, y: 0 },
    lengthMm: 1,
    rotationDeg: rot,
    unit: 1,
    hidden: false,
  });
  const res = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/drawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        drawnSymbol: {
          source: {
            name,
            unitCount: 1,
            referenceText: "U?",
            valueText: name,
            pins: [pin("p1", "1", -2, 0), pin("p2", "2", 2, 180)],
            graphics: [],
            warnings: [],
          },
          referencePrefix: "U",
        },
        footprintMode: "none",
        component: { name, description: "none-mode test" },
      }),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { data: { componentId: string } };
  return body.data.componentId;
}

describe("PCB projection unresolvedFootprints", () => {
  test("lists a placeholder part by refdes with reason; warning uses refdes", async () => {
    const { moduleRuntime, server } = await boot();
    const componentId = await importNone(server, "NoneA");
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Unresolved" });
    const placed = await sdk.dispatchCommand(design.id, {
      commandId: "cmd-place-none",
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
    expect(placed.ok).toBe(true);
    const pcb = await sdk.getPcbProjection(design.id);
    expect(pcb?.unresolvedFootprints.length).toBe(1);
    const u = pcb!.unresolvedFootprints[0]!;
    expect(u.reason).toBe("no-footprint");
    expect(u.reference.length).toBeGreaterThan(0);
    expect(pcb!.placements.find((p) => p.id === u.placementId)?.reference).toBe(
      u.reference,
    );
  });
});
