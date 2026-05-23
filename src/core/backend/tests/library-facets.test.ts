import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { LibraryFacets } from "../../../sdks/library";
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

async function fetchFacets(
  server: { fetch: (req: Request) => Promise<Response> },
  q: string,
  tags: string[],
): Promise<LibraryFacets> {
  const url = new URL("http://localhost/api/modules/library/facets");
  if (q) url.searchParams.set("q", q);
  if (tags.length > 0) url.searchParams.set("tags", tags.join(","));
  const response = await server.fetch(new Request(url));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { facets: LibraryFacets } };
  return body.data.facets;
}

describe("library facets endpoint", () => {
  test("returns bucketed counts for the full core catalog", async () => {
    const server = await bootServer("library-facets-baseline");
    const facets = await fetchFacets(server, "", []);

    // All 17 core components map to a single source bucket ("openpcb.core").
    expect(facets.total).toBe(17);
    expect(facets.source.length).toBeGreaterThan(0);
    const sourceCount = facets.source.reduce((s, o) => s + o.count, 0);
    expect(sourceCount).toBe(17);

    // Known core families show up with non-zero counts.
    const familyKeys = new Set(facets.family.map((o) => o.key));
    expect(familyKeys.has("diode")).toBe(true);
    expect(familyKeys.has("transistor")).toBe(true);
    expect(familyKeys.has("ic")).toBe(true);

    // Package + mount facets exist (mount derives from each component's
    // default footprint's mountType, joined server-side).
    expect(facets.package.length).toBeGreaterThan(0);
    expect(facets.mount.length).toBeGreaterThan(0);
    const mountKeys = new Set(facets.mount.map((o) => o.key));
    expect(mountKeys.has("smd") || mountKeys.has("tht")).toBe(true);

    // Sort order: descending count, ties broken alphabetically.
    for (const bucket of [facets.family, facets.package, facets.mount]) {
      for (let i = 1; i < bucket.length; i++) {
        const prev = bucket[i - 1]!;
        const cur = bucket[i]!;
        if (prev.count !== cur.count) {
          expect(prev.count).toBeGreaterThanOrEqual(cur.count);
        } else {
          expect(prev.label.localeCompare(cur.label)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  test("intersection-aware: filtering by family shrinks the package facet", async () => {
    const server = await bootServer("library-facets-intersection");
    const baseline = await fetchFacets(server, "", []);
    const filtered = await fetchFacets(server, "", ["diode"]);

    expect(filtered.total).toBeLessThan(baseline.total);
    expect(filtered.total).toBeGreaterThan(0);

    // The diode bucket in the family facet must still appear at its original
    // count (intersection-aware: self-bucket selections are excluded when
    // computing that bucket's counts).
    const diodeFamily = filtered.family.find((o) => o.key === "diode");
    expect(diodeFamily).toBeDefined();
    expect(diodeFamily!.count).toBe(
      baseline.family.find((o) => o.key === "diode")!.count,
    );

    // The package facet counts are now constrained to diodes only — every
    // count must be ≤ the baseline count for the same key.
    for (const pkg of filtered.package) {
      const base = baseline.package.find((o) => o.key === pkg.key);
      expect(base).toBeDefined();
      expect(pkg.count).toBeLessThanOrEqual(base!.count);
    }
  });

  test("query narrows the candidate set across all facets", async () => {
    const server = await bootServer("library-facets-query");
    const facets = await fetchFacets(server, "transistor", []);
    expect(facets.total).toBeGreaterThan(0);
    expect(facets.total).toBeLessThan(17);
    // Family bucket should be dominated by transistor-related entries.
    const familyKeys = new Set(facets.family.map((o) => o.key));
    expect(familyKeys.has("transistor")).toBe(true);
  });

  test("source: prefix filters the result list", async () => {
    const server = await bootServer("library-facets-source-filter");
    const all = await fetchFacets(server, "", []);
    const coreSrc = all.source[0]!;
    const scoped = await fetchFacets(server, "", [`source:${coreSrc.key}`]);
    expect(scoped.total).toBe(coreSrc.count);
  });
});
