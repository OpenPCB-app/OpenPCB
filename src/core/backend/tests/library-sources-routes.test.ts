import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { packOpclib } from "@openpcb/opclib-pack";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import {
  createHttpServer,
  type RuntimeServer,
} from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { getDb } from "../../../modules/library/backend/queries";
import { components } from "../../../modules/library/backend/schema";

const tempRoots: string[] = [];

async function bootHarness(label: string): Promise<RuntimeServer> {
  const { server } = await bootHarnessWithRuntime(label);
  return server;
}

async function bootHarnessWithRuntime(
  label: string,
): Promise<{ server: RuntimeServer; runtime: ModuleRuntime }> {
  resetSharedSqliteForTesting();
  const root = mkdtempSync(path.join(os.tmpdir(), `openpcb-${label}-`));
  tempRoots.push(root);
  process.env.OPENPCB_DB_PATH = path.join(root, "openpcb.sqlite");

  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  return {
    server: createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
    }),
    runtime: moduleRuntime,
  };
}

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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildOpclibBytes(
  opts: {
    sourceId?: string;
    version?: string;
    /** Manifest `library.kind`; null omits the field (the schema makes it optional). */
    kind?: "core" | "user" | "team" | null;
    sign?: {
      privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
      keyId: string;
    };
  } = {},
): Uint8Array {
  const symBytes = new TextEncoder().encode('{"id":"test.sym.x"}');
  const fpBytes = new TextEncoder().encode('{"id":"test.fp.x"}');
  const compBytes = new TextEncoder().encode('{"id":"test.comp.x"}');
  return packOpclib({
    library: {
      id: opts.sourceId ?? "test.userlib",
      name: "Test User Library",
      ...(opts.kind === null ? {} : { kind: opts.kind ?? "user" }),
      channel: "stable",
      version: opts.version ?? "0.1.0",
      license: "MIT",
      generatedAt: "2026-05-22T00:00:00.000Z",
    },
    symbols: [
      {
        entry: {
          id: "test.sym.x",
          uuid: "00000000-0000-0000-0000-000000000001",
          version: "1.0.0",
          name: "X",
          path: "symbols/x.symbol.json",
          sha256: sha256(symBytes),
        },
        bytes: symBytes,
      },
    ],
    footprints: [
      {
        entry: {
          id: "test.fp.x",
          uuid: "00000000-0000-0000-0000-000000000002",
          version: "1.0.0",
          name: "X",
          path: "footprints/x.fp.json",
          sha256: sha256(fpBytes),
        },
        bytes: fpBytes,
      },
    ],
    models3d: [],
    components: [
      {
        entry: {
          id: "test.comp.x",
          uuid: "00000000-0000-0000-0000-000000000010",
          version: "1.0.0",
          name: "X",
          category: "passive",
          symbol: "test.sym.x",
          defaultFootprint: "test.fp.x",
          footprints: [{ footprint: "test.fp.x", label: "default" }],
          provenance: { source: "openpcb-original", license: "MIT" },
        },
        path: "components/x.component.json",
        bytes: compBytes,
      },
    ],
    sign: opts.sign,
  }).bytes;
}

const URL_BASE = "http://localhost/api/modules/library";

describe("library sources routes", () => {
  test("GET /sources lists bundled core after bootstrap", async () => {
    const server = await bootHarness("sources-list");
    const res = await server.fetch(new Request(`${URL_BASE}/sources`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        sources: Array<{ id: string; kind: string; componentCount: number }>;
      };
    };
    const ids = body.data.sources.map((s) => s.id).sort();
    expect(ids).toContain("openpcb.core");
    expect(ids).toContain("user.local");
  });

  test("POST /sources/install with raw .opclib bytes installs a user source", async () => {
    const server = await bootHarness("sources-install-file");
    const bytes = buildOpclibBytes({
      sourceId: "test.userlib",
      version: "0.1.0",
    });

    const res = await server.fetch(
      new Request(`${URL_BASE}/sources/install`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      }),
    );
    expect(res.status).toBe(201);

    const list = await server.fetch(new Request(`${URL_BASE}/sources`));
    const body = (await list.json()) as {
      data: { sources: Array<{ id: string; latestVersion: string | null }> };
    };
    const entry = body.data.sources.find((s) => s.id === "test.userlib");
    expect(entry).toBeDefined();
    expect(entry!.latestVersion).toBe("0.1.0");
  });

  test("GET /sources counts legacy local components with null source as user.local", async () => {
    const { server, runtime } = await bootHarnessWithRuntime(
      "sources-local-legacy-count",
    );
    const ctx = (runtime as unknown as { loaded: Map<string, { context: unknown }> })
      .loaded.get("library")!.context as Parameters<typeof getDb>[0];
    getDb(ctx)
      .insert(components)
      .values({
        id: "legacy.local.component",
        name: "Legacy Local Component",
        description: "Legacy imported component without source id",
        symbolId: "legacy.symbol",
        footprintId: "legacy.footprint",
        tagsJson: JSON.stringify(["user"]),
        createdAt: new Date().toISOString(),
        isBuiltin: 0,
        sourceId: null,
      })
      .run();

    const list = await server.fetch(new Request(`${URL_BASE}/sources`));
    const body = (await list.json()) as {
      data: { sources: Array<{ id: string; componentCount: number }> };
    };
    const local = body.data.sources.find((s) => s.id === "user.local");
    expect(local).toBeDefined();
    expect(local!.componentCount).toBe(1);
  });

  test("POST /sources/install rejects URL with disallowed host", async () => {
    const server = await bootHarness("sources-install-url-deny");
    const res = await server.fetch(
      new Request(`${URL_BASE}/sources/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://evil.example.com/lib.opclib" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail?: string };
    expect(body.detail ?? "").toMatch(/allowlist/);
  });

  test("DELETE /sources/:id blocks deletion of core source", async () => {
    const server = await bootHarness("sources-delete-core");
    const res = await server.fetch(
      new Request(`${URL_BASE}/sources/openpcb.core`, { method: "DELETE" }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { detail?: string; type?: string };
    expect(body.detail ?? "").toMatch(/cannot delete core source/);
    expect(body.type).toBe("https://openpcb.dev/problems/library-source-protected");
  });

  test("DELETE /sources/user.local is refused and the local parts survive", async () => {
    const { server, runtime } = await bootHarnessWithRuntime("sources-delete-local");
    const ctx = (runtime as unknown as { loaded: Map<string, { context: unknown }> })
      .loaded.get("library")!.context as Parameters<typeof getDb>[0];
    getDb(ctx)
      .insert(components)
      .values({
        id: "local.keep.me",
        name: "Keep Me",
        description: "",
        symbolId: "local.symbol",
        footprintId: "local.footprint",
        tagsJson: "[]",
        createdAt: new Date().toISOString(),
        isBuiltin: 0,
        sourceId: "user.local",
      })
      .run();

    const res = await server.fetch(
      new Request(`${URL_BASE}/sources/user.local`, { method: "DELETE" }),
    );
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type") ?? "").toContain("application/problem+json");

    const list = await server.fetch(new Request(`${URL_BASE}/sources`));
    const body = (await list.json()) as {
      data: {
        sources: Array<{ id: string; componentCount: number; isRemovable: boolean }>;
      };
    };
    const local = body.data.sources.find((s) => s.id === "user.local");
    expect(local?.componentCount).toBe(1);
    expect(local?.isRemovable).toBe(false);
  });

  test("an .opclib without library.kind installs as a removable team source", async () => {
    const server = await bootHarness("sources-install-nokind");
    const install = await server.fetch(
      new Request(`${URL_BASE}/sources/install`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: buildOpclibBytes({ sourceId: "qa.nokind", kind: null }),
      }),
    );
    expect(install.status).toBe(201);

    const list = await server.fetch(new Request(`${URL_BASE}/sources`));
    const body = (await list.json()) as {
      data: {
        sources: Array<{ id: string; kind: string; isReadOnly: boolean; isRemovable: boolean }>;
      };
    };
    const entry = body.data.sources.find((s) => s.id === "qa.nokind");
    expect(entry).toMatchObject({ kind: "team", isReadOnly: false, isRemovable: true });

    const del = await server.fetch(
      new Request(`${URL_BASE}/sources/qa.nokind`, { method: "DELETE" }),
    );
    expect(del.status).toBe(200);
  });

  test("an .opclib declaring kind core under a foreign id is not core", async () => {
    const server = await bootHarness("sources-install-spoofed-core");
    await server.fetch(
      new Request(`${URL_BASE}/sources/install`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: buildOpclibBytes({ sourceId: "qa.fakecore", kind: "core" }),
      }),
    );
    const list = await server.fetch(new Request(`${URL_BASE}/sources`));
    const body = (await list.json()) as {
      data: { sources: Array<{ id: string; kind: string; isReadOnly: boolean }> };
    };
    const entry = body.data.sources.find((s) => s.id === "qa.fakecore");
    expect(entry).toMatchObject({ kind: "team", isReadOnly: false });
  });

  test("POST /sources/install refuses the reserved core and local ids", async () => {
    const server = await bootHarness("sources-install-reserved");
    for (const sourceId of ["openpcb.core", "user.local"]) {
      const res = await server.fetch(
        new Request(`${URL_BASE}/sources/install`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: buildOpclibBytes({ sourceId }),
        }),
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { type?: string };
      expect(body.type).toBe("https://openpcb.dev/problems/library-source-reserved");
    }
  });

  test("DELETE /sources/:id removes installed user source", async () => {
    const server = await bootHarness("sources-delete-user");
    const bytes = buildOpclibBytes({
      sourceId: "test.userlib",
      version: "0.1.0",
    });
    await server.fetch(
      new Request(`${URL_BASE}/sources/install`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      }),
    );
    const del = await server.fetch(
      new Request(`${URL_BASE}/sources/test.userlib`, { method: "DELETE" }),
    );
    expect(del.status).toBe(200);
    const list = await server.fetch(new Request(`${URL_BASE}/sources`));
    const body = (await list.json()) as {
      data: { sources: Array<{ id: string }> };
    };
    expect(body.data.sources.map((s) => s.id)).not.toContain("test.userlib");
  });
});

describe("library migration 0011_untrusted_core_sources", () => {
  test("demotes every non-bundled core source to a removable team source", async () => {
    const { Database } = await import("bun:sqlite");
    const { readFileSync } = await import("node:fs");
    const db = new Database(":memory:");
    db.run(
      "CREATE TABLE library_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, license TEXT, homepage TEXT, is_read_only INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
    );
    const insert = db.prepare(
      "INSERT INTO library_sources (id, name, kind, is_read_only, created_at) VALUES (?, ?, ?, ?, '2026-01-01')",
    );
    insert.run("openpcb.core", "OpenPCB Core", "core", 1);
    insert.run("qa.nokind", "No Kind", "core", 1);
    insert.run("user.local", "Local Library", "user", 0);

    db.run(
      readFileSync(
        path.resolve(
          import.meta.dir,
          "../../../modules/library/backend/migrations/0011_untrusted_core_sources.sql",
        ),
        "utf8",
      ),
    );

    const rows = db
      .query("SELECT id, kind, is_read_only AS ro FROM library_sources ORDER BY id")
      .all();
    expect(rows).toEqual([
      { id: "openpcb.core", kind: "core", ro: 1 },
      { id: "qa.nokind", kind: "team", ro: 0 },
      { id: "user.local", kind: "user", ro: 0 },
    ]);
  });
});
