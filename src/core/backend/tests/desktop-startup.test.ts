import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DesktopModuleStartupError,
  failDesktopStartup,
  startRequiredDesktopRuntime,
} from "../../../../electron/src/main/backend-startup";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import type { StartedBackendRuntime } from "../runtime";

const previousDbPath = process.env.OPENPCB_DB_PATH;
const previousNodeEnv = process.env.NODE_ENV;
const moduleIds = ["library", "designer", "assistant"];
const staticModules = new Map(
  moduleIds.map((id) => [id, { definition: { id } }]),
);
const payload =
  '{"schemaVersion":99,"future":{"nested":{"preserve":["unknown",42]}}}';
let root: string;
let workspace: string;
let dbPath: string;

function createModuleFiles(): void {
  for (const id of moduleIds) {
    const moduleDir = join(workspace, "modules", id);
    mkdirSync(join(moduleDir, "backend", "migrations"), { recursive: true });
    writeFileSync(
      join(moduleDir, "manifest.json"),
      JSON.stringify({
        id,
        label: id,
        version: "1.0.0",
        apiVersion: 2,
        namespace: `space.${id}`,
        kind: "space",
        dependsOn: [],
        sidebar: { label: id, icon: "Box", order: 10 },
      }),
    );
  }
}

async function bootstrapModules(): Promise<StartedBackendRuntime> {
  const moduleRuntime = new ModuleRuntime({
    workspaceRoot: workspace,
    moduleRegistry: new ModuleRouterRegistry(),
    staticModules,
  });
  await moduleRuntime.bootstrap();
  // Exercise real module loading/migration without starting a listening HTTP server.
  return {
    host: "127.0.0.1",
    port: 0,
    url: "http://127.0.0.1:0",
    snapshot: moduleRuntime.snapshot(),
    close: async () => {},
  };
}

function rowDigest(): string {
  const rows = getSharedSqlite()
    .query("SELECT * FROM preserved_user_data ORDER BY id")
    .all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function databaseFiles(): Record<string, string> {
  return Object.fromEntries(
    [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((path) => {
      expect(existsSync(path)).toBe(true);
      return [
        path,
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      ];
    }),
  );
}

beforeEach(async () => {
  resetSharedSqliteForTesting();
  root = mkdtempSync(join(tmpdir(), "openpcb-desktop-startup-"));
  workspace = join(root, "src");
  dbPath = join(root, "sentinel.sqlite");
  process.env.OPENPCB_DB_PATH = dbPath;
  createModuleFiles();
  await bootstrapModules();
  const sqlite = getSharedSqlite();
  sqlite.exec(
    "CREATE TABLE preserved_user_data(id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
  );
  sqlite
    .query("INSERT INTO preserved_user_data VALUES (?, ?)")
    .run("stable-user-id", payload);
});

afterEach(() => {
  resetSharedSqliteForTesting();
  if (previousDbPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = previousDbPath;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  rmSync(root, { recursive: true, force: true });
});

describe("desktop startup retains user data", () => {
  for (const environment of ["production", "development"]) {
    test(`${environment} failed migration reports required module failure without reset/retry`, async () => {
      process.env.NODE_ENV = environment;
      writeFileSync(
        join(workspace, "modules/library/backend/migrations/0000_fail.sql"),
        "UPDATE preserved_user_data SET payload = 'partial';\n--> statement-breakpoint\nINSERT INTO deliberately_missing_table VALUES (1);",
      );
      const beforeRows = rowDigest();
      const beforeFiles = databaseFiles();
      let starts = 0;
      let closes = 0;
      let failure: unknown;
      try {
        await startRequiredDesktopRuntime({
          start: async () => {
            starts++;
            return bootstrapModules();
          },
          close: async () => {
            closes++;
          },
          logSnapshot: () => {},
          reportCleanupFailure: () => {},
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(DesktopModuleStartupError);
      expect((failure as DesktopModuleStartupError).recoverable).toBe(true);
      expect((failure as DesktopModuleStartupError).code).toBe(
        "DESKTOP_REQUIRED_MODULES_FAILED",
      );
      expect((failure as DesktopModuleStartupError).missingModules).toEqual([
        "library",
      ]);
      expect((failure as Error).message).toContain(
        "deliberately_missing_table",
      );
      expect(starts).toBe(1);
      expect(closes).toBe(1);
      expect(rowDigest()).toBe(beforeRows);
      expect(databaseFiles()).toEqual(beforeFiles);
      expect(
        getSharedSqlite()
          .query<{ payload: string }>("SELECT payload FROM preserved_user_data")
          .get()?.payload,
      ).toBe(payload);
    });
  }

  test("healthy required modules return the same runtime with one attempt and no cleanup", async () => {
    const started = await bootstrapModules();
    let starts = 0;
    let closes = 0;
    const result = await startRequiredDesktopRuntime({
      start: async () => {
        starts++;
        return started;
      },
      close: async () => {
        closes++;
      },
      logSnapshot: () => {},
      reportCleanupFailure: () => {},
    });
    expect(result).toBe(started);
    expect(starts).toBe(1);
    expect(closes).toBe(0);
  });

  test("publication failure awaits runtime close before rethrowing original cause despite logging failure", async () => {
    let active = (await startRequiredDesktopRuntime({
      start: bootstrapModules,
      close: async () => {},
      logSnapshot: () => {},
      reportCleanupFailure: () => {},
    })) as StartedBackendRuntime | null;
    const publicationError = new Error("backend-ready publication failed");
    let closed = false;
    let failure: unknown;
    try {
      await failDesktopStartup(publicationError, {
        close: async () => {
          const current = active;
          active = null;
          await current?.close();
          await Promise.resolve();
          closed = true;
        },
        reportCleanupFailure: () => {},
        reportFailure: (error) => {
          expect(error).toBe(publicationError);
          expect(closed).toBe(true);
          throw new Error("diagnostic unavailable");
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(active).toBeNull();
    expect(closed).toBe(true);
    expect(failure).toBe(publicationError);
  });

  for (const diagnosticThrows of [false, true]) {
    test(`cleanup failure preserves startup cause when diagnostic throws=${diagnosticThrows}`, async () => {
      const startupError = new Error("original startup failure");
      const cleanupError = new Error("cleanup failed");
      const originalStack = startupError.stack;
      const reported: unknown[] = [];
      let starts = 0;
      let closes = 0;
      let failure: unknown;
      try {
        await startRequiredDesktopRuntime({
          start: async () => {
            starts++;
            throw startupError;
          },
          close: async () => {
            closes++;
            throw cleanupError;
          },
          logSnapshot: () => {},
          reportCleanupFailure: (error) => {
            reported.push(error);
            if (diagnosticThrows) throw new Error("diagnostic failed");
          },
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBe(startupError);
      expect((failure as Error).stack).toBe(originalStack);
      expect(reported).toEqual([cleanupError]);
      expect(starts).toBe(1);
      expect(closes).toBe(1);
      expect(
        getSharedSqlite()
          .query<{ payload: string }>("SELECT payload FROM preserved_user_data")
          .get()?.payload,
      ).toBe(payload);
    });
  }
});
