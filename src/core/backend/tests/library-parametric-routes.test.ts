import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import {
  createHttpServer,
  type RuntimeServer,
} from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const tempRoots: string[] = [];

async function bootHarness(label: string): Promise<RuntimeServer> {
  resetSharedSqliteForTesting();
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), `openpcb-${label}-`)),
  );
  tempRoots.push(root);
  process.env.OPENPCB_DB_PATH = path.join(root, "openpcb.sqlite");

  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  return createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

const TEMPLATES_URL = "http://localhost/api/modules/library/templates";

describe("library parametric template routes (F2)", () => {
  test("GET /templates lists three built-in templates", async () => {
    const server = await bootHarness("tpl-list");
    const res = await server.fetch(new Request(TEMPLATES_URL));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { templates: Array<{ id: string; schema: unknown }> };
    };
    const ids = body.data.templates.map((t) => t.id).sort();
    expect(ids).toEqual(["mounting-array", "pin-header", "screw-terminal"]);
  });

  test("GET /templates/:id returns schema + defaults", async () => {
    const server = await bootHarness("tpl-detail");
    const res = await server.fetch(new Request(`${TEMPLATES_URL}/pin-header`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        template: {
          id: string;
          defaults: { rows: number; pinsPerRow: number };
        };
      };
    };
    expect(body.data.template.id).toBe("pin-header");
    expect(body.data.template.defaults.rows).toBe(1);
  });

  test("GET /templates/:id 404s for unknown id", async () => {
    const server = await bootHarness("tpl-404");
    const res = await server.fetch(new Request(`${TEMPLATES_URL}/missing`));
    expect(res.status).toBe(404);
  });

  test("POST materialize returns generated FootprintRenderSource + hash", async () => {
    const server = await bootHarness("tpl-materialize");
    const res = await server.fetch(
      new Request(`${TEMPLATES_URL}/pin-header/materialize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          params: {
            rows: 2,
            pinsPerRow: 10,
            pitchMm: 2.54,
            mount: "tht",
            orientation: "vertical",
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        templateId: string;
        paramsHash: string;
        source: { pads: Array<unknown> };
        metadata: { mountType: string; name: string };
      };
    };
    expect(body.data.templateId).toBe("pin-header");
    expect(body.data.source.pads).toHaveLength(20);
    expect(body.data.paramsHash.length).toBeGreaterThan(0);
    expect(body.data.metadata.name).toContain("02x10");
  });

  test("POST materialize falls back to defaults when params omitted", async () => {
    const server = await bootHarness("tpl-defaults");
    const res = await server.fetch(
      new Request(`${TEMPLATES_URL}/mounting-array/materialize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { source: { pads: unknown[] } };
    };
    // Defaults are 2×2 → 4 holes.
    expect(body.data.source.pads).toHaveLength(4);
  });

  test("POST materialize rejects out-of-bounds params", async () => {
    const server = await bootHarness("tpl-validate");
    const res = await server.fetch(
      new Request(`${TEMPLATES_URL}/pin-header/materialize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params: { rows: 99 } }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
