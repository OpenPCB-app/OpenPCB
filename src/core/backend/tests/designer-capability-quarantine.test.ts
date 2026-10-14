import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import type { DesignerSDK, LibrarySDK } from "../../../sdks";
import { registerExtendedReadTools } from "../../../modules/assistant/backend/tools/read-tools";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import * as designerStore from "../../../modules/designer/backend/store";
import { commitKicadProjectImport } from "../../../modules/designer/backend/import/kicad-project/commit";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

// Quarantines are release-only flags; this suite asserts the fail-closed path.
const forcedFlags = ["OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE", "OPENPCB_FEATURE_LIBRARY_FOOTPRINTINTAKEQUARANTINE"];
const previousFlags = forcedFlags.map((name) => process.env[name]);
beforeAll(() => {
  for (const name of forcedFlags) process.env[name] = "1";
});
afterAll(() => {
  forcedFlags.forEach((name, index) => {
    const previous = previousFlags[index];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
});

const root = mkdtempSync(join(tmpdir(), "openpcb-capability-quarantine-"));
const previousDbPath = process.env.OPENPCB_DB_PATH;
const previousAppData = process.env.APP_DATA_DIR;
const restore: (() => void)[] = [];
let projectionCalls = 0;
let lookupCalls = 0;
let importCalls = 0;
let writeCalls = 0;
let sdk: DesignerSDK;
let ctx: CoreBackendModuleContext;
let server: ReturnType<typeof createHttpServer>;

function snapshot(): string {
  const db = getSharedSqlite();
  const tables = db
    .query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all();
  const rows = tables.map(({ name }) => [
    name,
    db
      .query(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)
      .all(),
  ]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function assets(): string[] {
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => !name.startsWith("isolated.sqlite"))
    .sort();
}

function observeStoreCalls(): void {
  const createStore = designerStore.createDesignerStore;
  const factory = spyOn(
    designerStore,
    "createDesignerStore",
  ).mockImplementation((context) => {
    const store = createStore(context);
    const projection = spyOn(store, "getPcbProjection").mockImplementation(
      async () => {
        projectionCalls++;
        throw new Error("Projection must not run before capability refusal");
      },
    );
    restore.push(() => projection.mockRestore());
    const write = spyOn(store, "createDesign").mockImplementation(async () => {
      writeCalls++;
      throw new Error("Design writes must not run before capability refusal");
    });
    restore.push(() => write.mockRestore());
    return store;
  });
  restore.push(() => factory.mockRestore());
}

beforeAll(async () => {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = join(root, "isolated.sqlite");
  process.env.APP_DATA_DIR = root;
  observeStoreCalls();
  const moduleRegistry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: resolve(import.meta.dir, "../../.."),
  });
  await runtime.bootstrap();
  ctx = (
    runtime as unknown as {
      loaded: Map<string, { context: CoreBackendModuleContext }>;
    }
  ).loaded.get("designer")!.context;
  sdk = runtime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const library = runtime
    .getSdkRegistry()
    .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  const ingest = spyOn(library, "resolveComponentForPlacement").mockImplementation(
    async () => {
      importCalls++;
      throw new Error(
        "Library import must not run during quarantined project commit",
      );
    },
  );
  restore.push(() => ingest.mockRestore());
  server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime: runtime,
  });
});

afterAll(() => {
  for (const cleanup of restore.reverse()) cleanup();
  resetSharedSqliteForTesting();
  if (previousDbPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = previousDbPath;
  if (previousAppData === undefined) delete process.env.APP_DATA_DIR;
  else process.env.APP_DATA_DIR = previousAppData;
  rmSync(root, { recursive: true, force: true });
});

async function request(endpoint: string, method: string): Promise<Response> {
  return server.fetch(
    new Request(`http://localhost/api/modules/designer/${endpoint}`, {
      method,
      ...(method === "POST"
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              allowDrcViolations: true,
              includeInnerLayers: false,
              qualification: "override",
            }),
          }
        : {}),
    }),
  );
}

async function expectRefusal(
  response: Response,
  code: string,
  before: string,
): Promise<void> {
  expect(response.status).toBe(422);
  const problem = (await response.json()) as {
    code: string;
    blockers: string[];
  };
  expect(problem.code).toBe(code);
  expect(problem.blockers).toEqual([
    "electrical-identity",
    "source-frame",
    "output-completeness",
  ]);
  expect(projectionCalls).toBe(0);
  expect(importCalls).toBe(0);
  expect(writeCalls).toBe(0);
  expect(snapshot()).toBe(before);
  expect(assets()).toEqual([]);
}

for (const format of ["summary", "json", "zip"]) {
  test(`HTTP manufacturing ${format} refuses before lazy projection or writes`, async () => {
    const before = snapshot();
    await expectRefusal(
      await request(
        `designs/any-design/exports/gerber?format=${format}&override=true`,
        "POST",
      ),
      "UNQUALIFIED_MANUFACTURING",
      before,
    );
  });
}

test("HTTP PnP placement coordinates refuse before projection", async () => {
  await expectRefusal(
    await request("designs/any-design/exports/pnp.csv", "GET"),
    "UNQUALIFIED_MANUFACTURING",
    snapshot(),
  );
});

test("SDK manufacturing summary cannot bypass refusal with export options", async () => {
  const before = snapshot();
  let error: unknown;
  try {
    await sdk.getManufacturingExportSummary("any-design", {
      includeInnerLayers: false,
    });
  } catch (failure) {
    error = failure;
  }
  expect(error).toMatchObject({
    status: 422,
    extras: { code: "UNQUALIFIED_MANUFACTURING" },
  });
  expect(projectionCalls).toBe(0);
  expect(importCalls).toBe(0);
  expect(writeCalls).toBe(0);
  expect(snapshot()).toBe(before);
});

test("HTTP project commit refuses without parsing, Library ingestion or asset publication", async () => {
  await expectRefusal(
    await request("imports/kicad-project", "POST"),
    "UNQUALIFIED_IMPORT",
    snapshot(),
  );
});

test("SDK and direct project commits refuse before inspect lookup or stores", async () => {
  const before = snapshot();
  for (const commit of [
    () =>
      sdk.commitKicadProject({
        archiveFileName: "untrusted.zip",
        archiveBytes: new Uint8Array(),
      }),
    () =>
      commitKicadProjectImport(ctx, {
        archiveFileName: "untrusted.zip",
        archiveBytes: new Uint8Array(),
        libraryComponentLookup: async () => {
          lookupCalls++;
          return null;
        },
      }),
  ]) {
    let error: unknown;
    try {
      await commit();
    } catch (failure) {
      error = failure;
    }
    expect(error).toMatchObject({
      status: 422,
      extras: { code: "UNQUALIFIED_IMPORT" },
    });
  }
  expect(lookupCalls).toBe(0);
  expect(importCalls).toBe(0);
  expect(writeCalls).toBe(0);
  expect(snapshot()).toBe(before);
  expect(assets()).toEqual([]);
});

test("MCP manufacturing tool returns refusal from real Designer SDK without projection or writes", async () => {
  type Tool = {
    definition: { name: string };
    execute(
      context: unknown,
      args: unknown,
    ): Promise<{ ok: boolean; warnings: string[] }>;
  };
  const tools: Tool[] = [];
  registerExtendedReadTools(
    { register: (tool: Tool) => tools.push(tool) } as never,
    ctx,
  );
  const tool = tools.find(
    (item) => item.definition.name === "designer_export_manufacturing",
  );
  expect(tool).toBeDefined();
  const before = snapshot();
  const result = await tool!.execute(
    { limits: {} },
    { designId: "any-design", includeInnerLayers: false },
  );
  expect(result.ok).toBe(false);
  expect(result.warnings[0]).toContain("Manufacturing exports are unavailable");
  expect(projectionCalls).toBe(0);
  expect(importCalls).toBe(0);
  expect(writeCalls).toBe(0);
  expect(snapshot()).toBe(before);
});
