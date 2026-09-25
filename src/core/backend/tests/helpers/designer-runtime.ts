/**
 * A booted module runtime on an isolated SQLite file, plus the few fixtures the
 * designer command tests keep re-declaring: an envelope builder and an SMD
 * capacitor component (symbol + 0603 footprint) imported through the real
 * library routes — the bundled core library does not seed in every
 * environment, so tests must not rely on it.
 */
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommand,
  DesignerCommandEnvelope,
  DesignerSDK,
} from "../../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../../sdks";
import { resetSharedSqliteForTesting } from "../../db/sqlite-client";
import { DiagnosticsStore } from "../../diagnostics/diagnostics-store";
import { createHttpServer } from "../../http/create-http-server";
import { MentionRegistry } from "../../mentions";
import { ModuleRuntime } from "../../modules/module-loader";
import { ModuleRouterRegistry } from "../../router/module-registry";
import { getKicadFixturePath } from "./kicad-fixtures";

export type TestServer = ReturnType<typeof createHttpServer>;

export async function bootDesignerRuntime(label: string): Promise<{
  sdk: DesignerSDK;
  server: TestServer;
}> {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();
  const repoRoot = path.resolve(import.meta.dir, "../../../..");
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

export const TEST_SESSION = "designer-test-session";

export function envelope(
  designId: string,
  baseRevision: number | null,
  command: DesignerCommand,
  commandId: string = crypto.randomUUID(),
): DesignerCommandEnvelope {
  return {
    commandId,
    sessionId: TEST_SESSION,
    aggregateId: designId,
    baseRevision,
    issuedAt: Date.now(),
    command,
  };
}

/** Dispatch at the design's current revision; throws on a failed result. */
export async function dispatchOk(
  sdk: DesignerSDK,
  designId: string,
  command: DesignerCommand,
): Promise<{ revision: number; createdEntityId: string | null }> {
  const head = await sdk.getSchematicProjection(designId);
  const result = await sdk.dispatchCommand(
    designId,
    envelope(designId, head?.revision ?? null, command),
  );
  if (!result.ok) {
    throw new Error(`${command.type} failed: ${JSON.stringify(result)}`);
  }
  return result;
}

/** POST a command envelope over HTTP — exercises the `routes.ts` parser. */
export function postCommand(
  server: TestServer,
  designId: string,
  body: unknown,
): Promise<Response> {
  return server.fetch(
    new Request(
      `http://localhost/api/modules/designer/designs/${designId}/commands`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  );
}

async function postJson(
  server: TestServer,
  url: string,
  body: unknown,
): Promise<Response> {
  return server.fetch(
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** A capacitor with a real 0603 SMD footprint; returns the component id. */
export async function importCapacitorComponent(
  server: TestServer,
): Promise<string> {
  const symbolLibrary = {
    fileName: "C.kicad_sym",
    content: await Bun.file(getKicadFixturePath("simple_capacitor.kicad_sym")).text(),
  };
  const footprints = [
    {
      fileName: "C_0603_1608Metric.kicad_mod",
      content: await Bun.file(
        getKicadFixturePath("C_0603_1608Metric.kicad_mod"),
      ).text(),
    },
  ];
  const inspect = await postJson(
    server,
    "/api/modules/library/imports/kicad/inspect",
    { symbolLibrary, footprints },
  );
  const inspected = (await inspect.json()) as {
    data?: { symbols?: Array<{ id: string }>; footprints?: Array<{ id: string }> };
  };
  const symbolId = inspected.data?.symbols?.[0]?.id;
  const footprintId = inspected.data?.footprints?.[0]?.id;
  if (!symbolId || !footprintId) throw new Error("fixture inspect failed");
  const commit = await postJson(server, "/api/modules/library/imports/kicad", {
    symbolLibrary,
    footprints,
    selection: { symbolId, footprintId },
    component: { name: "Test Capacitor", description: "designer test part" },
  });
  const committed = (await commit.json()) as {
    data?: { componentId?: string };
  };
  const componentId = committed.data?.componentId;
  if (!componentId) throw new Error("fixture commit failed");
  return componentId;
}

/** Place `count` capacitors 10 mm apart; returns their part ids in order. */
export async function placeCapacitors(
  sdk: DesignerSDK,
  designId: string,
  componentId: string,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const placed = await dispatchOk(sdk, designId, {
      type: "place_part",
      componentId,
      positionNm: { x: i * 10_000_000, y: 0 },
    });
    if (!placed.createdEntityId) throw new Error("place_part returned no id");
    ids.push(placed.createdEntityId);
  }
  return ids;
}
