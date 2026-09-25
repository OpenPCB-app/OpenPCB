import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  LibraryComponentPage,
  LibraryFacets,
} from "../../../sdks/library";
import {
  compareForList,
  matchesLibraryFilter,
  matchesQuery,
  parseLibraryFilter,
  toFilterableComponent,
  type FilterableComponentInput,
} from "../../../modules/library/backend/component-filter";
import { getDb } from "../../../modules/library/backend/queries";
import { components, footprints } from "../../../modules/library/backend/schema";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import {
  createHttpServer,
  type RuntimeServer,
} from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function filterable(overrides: Partial<FilterableComponentInput>) {
  return toFilterableComponent({
    id: "c1",
    name: "Part",
    description: "",
    tags: [],
    isBuiltin: false,
    sourceId: "user.local",
    sourceName: "Local Library",
    footprintMountType: null,
    ...overrides,
  });
}

describe("component filter (shared list/facet predicate)", () => {
  test("mount filters and footprint mount types share one canonical key", () => {
    const filter = parseLibraryFilter("", ["through_hole", "SMT", "source:openpcb.core"]);
    expect([...filter.mount].sort()).toEqual(["smd", "tht"]);
    expect([...filter.source]).toEqual(["openpcb.core"]);
    expect(filter.other.size).toBe(0);

    const header = filterable({ footprintMountType: "through_hole" });
    expect(header.mount.has("tht")).toBe(true);
    expect(matchesLibraryFilter(header, parseLibraryFilter("", ["tht"]))).toBe(true);
    expect(matchesLibraryFilter(header, parseLibraryFilter("", ["smd"]))).toBe(false);
  });

  test("free text searches name, description and tags but not the source id", () => {
    const part = filterable({
      name: "LED",
      description: "Indicator",
      tags: ["opto"],
      sourceId: "openpcb.core",
    });
    expect(matchesQuery(part, parseLibraryFilter("indic", []))).toBe(true);
    expect(matchesQuery(part, parseLibraryFilter("opto", []))).toBe(true);
    expect(matchesQuery(part, parseLibraryFilter("core", []))).toBe(false);
    expect(matchesQuery(part, parseLibraryFilter("pcb", []))).toBe(false);
  });

  test("system tags filter but never widen the query", () => {
    const user = filterable({ tags: ["user"] });
    expect(matchesLibraryFilter(user, parseLibraryFilter("", ["user"]))).toBe(true);
    expect(matchesLibraryFilter(filterable({}), parseLibraryFilter("", ["user"]))).toBe(false);
  });

  test("exact and prefix name matches rank first, then name, then id", () => {
    const filter = parseLibraryFilter("r", []);
    const parts = [
      filterable({ id: "a", name: "Zener", description: "regulator" }),
      filterable({ id: "b", name: "Resistor" }),
      filterable({ id: "c", name: "R" }),
      filterable({ id: "d", name: "Crystal" }),
      filterable({ id: "e", name: "R" }),
    ];
    const order = parts
      .sort((x, y) => compareForList(x, y, filter))
      .map((p) => p.id);
    expect(order).toEqual(["c", "e", "b", "d", "a"]);
  });
});

const tempRoots: string[] = [];

const ORIGINAL_DB_PATH = process.env.OPENPCB_DB_PATH;

afterEach(async () => {
  resetSharedSqliteForTesting();
  if (ORIGINAL_DB_PATH === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = ORIGINAL_DB_PATH;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

const URL_BASE = "http://localhost/api/modules/library";
const SCOPE = "qa-lb-scope";

async function bootWithSeed(label: string): Promise<RuntimeServer> {
  resetSharedSqliteForTesting();
  const root = mkdtempSync(path.join(os.tmpdir(), `openpcb-${label}-`));
  tempRoots.push(root);
  process.env.OPENPCB_DB_PATH = path.join(root, "openpcb.sqlite");
  const moduleRegistry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await runtime.bootstrap();
  const ctx = (runtime as unknown as { loaded: Map<string, { context: unknown }> })
    .loaded.get("library")!.context as Parameters<typeof getDb>[0];
  seed(getDb(ctx));
  return createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime: runtime,
  });
}

function seed(db: ReturnType<typeof getDb>): void {
  const now = new Date().toISOString();
  const mounts = { smd: "smd", tht: "through_hole" } as const;
  for (const [key, mountType] of Object.entries(mounts)) {
    db.insert(footprints)
      .values({
        id: `qa.fp.${key}`,
        name: `FP ${key}`,
        dataJson: JSON.stringify({ normalized: { mountType } }),
        createdAt: now,
        sourceId: "user.local",
      })
      .run();
  }
  const parts: Array<[string, string, string[], keyof typeof mounts]> = [
    ["R", "", [SCOPE], "smd"],
    ["Resistor Array", "", [SCOPE, "resistor"], "smd"],
    ["Header 1x02", "pin header", [SCOPE, "connector"], "tht"],
    ["Zener", "regulator diode", [SCOPE, "diode"], "smd"],
    ["Socket", "", [SCOPE, "connector", "smd"], "tht"],
  ];
  parts.forEach(([name, description, tags, mount], index) => {
    db.insert(components)
      .values({
        id: `qa.comp.${index}`,
        name,
        description,
        symbolId: "qa.sym",
        footprintId: `qa.fp.${mount}`,
        tagsJson: JSON.stringify(tags),
        createdAt: now,
        isBuiltin: 0,
        sourceId: "user.local",
      })
      .run();
  });
}

async function listPage(
  server: RuntimeServer,
  params: Record<string, string>,
): Promise<LibraryComponentPage> {
  const url = new URL(`${URL_BASE}/components`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await server.fetch(new Request(url));
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: LibraryComponentPage }).data;
}

async function facets(
  server: RuntimeServer,
  params: Record<string, string>,
): Promise<LibraryFacets> {
  const url = new URL(`${URL_BASE}/facets`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await server.fetch(new Request(url));
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { facets: LibraryFacets } }).data.facets;
}

describe("GET /components and GET /facets agree", () => {
  test("list total equals facet total for queries and mount/family filters", async () => {
    const server = await bootWithSeed("library-filter-parity");
    const cases: Array<{ q?: string; tags: string[]; expected: number }> = [
      { tags: [SCOPE], expected: 5 },
      { q: "r", tags: [SCOPE], expected: 5 },
      { q: "local", tags: [SCOPE], expected: 0 },
      { q: "core", tags: [SCOPE], expected: 0 },
      { q: "regulator", tags: [SCOPE], expected: 1 },
      { tags: [SCOPE, "smd"], expected: 4 },
      { tags: [SCOPE, "through_hole"], expected: 2 },
      { tags: [SCOPE, "connector", "tht"], expected: 2 },
    ];
    for (const { q, tags, expected } of cases) {
      const params: Record<string, string> = { tags: tags.join(","), limit: "200" };
      if (q) params.q = q;
      const page = await listPage(server, params);
      const facet = await facets(server, params);
      expect({ q, tags, total: page.total }).toEqual({ q, tags, total: expected });
      expect(page.components.length).toBe(expected);
      expect(facet.total).toBe(expected);
    }
  });

  test("whole catalog (core included when bundled): totals agree for QA's repro queries", async () => {
    const server = await bootWithSeed("library-filter-catalog");
    const cases: Array<Record<string, string>> = [
      {},
      { q: "passive" },
      { q: "R" },
      { q: "core" },
      { q: "local" },
      { tags: "smd" },
      { tags: "through_hole" },
      { tags: "ic,smd" },
      { tags: "source:openpcb.core,smd" },
    ];
    for (const params of cases) {
      const page = await listPage(server, { ...params, limit: "200" });
      const facet = await facets(server, params);
      expect({ params, total: page.total }).toEqual({ params, total: facet.total });
      expect(page.components.length).toBe(Math.min(page.total, 200));
    }
  });

  test("the exact name match is the first row", async () => {
    const server = await bootWithSeed("library-filter-rank");
    const page = await listPage(server, { q: "R", tags: SCOPE });
    expect(page.components[0]?.name).toBe("R");
  });

  test("offset paging walks the whole result set once, in a stable order", async () => {
    const server = await bootWithSeed("library-filter-paging");
    const all = await listPage(server, { tags: SCOPE, limit: "200" });
    const seen: string[] = [];
    for (let offset = 0; offset < all.total; offset += 2) {
      const page = await listPage(server, {
        tags: SCOPE,
        limit: "2",
        offset: String(offset),
      });
      expect(page).toMatchObject({ total: 5, offset, limit: 2 });
      seen.push(...page.components.map((c) => c.id));
    }
    expect(seen).toEqual(all.components.map((c) => c.id));
    expect(new Set(seen).size).toBe(5);
  });

  test("a negative offset is a 400 problem", async () => {
    const server = await bootWithSeed("library-filter-bad-offset");
    const res = await server.fetch(new Request(`${URL_BASE}/components?offset=-1`));
    expect(res.status).toBe(400);
  });
});
