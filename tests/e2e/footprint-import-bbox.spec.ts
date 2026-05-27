import { expect, test, type APIRequestContext } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * End-to-end coverage for the KiCad import bbox bug:
 * On PCB the selection bbox previously stretched far to the right because
 * (1) the parser hardcoded a smaller font size, (2) value/reference text
 * was anchored far outside the body in some KiCad libraries, and (3) those
 * label positions ended up in the baked `model.bounds`. After the fix the
 * stored bounds derive from pads + graphics only.
 */

const BACKEND = "http://127.0.0.1:3000";
const REPO_ROOT = resolve(__dirname, "..", "..");

interface Fixture {
  zip: string;
  fpNameHint: string;
  // Upper bound on |x|/|y| of expected geometry-only bbox (mm).
  expectedMaxAbsXMm: number;
  expectedMaxAbsYMm: number;
}

const FIXTURES: Fixture[] = [
  {
    zip: "data/SC0914_13_.zip",
    fpNameHint: "QFN40P700X700X90-57N",
    expectedMaxAbsXMm: 5.0,
    expectedMaxAbsYMm: 5.0,
  },
  {
    zip: "data/OP07CD.zip",
    fpNameHint: "SOIC127P599X175-8N",
    expectedMaxAbsXMm: 4.5,
    expectedMaxAbsYMm: 4.5,
  },
  {
    zip: "data/LM324N.zip",
    fpNameHint: "DIP794W45P254L1969H508Q14",
    expectedMaxAbsXMm: 6.0,
    expectedMaxAbsYMm: 11.0,
  },
];

async function importZip(
  request: APIRequestContext,
  zipPath: string,
): Promise<string> {
  const buf = readFileSync(zipPath);
  const res = await request.post(
    `${BACKEND}/api/modules/library/imports/kicad/zip`,
    {
      multipart: {
        file: {
          name: zipPath.split("/").pop() ?? "fixture.zip",
          mimeType: "application/zip",
          buffer: buf,
        },
      },
    },
  );
  expect(res.ok(), `import failed: ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  const body = (await res.json()) as { data?: { componentId?: string } };
  const id = body.data?.componentId;
  if (!id) throw new Error("import did not return componentId");
  return id;
}

interface DetailPreview {
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  pads: Array<{
    centerMm: { x: number; y: number };
    widthMm: number;
    heightMm: number;
    rotationDeg: number;
  }>;
}

async function fetchPreview(
  request: APIRequestContext,
  componentId: string,
): Promise<DetailPreview> {
  const res = await request.get(
    `${BACKEND}/api/modules/library/components/${encodeURIComponent(componentId)}/detail`,
  );
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    data: { detail: { footprint: { preview: DetailPreview } } };
  };
  return body.data.detail.footprint.preview;
}

for (const fix of FIXTURES) {
  test(`bbox is tight after KiCad import — ${fix.fpNameHint}`, async ({
    request,
  }) => {
    const zipAbs = resolve(REPO_ROOT, fix.zip);
    test.skip(!existsSync(zipAbs), `missing local KiCad fixture ${fix.zip}`);
    const componentId = await importZip(request, zipAbs);
    const preview = await fetchPreview(request, componentId);

    expect(preview.bounds).not.toBeNull();
    const b = preview.bounds!;

    // 1. Bounds must contain every pad.
    for (const pad of preview.pads) {
      const halfW = Math.abs(pad.widthMm) / 2;
      const halfH = Math.abs(pad.heightMm) / 2;
      const r = (pad.rotationDeg * Math.PI) / 180;
      const cos = Math.abs(Math.cos(r));
      const sin = Math.abs(Math.sin(r));
      const hx = cos * halfW + sin * halfH;
      const hy = sin * halfW + cos * halfH;
      expect(b.minX).toBeLessThanOrEqual(pad.centerMm.x - hx + 0.01);
      expect(b.maxX).toBeGreaterThanOrEqual(pad.centerMm.x + hx - 0.01);
      expect(b.minY).toBeLessThanOrEqual(pad.centerMm.y - hy + 0.01);
      expect(b.maxY).toBeGreaterThanOrEqual(pad.centerMm.y + hy - 0.01);
    }

    // 2. Bounds must NOT inflate beyond the courtyard/body envelope.
    expect(b.maxX).toBeLessThanOrEqual(fix.expectedMaxAbsXMm);
    expect(b.minX).toBeGreaterThanOrEqual(-fix.expectedMaxAbsXMm);
    expect(b.maxY).toBeLessThanOrEqual(fix.expectedMaxAbsYMm);
    expect(b.minY).toBeGreaterThanOrEqual(-fix.expectedMaxAbsYMm);
  });
}
