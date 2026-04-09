import { describe, expect, test } from "bun:test";
import path from "node:path";
import { createHttpServer } from "../runtime/http/create-http-server";
import { DiagnosticsStore } from "../runtime/diagnostics/diagnostics-store";
import { ModuleRuntime } from "../runtime/modules/module-loader";
import { ModuleRouterRegistry } from "../runtime/router/module-registry";

describe("knowledge module real route migration", () => {
  test("registers and serves legacy knowledge page routes", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../..");
    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRuntime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: repoRoot,
    });

    await moduleRuntime.bootstrap();
    const snapshot = moduleRuntime.snapshot();
    expect(snapshot.loadedModules.includes("knowledge")).toBe(true);

    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
      moduleRegistry,
      moduleRuntime,
    });

    const createResponse = await server.fetch(
      new Request("http://localhost/api/modules/knowledge/pages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspace_id: "workspace-route-migration",
          title: "Migrated Route Page",
        }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const createBody = (await createResponse.json()) as {
      page?: { id: string; title: string; workspace_id: string };
      error?: string;
    };
    expect(createBody.page?.title).toBe("Migrated Route Page");
    expect(createBody.page?.workspace_id).toBe("workspace-route-migration");

    const pageId = createBody.page?.id;
    expect(typeof pageId).toBe("string");

    const getResponse = await server.fetch(
      new Request(`http://localhost/api/modules/knowledge/pages/${pageId}`),
    );
    expect(getResponse.status).toBe(200);
    const getBody = (await getResponse.json()) as {
      page?: { id: string; title: string };
      error?: string;
    };
    expect(getBody.page?.id).toBe(pageId);
    expect(getBody.page?.title).toBe("Migrated Route Page");
  });
});
