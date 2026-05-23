import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function bootServer(label: string) {
  isolateTestDb(label);
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  return createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
}

async function fetchModelRef(
  server: { fetch: (req: Request) => Promise<Response> },
  footprintId: string,
): Promise<unknown> {
  const response = await server.fetch(
    new Request(
      `http://localhost/api/modules/library/footprints/${encodeURIComponent(
        footprintId,
      )}/model/meta`,
    ),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { modelRef: unknown } };
  return body.data.modelRef;
}

describe("library model-ref propagation from .opclib manifest", () => {
  test("Pin headers/sockets ship baked GLBs without runtime modelRef", async () => {
    const server = await bootServer("library-model-ref-pin-header");

    for (const footprintId of [
      "openpcb.core.footprint.connector.pin-header-1x02-p2-54mm-vertical",
      "openpcb.core.footprint.connector.pin-header-2x03-p2-54mm-vertical",
      "openpcb.core.footprint.connector.pin-socket-1x02-p2-54mm-vertical",
      "openpcb.core.footprint.connector.pin-socket-2x03-p2-54mm-vertical",
    ]) {
      const modelRef = await fetchModelRef(server, footprintId);
      expect(modelRef).toBeNull();
    }
  });

  test("LEDs ship baked GLBs without runtime modelRef", async () => {
    const server = await bootServer("library-model-ref-led");

    for (const footprintId of [
      "openpcb.core.footprint.opto.led-0603-1608metric",
      "openpcb.core.footprint.opto.led-0805-2012metric",
      "openpcb.core.footprint.opto.led-1206-3216metric",
    ]) {
      const modelRef = await fetchModelRef(server, footprintId);
      expect(modelRef).toBeNull();
    }
  });
});
