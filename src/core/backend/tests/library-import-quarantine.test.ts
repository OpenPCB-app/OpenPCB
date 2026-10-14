import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import { commitKicadImport } from "../../../modules/library/backend/import/commit-kicad";
import { commitKicadZipImport } from "../../../modules/library/backend/import/commit-kicad-zip";
import { commitDrawnImport } from "../../../modules/library/backend/import/commit-drawn";
import { UnqualifiedImportError } from "../../../modules/library/backend/import/unqualified-import";
import { importOpclib } from "../../../modules/library/backend/sync/opclib-importer";
import { readOpclibFromBytes } from "../../../modules/library/backend/sync/opclib-reader";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import {
  drawnSymbol,
  externalPack,
  footprintFiles,
  kicadZip,
  symbolLibrary,
} from "./helpers/library-import-quarantine-fixtures";

// Quarantines are release-only flags; this suite asserts the fail-closed path.
const forcedFlags = ["OPENPCB_FEATURE_LIBRARY_FOOTPRINTINTAKEQUARANTINE"];
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

const root = mkdtempSync(join(os.tmpdir(), "openpcb-import-quarantine-"));
const previousDbPath = process.env.OPENPCB_DB_PATH;
let server: ReturnType<typeof createHttpServer>;
let ctx: CoreBackendModuleContext;
let symbolId: string;
let footprintId: string;
const component = { name: "Quarantine fixture", description: "" };

async function post(endpoint: string, body: unknown): Promise<Response> {
  return server.fetch(
    new Request(`http://localhost/api/modules/library/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function snapshot(): string {
  const sqlite = getSharedSqlite();
  const tables = sqlite
    .query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'library_%' ORDER BY name",
    )
    .all();
  return JSON.stringify(
    tables.map(({ name }) => [
      name,
      sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ]),
  );
}

function assets(): string[] {
  const path = join(root, "models");
  return existsSync(path)
    ? readdirSync(path, { recursive: true }).map(String).sort()
    : [];
}

async function assertRejected(
  response: Response,
  source: string,
  before: string,
) {
  expect(response.status).toBe(422);
  const problem = (await response.json()) as {
    code: string;
    source: string;
    blockedCapability: string;
    detail: string;
  };
  expect(problem.code).toBe("UNQUALIFIED_IMPORT");
  expect(problem.source).toBe(source);
  expect(problem.blockedCapability).toBe("footprint-import");
  expect(problem.detail).toContain("coordinate conversion is unqualified");
  expect(snapshot()).toBe(before);
  expect(assets()).toEqual([]);
}

beforeAll(async () => {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = join(root, "isolated.sqlite");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  ctx = (
    moduleRuntime as unknown as {
      loaded: Map<string, { context: CoreBackendModuleContext }>;
    }
  ).loaded.get("library")!.context;
  server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  const response = await post("imports/kicad/inspect", {
    symbolLibrary,
    footprints: footprintFiles,
  });
  expect(response.status).toBe(200);
  const data = (
    (await response.json()) as {
      data: { symbols: { id: string }[]; footprints: { id: string }[] };
    }
  ).data;
  symbolId = data.symbols[0]!.id;
  footprintId = data.footprints[0]!.id;
});

afterAll(() => {
  resetSharedSqliteForTesting();
  if (previousDbPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = previousDbPath;
  rmSync(root, { recursive: true, force: true });
});

function kicadRequest() {
  return {
    symbolLibrary,
    footprints: footprintFiles,
    selection: { symbolId, footprintId },
    component,
  };
}

test("direct KiCad endpoint rejects with zero DB/assets writes; preview remains read-only", async () => {
  const before = snapshot();
  await assertRejected(
    await post("imports/kicad", {
      ...kicadRequest(),
      provenance: { sourceKind: "drawn" },
    }),
    "kicad_mod",
    before,
  );
  expect(() => commitKicadImport(ctx, kicadRequest())).toThrow(
    UnqualifiedImportError,
  );
  expect(snapshot()).toBe(before);
});

test("drawn symbol plus KiCad footprint rejects import mode, including omitted imported payload", async () => {
  const before = snapshot();
  const body = {
    drawnSymbol,
    footprintMode: "import" as const,
    footprintFiles,
    footprintSelection: { footprintId },
    component,
  };
  await assertRejected(await post("imports/drawn", body), "kicad_mod", before);
  expect(() => commitDrawnImport(ctx, body)).toThrow(UnqualifiedImportError);
  await assertRejected(
    await post("imports/drawn", {
      ...body,
      footprintFiles: undefined,
      footprintSelection: undefined,
    }),
    "kicad_mod",
    before,
  );
});

test("ZIP with KiCad and STEP refuses before component, transaction or asset writes", async () => {
  const before = snapshot();
  const bytes = kicadZip();
  const form = new FormData();
  form.set(
    "file",
    new File([bytes], "fixture.zip", { type: "application/zip" }),
  );
  const response = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad/zip", {
      method: "POST",
      body: form,
    }),
  );
  await assertRejected(response, "kicad_zip", before);
  await expect(
    commitKicadZipImport(ctx, "fixture.zip", bytes),
  ).rejects.toBeInstanceOf(UnqualifiedImportError);
  expect(snapshot()).toBe(before);
  expect(assets()).toEqual([]);
});

for (const [label, provenance, classification] of [
  [
    "explicit KiCad",
    {
      source: "kicad-derived",
      sourceFormat: "kicad-mod",
      conversionTool: "CoreLibrary tools/import-kicad-batch.ts",
    },
    "kicad-derived",
  ],
  ["stripped markers", undefined, "unverified"],
  [
    "forged drawn/frame qualification",
    {
      sourceKind: "drawn",
      source: "openpcb-original",
      frameQualified: true,
      coordinateContract: "y-up",
    },
    "unverified",
  ],
] as const) {
  test(`external pack ${label}: reject before GLB/STEP/DB writes; markers cannot authorize`, async () => {
    const before = snapshot();
    const bytes = externalPack(provenance);
    const response = await server.fetch(
      new Request("http://localhost/api/modules/library/sources/install", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      }),
    );
    const copy = response.clone();
    await assertRejected(response, "opclib", before);
    const problem = (await copy.json()) as {
      affectedFootprints: {
        id: string;
        classification: string;
        markers: Record<string, { value: string }>;
      }[];
    };
    expect(problem.affectedFootprints[0]?.classification).toBe(classification);
    expect(problem.affectedFootprints[0]?.id).toBe("fixture.footprint.0");
    if (label === "explicit KiCad")
      expect(problem.affectedFootprints[0]?.markers.sourceFormat?.value).toBe(
        "kicad-mod",
      );
    await expect(
      importOpclib(ctx, readOpclibFromBytes(bytes), {
        installOrigin: "sync",
        requireSignature: false,
      }),
    ).rejects.toBeInstanceOf(UnqualifiedImportError);
    expect(snapshot()).toBe(before);
    expect(assets()).toEqual([]);
  });
}

test("pack diagnostics cap affected entries and marker lengths explicitly", async () => {
  const before = snapshot();
  try {
    await importOpclib(
      ctx,
      readOpclibFromBytes(externalPack({ source: "x".repeat(1000) }, 25)),
      { installOrigin: "bundled", requireSignature: false },
    );
    throw new Error("Expected quarantine");
  } catch (error) {
    expect(error).toBeInstanceOf(UnqualifiedImportError);
    const extras = (error as UnqualifiedImportError).extras as {
      affectedFootprintCount: number;
      omittedFootprintCount: number;
      affectedFootprints: {
        markers: Record<string, { value: string; truncated: boolean }>;
      }[];
    };
    expect(extras.affectedFootprintCount).toBe(25);
    expect(extras.omittedFootprintCount).toBe(5);
    expect(extras.affectedFootprints).toHaveLength(20);
    expect(extras.affectedFootprints[0]?.markers.source?.value.length).toBe(
      256,
    );
    expect(extras.affectedFootprints[0]?.markers.source?.truncated).toBe(true);
  }
  expect(snapshot()).toBe(before);
  expect(assets()).toEqual([]);
});

test("H02 required signatures and reserved source identities remain enforced", async () => {
  const before = snapshot();
  await expect(
    importOpclib(ctx, readOpclibFromBytes(externalPack(undefined)), {
      installOrigin: "manual-import",
      requireSignature: true,
    }),
  ).rejects.toThrow("signature verification failed");
  const response = await server.fetch(
    new Request("http://localhost/api/modules/library/sources/install", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: externalPack(undefined, 1, "openpcb.core"),
    }),
  );
  expect(response.status).toBe(409);
  expect(snapshot()).toBe(before);
  expect(assets()).toEqual([]);
});

test("symbol-only import ignores preview footprints; drawn symbol without footprint remains valid", async () => {
  expect(
    (
      await post("imports/kicad", {
        ...kicadRequest(),
        selection: { symbolId, footprintId: "" },
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await post("imports/drawn", {
        drawnSymbol,
        footprintMode: "none",
        component,
      })
    ).status,
  ).toBe(201);
});

test("symbol-only external packs remain installable and idempotent", async () => {
  const pkg = readOpclibFromBytes(externalPack(undefined, 0));
  const first = await importOpclib(ctx, pkg, {
    installOrigin: "manual-import",
    requireSignature: false,
  });
  expect(first.inserted.symbols).toBe(1);
  expect(first.inserted.footprints).toBe(0);
  const second = await importOpclib(ctx, pkg, {
    installOrigin: "sync",
    requireSignature: false,
  });
  expect(second.reimport).toBe(true);
  expect(second.updated.symbols).toBe(1);
  expect(assets()).toEqual([]);
});
