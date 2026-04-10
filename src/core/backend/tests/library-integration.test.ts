import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { LibrarySDK } from "../../contracts/modules/sdk";
import { MODULE_SDK_TOKENS } from "../../contracts/modules/sdk-map";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

describe("library module integration", () => {
  test("boots, seeds, serves routes, registers SDK", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../..");
    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRuntime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: repoRoot,
    });
    await moduleRuntime.bootstrap();

    const snapshot = moduleRuntime.snapshot();
    expect(snapshot.loadedModules.includes("library")).toBe(true);

    const sdkRegistry = moduleRuntime.getSdkRegistry();
    expect(sdkRegistry.has(MODULE_SDK_TOKENS.LIBRARY)).toBe(true);

    const librarySdk = sdkRegistry.resolve<LibrarySDK>(
      MODULE_SDK_TOKENS.LIBRARY,
    );

    const components = await librarySdk.searchComponents({
      query: "capacitor",
      limit: 20,
    });
    expect(components.length).toBeGreaterThan(0);
    const resolved = await librarySdk.resolveComponent(components[0]!.id);
    expect(resolved?.id).toBe(components[0]!.id);

    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
      moduleRegistry,
      moduleRuntime,
    });

    const statusResponse = await server.fetch(
      new Request("http://localhost/api/modules/library/status"),
    );
    expect(statusResponse.status).toBe(200);
    const statusBody = (await statusResponse.json()) as {
      data: { componentCount: number };
    };
    expect(statusBody.data.componentCount).toBeGreaterThanOrEqual(3);

    const searchResponse = await server.fetch(
      new Request("http://localhost/api/modules/library/components?q=resistor"),
    );
    expect(searchResponse.status).toBe(200);
    const searchBody = (await searchResponse.json()) as {
      data?: {
        components?: Array<{
          id: string;
          symbolId: string;
          footprintId: string;
        }>;
      };
    };
    const first = searchBody.data?.components?.[0];
    expect(first?.id).toBeDefined();

    const symbolResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/symbols/${first?.symbolId}`,
      ),
    );
    expect(symbolResponse.status).toBe(200);

    const footprintResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/footprints/${first?.footprintId}`,
      ),
    );
    expect(footprintResponse.status).toBe(200);
  });
});
