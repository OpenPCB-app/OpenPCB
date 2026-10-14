import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_FAMILIES,
  generateFootprint,
} from "../../../shared/rendering/ipc7351b";
import type { SymbolRenderSource } from "../../../shared/rendering/types";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { getKicadFixturePath } from "./helpers/kicad-fixtures";

let server: ReturnType<typeof createHttpServer>;
let symbolId: string;
const previousDbPath = process.env.OPENPCB_DB_PATH;
const symbolLibrary = {
  fileName: "simple_capacitor.kicad_sym",
  content: readFileSync(
    getKicadFixturePath("simple_capacitor.kicad_sym"),
    "utf8",
  ),
};
const drawnSymbol: { source: SymbolRenderSource; referencePrefix: string } = {
  referencePrefix: "C",
  source: {
    name: "Drawn C",
    unitCount: 1,
    referenceText: "C",
    valueText: "C",
    pins: ["1", "2"].map((number, index) => ({
      id: number,
      name: number,
      number,
      electricalType: "passive",
      positionMm: { x: index, y: 0 },
      lengthMm: 1,
      rotationDeg: 0,
      unit: 1,
      hidden: false,
    })),
    graphics: [],
    warnings: [],
  },
};

async function post(endpoint: string, body: unknown): Promise<Response> {
  return server.fetch(
    new Request(`http://localhost/api/modules/library/imports/${endpoint}`, {
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

function request(endpoint: string, generatedFootprint: unknown) {
  const component = { name: "Quarantine fixture", description: "" };
  return endpoint === "generated"
    ? { symbolLibrary, selection: { symbolId }, generatedFootprint, component }
    : {
        drawnSymbol,
        footprintMode: "generated",
        generatedFootprint,
        component,
      };
}

beforeAll(async () => {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = ":memory:";
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  const response = await post("kicad/inspect", {
    symbolLibrary,
    footprints: [],
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    data: { symbols: { id: string }[] };
  };
  const symbol = payload.data.symbols[0];
  if (!symbol) throw new Error("Imported fixture has no symbol");
  symbolId = symbol.id;
});

afterAll(() => {
  resetSharedSqliteForTesting();
  if (previousDbPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = previousDbPath;
});

for (const endpoint of ["generated", "drawn"]) {
  test(`${endpoint}: every quarantined size/density returns actionable 422 with no library writes`, async () => {
    const before = snapshot();
    for (const family of ALL_FAMILIES.filter((family) =>
      ["sot", "qfn"].includes(family.id),
    )) {
      for (const size of family.sizes) {
        for (const density of ["most", "nominal", "least"] as const) {
          const generatedFootprint = {
            generator: {
              kind: "ipc7351b",
              family: family.id,
              size: size.label,
              density,
            },
          };
          const response = await post(
            endpoint,
            request(endpoint, generatedFootprint),
          );
          expect(response.status).toBe(422);
          const problem = (await response.json()) as {
            type: string;
            detail: string;
            code: string;
          };
          expect(problem.type).toBe(
            "https://openpcb.dev/problems/unqualified-generator",
          );
          expect(problem.code).toBe("UNQUALIFIED_GENERATOR");
          expect(problem.detail).toContain(
            "Import a verified footprint or draw one",
          );
          expect(snapshot()).toBe(before);
        }
      }
    }
  });

  test(`${endpoint}: raw generated requests and mismatched previews cannot reach persistence`, async () => {
    const preview = generateFootprint("chip", "0603", "nominal");
    const before = snapshot();
    for (const payload of [
      { source: preview.source, metadata: preview.metadata },
      {
        generator: {
          kind: "ipc7351b",
          family: "chip",
          size: "0603",
          density: "least",
        },
        source: preview.source,
        metadata: preview.metadata,
      },
      {
        generator: {
          kind: "ipc7351b",
          family: "chip",
          size: "0603",
          density: "nominal",
        },
        source: { ...preview.source, name: "spoofed SOT-23" },
        metadata: preview.metadata,
      },
    ]) {
      expect((await post(endpoint, request(endpoint, payload))).status).toBe(
        422,
      );
      expect(snapshot()).toBe(before);
    }
  });

  test(`${endpoint}: allowed tuple persists exact server geometry and generator provenance`, async () => {
    const generator = {
      kind: "ipc7351b",
      family: "chip",
      size: "0603",
      density: "least",
    };
    const preview = generateFootprint("chip", "0603", "least");
    const response = await post(
      endpoint,
      request(endpoint, {
        generator,
        source: preview.source,
        metadata: preview.metadata,
      }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      data: { componentId: string };
    };
    const row = getSharedSqlite()
      .query<{ data_json: string }, [string]>(
        "SELECT f.data_json FROM library_footprints f JOIN library_components c ON c.footprint_id=f.id WHERE c.id=?",
      )
      .get(payload.data.componentId)!;
    const data = JSON.parse(row.data_json);
    expect(data.raw.source).toEqual(preview.source);
    expect(data.normalized.name).toBe(preview.metadata.name);
    expect(data.provenance.generator).toEqual(generator);
    expect(data.provenance.generatorPackage.name).toBe(
      "@openpcb/rendering-core",
    );
    expect(data.provenance.presetParameters).toEqual(
      ALL_FAMILIES[0].sizes.find((size) => size.label === "0603")!.params,
    );
  });
}

test("provenance='drawn' cannot bypass generated endpoint validation", async () => {
  const preview = generateFootprint("sot", "SOT-23", "nominal");
  const before = snapshot();
  const response = await post("generated", {
    ...request("generated", {
      source: preview.source,
      metadata: preview.metadata,
    }),
    footprintProvenance: "drawn",
  });
  expect(response.status).toBe(422);
  expect(snapshot()).toBe(before);
});

test("explicit editor payload preserves imported-symbol and drawn-symbol workflows without name heuristics", async () => {
  const preview = generateFootprint("chip", "0603", "nominal");
  const drawnFootprint = {
    source: { ...preview.source, name: "User drawn SOT-23" },
    metadata: {
      ...preview.metadata,
      name: "User drawn SOT-23",
      tags: ["drawn-footprint"],
    },
  };
  for (const endpoint of ["generated", "drawn"]) {
    const body =
      endpoint === "generated"
        ? {
            symbolLibrary,
            selection: { symbolId },
            drawnFootprint,
            component: { name: "Drawn SOT fixture", description: "" },
          }
        : {
            drawnSymbol,
            footprintMode: "drawn",
            drawnFootprint,
            component: { name: "Drawn SOT fixture", description: "" },
          };
    const response = await post(endpoint, body);
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      data: { componentId: string };
    };
    const row = getSharedSqlite()
      .query<{ data_json: string }, [string]>(
        "SELECT f.data_json FROM library_footprints f JOIN library_components c ON c.footprint_id=f.id WHERE c.id=?",
      )
      .get(payload.data.componentId)!;
    const data = JSON.parse(row.data_json);
    expect(data.provenance.sourceKind).toBe("drawn");
    expect(data.provenance.generator).toBeUndefined();
    expect(data.raw.source).toEqual(drawnFootprint.source);
  }
});

test("drawn mode cannot relabel a generated payload or silently substitute a placeholder", async () => {
  const before = snapshot();
  for (const generatedFootprint of [
    undefined,
    generateFootprint("sot", "SOT-23", "nominal"),
  ]) {
    const response = await post("drawn", {
      drawnSymbol,
      footprintMode: "drawn",
      generatedFootprint,
      component: { name: "Invalid drawn fixture", description: "" },
    });
    expect(response.status).toBe(422);
    expect(snapshot()).toBe(before);
  }
});
