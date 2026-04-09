import { describe, expect, test } from "bun:test";
import path from "node:path";
import { DiagnosticsStore } from "../runtime/diagnostics/diagnostics-store";
import { createHttpServer } from "../runtime/http/create-http-server";
import { ModuleRuntime } from "../runtime/modules/module-loader";
import { ModuleRouterRegistry } from "../runtime/router/module-registry";

describe("designer module disabled", () => {
  test("is skipped by manifest and not registered in app routes", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../..");
    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRuntime = new ModuleRuntime({ moduleRegistry, workspaceRoot: repoRoot });
    await moduleRuntime.bootstrap();

    const snapshot = moduleRuntime.snapshot();
    expect(snapshot.loadedModules.includes("designer")).toBe(false);

    const designer = snapshot.modules.find((module) => module.id === "designer");
    expect(designer?.status).toBe("skipped");
    expect(designer?.reason).toContain("Disabled by manifest");

    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
      moduleRegistry,
      moduleRuntime,
    });

    const response = await server.fetch(new Request("http://localhost/api/modules/designer/status"));
    expect(response.status).toBe(404);
  });
});
