import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "openpcb-modules-"));
  tempDirs.push(workspace);
  await mkdir(path.join(workspace, "modules"), { recursive: true });
  return workspace;
}

async function writeModule(
  workspace: string,
  moduleId: string,
  manifest: Record<string, unknown>,
  backendEntrySource: string,
): Promise<void> {
  const moduleDir = path.join(workspace, "modules", moduleId);
  await mkdir(moduleDir, { recursive: true });
  await writeFile(
    path.join(moduleDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(moduleDir, "module.backend.mjs"),
    backendEntrySource,
    "utf8",
  );
}

function baseManifest(moduleId: string): Record<string, unknown> {
  return {
    id: moduleId,
    label: moduleId,
    version: "1.0.0",
    apiVersion: 2,
    namespace: `space.${moduleId}`,
    kind: "space",
    sidebar: {
      label: moduleId,
      icon: "Box",
      order: 10,
    },
    runtime: {
      backendEntry: "module.backend.mjs",
    },
    dependsOn: [],
  };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

describe("module runtime bootstrap", () => {
  test("skips module when dependency minVersion is not satisfied", async () => {
    const workspace = await createWorkspace();

    await writeModule(
      workspace,
      "lib",
      {
        ...baseManifest("lib"),
        version: "0.1.0",
      },
      `export default { id: "lib", registerRoutes() {} };`,
    );

    await writeModule(
      workspace,
      "designer",
      {
        ...baseManifest("designer"),
        dependsOn: [{ id: "lib", minVersion: "0.2.0", optional: false }],
      },
      `export default { id: "designer", registerRoutes() {} };`,
    );

    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRuntime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: workspace,
    });

    await moduleRuntime.bootstrap();
    const snapshot = moduleRuntime.snapshot();
    const byId = new Map(snapshot.modules.map((item) => [item.id, item]));

    expect(byId.get("lib")?.status).toBe("loaded");
    expect(byId.get("designer")?.status).toBe("skipped");
  });

  test("loads independent module and skips dependents on missing required dependencies", async () => {
    const workspace = await createWorkspace();
    await writeModule(
      workspace,
      "a",
      baseManifest("a"),
      `export default { id: "a", registerRoutes(router) { router.get("/status", async () => new Response(JSON.stringify({ module: "a" }), { headers: { "content-type": "application/json" } })); } };`,
    );

    await writeModule(
      workspace,
      "b",
      {
        ...baseManifest("b"),
        dependsOn: [{ id: "missing", optional: false }],
      },
      `export default { id: "b", registerRoutes() {} };`,
    );

    await writeModule(
      workspace,
      "c",
      {
        ...baseManifest("c"),
        dependsOn: [{ id: "b", optional: false }],
      },
      `export default { id: "c", registerRoutes() {} };`,
    );

    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRuntime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: workspace,
    });

    await moduleRuntime.bootstrap();
    const snapshot = moduleRuntime.snapshot();

    expect(snapshot.loadedModules).toEqual(["a"]);

    const byId = new Map(snapshot.modules.map((item) => [item.id, item]));
    expect(byId.get("a")?.status).toBe("loaded");
    expect(byId.get("b")?.status).toBe("skipped");
    expect(byId.get("c")?.status).toBe("skipped");
  });

  test("exposes registry snapshot and module routes through HTTP server", async () => {
    const workspace = await createWorkspace();
    await writeModule(
      workspace,
      "modx",
      baseManifest("modx"),
      `export default { id: "modx", registerRoutes(router) { router.get("/status", async () => new Response(JSON.stringify({ ok: true, name: "modx" }), { headers: { "content-type": "application/json" } })); } };`,
    );

    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRuntime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: workspace,
    });
    await moduleRuntime.bootstrap();

    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
      moduleRegistry,
      moduleRuntime,
    });

    const registryResponse = await server.fetch(
      new Request("http://localhost/api/modules/registry"),
    );
    const registryBody = (await registryResponse.json()) as {
      modules: Array<{ id: string; status: string }>;
      loadedModules: string[];
    };

    expect(registryResponse.status).toBe(200);
    expect(registryBody.loadedModules).toEqual(["modx"]);
    expect(registryBody.modules[0]?.id).toBe("modx");

    const statusResponse = await server.fetch(
      new Request("http://localhost/api/modules/modx/status"),
    );
    const statusBody = (await statusResponse.json()) as {
      ok: boolean;
      name: string;
    };
    expect(statusResponse.status).toBe(200);
    expect(statusBody.name).toBe("modx");
  });
});
