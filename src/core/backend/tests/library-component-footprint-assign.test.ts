import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { LibrarySDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { generateFootprint } from "../../../shared/rendering/ipc7351b";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MentionRegistry } from "../mentions";

const PLACEHOLDER = "fp-no-footprint-yet";

async function boot() {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `fp-assign-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();
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
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  return { server, sdk };
}
type Server = Awaited<ReturnType<typeof boot>>["server"];

async function call(
  server: Server,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await server.fetch(
    new Request(`http://localhost/api/modules/library${url}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
}

/** Drawn component with the placeholder footprint and pins numbered `numbers`. */
async function importNone(
  server: Server,
  name: string,
  numbers: string[],
): Promise<string> {
  const pins = numbers.map((n, i) => ({
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
  const { status, json } = await call(server, "POST", "/imports/drawn", {
    drawnSymbol: {
      source: {
        name,
        unitCount: 1,
        referenceText: "U?",
        valueText: name,
        pins,
        graphics: [],
        warnings: [],
      },
      referencePrefix: "U",
    },
    footprintMode: "none",
    component: { name, description: "fp assign test" },
  });
  expect(status).toBe(201);
  return json.data.componentId as string;
}

// Generated footprints are re-derived server-side from these parameters.
const SOIC8_GENERATOR = {
  kind: "ipc7351b",
  family: "soic",
  size: "SOIC-8",
  density: "nominal",
} as const;

function soic8() {
  const result = generateFootprint("soic", "SOIC-8", "nominal");
  return { source: result.source, metadata: result.metadata };
}

describe("library: assign / replace component default footprint", () => {
  test("POST /components/:id/footprints (generated SOIC-8) links + sets default", async () => {
    const { server, sdk } = await boot();
    const id = await importNone(server, "FpAddA", ["1", "2"]);
    const before = await sdk.resolveComponentForPlacement(id);
    expect(before?.footprint.footprintId).toBe(PLACEHOLDER);

    const res = await call(server, "POST", `/components/${id}/footprints`, {
      mode: "generated",
      source: soic8(),
      generator: SOIC8_GENERATOR,
    });
    expect(res.status).toBe(201);
    const footprintId = res.json.data.footprintId as string;

    const after = await sdk.resolveComponentForPlacement(id);
    expect(after?.footprint.footprintId).toBe(footprintId);
    expect(after?.footprint.preview?.pads.length).toBe(8);
    expect(after?.footprint.pinMap?.map((e) => e.pinNumber)).toEqual(["1", "2"]);
    const variants = after?.footprintVariants ?? [];
    expect(variants.map((v) => v.footprintId)).toContain(footprintId);
    expect(variants.map((v) => v.footprintId)).toContain(PLACEHOLDER);
    expect(variants.filter((v) => v.isDefault).map((v) => v.footprintId)).toEqual([
      footprintId,
    ]);
  });

  test("POST footprints with setDefault=false keeps the old default", async () => {
    const { server, sdk } = await boot();
    const id = await importNone(server, "FpAddB", ["1", "2"]);
    const res = await call(server, "POST", `/components/${id}/footprints`, {
      mode: "drawn",
      source: soic8(),
      setDefault: false,
      variantLabel: "alt",
    });
    expect(res.status).toBe(201);
    const after = await sdk.resolveComponentForPlacement(id);
    expect(after?.footprint.footprintId).toBe(PLACEHOLDER);
    expect(
      after?.footprintVariants.some(
        (v) => v.footprintId === res.json.data.footprintId,
      ),
    ).toBe(true);
  });

  test("POST footprints rejects pin numbers without pads; nothing persisted", async () => {
    const { server, sdk } = await boot();
    const id = await importNone(server, "FpAddC", ["1", "99"]);
    const res = await call(server, "POST", `/components/${id}/footprints`, {
      mode: "generated",
      source: soic8(),
      generator: SOIC8_GENERATOR,
    });
    expect(res.status).toBe(400);
    const after = await sdk.resolveComponentForPlacement(id);
    expect(after?.footprint.footprintId).toBe(PLACEHOLDER);
    expect(after?.footprintVariants.length).toBe(1);
  });

  test("PATCH defaultFootprintId: OK + persisted, replace back to placeholder", async () => {
    const { server, sdk } = await boot();
    const id = await importNone(server, "FpPatchA", ["1", "2"]);
    const other = await importNone(server, "FpPatchSrc", ["1"]);
    const created = await call(server, "POST", `/components/${other}/footprints`, {
      mode: "generated",
      source: soic8(),
      generator: SOIC8_GENERATOR,
    });
    const fpId = created.json.data.footprintId as string;

    const patched = await call(server, "PATCH", `/components/${id}`, {
      defaultFootprintId: fpId,
    });
    expect(patched.status).toBe(200);
    expect(patched.json.data.component.footprintId).toBe(fpId);
    const placed = await sdk.resolveComponentForPlacement(id);
    expect(placed?.footprint.footprintId).toBe(fpId);
    expect(placed?.footprint.pinMap?.length).toBe(2);

    const back = await call(server, "PATCH", `/components/${id}`, {
      defaultFootprintId: PLACEHOLDER,
    });
    expect(back.status).toBe(200);
    const placedBack = await sdk.resolveComponentForPlacement(id);
    expect(placedBack?.footprint.footprintId).toBe(PLACEHOLDER);
    expect(
      placedBack?.footprintVariants.filter((v) => v.isDefault).length,
    ).toBe(1);
  });

  test("PATCH defaultFootprintId: pin mismatch rejected, nothing changed", async () => {
    const { server, sdk } = await boot();
    const src = await importNone(server, "FpMmSrc", ["1"]);
    const created = await call(server, "POST", `/components/${src}/footprints`, {
      mode: "generated",
      source: soic8(),
      generator: SOIC8_GENERATOR,
    });
    const fpId = created.json.data.footprintId as string;
    const id = await importNone(server, "FpMm", ["1", "42"]);

    const res = await call(server, "PATCH", `/components/${id}`, {
      name: "Renamed",
      defaultFootprintId: fpId,
    });
    expect(res.status).toBe(400);
    const comp = (await sdk.resolveComponentForPlacement(id))!;
    expect(comp.footprint.footprintId).toBe(PLACEHOLDER);
    expect(comp.component.name).toBe("FpMm");

    const missing = await call(server, "PATCH", `/components/${id}`, {
      defaultFootprintId: "does-not-exist",
    });
    expect(missing.status).toBe(400);
  });

  test("built-in component is rejected for both operations", async () => {
    const { server, sdk } = await boot();
    const page = await sdk.searchComponents({ limit: 200 });
    const builtin = page.find((c) => c.isBuiltin);
    expect(builtin).toBeDefined();
    const patch = await call(server, "PATCH", `/components/${builtin!.id}`, {
      defaultFootprintId: PLACEHOLDER,
    });
    expect(patch.status).toBe(400);
    expect(JSON.stringify(patch.json)).toContain("Cannot edit built-in component");
    const post = await call(
      server,
      "POST",
      `/components/${builtin!.id}/footprints`,
      { mode: "generated", source: soic8(), generator: SOIC8_GENERATOR },
    );
    expect(post.status).toBe(400);
  });

  test("getDefaultFootprintRefs: batch, unknown ids absent", async () => {
    const { server, sdk } = await boot();
    const id = await importNone(server, "FpRefs", ["1"]);
    const refs = await sdk.getDefaultFootprintRefs([id, id, "nope"]);
    expect(Object.keys(refs)).toEqual([id]);
    expect(refs[id]?.footprintId).toBe(PLACEHOLDER);
  });
  test("POST footprints with a malformed pad is 400 and persists nothing", async () => {
    const { server, sdk } = await boot();
    const id = await importNone(server, "FpAddBad", ["1", "2"]);
    const valid = soic8();
    const badBodies = [
      { ...valid, source: { ...valid.source, pads: [{ number: "1" }] } },
      {
        ...valid,
        source: {
          ...valid.source,
          pads: [{ ...valid.source.pads[0], widthMm: "x" }],
        },
      },
      { ...valid, metadata: { ...valid.metadata, mountType: "bogus" } },
      { ...valid, metadata: { ...valid.metadata, packageCode: "x" } },
      { ...valid, metadata: { ...valid.metadata, tags: [1] } },
      { ...valid, metadata: { ...valid.metadata, name: "  " } },
    ];
    for (const source of badBodies) {
      const res = await call(server, "POST", `/components/${id}/footprints`, {
        mode: "generated",
        source,
      });
      expect(res.status).toBe(400);
    }
    const after = await sdk.resolveComponentForPlacement(id);
    expect(after?.footprint.footprintId).toBe(PLACEHOLDER);
    expect(after?.footprintVariants.length).toBe(1);
  });

  test("deleting the only none component keeps the placeholder row", async () => {
    const { server } = await boot();
    const id = await importNone(server, "FpDelOnly", ["1"]);
    const del = await call(server, "POST", "/components/delete", { ids: [id] });
    expect(del.status).toBe(200);
    const fp = await call(server, "GET", `/footprints/${PLACEHOLDER}`);
    expect(fp.status).toBe(200);
  });

  test("shared placeholder footprint model routes are rejected", async () => {
    const { server } = await boot();
    await importNone(server, "FpPlaceholderGuard", ["1"]);
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const res = await call(
        server,
        method,
        `/footprints/${PLACEHOLDER}/model`,
        method === "PATCH" ? { status: "failed", errorMessage: "x" } : {},
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.json)).toContain("placeholder footprint is shared");
    }
  });
});
