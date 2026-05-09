import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import {
  createHttpServer,
  type RuntimeServer,
} from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import {
  decodeTextEntry,
  extractZipEntries,
} from "../../../modules/library/backend/import/archive/extract-zip";

const tempRoots: string[] = [];

interface TestBundleManifestEntry {
  glbRelativePath: string;
  sourceRelativePath: string;
  createdAt: string;
  updatedAt: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function bootHarness(label: string): Promise<RuntimeServer> {
  resetSharedSqliteForTesting();
  const root = await mkdtemp(path.join(os.tmpdir(), `openpcb-${label}-`));
  tempRoots.push(root);
  process.env.OPENPCB_DB_PATH = path.join(root, "openpcb.sqlite");

  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();

  return createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
}

function seedUserFootprint(footprintId: string): void {
  const db = getSharedSqlite();
  const now = new Date().toISOString();
  const symbolId = crypto.randomUUID();
  const componentId = crypto.randomUUID();

  db.query(
    "INSERT INTO library_symbols (id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
  ).run(symbolId, "Bundle Test Symbol", JSON.stringify({}), now);
  db.query(
    "INSERT INTO library_footprints (id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
  ).run(footprintId, "Bundle Test Footprint", JSON.stringify({}), now);
  db.query(
    "INSERT INTO library_components (id, name, description, symbol_id, footprint_id, tags_json, created_at, is_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
  ).run(
    componentId,
    "Bundle Test Component",
    "User-owned component for model bundle tests",
    symbolId,
    footprintId,
    JSON.stringify(["user"]),
    now,
  );
}

function buildUploadForm(options: {
  glbBytes: Uint8Array;
  sourceStepBytes: Uint8Array;
}): FormData {
  const form = new FormData();
  form.set("glb", new File([options.glbBytes], "model.glb"));
  form.set("sha256", sha256(options.glbBytes));
  form.set("sourceStep", new File([options.sourceStepBytes], "source.step"));
  form.set("sourceStepSha256", sha256(options.sourceStepBytes));
  form.set("sourceFilename", "source.step");
  form.set(
    "modelRefJson",
    JSON.stringify({ path: "${KICAD8_3DMODEL_DIR}/source.step" }),
  );
  form.set("tessellationParamsJson", JSON.stringify({ linearDeflection: 0.1 }));
  form.set("converterVersion", "bundle-test/1.0.0");
  return form;
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

function createStoredZip(
  entries: Array<{ name: string; bytes: Uint8Array }>,
): Uint8Array {
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

async function uploadModel(
  server: RuntimeServer,
  footprintId: string,
  glbBytes: Uint8Array,
  sourceStepBytes: Uint8Array,
): Promise<void> {
  const response = await server.fetch(
    new Request(
      `http://localhost/api/modules/library/footprints/${footprintId}/model`,
      {
        method: "POST",
        body: buildUploadForm({ glbBytes, sourceStepBytes }),
      },
    ),
  );
  expect(response.status).toBe(201);
}

async function exportBundle(server: RuntimeServer): Promise<Uint8Array> {
  const response = await server.fetch(
    new Request("http://localhost/api/modules/library/models/export"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  return new Uint8Array(await response.arrayBuffer());
}

async function importBundle(
  server: RuntimeServer,
  bundleBytes: Uint8Array,
): Promise<Response> {
  const form = new FormData();
  form.set(
    "file",
    new File([bundleBytes], "models.zip", { type: "application/zip" }),
  );
  return server.fetch(
    new Request("http://localhost/api/modules/library/models/import", {
      method: "POST",
      body: form,
    }),
  );
}

function readManifest(bundleBytes: Uint8Array): {
  entries: TestBundleManifestEntry[];
} {
  const entries = extractZipEntries(bundleBytes);
  const manifestEntry = entries.find((entry) => entry.path === "manifest.json");
  if (!manifestEntry)
    throw new Error("Exported bundle did not include manifest.json");
  return JSON.parse(decodeTextEntry(manifestEntry)) as {
    entries: TestBundleManifestEntry[];
  };
}

function mutateFirstGlbByte(bundleBytes: Uint8Array): Uint8Array {
  const entries = extractZipEntries(bundleBytes).map((entry) => ({
    name: entry.path,
    bytes: entry.bytes.slice(),
  }));
  const glb = entries.find((entry) => entry.name.startsWith("models/glb/"));
  if (!glb) throw new Error("Exported bundle did not include GLB asset");
  glb.bytes[0] = (glb.bytes[0] ?? 0) ^ 0xff;
  return createStoredZip(entries);
}

afterEach(async () => {
  resetSharedSqliteForTesting();
  delete process.env.OPENPCB_DB_PATH;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("library 3D asset bundle import/export", () => {
  test("exports and imports a portable model bundle", async () => {
    const footprintId = crypto.randomUUID();
    const sourceServer = await bootHarness("asset-bundle-source");
    seedUserFootprint(footprintId);
    const glbBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x42]);
    const stepBytes = new TextEncoder().encode(
      "ISO-10303-21;BUNDLE;END-ISO-10303-21;",
    );
    await uploadModel(sourceServer, footprintId, glbBytes, stepBytes);

    const bundleBytes = await exportBundle(sourceServer);
    const manifest = readManifest(bundleBytes);
    expect(manifest.entries).toHaveLength(1);
    expect(JSON.stringify(manifest)).not.toContain(os.tmpdir());

    const targetServer = await bootHarness("asset-bundle-target");
    seedUserFootprint(footprintId);
    const importResponse = await importBundle(targetServer, bundleBytes);
    expect(importResponse.status).toBe(201);
    expect(await importResponse.json()).toMatchObject({
      data: { imported: 1 },
    });

    const metaResponse = await targetServer.fetch(
      new Request(
        `http://localhost/api/modules/library/footprints/${footprintId}/model/meta`,
      ),
    );
    expect(metaResponse.status).toBe(200);
    const metaBody = (await metaResponse.json()) as {
      data: Record<string, unknown>;
    };
    expect(metaBody.data).toMatchObject({
      status: "ready",
      hasModel: true,
      glbSha256: sha256(glbBytes),
      sourceStepSha256: sha256(stepBytes),
      byteSize: glbBytes.byteLength,
      modelRef: { path: "${KICAD8_3DMODEL_DIR}/source.step" },
    });

    const row = getSharedSqlite()
      .query(
        "SELECT glb_path, source_step_path, tessellation_params_json, converter_version, created_at, updated_at FROM library_footprint_models WHERE footprint_id = ?",
      )
      .get(footprintId) as Record<string, string>;
    const manifestEntry = manifest.entries[0];
    if (!manifestEntry)
      throw new Error("Bundle manifest did not include an entry");
    expect(row.glb_path).toBe(manifestEntry.glbRelativePath);
    expect(row.source_step_path).toBe(manifestEntry.sourceRelativePath);
    expect(row.tessellation_params_json).toBe(
      JSON.stringify({ linearDeflection: 0.1 }),
    );
    expect(row.converter_version).toBe("bundle-test/1.0.0");
    expect(row.created_at).toBe(manifestEntry.createdAt);
    expect(row.updated_at).toBe(manifestEntry.updatedAt);
  });

  test("rejects a bundle when asset bytes do not match manifest hashes", async () => {
    const footprintId = crypto.randomUUID();
    const sourceServer = await bootHarness("asset-bundle-mismatch-source");
    seedUserFootprint(footprintId);
    await uploadModel(
      sourceServer,
      footprintId,
      new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x99]),
      new TextEncoder().encode("ISO-10303-21;MISMATCH;END-ISO-10303-21;"),
    );
    const mutatedBundle = mutateFirstGlbByte(await exportBundle(sourceServer));

    const targetServer = await bootHarness("asset-bundle-mismatch-target");
    seedUserFootprint(footprintId);
    const importResponse = await importBundle(targetServer, mutatedBundle);
    expect(importResponse.status).toBe(400);
    expect(importResponse.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    const problem = (await importResponse.json()) as { detail?: string };
    expect(problem.detail).toContain("SHA-256 mismatch");
  });
});
