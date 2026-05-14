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

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  const dbFile = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  process.env.OPENPCB_DB_PATH = dbFile;
}

async function createRuntimeAndServer() {
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
  return { moduleRuntime, server };
}

describe("designer rename endpoint", () => {
  test("PATCH /designs/:id updates name and updatedAt without bumping revision", async () => {
    isolateTestDb("designer-rename-success");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const created = await sdk.createDesign({ name: "Original" });

    // Spin briefly so updatedAt timestamp differs.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Renamed Design" }),
        },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        design: {
          id: string;
          name: string;
          revision: number;
          updatedAt: string;
        };
      };
    };
    expect(body.data.design.id).toBe(created.id);
    expect(body.data.design.name).toBe("Renamed Design");
    expect(body.data.design.revision).toBe(created.revision);
    expect(body.data.design.updatedAt).not.toBe(created.updatedAt);

    const listed = await sdk.listDesigns();
    expect(listed.find((d) => d.id === created.id)?.name).toBe(
      "Renamed Design",
    );
  });

  test("PATCH trims whitespace from name", async () => {
    isolateTestDb("designer-rename-trim");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const created = await sdk.createDesign({ name: "x" });
    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "  Power Supply  " }),
        },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { design: { name: string } };
    };
    expect(body.data.design.name).toBe("Power Supply");
  });

  test("PATCH rejects empty name with 400", async () => {
    isolateTestDb("designer-rename-empty");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const created = await sdk.createDesign({ name: "x" });
    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "   " }),
        },
      ),
    );
    expect(response.status).toBe(400);
  });

  test("PATCH rejects oversized name with 400", async () => {
    isolateTestDb("designer-rename-oversized");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const created = await sdk.createDesign({ name: "x" });
    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "a".repeat(200) }),
        },
      ),
    );
    expect(response.status).toBe(400);
  });

  test("PATCH on unknown id returns 404", async () => {
    isolateTestDb("designer-rename-missing");
    const { server } = await createRuntimeAndServer();
    const response = await server.fetch(
      new Request(`http://localhost/api/modules/designer/designs/missing-id`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Whatever" }),
      }),
    );
    expect(response.status).toBe(404);
  });
});
