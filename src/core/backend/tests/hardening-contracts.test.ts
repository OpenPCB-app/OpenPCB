import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDb } from "../../../modules/library/backend/queries";
import { components, sources } from "../../../modules/library/backend/schema";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const originalDbPath = process.env.OPENPCB_DB_PATH;
const temporaryRoots: string[] = [];
const baseUrl = "http://localhost/api/modules/library";
type LibraryContext = Parameters<typeof getDb>[0];

afterEach(async () => {
  resetSharedSqliteForTesting();
  if (originalDbPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = originalDbPath;
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function bootProtectedSourceFixture() {
  resetSharedSqliteForTesting();
  const root = mkdtempSync(path.join(os.tmpdir(), "openpcb-h48-contracts-"));
  temporaryRoots.push(root);
  process.env.OPENPCB_DB_PATH = path.join(root, "openpcb.sqlite");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  const loaded = (
    moduleRuntime as unknown as {
      loaded: Map<string, { context: LibraryContext }>;
    }
  ).loaded;
  const context = loaded.get("library")!.context;
  seedProtectedSources(context);
  return createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
}

function seedProtectedSources(context: LibraryContext): void {
  const db = getDb(context);
  const createdAt = new Date().toISOString();
  for (const id of ["openpcb.core", "user.local"]) {
    // The guard contract must be testable even when bundled-library bootstrap fails.
    db.insert(sources)
      .values({
        id,
        name: id,
        kind: id === "openpcb.core" ? "core" : "user",
        isReadOnly: id === "openpcb.core" ? 1 : 0,
        createdAt,
      })
      .onConflictDoNothing()
      .run();
    db.insert(components)
      .values({
        id: `h48.${id}`,
        name: `H48 ${id}`,
        description: "",
        symbolId: `h48.symbol.${id}`,
        footprintId: `h48.footprint.${id}`,
        tagsJson: "[]",
        isBuiltin: id === "openpcb.core" ? 1 : 0,
        sourceId: id,
        createdAt,
      })
      .run();
  }
}

test("Wave-A source metadata and protected DELETE agree without a bundled-library dependency", async () => {
  const server = await bootProtectedSourceFixture();
  const list = await server.fetch(new Request(`${baseUrl}/sources`));
  expect(list.status).toBe(200);
  const before = (await list.json()) as {
    data: {
      sources: Array<{
        id: string;
        isRemovable: boolean;
        componentCount: number;
      }>;
    };
  };
  for (const sourceId of ["openpcb.core", "user.local"]) {
    const source = before.data.sources.find((row) => row.id === sourceId);
    expect(source).toBeDefined();
    expect(source!.isRemovable).toBe(false);
    expect(source!.componentCount).toBeGreaterThanOrEqual(1);
    const response = await server.fetch(
      new Request(`${baseUrl}/sources/${sourceId}`, {
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    const problem = (await response.json()) as {
      type: string;
      sourceId: string;
    };
    expect(problem.type).toBe(
      "https://openpcb.dev/problems/library-source-protected",
    );
    expect(problem.sourceId).toBe(sourceId);
  }
  const remaining = await server.fetch(new Request(`${baseUrl}/sources`));
  expect(await remaining.json()).toEqual(before);
});
