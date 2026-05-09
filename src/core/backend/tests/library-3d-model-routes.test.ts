import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
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

const tempRoots: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function bootHarness(label: string): Promise<RuntimeServer> {
  resetSharedSqliteForTesting();
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), `openpcb-${label}-`)),
  );
  tempRoots.push(root);
  process.env.OPENPCB_DB_PATH = path.join(root, "openpcb.sqlite");

  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();

  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return server;
}

function seedUserFootprint(footprintId = crypto.randomUUID()): string {
  const db = getSharedSqlite();
  const now = new Date().toISOString();
  const symbolId = crypto.randomUUID();
  const componentId = crypto.randomUUID();

  db.query(
    "INSERT INTO library_symbols (id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
  ).run(symbolId, "Route Test Symbol", JSON.stringify({}), now);
  db.query(
    "INSERT INTO library_footprints (id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
  ).run(footprintId, "Route Test Footprint", JSON.stringify({}), now);
  db.query(
    "INSERT INTO library_components (id, name, description, symbol_id, footprint_id, tags_json, created_at, is_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
  ).run(
    componentId,
    "Route Test Component",
    "User-owned component for model routes",
    symbolId,
    footprintId,
    JSON.stringify(["user"]),
    now,
  );
  return footprintId;
}

function buildUploadForm(options: {
  glbBytes?: Uint8Array;
  glbSha256?: string;
  sourceStepBytes?: Uint8Array;
  sourceStepSha256?: string;
  sourceFilename?: string;
}): FormData {
  const glbBytes = options.glbBytes ?? new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
  const form = new FormData();
  form.set("glb", new File([glbBytes], "model.glb"));
  form.set("sha256", options.glbSha256 ?? sha256(glbBytes));
  form.set(
    "sourceStepSha256",
    options.sourceStepSha256 ??
      sha256(options.sourceStepBytes ?? new Uint8Array()),
  );
  form.set(
    "modelRefJson",
    JSON.stringify({ path: "${KICAD8_3DMODEL_DIR}/demo.step" }),
  );
  form.set("tessellationParamsJson", JSON.stringify({ linearDeflection: 0.1 }));
  form.set("converterVersion", "test-converter/1.0.0");

  if (options.sourceStepBytes) {
    form.set("sourceStep", new File([options.sourceStepBytes], "source.step"));
    if (options.sourceFilename) {
      form.set("sourceFilename", options.sourceFilename);
    }
  }
  return form;
}

async function expectProblem(
  response: Response,
  status = 400,
): Promise<unknown> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain(
    "application/problem+json",
  );
  const body = (await response.json()) as { status: number; detail?: string };
  expect(body.status).toBe(status);
  expect(typeof body.detail).toBe("string");
  return body;
}

afterEach(async () => {
  resetSharedSqliteForTesting();
  delete process.env.OPENPCB_DB_PATH;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

describe("library 3D model routes", () => {
  test("uploads metadata and streams GLB/source round-trip", async () => {
    const server = await bootHarness("model-route-roundtrip");
    const footprintId = seedUserFootprint();
    const glbBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x01]);
    const sourceStepBytes = new TextEncoder().encode(
      "ISO-10303-21;\nENDSEC;\n",
    );
    const glbHash = sha256(glbBytes);
    const sourceHash = sha256(sourceStepBytes);

    const uploadResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/footprints/${footprintId}/model`,
        {
          method: "POST",
          body: buildUploadForm({
            glbBytes,
            sourceStepBytes,
            sourceFilename: "uploaded.step",
          }),
        },
      ),
    );
    expect(uploadResponse.status).toBe(201);
    const uploadBody = (await uploadResponse.json()) as {
      data: {
        hasModel: boolean;
        glbSha256: string;
        sourceStepSha256: string;
        sourceFilename: string;
        byteSize: number;
      };
    };
    expect(uploadBody.data).toMatchObject({
      hasModel: true,
      glbSha256: glbHash,
      sourceStepSha256: sourceHash,
      sourceFilename: "uploaded.step",
      byteSize: glbBytes.byteLength,
    });

    const metaResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/footprints/${footprintId}/model/meta`,
      ),
    );
    expect(metaResponse.status).toBe(200);
    const metaBody = (await metaResponse.json()) as {
      data: Record<string, unknown>;
    };
    expect(JSON.stringify(metaBody.data)).not.toContain(os.tmpdir());
    expect(metaBody.data).not.toHaveProperty("glbPath");
    expect(metaBody.data).not.toHaveProperty("sourceStepPath");

    const modelResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/footprints/${footprintId}/model`,
      ),
    );
    expect(modelResponse.status).toBe(200);
    expect(modelResponse.headers.get("content-type")).toBe("model/gltf-binary");
    expect(modelResponse.headers.get("etag")).toBe(`"${glbHash}"`);
    expect(modelResponse.headers.get("cache-control")).toBe(
      "private, immutable, max-age=31536000",
    );
    expect(new Uint8Array(await modelResponse.arrayBuffer())).toEqual(glbBytes);

    const sourceResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/footprints/${footprintId}/model/source`,
      ),
    );
    expect(sourceResponse.status).toBe(200);
    expect(sourceResponse.headers.get("content-type")).toBe("model/step");
    expect(sourceResponse.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(
      Array.from(new Uint8Array(await sourceResponse.arrayBuffer())),
    ).toEqual(Array.from(sourceStepBytes));

    const deleteResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/footprints/${footprintId}/model`,
        {
          method: "DELETE",
        },
      ),
    );
    expect(deleteResponse.status).toBe(200);
    const afterDeleteMeta = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/footprints/${footprintId}/model/meta`,
      ),
    );
    const afterDeleteBody = (await afterDeleteMeta.json()) as {
      data: Record<string, unknown>;
    };
    expect(afterDeleteBody.data).toEqual({
      status: "missing",
      hasModel: false,
      glbSha256: null,
      sourceStepSha256: null,
      sourceFilename: null,
      modelRef: null,
      byteSize: null,
      errorMessage: null,
    });
  });

  test("rejects invalid multipart, oversized files, hash mismatch, missing footprint, and path traversal", async () => {
    const server = await bootHarness("model-route-errors");
    const footprintId = seedUserFootprint();
    const glbBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);

    await expectProblem(
      await server.fetch(
        new Request(
          `http://localhost/api/modules/library/footprints/${footprintId}/model`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          },
        ),
      ),
    );

    await expectProblem(
      await server.fetch(
        new Request(
          `http://localhost/api/modules/library/footprints/${footprintId}/model`,
          {
            method: "POST",
            body: buildUploadForm({
              glbBytes,
              glbSha256: sha256(new Uint8Array([1])),
            }),
          },
        ),
      ),
    );

    await expectProblem(
      await server.fetch(
        new Request(
          "http://localhost/api/modules/library/footprints/missing/model",
          {
            method: "POST",
            body: buildUploadForm({ glbBytes }),
          },
        ),
      ),
    );

    await expectProblem(
      await server.fetch(
        new Request(
          `http://localhost/api/modules/library/footprints/${footprintId}/model`,
          {
            method: "POST",
            body: buildUploadForm({
              glbBytes,
              sourceStepBytes: new TextEncoder().encode("STEP"),
              sourceFilename: "../evil.step",
            }),
          },
        ),
      ),
    );

    await expectProblem(
      await server.fetch(
        new Request(
          `http://localhost/api/modules/library/footprints/${footprintId}/model`,
          {
            method: "POST",
            body: buildUploadForm({
              glbBytes: new Uint8Array(10 * 1024 * 1024 + 1),
            }),
          },
        ),
      ),
    );

    await expectProblem(
      await server.fetch(
        new Request(
          `http://localhost/api/modules/library/footprints/${footprintId}/model`,
          {
            method: "POST",
            body: buildUploadForm({
              glbBytes,
              sourceStepBytes: new Uint8Array(25 * 1024 * 1024 + 1),
            }),
          },
        ),
      ),
    );
  });
});
