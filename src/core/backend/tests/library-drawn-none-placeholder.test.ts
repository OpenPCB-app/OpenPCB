import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { LibrarySDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MentionRegistry } from "../mentions";
import { unresolvedFootprintReason } from "../../../shared/pcb-geometry/pad-geometry";

async function boot() {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `drawn-none-${Date.now()}-${crypto.randomUUID()}.sqlite`,
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

describe("commit-drawn footprintMode none", () => {
  test("two components share the placeholder footprint", async () => {
    const { moduleRuntime, server } = await boot();
    const a = await importNone(server, "NoneA");
    const b = await importNone(server, "NoneB");
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
    const pa = await sdk.resolveComponentForPlacement(a);
    const pb = await sdk.resolveComponentForPlacement(b);
    if (!pa || !pb) throw new Error("placement must resolve");
    expect(pa.footprint.footprintId).toBe("fp-no-footprint-yet");
    expect(pb.footprint.footprintId).toBe(pa.footprint.footprintId);
    expect(pa.footprint.preview).toBeNull();
    expect(pa.footprint.mountType).toBe("virtual");
    expect(unresolvedFootprintReason(pa.footprint)).toBe("no-footprint");
  });
});
