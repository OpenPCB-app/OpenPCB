import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { packOpclib } from "@openpcb/opclib-pack";
import { eq } from "drizzle-orm";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MODULE_SDK_TOKENS, type LibrarySDK } from "../../../sdks";
import { getDb } from "../../../modules/library/backend/queries";
import {
  components,
  footprintModels,
  footprints,
  releases,
  symbols,
} from "../../../modules/library/backend/schema";

const tempRoots: string[] = [];
let prevBundleEnv: string | undefined;

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

afterEach(async () => {
  if (prevBundleEnv === undefined) delete process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
  else process.env.OPENPCB_BUNDLED_LIBRARY_PATH = prevBundleEnv;
  prevBundleEnv = undefined;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function bootRuntime(): Promise<ModuleRuntime> {
  const moduleRegistry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: REPO_ROOT,
  });
  await runtime.bootstrap();
  return runtime;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildCorePackage(version: string, componentId: string): Uint8Array {
  const slug = componentId.replace("openpcb.core.", "");
  const symbolId = `openpcb.core.symbol.${slug}`;
  const footprintId = `openpcb.core.footprint.${slug}`;
  const symBytes = new TextEncoder().encode(JSON.stringify({ id: symbolId }));
  const fpBytes = new TextEncoder().encode(JSON.stringify({ id: footprintId }));
  const compBytes = new TextEncoder().encode(JSON.stringify({ id: componentId }));
  return packOpclib({
    library: {
      id: "openpcb.core",
      name: "OpenPCB Core Library",
      kind: "core",
      channel: version.includes("dev") ? "nightly" : "stable",
      version,
      license: "MIT",
      generatedAt: "2026-05-22T00:00:00.000Z",
    },
    symbols: [
      {
        entry: {
          id: symbolId,
          uuid: "00000000-0000-0000-0000-000000000001",
          version: "1.0.0",
          name: "X",
          path: "symbols/x.symbol.json",
          sha256: sha256(symBytes),
        },
        bytes: symBytes,
      },
    ],
    footprints: [
      {
        entry: {
          id: footprintId,
          uuid: "00000000-0000-0000-0000-000000000002",
          version: "1.0.0",
          name: "X",
          path: "footprints/x.fp.json",
          sha256: sha256(fpBytes),
        },
        bytes: fpBytes,
      },
    ],
    models3d: [],
    components: [
      {
        entry: {
          id: componentId,
          uuid: crypto.randomUUID(),
          version: "1.0.0",
          name: componentId,
          category: "test",
          symbol: symbolId,
          defaultFootprint: footprintId,
          footprints: [{ footprint: footprintId, label: "default" }],
          provenance: { source: "openpcb-original", license: "MIT" },
        },
        path: "components/x.component.json",
        bytes: compBytes,
      },
    ],
  }).bytes;
}

function buildPackageWithModel(input: {
  libraryId: string;
  version: string;
  componentId: string;
  includeGlb: boolean;
}): Uint8Array {
  const slug = input.componentId.replace(`${input.libraryId}.`, "");
  const symbolId = `${input.libraryId}.symbol.${slug}`;
  const footprintId = `${input.libraryId}.footprint.${slug}`;
  const modelId = `${input.libraryId}.3d.${slug}`;
  const symBytes = new TextEncoder().encode(JSON.stringify({ id: symbolId }));
  const fpBytes = new TextEncoder().encode(JSON.stringify({ id: footprintId }));
  const compBytes = new TextEncoder().encode(JSON.stringify({ id: input.componentId }));
  const stepBytes = new TextEncoder().encode("ISO-10303-21; END-ISO-10303-21;");
  const glbBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  return packOpclib({
    library: {
      id: input.libraryId,
      name: input.libraryId,
      kind: input.libraryId === "openpcb.core" ? "core" : "user",
      channel: "stable",
      version: input.version,
      license: "MIT",
      generatedAt: "2026-05-22T00:00:00.000Z",
    },
    symbols: [
      {
        entry: {
          id: symbolId,
          uuid: "10000000-0000-0000-0000-000000000001",
          version: "1.0.0",
          name: "X",
          path: "symbols/x.symbol.json",
          sha256: sha256(symBytes),
        },
        bytes: symBytes,
      },
    ],
    footprints: [
      {
        entry: {
          id: footprintId,
          uuid: "10000000-0000-0000-0000-000000000002",
          version: "1.0.0",
          name: "X",
          path: "footprints/x.fp.json",
          sha256: sha256(fpBytes),
          models3d: [modelId],
        },
        bytes: fpBytes,
      },
    ],
    models3d: [
      {
        entry: {
          id: modelId,
          uuid: "10000000-0000-0000-0000-000000000003",
          version: "1.0.0",
          name: "X model",
          formats: {
            step: { path: "3d/x.step", sha256: sha256(stepBytes) },
            ...(input.includeGlb
              ? { glb: { path: "3d/x.glb", sha256: sha256(glbBytes) } }
              : {}),
          },
        },
        assets: [
          { format: "step", path: "3d/x.step", bytes: stepBytes },
          ...(input.includeGlb
            ? [{ format: "glb" as const, path: "3d/x.glb", bytes: glbBytes }]
            : []),
        ],
      },
    ],
    components: [
      {
        entry: {
          id: input.componentId,
          uuid: crypto.randomUUID(),
          version: "1.0.0",
          name: input.componentId,
          category: "test",
          symbol: symbolId,
          defaultFootprint: footprintId,
          footprints: [{ footprint: footprintId, label: "default" }],
          provenance: { source: "openpcb-original", license: "MIT" },
        },
        path: "components/x.component.json",
        bytes: compBytes,
      },
    ],
  }).bytes;
}

describe("core library .opclib bootstrap", () => {
  test("imports bundled package and exposes resistor/capacitor with all variants", async () => {
    isolateTestDb("opclib-bootstrap");
    const runtime = await bootRuntime();

    const sdk = runtime
      .getSdkRegistry()
      .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
    const resistor = await sdk.resolveComponentForPlacement(
      "openpcb.core.passive.resistor",
    );
    expect(resistor).not.toBeNull();
    expect(resistor!.footprintVariants.length).toBe(9);
    expect(resistor!.footprint.footprintId).toBe(
      "openpcb.core.footprint.passive.r-0603",
    );
    expect(resistor!.footprint.model3d).toMatchObject({ status: "ready" });

    const capacitor = await sdk.resolveComponentForPlacement(
      "openpcb.core.passive.capacitor",
    );
    expect(capacitor).not.toBeNull();
    expect(capacitor!.footprintVariants.length).toBe(8);
    expect(capacitor!.footprint.footprintId).toBe(
      "openpcb.core.footprint.passive.c-0603",
    );
    expect(capacitor!.footprint.model3d).toMatchObject({ status: "ready" });

    // Tags retained
    const tags = await sdk.listTags();
    const passive = tags.find((t) => t.tag === "passive");
    expect(passive).toBeDefined();
    expect(passive!.count).toBeGreaterThanOrEqual(2);
  });

  test("re-bootstrap is idempotent", async () => {
    isolateTestDb("opclib-bootstrap-idempotent");
    await bootRuntime();
    const r2 = await bootRuntime();

    const sdk = r2
      .getSdkRegistry()
      .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
    const results = await sdk.searchComponents({});
    const ids = results.map((c) => c.id);
    expect(ids).toContain("openpcb.core.passive.resistor");
    expect(ids).toContain("openpcb.core.passive.capacitor");
    // No duplicates from the second bootstrap
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("can switch normal dev DB from fixed dev package back to bundled release", async () => {
    isolateTestDb("opclib-bootstrap-dev-switch");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const root = await mkdtemp(path.join(os.tmpdir(), "opclib-switch-"));
    tempRoots.push(root);
    const devPath = path.join(root, "openpcb-core-library-999.0.0-dev.opclib");
    const releasePath = path.join(root, "openpcb-core-library-1.0.0.opclib");
    await writeFile(devPath, buildCorePackage("999.0.0-dev", "openpcb.core.test.dev-only"));
    await writeFile(releasePath, buildCorePackage("1.0.0", "openpcb.core.test.release-only"));

    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = devPath;
    await bootRuntime();

    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = releasePath;
    const runtime = await bootRuntime();
    const sdk = runtime
      .getSdkRegistry()
      .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
    const ids = (await sdk.searchComponents({})).map((component) => component.id);
    expect(ids).toContain("openpcb.core.test.release-only");
    expect(ids).not.toContain("openpcb.core.test.dev-only");

    const internals = runtime as unknown as MapBackedRuntime;
    const ctx = internals.loaded.get("library")!.context as Parameters<
      typeof getDb
    >[0];
    const releaseRows = getDb(ctx).select().from(releases).all();
    expect(releaseRows.map((row) => row.version)).toContain("999.0.0-dev");
    expect(releaseRows.map((row) => row.version)).toContain("1.0.0");
    const symbolIds = getDb(ctx)
      .select({ id: symbols.id })
      .from(symbols)
      .all()
      .map((row) => row.id);
    const footprintIds = getDb(ctx)
      .select({ id: footprints.id })
      .from(footprints)
      .all()
      .map((row) => row.id);
    expect(symbolIds).not.toContain("openpcb.core.symbol.test.dev-only");
    expect(footprintIds).not.toContain("openpcb.core.footprint.test.dev-only");
  });

  test("keeps stale core assets when user components still reference them", async () => {
    isolateTestDb("opclib-bootstrap-dev-switch-user-ref");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const root = await mkdtemp(path.join(os.tmpdir(), "opclib-switch-ref-"));
    tempRoots.push(root);
    const devPath = path.join(root, "openpcb-core-library-999.0.0-dev.opclib");
    const releasePath = path.join(root, "openpcb-core-library-1.0.0.opclib");
    await writeFile(devPath, buildCorePackage("999.0.0-dev", "openpcb.core.test.dev-only"));
    await writeFile(releasePath, buildCorePackage("1.0.0", "openpcb.core.test.release-only"));

    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = devPath;
    const firstRuntime = await bootRuntime();
    const firstCtx = (firstRuntime as unknown as MapBackedRuntime).loaded.get(
      "library",
    )!.context as Parameters<typeof getDb>[0];
    getDb(firstCtx)
      .insert(components)
      .values({
        id: "user.local.dev-copy",
        name: "Dev Copy",
        description: "",
        symbolId: "openpcb.core.symbol.test.dev-only",
        footprintId: "openpcb.core.footprint.test.dev-only",
        tagsJson: JSON.stringify(["user"]),
        createdAt: new Date().toISOString(),
        isBuiltin: 0,
        sourceId: "user.local",
        version: "1.0.0",
        uuid: "user.local.dev-copy",
        contentSha256: null,
        originJson: null,
      })
      .run();

    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = releasePath;
    const runtime = await bootRuntime();
    const ctx = (runtime as unknown as MapBackedRuntime).loaded.get("library")!
      .context as Parameters<typeof getDb>[0];
    const symbolIds = getDb(ctx)
      .select({ id: symbols.id })
      .from(symbols)
      .all()
      .map((row) => row.id);
    const footprintIds = getDb(ctx)
      .select({ id: footprints.id })
      .from(footprints)
      .all()
      .map((row) => row.id);
    expect(symbolIds).toContain("openpcb.core.symbol.test.dev-only");
    expect(footprintIds).toContain("openpcb.core.footprint.test.dev-only");
  });

  test("core opclib imports GLB-backed 3D model metadata", async () => {
    isolateTestDb("opclib-bootstrap-3d-ready");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const root = await mkdtemp(path.join(os.tmpdir(), "opclib-3d-"));
    tempRoots.push(root);
    const packagePath = path.join(root, "openpcb-core-library-1.2.3.opclib");
    await writeFile(
      packagePath,
      buildPackageWithModel({
        libraryId: "openpcb.core",
        version: "1.2.3",
        componentId: "openpcb.core.test.with-model",
        includeGlb: true,
      }),
    );
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = packagePath;

    const runtime = await bootRuntime();
    const ctx = (runtime as unknown as MapBackedRuntime).loaded.get("library")!
      .context as Parameters<typeof getDb>[0];
    const row = getDb(ctx)
      .select()
      .from(footprintModels)
      .where(eq(footprintModels.footprintId, "openpcb.core.footprint.test.with-model"))
      .get();
    expect(row?.status).toBe("ready");
    expect(row?.glbPath).toMatch(/^models\/glb\//);
    expect(row?.sourceFilename).toBe("x.step");
    expect(row?.sourceStepPath).toMatch(/^models\/source\//);
  });

  test("core opclib rejects referenced STEP-only 3D models", async () => {
    isolateTestDb("opclib-bootstrap-3d-reject-core");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const root = await mkdtemp(path.join(os.tmpdir(), "opclib-3d-reject-"));
    tempRoots.push(root);
    const packagePath = path.join(root, "openpcb-core-library-1.2.4.opclib");
    await writeFile(
      packagePath,
      buildPackageWithModel({
        libraryId: "openpcb.core",
        version: "1.2.4",
        componentId: "openpcb.core.test.step-only",
        includeGlb: false,
      }),
    );
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = packagePath;

    const runtime = await bootRuntime();
    const sdk = runtime
      .getSdkRegistry()
      .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
    const ids = (await sdk.searchComponents({})).map((component) => component.id);
    expect(ids).not.toContain("openpcb.core.test.step-only");
  });

  test("non-core opclib keeps STEP-only 3D policy permissive", async () => {
    isolateTestDb("opclib-bootstrap-3d-non-core");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const root = await mkdtemp(path.join(os.tmpdir(), "opclib-3d-non-core-"));
    tempRoots.push(root);
    const packagePath = path.join(root, "openpcb-user-library-1.2.5.opclib");
    await writeFile(
      packagePath,
      buildPackageWithModel({
        libraryId: "user.local",
        version: "1.2.5",
        componentId: "user.local.test.step-only",
        includeGlb: false,
      }),
    );
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = packagePath;

    const runtime = await bootRuntime();
    const sdk = runtime
      .getSdkRegistry()
      .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
    const ids = (await sdk.searchComponents({})).map((component) => component.id);
    expect(ids).toContain("user.local.test.step-only");
  });
});

interface MapBackedRuntime {
  loaded: Map<string, { context: unknown }>;
}
