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

describe("library preview SVG endpoints", () => {
  test("serves symbol SVG, sets ETag, and 304s on If-None-Match", async () => {
    const server = await bootServer("library-preview-svg");

    // Pick any core component — its symbol must have a renderable preview.
    const searchResponse = await server.fetch(
      new Request("http://localhost/api/modules/library/components?limit=5"),
    );
    expect(searchResponse.status).toBe(200);
    const searchBody = (await searchResponse.json()) as {
      data?: { components?: Array<{ id: string; symbolId: string }> };
    };
    const first = searchBody.data?.components?.[0];
    expect(first).toBeDefined();
    if (!first) return;

    const url = `http://localhost/api/modules/library/symbols/${encodeURIComponent(first.symbolId)}/preview.svg`;

    const first200 = await server.fetch(new Request(url));
    expect(first200.status).toBe(200);
    expect(first200.headers.get("content-type")).toContain("image/svg+xml");
    const etag = first200.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(first200.headers.get("cache-control")).toContain("max-age=");

    const body = await first200.text();
    expect(body.startsWith("<svg")).toBe(true);
    expect(body).toContain("viewBox=");
    expect(body.endsWith("</svg>")).toBe(true);

    // Second fetch with the previous ETag should 304 (cache hit, no body).
    const cached = await server.fetch(
      new Request(url, { headers: { "if-none-match": etag ?? "" } }),
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.get("etag")).toBe(etag);
  });

  test("returns 404 problem-details for unknown symbol id", async () => {
    const server = await bootServer("library-preview-svg-missing");
    const response = await server.fetch(
      new Request(
        "http://localhost/api/modules/library/symbols/does-not-exist/preview.svg",
      ),
    );
    expect(response.status).toBe(404);
  });

  test("footprint preview endpoint exists and matches the SVG contract", async () => {
    const server = await bootServer("library-preview-svg-footprint");
    const searchResponse = await server.fetch(
      new Request("http://localhost/api/modules/library/components?limit=20"),
    );
    const searchBody = (await searchResponse.json()) as {
      data?: { components?: Array<{ footprintId: string }> };
    };
    const components = searchBody.data?.components ?? [];
    // Find the first component whose footprint actually renders. Placeholder
    // footprints (symbol-only imports) legitimately 404 here.
    let renderedOne = false;
    for (const c of components) {
      const url = `http://localhost/api/modules/library/footprints/${encodeURIComponent(c.footprintId)}/preview.svg`;
      const response = await server.fetch(new Request(url));
      if (response.status === 404) continue;
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/svg+xml");
      const body = await response.text();
      expect(body.startsWith("<svg")).toBe(true);
      renderedOne = true;
      break;
    }
    // At least one core component must have a renderable footprint.
    expect(renderedOne).toBe(true);
  });
});
