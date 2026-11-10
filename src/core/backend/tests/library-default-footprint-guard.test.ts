import { beforeAll, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { LibrarySDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { MentionRegistry } from "../mentions";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import {
  footprintDataJson,
  insertFootprintRow,
  overlappingPreview,
  plainPreview,
  PROVENANCE,
  PIN_HEADER_1X2,
} from "./helpers/footprint-qualification";
import { pinHeaderGenerator, templatePayload } from "./helpers/template-footprint";

// PATCH /components/:id {defaultFootprintId} refuses a flagged generated
// footprint as a NEW default (H15 §3.4) from every client; an unchanged
// flagged default (e.g. set by .opclib intake) stays editable.

let server: ReturnType<typeof createHttpServer>;
let sdk: LibrarySDK;

beforeAll(async () => {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `fp-default-guard-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  sdk = moduleRuntime.getSdkRegistry().resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
});

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await server.fetch(
    new Request(`http://localhost/api/modules/library${url}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
}

/** Drawn two-pin component (pins 1, 2) on the placeholder footprint. */
async function importComponent(name: string): Promise<string> {
  const pins = ["1", "2"].map((n, i) => ({
    id: `p${n}`,
    name: n,
    number: n,
    electricalType: "passive",
    positionMm: { x: i * 2.54, y: 0 },
    lengthMm: 1,
    rotationDeg: 0,
    unit: 1,
    hidden: false,
  }));
  const { status, json } = await call("POST", "/imports/drawn", {
    drawnSymbol: {
      source: { name, unitCount: 1, referenceText: "U?", valueText: name, pins, graphics: [], warnings: [] },
      referencePrefix: "U",
    },
    footprintMode: "none",
    component: { name, description: "default guard" },
  });
  expect(status).toBe(201);
  return json.data.componentId as string;
}

/** Link a stored footprint row to the component as a (non-default) variant. */
function linkVariant(componentId: string, footprintId: string, isDefault = false): void {
  const db = getSharedSqlite();
  db.query(
    "INSERT INTO library_component_footprints (component_id, footprint_id, is_default, variant_label, sort_order) VALUES (?, ?, ?, ?, ?)",
  ).run(componentId, footprintId, isDefault ? 1 : 0, footprintId, 10);
  if (isDefault) {
    db.query("UPDATE library_component_footprints SET is_default = 0 WHERE component_id = ? AND footprint_id != ?").run(
      componentId,
      footprintId,
    );
    db.query("UPDATE library_components SET footprint_id = ? WHERE id = ?").run(footprintId, componentId);
  }
}

function flaggedRows(): { label: string; dataJson: string }[] {
  return [
    { label: "legacy generated", dataJson: footprintDataJson(PROVENANCE.legacyGenerated, plainPreview()) },
    {
      label: "overlapping template",
      dataJson: footprintDataJson(PROVENANCE.template("pin-header", PIN_HEADER_1X2), overlappingPreview()),
    },
  ];
}

describe("library: default-footprint qualification guard", () => {
  for (const { label, dataJson } of flaggedRows()) {
    test(`PATCH to a flagged ${label} footprint → 422, default unchanged`, async () => {
      const componentId = await importComponent(`Guard ${label}`);
      const flagged = insertFootprintRow(crypto.randomUUID(), dataJson);
      linkVariant(componentId, flagged);

      const detail = await sdk.getComponentDetail(componentId);
      const variant = detail?.footprintVariants.find((v) => v.footprintId === flagged);
      expect(variant?.qualification?.status).toBe("unqualified-generator");

      const res = await call("PATCH", `/components/${componentId}`, { defaultFootprintId: flagged });
      expect(res.status).toBe(422);
      expect(res.json.code).toBe("UNQUALIFIED_GENERATOR");
      expect(res.json.type).toBe("https://openpcb.dev/problems/unqualified-generator");
      expect(res.json.detail).toBe(variant?.qualification?.reason);

      const after = await sdk.resolveComponent(componentId);
      expect(after?.footprintId).toBe("fp-no-footprint-yet");
    });
  }

  test("the SDK path is guarded too", async () => {
    const componentId = await importComponent("Guard SDK");
    const flagged = insertFootprintRow(crypto.randomUUID(), flaggedRows()[0]!.dataJson);
    linkVariant(componentId, flagged);
    await expect(sdk.updateComponent(componentId, { defaultFootprintId: flagged })).rejects.toThrow(
      "Generated before generator provenance was recorded",
    );
  });

  test("an unchanged flagged default → 200", async () => {
    const componentId = await importComponent("Guard unchanged");
    const flagged = insertFootprintRow(crypto.randomUUID(), flaggedRows()[0]!.dataJson);
    linkVariant(componentId, flagged, true);

    const res = await call("PATCH", `/components/${componentId}`, {
      defaultFootprintId: flagged,
      description: "still editable",
    });
    expect(res.status).toBe(200);
    expect(res.json.data.component.footprintId).toBe(flagged);
    expect(res.json.data.component.description).toBe("still editable");
  });

  test("PATCH to a qualified template or drawn footprint → 200", async () => {
    const componentId = await importComponent("Guard ok");
    const generator = pinHeaderGenerator(1, 2);
    const added = await call("POST", `/components/${componentId}/footprints`, {
      mode: "generated",
      source: templatePayload(generator),
      generator,
      setDefault: false,
    });
    expect(added.status).toBe(201);
    const template = added.json.data.footprintId as string;
    const drawn = insertFootprintRow(crypto.randomUUID(), footprintDataJson(PROVENANCE.drawn, plainPreview()));
    linkVariant(componentId, drawn);

    for (const footprintId of [template, drawn]) {
      const res = await call("PATCH", `/components/${componentId}`, { defaultFootprintId: footprintId });
      expect(res.status).toBe(200);
      expect(res.json.data.component.footprintId).toBe(footprintId);
    }
  });
});
