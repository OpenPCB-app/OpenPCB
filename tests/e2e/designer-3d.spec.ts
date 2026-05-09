import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

const BACKEND = "http://127.0.0.1:3000";
const SYMBOL_FIXTURE = path.resolve(
  process.cwd(),
  "src/modules/library/backend/infrastructure/parsers/kicad/__fixtures__/simple_capacitor.kicad_sym",
);
const FOOTPRINT_FIXTURE = path.resolve(
  process.cwd(),
  "src/modules/library/backend/infrastructure/parsers/kicad/__fixtures__/C_0603_1608Metric.kicad_mod",
);
const STEP_FIXTURE = path.resolve(
  process.cwd(),
  "tests/fixtures/3d/minimal.step",
);

interface ImportedComponent3D {
  componentId: string;
  footprintId: string;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function writeUInt16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function writeUInt32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function createStoredZip(entries: Array<{ name: string; bytes: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(entry.bytes.byteLength),
      writeUInt32(entry.bytes.byteLength),
      writeUInt16(nameBytes.byteLength),
      writeUInt16(0),
      nameBytes,
    ]);
    localParts.push(localHeader, entry.bytes);
    centralParts.push(
      Buffer.concat([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(entry.bytes.byteLength),
        writeUInt32(entry.bytes.byteLength),
        writeUInt16(nameBytes.byteLength),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(offset),
        nameBytes,
      ]),
    );
    offset += localHeader.byteLength + entry.bytes.byteLength;
  }

  const local = Buffer.concat(localParts);
  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(central.byteLength),
    writeUInt32(local.byteLength),
    writeUInt16(0),
  ]);
  return Buffer.concat([local, central, end]);
}

async function createKicadZipFixture(): Promise<Buffer> {
  const uniqueStep = Buffer.concat([
    await readFile(STEP_FIXTURE),
    Buffer.from(`\n/* e2e ${crypto.randomUUID()} */\n`, "utf8"),
  ]);
  return createStoredZip([
    { name: "simple_capacitor.kicad_sym", bytes: await readFile(SYMBOL_FIXTURE) },
    { name: "C_0603_1608Metric.kicad_mod", bytes: await readFile(FOOTPRINT_FIXTURE) },
    { name: "minimal.step", bytes: uniqueStep },
  ]);
}

function createMinimalGlb(): Buffer {
  const json = JSON.stringify({
    asset: { version: "2.0", generator: "OpenPCB e2e" },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
  });
  const jsonPadding = (4 - (Buffer.byteLength(json) % 4)) % 4;
  const jsonChunk = Buffer.concat([
    Buffer.from(json, "utf8"),
    Buffer.alloc(jsonPadding, 0x20),
  ]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunkHeader, jsonChunk]);
}

async function getFootprintId(
  request: APIRequestContext,
  componentId: string,
): Promise<string> {
  const response = await request.get(
    `${BACKEND}/api/modules/library/components/${encodeURIComponent(componentId)}/detail`,
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    data?: { detail?: { component?: { footprintId?: string } } };
  };
  const footprintId = body.data?.detail?.component?.footprintId;
  if (!footprintId) {
    throw new Error(`No footprint id for ${componentId}`);
  }
  return footprintId;
}

async function importComponentWithReadyModel(
  request: APIRequestContext,
): Promise<ImportedComponent3D> {
  const zipBuffer = await createKicadZipFixture();
  const importResponse = await request.post(
    `${BACKEND}/api/modules/library/imports/kicad/zip`,
    {
      multipart: {
        file: {
          name: "kicad-with-step.zip",
          mimeType: "application/zip",
          buffer: zipBuffer,
        },
      },
    },
  );
  expect(importResponse.ok()).toBeTruthy();
  const importBody = (await importResponse.json()) as {
    data?: {
      componentId?: string;
      modelConversion?: { footprintId?: string; sourceStepSha256?: string } | null;
    };
  };
  const componentId = importBody.data?.componentId;
  if (!componentId) {
    throw new Error("KiCad ZIP import did not return componentId");
  }
  const footprintId =
    importBody.data?.modelConversion?.footprintId ??
    (await getFootprintId(request, componentId));
  const sourceStepSha256 = importBody.data?.modelConversion?.sourceStepSha256;

  const glbBuffer = createMinimalGlb();
  const uploadResponse = await request.post(
    `${BACKEND}/api/modules/library/footprints/${encodeURIComponent(footprintId)}/model`,
    {
      multipart: {
        glb: {
          name: "minimal.glb",
          mimeType: "model/gltf-binary",
          buffer: glbBuffer,
        },
        sha256: sha256(glbBuffer),
        sourceStepSha256: sourceStepSha256 ?? sha256(zipBuffer),
        sourceFilename: "minimal.step",
        tessellationParamsJson: JSON.stringify({ source: "e2e" }),
        converterVersion: "e2e-synthetic-glb",
      },
    },
  );
  expect(uploadResponse.ok()).toBeTruthy();
  return { componentId, footprintId };
}

async function placePart(args: {
  request: APIRequestContext;
  designId: string;
  componentId: string;
}): Promise<void> {
  const response = await args.request.post(
    `${BACKEND}/api/modules/designer/designs/${args.designId}/commands`,
    {
      data: {
        commandId: `cmd-${crypto.randomUUID()}`,
        sessionId: `e2e-${crypto.randomUUID()}`,
        aggregateId: args.designId,
        baseRevision: null,
        issuedAt: Date.now(),
        command: {
          type: "place_part",
          componentId: args.componentId,
          positionNm: { x: 25_000_000, y: 20_000_000 },
        },
      },
    },
  );
  expect(response.ok()).toBeTruthy();
}

test("Designer PCB 3D view renders imported component board geometry", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const failedModelFetches: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (failedRequest) => {
    if (failedRequest.url().includes("/model")) {
      failedModelFetches.push(
        `${failedRequest.method()} ${failedRequest.url()} ${failedRequest.failure()?.errorText ?? "failed"}`,
      );
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/model") && response.status() >= 400) {
      failedModelFetches.push(`${response.status()} ${response.url()}`);
    }
  });

  const { componentId } = await importComponentWithReadyModel(request);

  await page.goto("/");
  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/modules/designer/designs") &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "New Design" }).first().click(),
  ]);
  const createBody = (await createResponse.json()) as {
    data?: { design?: { id?: string } };
  };
  const designId = createBody.data?.design?.id;
  if (!designId) {
    throw new Error("New design response did not include design id");
  }

  await expect(page.getByRole("tab", { name: "Schem" })).toBeVisible({
    timeout: 15_000,
  });
  await placePart({ request, designId, componentId });
  await page.getByRole("tab", { name: "PCB" }).click();
  await expect(page.locator('[data-testid="designer-pcb-canvas"]')).toBeVisible({
    timeout: 15_000,
  });
  await page.locator('[data-testid="designer-view-3d"]').click();
  await expect(page.locator('[data-testid="designer-3d-canvas"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator('[data-testid="designer-3d-board-geometry"]'),
  ).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);

  expect(failedModelFetches, failedModelFetches.join("\n")).toEqual([]);
  expect(errors, errors.join("\n")).toEqual([]);
});
