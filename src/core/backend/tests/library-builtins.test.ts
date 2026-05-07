import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { LibrarySDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

interface TestHarness {
  runtime: ModuleRuntime;
  registry: ModuleRouterRegistry;
  librarySdk: LibrarySDK;
  server: ReturnType<typeof createHttpServer>;
}

async function bootHarness(label: string): Promise<TestHarness> {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const registry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({
    moduleRegistry: registry,
    workspaceRoot: repoRoot,
  });
  await runtime.bootstrap();
  const sdkRegistry = runtime.getSdkRegistry();
  const librarySdk = sdkRegistry.resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry: registry,
    moduleRuntime: runtime,
  });
  return { runtime, registry, librarySdk, server };
}

describe("library builtins", () => {
  test("seeds RESISTOR and CAPACITOR with isBuiltin = true on cold boot", async () => {
    const { librarySdk } = await bootHarness("library-builtins-cold");
    const resistor = await librarySdk.resolveComponent("builtin:resistor");
    const capacitor = await librarySdk.resolveComponent("builtin:capacitor");
    expect(resistor).not.toBeNull();
    expect(capacitor).not.toBeNull();
    expect(resistor?.isBuiltin).toBe(true);
    expect(capacitor?.isBuiltin).toBe(true);
    expect(resistor?.tags).toContain("builtin");
    expect(capacitor?.tags).toContain("builtin");

    // Symbol must resolve with a valid render preview
    const detail = await librarySdk.getComponentDetail("builtin:resistor");
    expect(detail).not.toBeNull();
    expect(detail?.symbol.pinCount).toBe(2);
    const placement =
      await librarySdk.resolveComponentForPlacement("builtin:resistor");
    expect(placement).not.toBeNull();
    expect(placement?.symbol.pins.length).toBe(2);
    expect(placement?.symbol.preview.kind).toBe("symbol");
  });

  test("Resistor follows Flux-style horizontal convention with KLC text", async () => {
    const { librarySdk } = await bootHarness("library-builtins-resistor-geom");
    const placement =
      await librarySdk.resolveComponentForPlacement("builtin:resistor");
    expect(placement).not.toBeNull();
    const pins = placement!.symbol.pins;
    expect(pins.length).toBe(2);
    // Pins on horizontal axis at x = ±5.08 mm → 10.16 mm pin span
    const xCoords = pins.map((p) => p.localPositionMm.x).sort();
    expect(xCoords[0]).toBeCloseTo(-5.08, 5);
    expect(xCoords[1]).toBeCloseTo(5.08, 5);
    pins.forEach((p) => expect(p.localPositionMm.y).toBeCloseTo(0, 5));

    // Reference label at KLC 1.27 mm
    const referenceLabel = placement!.symbol.preview.labels.find(
      (l) => l.role === "reference",
    );
    expect(referenceLabel).toBeDefined();
    expect(referenceLabel?.fontSizeMm).toBeCloseTo(1.27, 5);
  });

  test("Capacitor follows KiCad-Device vertical convention with KLC text", async () => {
    const { librarySdk } = await bootHarness("library-builtins-capacitor-geom");
    const placement =
      await librarySdk.resolveComponentForPlacement("builtin:capacitor");
    expect(placement).not.toBeNull();
    const pins = placement!.symbol.pins;
    expect(pins.length).toBe(2);
    const yCoords = pins.map((p) => p.localPositionMm.y).sort();
    expect(yCoords[0]).toBeCloseTo(-3.81, 5);
    expect(yCoords[1]).toBeCloseTo(3.81, 5);

    const referenceLabel = placement!.symbol.preview.labels.find(
      (l) => l.role === "reference",
    );
    expect(referenceLabel?.fontSizeMm).toBeCloseTo(1.27, 5);
  });

  test("seeding is idempotent across module re-bootstrap", async () => {
    const harness = await bootHarness("library-builtins-warm");
    const before = await harness.librarySdk.searchComponents({
      query: "",
      limit: 100,
    });
    const builtinCountBefore = before.filter((c) => c.isBuiltin).length;
    expect(builtinCountBefore).toBe(2);

    // Re-bootstrap a second runtime against the SAME sqlite file
    const dbPath = process.env.OPENPCB_DB_PATH;
    expect(dbPath).toBeTruthy();
    resetSharedSqliteForTesting();
    process.env.OPENPCB_DB_PATH = dbPath;
    const repoRoot = path.resolve(import.meta.dir, "../../..");
    const registry2 = new ModuleRouterRegistry();
    const runtime2 = new ModuleRuntime({
      moduleRegistry: registry2,
      workspaceRoot: repoRoot,
    });
    await runtime2.bootstrap();
    const librarySdk2 = runtime2
      .getSdkRegistry()
      .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
    const after = await librarySdk2.searchComponents({
      query: "",
      limit: 100,
    });
    const builtinCountAfter = after.filter((c) => c.isBuiltin).length;
    expect(builtinCountAfter).toBe(2);
  });

  test("DELETE rejects builtin component ids with HTTP 400", async () => {
    const { server } = await bootHarness("library-builtins-delete");
    const response = await server.fetch(
      new Request("http://localhost/api/modules/library/components/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["builtin:resistor"] }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { detail?: string; title?: string };
    const message = body.detail ?? body.title ?? "";
    expect(message.toLowerCase()).toContain("built-in");
  });

  test("CLONE produces an editable copy with isBuiltin = false", async () => {
    const { server, librarySdk } = await bootHarness("library-builtins-clone");
    const response = await server.fetch(
      new Request(
        "http://localhost/api/modules/library/components/builtin:resistor/clone",
        { method: "POST" },
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: boolean;
      data: { componentId: string; componentName: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.componentName).toBe("Resistor (Copy)");

    const cloned = await librarySdk.resolveComponent(body.data.componentId);
    expect(cloned).not.toBeNull();
    expect(cloned?.isBuiltin).toBe(false);
    expect(cloned?.tags).toContain("user");
    expect(cloned?.tags).not.toContain("builtin");
    expect(cloned?.tags).not.toContain("system");
  });

  test("CLONE on missing component returns 404", async () => {
    const { server } = await bootHarness("library-builtins-clone-404");
    const response = await server.fetch(
      new Request(
        "http://localhost/api/modules/library/components/no-such-id/clone",
        { method: "POST" },
      ),
    );
    expect(response.status).toBe(404);
  });

  test("URL-encoded builtin id resolves on the designer placement route", async () => {
    // Regression: clients call encodeURIComponent("builtin:resistor") which
    // becomes "builtin%3Aresistor". Without router-level decoding, the
    // backend looks up the encoded id and returns 404, breaking drag-drop.
    const { server } = await bootHarness("library-builtins-encoded-id");
    const encoded = encodeURIComponent("builtin:resistor");
    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/library/components/${encoded}/placement`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { detail: { component: { id: string } } };
    };
    expect(body.data.detail.component.id).toBe("builtin:resistor");
  });
});
