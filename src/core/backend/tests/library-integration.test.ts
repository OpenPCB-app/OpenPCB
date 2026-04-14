import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { LibrarySDK } from "../../contracts/modules/sdk";
import { MODULE_SDK_TOKENS } from "../../contracts/modules/sdk-map";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

describe("library module integration", () => {
  test("boots, serves routes, registers SDK", async () => {
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
    expect(Array.isArray(components)).toBe(true);
    const missingResolved = await librarySdk.resolveComponent("missing-component-id");
    expect(missingResolved).toBeNull();

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
    expect(statusBody.data.componentCount).toBeGreaterThanOrEqual(0);

    const searchResponse = await server.fetch(
      new Request("http://localhost/api/modules/library/components?q=resistor"),
    );
    expect(searchResponse.status).toBe(200);
    const searchBody = (await searchResponse.json()) as {
      data?: {
        components?: Array<{ id: string }>;
      };
    };
    expect(Array.isArray(searchBody.data?.components)).toBe(true);
  });

  test("imports component via inspect and commit routes", async () => {
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
        symbols?: Array<{ id: string; name: string; preview?: { kind?: string } }>;
        footprints?: Array<{ id: string; name: string; preview?: { kind?: string } }>;
      };
    };
    const selectedSymbol = inspectBody.data?.symbols?.[0];
    const selectedFootprint = inspectBody.data?.footprints?.[0];
    expect(selectedSymbol?.name).toBe("C");
    expect(selectedFootprint?.name).toBe("C_1210_3225Metric");
    expect(selectedSymbol?.id).toBeDefined();
    expect(selectedFootprint?.id).toBeDefined();
    expect(selectedSymbol?.preview?.kind).toBe("symbol");
    expect(selectedFootprint?.preview?.kind).toBe("footprint");
    if (!selectedSymbol?.id || !selectedFootprint?.id) {
      throw new Error("Inspect route did not return stable ids");
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
            symbolId: selectedSymbol.id,
            footprintId: selectedFootprint.id,
          },
          component: {
            name: "Capacitor 1210 Imported",
            description: "Imported from KiCad fixtures",
          },
        }),
      }),
    );
    expect(commitResponse.status).toBe(201);
    const commitBody = (await commitResponse.json()) as {
      data?: { componentId?: string };
    };
    const importedComponentId = commitBody.data?.componentId;
    expect(importedComponentId).toBeDefined();
    if (!importedComponentId) {
      throw new Error("Commit route did not return component id");
    }

    const listResponse = await server.fetch(
      new Request(
        "http://localhost/api/modules/library/components?q=Capacitor%201210%20Imported",
      ),
    );
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as {
      data?: {
        components?: Array<{ name: string; symbolId: string; footprintId: string }>;
      };
    };

    const imported = listBody.data?.components?.find(
      (component) => component.name === "Capacitor 1210 Imported",
    );
    expect(imported).toBeDefined();
    expect(imported?.symbolId).toBeDefined();
    expect(imported?.footprintId).toBeDefined();

    const detailResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/components/${importedComponentId}/detail`,
      ),
    );
    expect(detailResponse.status).toBe(200);
    const detailBody = (await detailResponse.json()) as {
      data?: {
        detail?: {
          component?: { id?: string };
          symbol?: { preview?: { kind?: string } | null };
          footprint?: { preview?: { kind?: string } | null };
        };
      };
    };
    expect(detailBody.data?.detail?.component?.id).toBe(importedComponentId);
    expect(detailBody.data?.detail?.symbol?.preview?.kind).toBe("symbol");
    expect(detailBody.data?.detail?.footprint?.preview?.kind).toBe("footprint");
  });
});
