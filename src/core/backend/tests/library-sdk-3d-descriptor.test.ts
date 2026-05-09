import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LibrarySDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const tempRoots: string[] = [];

interface SeededComponent {
  componentId: string;
  footprintId: string;
}

async function bootHarness(label: string): Promise<LibrarySDK> {
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

  return moduleRuntime
    .getSdkRegistry()
    .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
}

function createSymbolData(): Record<string, unknown> {
  return {
    normalized: {
      referencePrefix: "U",
      pins: [
        {
          originPinKey: "pin:1",
          number: "1",
          name: "IO",
          localPosition: { x: 0, y: 0 },
          electricalType: "passive",
          unit: 1,
        },
      ],
      preview: {
        kind: "symbol",
        units: "mm",
        name: "SDK Test Symbol",
        unitCount: 1,
        graphics: [],
        pins: [
          {
            id: "pin:1",
            name: "IO",
            number: "1",
            electricalType: "passive",
            unit: 1,
            anchor: { x: 0, y: 0 },
            bodyEnd: { x: 1, y: 0 },
            rotationDeg: 0,
          },
        ],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
    provenance: { sourceHash: "symbol-source-hash" },
  };
}

function createFootprintData(): Record<string, unknown> {
  return {
    normalized: {
      mountType: "smd",
      padCount: 1,
      packageCode: { imperial: null, metric: null },
      warnings: [],
      preview: {
        kind: "footprint",
        units: "mm",
        name: "SDK Test Footprint",
        pads: [
          {
            id: "pad:1",
            number: "1",
            shape: "rect",
            centerMm: { x: 0, y: 0 },
            widthMm: 1,
            heightMm: 1,
            rotationDeg: 0,
            layer: "F.Cu",
          },
        ],
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
    provenance: { sourceHash: "footprint-source-hash" },
  };
}

function seedPlacementComponent(): SeededComponent {
  const db = getSharedSqlite();
  const now = new Date().toISOString();
  const componentId = crypto.randomUUID();
  const symbolId = crypto.randomUUID();
  const footprintId = crypto.randomUUID();

  db.query(
    "INSERT INTO library_symbols (id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
  ).run(symbolId, "SDK Test Symbol", JSON.stringify(createSymbolData()), now);
  db.query(
    "INSERT INTO library_footprints (id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
  ).run(
    footprintId,
    "SDK Test Footprint",
    JSON.stringify(createFootprintData()),
    now,
  );
  db.query(
    "INSERT INTO library_components (id, name, description, symbol_id, footprint_id, tags_json, created_at, is_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
  ).run(
    componentId,
    "SDK Test Component",
    "Component for SDK placement descriptor tests",
    symbolId,
    footprintId,
    JSON.stringify(["user"]),
    now,
  );
  db.query(
    "INSERT INTO library_component_footprints (component_id, footprint_id, is_default, variant_label, sort_order) VALUES (?, ?, 1, ?, 0)",
  ).run(componentId, footprintId, "SDK Test Footprint");

  return { componentId, footprintId };
}

function seedFootprintModel(
  footprintId: string,
  options: { status?: "ready" | "pending_client_conversion" | "failed" } = {},
): void {
  const now = new Date().toISOString();
  const status = options.status ?? "ready";
  const hasGlb = status === "ready";
  getSharedSqlite()
    .query(
      `INSERT INTO library_footprint_models
       (footprint_id, status, glb_path, glb_sha256, source_step_path, source_step_sha256,
        source_filename, source_byte_size, model_ref_json, tessellation_params_json,
        converter_version, byte_size, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      footprintId,
      status,
      hasGlb
        ? "models/glb/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.glb"
        : null,
      hasGlb
        ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        : null,
      "models/source/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.step",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "uploaded.step",
      128,
      JSON.stringify({ path: "${KICAD8_3DMODEL_DIR}/uploaded.step" }),
      JSON.stringify({ linearDeflection: 0.1 }),
      "sdk-test/1.0.0",
      hasGlb ? 64 : null,
      status === "failed" ? "conversion failed" : null,
      now,
      now,
    );
}

afterEach(async () => {
  resetSharedSqliteForTesting();
  delete process.env.OPENPCB_DB_PATH;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("library SDK 3D placement descriptors", () => {
  test("resolveComponentForPlacement returns descriptor URLs without storage paths", async () => {
    const librarySdk = await bootHarness("library-sdk-3d-descriptor");
    const { componentId, footprintId } = seedPlacementComponent();
    seedFootprintModel(footprintId);

    const placement = await librarySdk.resolveComponentForPlacement(componentId);

    expect(placement).not.toBeNull();
    expect(placement!.footprint.model3d).toEqual({
      status: "ready",
      glbUrl: `/api/modules/library/footprints/${footprintId}/model`,
      glbSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceStepSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      sourceFilename: "uploaded.step",
      modelRef: { path: "${KICAD8_3DMODEL_DIR}/uploaded.step" },
      converterVersion: "sdk-test/1.0.0",
    });
    expect(JSON.stringify(placement!.footprint.model3d)).not.toContain(
      "models/glb",
    );
    expect(JSON.stringify(placement!.footprint.model3d)).not.toContain(
      "models/source",
    );
    expect(JSON.stringify(placement!.footprint.model3d)).not.toContain(
      os.tmpdir(),
    );
  });

  test("resolveComponentForPlacement omits model3d when no model row exists", async () => {
    const librarySdk = await bootHarness("library-sdk-3d-no-descriptor");
    const { componentId } = seedPlacementComponent();

    const placement = await librarySdk.resolveComponentForPlacement(componentId);

    expect(placement).not.toBeNull();
    expect(placement!.footprint).not.toHaveProperty("model3d");
    expect(placement!.footprint.footprintId).toBeTruthy();
    expect(placement!.symbol.pins).toHaveLength(1);
  });

  test("resolveComponentForPlacement includes pending and failed descriptors", async () => {
    const librarySdk = await bootHarness("library-sdk-3d-pending-failed");
    const pending = seedPlacementComponent();
    const failed = seedPlacementComponent();
    seedFootprintModel(pending.footprintId, {
      status: "pending_client_conversion",
    });
    seedFootprintModel(failed.footprintId, { status: "failed" });

    const pendingPlacement = await librarySdk.resolveComponentForPlacement(
      pending.componentId,
    );
    const failedPlacement = await librarySdk.resolveComponentForPlacement(
      failed.componentId,
    );

    expect(pendingPlacement?.footprint.model3d).toMatchObject({
      status: "pending_client_conversion",
      glbUrl: null,
      glbSha256: null,
      sourceStepSha256:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(failedPlacement?.footprint.model3d).toMatchObject({
      status: "failed",
      glbUrl: null,
      glbSha256: null,
      sourceFilename: "uploaded.step",
    });
  });
});
