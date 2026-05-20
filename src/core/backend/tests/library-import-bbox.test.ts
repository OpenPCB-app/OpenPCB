import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { getKicadFixtureDir } from "./helpers/kicad-fixtures";

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createServer(label: string) {
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

async function importFixture(
  server: ReturnType<typeof createHttpServer>,
  input: { symbolFileName: string; footprintFileName: string; componentName: string },
): Promise<string> {
  const fixtureDir = getKicadFixtureDir();
  const symbolPath = path.resolve(fixtureDir, input.symbolFileName);
  const footprintPath = path.resolve(fixtureDir, input.footprintFileName);
  const symbolContent = await Bun.file(symbolPath).text();
  const footprintContent = await Bun.file(footprintPath).text();

  const inspect = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbolLibrary: { fileName: input.symbolFileName, content: symbolContent },
        footprints: [
          {
            fileName: input.footprintFileName,
            content: footprintContent,
          },
        ],
      }),
    }),
  );
  expect(inspect.status).toBe(200);
  const inspectBody = (await inspect.json()) as {
    data?: {
      symbols?: Array<{ id: string }>;
      footprints?: Array<{ id: string }>;
    };
  };
  const symbolId = inspectBody.data?.symbols?.[0]?.id;
  const footprintId = inspectBody.data?.footprints?.[0]?.id;
  if (!symbolId || !footprintId) throw new Error("inspect missing ids");

  const commit = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbolLibrary: { fileName: input.symbolFileName, content: symbolContent },
        footprints: [
          {
            fileName: input.footprintFileName,
            content: footprintContent,
          },
        ],
        selection: { symbolId, footprintId },
        component: { name: input.componentName, description: "" },
      }),
    }),
  );
  expect(commit.status).toBe(201);
  const commitBody = (await commit.json()) as { data?: { componentId?: string } };
  const componentId = commitBody.data?.componentId;
  if (!componentId) throw new Error("commit missing componentId");
  return componentId;
}

interface ImportPreview {
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  pads: Array<{
    centerMm: { x: number; y: number };
    widthMm: number;
    heightMm: number;
    rotationDeg: number;
  }>;
}

async function fetchPreview(
  server: ReturnType<typeof createHttpServer>,
  componentId: string,
): Promise<ImportPreview> {
  const res = await server.fetch(
    new Request(
      `http://localhost/api/modules/library/components/${componentId}/detail`,
    ),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: {
      detail: {
        footprint: { preview: ImportPreview };
      };
    };
  };
  return body.data.detail.footprint.preview;
}

function padHalfExtents(pad: ImportPreview["pads"][number]) {
  const halfW = Math.abs(pad.widthMm) / 2;
  const halfH = Math.abs(pad.heightMm) / 2;
  const r = (pad.rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return {
    halfX: cos * halfW + sin * halfH,
    halfY: sin * halfW + cos * halfH,
  };
}

interface Fixture {
  symbolFileName: string;
  footprintFileName: string;
  componentName: string;
  nameHint: string;
  // Expected real geometry max (mm). Pads cluster + some silk slack.
  expectedMaxAbsXMm: number;
  expectedMaxAbsYMm: number;
}

const FIXTURES: Fixture[] = [
  {
    symbolFileName: "simple_capacitor.kicad_sym",
    footprintFileName: "C_0603_1608Metric.kicad_mod",
    componentName: "BBox: C_0603_1608Metric",
    nameHint: "C_0603_1608Metric",
    expectedMaxAbsXMm: 2.0,
    expectedMaxAbsYMm: 1.1,
  },
  {
    symbolFileName: "simple_capacitor.kicad_sym",
    footprintFileName: "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder.kicad_mod",
    componentName: "BBox: C_0603_HandSolder",
    nameHint: "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder",
    expectedMaxAbsXMm: 2.2,
    expectedMaxAbsYMm: 1.1,
  },
  {
    symbolFileName: "simple_capacitor.kicad_sym",
    footprintFileName: "CP_Elec_6.3x5.4_Nichicon.kicad_mod",
    componentName: "BBox: CP_Elec_6.3x5.4_Nichicon",
    nameHint: "CP_Elec_6.3x5.4_Nichicon",
    // Courtyard reaches ±4.7mm X and ±3.55mm Y. Keep Y below the
    // Reference/Value text anchors at ±4.35mm so text anchors cannot inflate bounds.
    expectedMaxAbsXMm: 4.8,
    expectedMaxAbsYMm: 3.65,
  },
  {
    symbolFileName: "simple_capacitor.kicad_sym",
    footprintFileName: "missing_3d_footprint.kicad_mod",
    componentName: "BBox: missing_3d_footprint",
    nameHint: "C_Missing3D",
    expectedMaxAbsXMm: 1.5,
    expectedMaxAbsYMm: 1.0,
  },
];

describe("library KiCad import — bounds tightness", () => {
  for (const fix of FIXTURES) {
    test(`bounds tight for ${fix.nameHint}`, async () => {
      const server = await createServer(`bbox-${fix.nameHint}`);
      const componentId = await importFixture(server, {
        symbolFileName: fix.symbolFileName,
        footprintFileName: fix.footprintFileName,
        componentName: fix.componentName,
      });

      const preview = await fetchPreview(server, componentId);
      expect(preview.bounds).not.toBeNull();
      const b = preview.bounds!;

      // Compute expected from pads alone (lower bound — graphics may extend).
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const pad of preview.pads) {
        const { halfX, halfY } = padHalfExtents(pad);
        minX = Math.min(minX, pad.centerMm.x - halfX);
        maxX = Math.max(maxX, pad.centerMm.x + halfX);
        minY = Math.min(minY, pad.centerMm.y - halfY);
        maxY = Math.max(maxY, pad.centerMm.y + halfY);
      }

      // Bounds must contain all pads.
      expect(b.minX).toBeLessThanOrEqual(minX + 0.01);
      expect(b.maxX).toBeGreaterThanOrEqual(maxX - 0.01);
      expect(b.minY).toBeLessThanOrEqual(minY + 0.01);
      expect(b.maxY).toBeGreaterThanOrEqual(maxY - 0.01);

      // Bounds must NOT inflate beyond expected courtyard/body.
      expect(b.maxX).toBeLessThanOrEqual(fix.expectedMaxAbsXMm);
      expect(b.minX).toBeGreaterThanOrEqual(-fix.expectedMaxAbsXMm);
      expect(b.maxY).toBeLessThanOrEqual(fix.expectedMaxAbsYMm);
      expect(b.minY).toBeGreaterThanOrEqual(-fix.expectedMaxAbsYMm);
    });
  }
});
