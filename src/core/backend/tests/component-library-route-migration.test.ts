import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { ComponentLibrarySDK } from "../../contracts/modules/sdk";
import { MODULE_SDK_TOKENS } from "../../contracts/modules/sdk-map";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

describe("component-library native route migration", () => {
  test("serves native parts/symbols/footprints routes and registers SDK", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../..");
    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRuntime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: repoRoot,
    });
    await moduleRuntime.bootstrap();

    const snapshot = moduleRuntime.snapshot();
    expect(snapshot.loadedModules.includes("component-library")).toBe(true);

    const sdkRegistry = moduleRuntime.getSdkRegistry();
    expect(sdkRegistry.has(MODULE_SDK_TOKENS.COMPONENT_LIBRARY)).toBe(true);

    const componentLibrarySdk = sdkRegistry.resolve<ComponentLibrarySDK>(
      MODULE_SDK_TOKENS.COMPONENT_LIBRARY,
    );

    const parts = await componentLibrarySdk.searchParts({
      query: "capacitor",
      limit: 20,
    });
    expect(parts.length).toBeGreaterThan(0);
    const resolved = await componentLibrarySdk.resolvePart(parts[0]!.id);
    expect(resolved?.id).toBe(parts[0]!.id);

    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
      moduleRegistry,
      moduleRuntime,
    });

    const statusResponse = await server.fetch(
      new Request("http://localhost/api/modules/component-library/status"),
    );
    expect(statusResponse.status).toBe(200);

    const searchResponse = await server.fetch(
      new Request(
        "http://localhost/api/modules/component-library/parts?q=resistor",
      ),
    );
    expect(searchResponse.status).toBe(200);
    const searchBody = (await searchResponse.json()) as {
      data?: {
        parts?: Array<{ id: string; symbolId: string; footprintId: string }>;
      };
    };
    const first = searchBody.data?.parts?.[0];
    expect(first?.id).toBeDefined();

    const symbolResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/component-library/symbols/${first?.symbolId}`,
      ),
    );
    expect(symbolResponse.status).toBe(200);

    const footprintResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/component-library/footprints/${first?.footprintId}`,
      ),
    );
    expect(footprintResponse.status).toBe(200);
  });
});
