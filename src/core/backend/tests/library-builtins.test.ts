import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { LibrarySDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import {
  BUILTIN_COMPONENT_IDS,
  BUILTIN_FOOTPRINT_IDS,
} from "../../../modules/library/backend/builtins/seed";
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
    expect(builtinCountBefore).toBe(BUILTIN_COMPONENT_IDS.size);

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
    expect(builtinCountAfter).toBe(BUILTIN_COMPONENT_IDS.size);
  });

  // The library SDK's `getFootprint` returns a flat `LibraryFootprint`
  // (`{ id, name, data }`); the curated preview lives at
  // `data.normalized.preview`. `LibraryFootprintDetail` (with `padCount`,
  // `preview`, etc.) is only produced by `getComponentDetail`.
  function readPreview(fp: { data: Record<string, unknown> } | null): {
    pads: Array<{
      centerMm: { x: number; y: number };
      layer: string;
      drillDiameterMm?: number;
    }>;
    kind: string;
  } | null {
    const normalized = (fp?.data as { normalized?: { preview?: unknown } })
      ?.normalized;
    return (normalized?.preview as ReturnType<typeof readPreview>) ?? null;
  }

  test("seeds 17 builtin footprints with non-empty pads (SMD chip + THT axial + disc)", async () => {
    const { librarySdk } = await bootHarness("library-builtins-footprints");
    expect(BUILTIN_FOOTPRINT_IDS.size).toBe(17);
    for (const fpId of BUILTIN_FOOTPRINT_IDS) {
      const fp = await librarySdk.getFootprint(fpId);
      expect(fp).not.toBeNull();
      const preview = readPreview(fp);
      expect(preview).not.toBeNull();
      expect(preview!.pads.length).toBe(2);
    }
  });

  test("R_0603_1608Metric pad geometry matches IPC nominal density (~1.55mm pad-pad center)", async () => {
    const { librarySdk } = await bootHarness("library-builtins-r0603-geom");
    const fp = await librarySdk.getFootprint("builtin:fp:r-0603-1608m");
    const preview = readPreview(fp);
    expect(preview).not.toBeNull();
    const xs = preview!.pads.map((p) => p.centerMm.x).sort((a, b) => a - b);
    const span = xs[1]! - xs[0]!;
    expect(span).toBeGreaterThan(1.4);
    expect(span).toBeLessThan(1.7);
    for (const pad of preview!.pads) {
      expect(pad.layer).toBe("F.Cu");
    }
  });

  test("THT footprints expose drilled pads (drillDiameterMm > 0) and *.Cu layer", async () => {
    const { librarySdk } = await bootHarness("library-builtins-tht-drill");
    const thtIds = [
      "builtin:fp:r-axial-din0207-p7.62",
      "builtin:fp:r-axial-din0207-p10.16",
      "builtin:fp:r-axial-din0309-p12.70",
      "builtin:fp:c-disc-d3-p2.5",
      "builtin:fp:c-disc-d5-p5",
      "builtin:fp:c-disc-d7.5-p5",
    ];
    for (const id of thtIds) {
      const fp = await librarySdk.getFootprint(id);
      const preview = readPreview(fp);
      expect(preview).not.toBeNull();
      for (const pad of preview!.pads) {
        expect(pad.drillDiameterMm ?? 0).toBeGreaterThan(0);
        expect(pad.layer).toBe("*.Cu");
      }
    }
  });

  test("R_Axial_DIN0207 P7.62mm pads sit at ±3.81mm (= 7.62mm pitch)", async () => {
    const { librarySdk } = await bootHarness("library-builtins-axial-pitch");
    const fp = await librarySdk.getFootprint(
      "builtin:fp:r-axial-din0207-p7.62",
    );
    const preview = readPreview(fp);
    expect(preview).not.toBeNull();
    const xs = preview!.pads.map((p) => p.centerMm.x).sort((a, b) => a - b);
    expect(Math.abs(xs[1]! - xs[0]!)).toBeCloseTo(7.62, 5);
  });

  test("Generic builtin:resistor + builtin:capacitor repointed to 0603 footprints", async () => {
    const { librarySdk } = await bootHarness("library-builtins-default-fp");
    const r = await librarySdk.getComponentDetail("builtin:resistor");
    const c = await librarySdk.getComponentDetail("builtin:capacitor");
    expect(r?.component.footprintId).toBe("builtin:fp:r-0603-1608m");
    expect(c?.component.footprintId).toBe("builtin:fp:c-0603-1608m");
    expect(r?.footprint.padCount).toBe(2);
    expect(c?.footprint.padCount).toBe(2);
  });

  test("builtin:resistor exposes 9 footprint variants (6 SMD + 3 THT) with default flagged", async () => {
    const { librarySdk } = await bootHarness("library-builtins-r-variants");
    const detail = await librarySdk.getComponentDetail("builtin:resistor");
    expect(detail).not.toBeNull();
    const variants = detail!.footprintVariants;
    expect(variants.length).toBe(9);
    const defaults = variants.filter((v) => v.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0]!.footprintId).toBe("builtin:fp:r-0603-1608m");
    expect(detail!.component.footprintId).toBe(defaults[0]!.footprintId);
    // Sort order: variants are ordered by sortOrder ascending.
    const sortOrders = variants.map((v) => v.sortOrder);
    const sorted = [...sortOrders].sort((a, b) => a - b);
    expect(sortOrders).toEqual(sorted);
  });

  test("builtin:capacitor exposes 8 footprint variants with default flagged", async () => {
    const { librarySdk } = await bootHarness("library-builtins-c-variants");
    const detail = await librarySdk.getComponentDetail("builtin:capacitor");
    expect(detail).not.toBeNull();
    const variants = detail!.footprintVariants;
    expect(variants.length).toBe(8);
    const defaults = variants.filter((v) => v.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0]!.footprintId).toBe("builtin:fp:c-0603-1608m");
  });

  test("placement detail surfaces footprintVariants for picker UIs", async () => {
    const { librarySdk } = await bootHarness(
      "library-builtins-placement-variants",
    );
    const placement =
      await librarySdk.resolveComponentForPlacement("builtin:resistor");
    expect(placement).not.toBeNull();
    expect(placement!.footprintVariants.length).toBe(9);
  });

  test("legacy sized component IDs are removed on boot (no builtin:resistor:0805)", async () => {
    const { librarySdk } = await bootHarness("library-builtins-legacy-removed");
    const all = await librarySdk.searchComponents({ query: "", limit: 100 });
    const ids = all.map((c) => c.id);
    expect(ids).not.toContain("builtin:resistor:0805");
    expect(ids).not.toContain("builtin:capacitor:tht-disc-d5");
    expect(ids).toContain("builtin:resistor");
    expect(ids).toContain("builtin:capacitor");
  });

  test("DELETE rejects builtin component ids with HTTP 400", async () => {
    const { server } = await bootHarness("library-builtins-delete");
    const response = await server.fetch(
      new Request("http://localhost/api/modules/library/components/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: ["builtin:resistor", "builtin:capacitor"],
        }),
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
