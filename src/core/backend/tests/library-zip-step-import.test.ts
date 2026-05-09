import { createHash } from "node:crypto";
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

function writeUInt16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function writeUInt32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function createStoredZip(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const localHeader = concatBytes([
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
      concatBytes([
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

  const local = concatBytes(localParts);
  const central = concatBytes(centralParts);
  const end = concatBytes([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(central.byteLength),
    writeUInt32(local.byteLength),
    writeUInt16(0),
  ]);
  return concatBytes([local, central, end]);
}

async function createLibraryServer(testLabel: string) {
  isolateTestDb(testLabel);
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({ moduleRegistry, workspaceRoot: repoRoot });
  await moduleRuntime.bootstrap();
  return createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
}

async function readKicadFixtures(): Promise<{
  symbolContent: string;
  footprintContent: string;
}> {
  const fixtureDir = path.resolve(
    import.meta.dir,
    "../../../modules/library/backend/infrastructure/parsers/kicad/__fixtures__",
  );
  const symbolContent = await Bun.file(
    path.resolve(fixtureDir, "simple_capacitor.kicad_sym"),
  ).text();
  const footprintContent = await Bun.file(
    path.resolve(fixtureDir, "C_0603_1608Metric.kicad_mod"),
  ).text();
  return { symbolContent, footprintContent };
}

async function importZip(
  server: ReturnType<typeof createHttpServer>,
  zipBytes: Uint8Array,
  fileName = "C.zip",
) {
  const form = new FormData();
  form.set("file", new File([zipBytes], fileName, { type: "application/zip" }));
  return server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad/zip", {
      method: "POST",
      body: form,
    }),
  );
}

async function footprintIdForComponent(
  server: ReturnType<typeof createHttpServer>,
  componentId: string,
): Promise<string> {
  const detailResponse = await server.fetch(
    new Request(`http://localhost/api/modules/library/components/${componentId}/detail`),
  );
  expect(detailResponse.status).toBe(200);
  const detailBody = (await detailResponse.json()) as {
    data?: { detail?: { component?: { footprintId?: string } } };
  };
  const footprintId = detailBody.data?.detail?.component?.footprintId;
  if (!footprintId) throw new Error("ZIP import detail did not include footprint id");
  return footprintId;
}

describe("library KiCad ZIP STEP import", () => {
  test("persists selected STEP source and returns conversion metadata", async () => {
    const server = await createLibraryServer("library-zip-step-import");
    const { symbolContent, footprintContent } = await readKicadFixtures();
    const encoder = new TextEncoder();
    const stepBytes = encoder.encode("ISO-10303-21;ZIP-STEP-FIXTURE;END-ISO-10303-21;");
    const stepSha256 = createHash("sha256").update(stepBytes).digest("hex");

    const inspectResponse = await server.fetch(
      new Request("http://localhost/api/modules/library/imports/kicad/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbolLibrary: { fileName: "C.kicad_sym", content: symbolContent },
          footprints: [{ fileName: "C_0603_1608Metric.kicad_mod", content: footprintContent }],
          model3dFiles: [{ fileName: "C.step" }],
        }),
      }),
    );
    expect(inspectResponse.status).toBe(200);
    const inspectBody = (await inspectResponse.json()) as {
      data?: {
        model3dCandidates?: Array<{
          fileName: string;
          extension: string;
          association: string;
        }>;
      };
    };
    expect(inspectBody.data?.model3dCandidates).toContainEqual({
      fileName: "C.step",
      extension: ".step",
      association: "orphan_asset",
    });

    const zipBytes = createStoredZip([
      { name: "C.kicad_sym", bytes: encoder.encode(symbolContent) },
      { name: "C_0603_1608Metric.kicad_mod", bytes: encoder.encode(footprintContent) },
      { name: "C.step", bytes: stepBytes },
    ]);
    const importResponse = await importZip(server, zipBytes);
    expect(importResponse.status).toBe(201);
    const importBody = (await importResponse.json()) as {
      data?: {
        componentId?: string;
        modelConversion?: {
          footprintId: string;
          sourceStepSha256: string;
          sourceStepUrl: string;
          sourceFilename: string;
          selectedModel: { fileName: string; extension: string; association: string };
          modelRef: unknown | null;
          status: string;
        } | null;
      };
    };
    const componentId = importBody.data?.componentId;
    if (!componentId) throw new Error("ZIP import did not return component id");
    const footprintId = await footprintIdForComponent(server, componentId);

    expect(importBody.data?.modelConversion).toEqual({
      footprintId,
      sourceStepSha256: stepSha256,
      sourceStepUrl: `/footprints/${footprintId}/model/source`,
      sourceFilename: "C.step",
      selectedModel: { fileName: "C.step", extension: ".step", association: "symbol-name" },
      modelRef: null,
      status: "pending_client_conversion",
    });

    const metaResponse = await server.fetch(
      new Request(`http://localhost/api/modules/library/footprints/${footprintId}/model/meta`),
    );
    expect(metaResponse.status).toBe(200);
    const metaBody = (await metaResponse.json()) as {
      data?: { status?: string; hasModel?: boolean; sourceStepSha256?: string };
    };
    expect(metaBody.data?.status).toBe("pending_client_conversion");
    expect(metaBody.data?.hasModel).toBe(false);
    expect(metaBody.data?.sourceStepSha256).toBe(stepSha256);

    const sourceResponse = await server.fetch(
      new Request(`http://localhost/api/modules/library/footprints/${footprintId}/model/source`),
    );
    expect(sourceResponse.status).toBe(200);
    expect(Array.from(new Uint8Array(await sourceResponse.arrayBuffer()))).toEqual(
      Array.from(stepBytes),
    );
  });

  test("reports WRL candidates without creating a model row", async () => {
    const server = await createLibraryServer("library-zip-wrl-import");
    const { symbolContent, footprintContent } = await readKicadFixtures();
    const encoder = new TextEncoder();
    const zipBytes = createStoredZip([
      { name: "C.kicad_sym", bytes: encoder.encode(symbolContent) },
      { name: "C_0603_1608Metric.kicad_mod", bytes: encoder.encode(footprintContent) },
      { name: "C.wrl", bytes: encoder.encode("#VRML V2.0 utf8") },
    ]);
    const importResponse = await importZip(server, zipBytes);
    expect(importResponse.status).toBe(201);
    const importBody = (await importResponse.json()) as {
      data?: {
        componentId?: string;
        model3dCandidates?: Array<{
          fileName: string;
          extension: string;
          association: string;
        }>;
        modelConversion?: unknown | null;
        warnings?: Array<{ code: string }>;
      };
    };
    const componentId = importBody.data?.componentId;
    if (!componentId) throw new Error("ZIP import did not return component id");
    expect(importBody.data?.model3dCandidates).toContainEqual({
      fileName: "C.wrl",
      extension: ".wrl",
      association: "unsupported_format",
    });
    expect(importBody.data?.warnings?.some((item) => item.code === "unsupported_wrl_model")).toBe(true);
    expect(importBody.data?.modelConversion).toBeNull();

    const footprintId = await footprintIdForComponent(server, componentId);
    const metaResponse = await server.fetch(
      new Request(`http://localhost/api/modules/library/footprints/${footprintId}/model/meta`),
    );
    expect(metaResponse.status).toBe(200);
    const metaBody = (await metaResponse.json()) as {
      data?: { status?: string; sourceStepSha256?: string | null };
    };
    expect(metaBody.data?.status).toBe("missing");
    expect(metaBody.data?.sourceStepSha256).toBeNull();
  });

  test("imports real ATTINY ZIP and queues its orphan STEP by symbol name", async () => {
    const server = await createLibraryServer("library-zip-attiny-step-import");
    const zipPath = path.resolve(import.meta.dir, "../../../../data/ATTINY13A-SU.zip");
    const zipBytes = new Uint8Array(await Bun.file(zipPath).arrayBuffer());
    const importResponse = await importZip(server, zipBytes, "ATTINY13A-SU.zip");

    expect(importResponse.status).toBe(201);
    const importBody = (await importResponse.json()) as {
      data?: {
        componentId?: string;
        componentName?: string;
        model3dCandidates?: Array<{
          fileName: string;
          extension: string;
          association: string;
        }>;
        modelConversion?: {
          footprintId: string;
          sourceStepUrl: string;
          sourceFilename: string;
          selectedModel: { fileName: string; extension: string; association: string };
          status: string;
        } | null;
        selected?: {
          symbolName?: string;
          footprintName?: string;
          modelFileName?: string | null;
          confidence?: string;
        };
      };
    };

    expect(importBody.data?.componentName).toBe("ATTINY13A-SU");
    expect(importBody.data?.selected).toEqual({
      symbolName: "ATTINY13A-SU",
      footprintName: "SOIC127P798X216-8N",
      modelFileName: "ATTINY13A-SU.step",
      confidence: "high",
    });
    expect(importBody.data?.model3dCandidates).toContainEqual({
      fileName: "ATTINY13A-SU.step",
      extension: ".step",
      association: "symbol-name",
    });
    expect(importBody.data?.modelConversion).toMatchObject({
      sourceFilename: "ATTINY13A-SU.step",
      selectedModel: {
        fileName: "ATTINY13A-SU.step",
        extension: ".step",
        association: "symbol-name",
      },
      status: "pending_client_conversion",
    });

    const sourceUrl = importBody.data?.modelConversion?.sourceStepUrl;
    if (!sourceUrl) throw new Error("ATTINY import did not return source URL");
    const sourceResponse = await server.fetch(
      new Request(`http://localhost/api/modules/library${sourceUrl}`),
    );
    expect(sourceResponse.status).toBe(200);
    const sourceText = await sourceResponse.text();
    expect(sourceText).toContain("ISO-10303-21");
  });
});
