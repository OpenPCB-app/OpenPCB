import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

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

async function importRealZip(
  server: ReturnType<typeof createHttpServer>,
  zipPath: string,
) {
  const bytes = await Bun.file(zipPath).bytes();
  const form = new FormData();
  form.set(
    "file",
    new File([bytes], path.basename(zipPath), { type: "application/zip" }),
  );
  return server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad/zip", {
      method: "POST",
      body: form,
    }),
  );
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

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");

interface Fixture {
  zip: string;
  fpNameHint: string;
  // Expected real geometry max (mm). Pads cluster + some silk slack.
  expectedMaxAbsXMm: number;
  expectedMaxAbsYMm: number;
}

const FIXTURES: Fixture[] = [
  {
    zip: "data/SC0914_13_.zip",
    fpNameHint: "QFN40P700X700X90-57N",
    // Pads at ±3.435 mm, courtyard at ±4.105 mm, body at ±3.5 mm.
    // Pin-1 silkscreen dot at (-4.475, -2.6) extends slightly further.
    // Without the fix this would be ~13.5 mm right (fp_text value).
    expectedMaxAbsXMm: 5.0,
    expectedMaxAbsYMm: 5.0,
  },
  {
    zip: "data/OP07CD.zip",
    fpNameHint: "SOIC127P599X175-8N",
    // SOIC8 ~6mm pad span × ~6mm body
    expectedMaxAbsXMm: 4.5,
    expectedMaxAbsYMm: 4.5,
  },
  {
    zip: "data/LM324N.zip",
    fpNameHint: "DIP794W45P254L1969H508Q14",
    // DIP14, 7.94mm row span, 19.69mm body length
    expectedMaxAbsXMm: 6.0,
    expectedMaxAbsYMm: 11.0,
  },
];

describe("library KiCad import — bounds tightness", () => {
  for (const fix of FIXTURES) {
    test(`bounds tight for ${fix.fpNameHint}`, async () => {
      const server = await createServer(`bbox-${fix.fpNameHint}`);
      const zipAbs = path.resolve(REPO_ROOT, fix.zip);

      const importRes = await importRealZip(server, zipAbs);
      expect(importRes.status).toBe(201);
      const importBody = (await importRes.json()) as {
        data: { componentId: string };
      };

      const preview = await fetchPreview(server, importBody.data.componentId);
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
