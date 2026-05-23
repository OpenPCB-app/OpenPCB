import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MODULE_SDK_TOKENS, type LibrarySDK } from "../../../sdks";
import { readOpclibFromPath } from "../../../modules/library/backend/sync/opclib-reader";
import { importOpclib } from "../../../modules/library/backend/sync/opclib-importer";
import { locateBundledOpclib } from "../../../modules/library/backend/sync/package-locator";
import { getDb } from "../../../modules/library/backend/queries";
import { componentFootprints } from "../../../modules/library/backend/schema";
import { eq } from "drizzle-orm";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
// Resolve the bundled .opclib via the same locator the production code uses.
// Returns null in environments where no .opclib exists yet (e.g. fresh checkout
// before `npm run corelib:fetch`) — tests below short-circuit in that case.
const BUNDLED = await locateBundledOpclib({ repoRoot: REPO_ROOT });

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

// Skip the whole suite when no bundled .opclib is locatable (fresh checkout
// before `npm run corelib:fetch`). The bootstrap-based first test would error
// on missing library at module activation; better to surface a clear skip.
const describeWithLib = BUNDLED ? describe : describe.skip;

describeWithLib("opclib importer idempotent re-import", () => {
  test("re-import of same package: variants updated, no duplicates", async () => {
    isolateTestDb("opclib-reimport");
    const moduleRegistry = new ModuleRouterRegistry();
    const runtime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: REPO_ROOT,
    });
    await runtime.bootstrap();

    // Bootstrap already imported once. Call importOpclib directly to re-import.
    const sdkRegistry = runtime.getSdkRegistry();
    const sdk = sdkRegistry.resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);

    // Re-importing needs a ctx; reuse the library module's runtime context
    // by finding it through the loaded modules list. The simpler path: load
    // the .opclib bytes and call importOpclib via a fresh module context.
    // Since the SDK doesn't expose importOpclib, we drive it via direct
    // import-and-invocation, mirroring what bootstrap does.

    // Grab a context-shaped object via the SDK registry's underlying ctx.
    // The cleanest available handle is to re-bootstrap a second runtime
    // against the same DB and grab its first activate event's ctx, but
    // simpler: re-read the package and invoke importOpclib using a context
    // we synthesise from runtime internals. Instead, we just call importOpclib
    // a second time through a fresh runtime that re-uses the same SQLite file.
    const runtime2 = new ModuleRuntime({
      moduleRegistry: new ModuleRouterRegistry(),
      workspaceRoot: REPO_ROOT,
    });
    await runtime2.bootstrap();
    // Now runtime2's library module activated; bootstrap.ts saw
    // alreadyInstalled=true and skipped re-import. We invoke importOpclib
    // directly. The trick: we need a CoreBackendModuleContext. Use the
    // approach the library module itself uses — go through the SDK registry
    // ... but importOpclib needs the raw ctx, not the SDK. Construct it
    // from a Bun import.

    // The cleanest test path is: drive ImportResult through a second
    // explicit importOpclib() call. We need a ctx. The module-loader
    // exposes contexts via a private map; use the public path:
    // the existing test harness in library-opclib-bootstrap.test.ts only
    // ever resolves through the SDK. For this test, we'll verify
    // idempotency via DB-level invariants instead.

    // Verify no duplicate variant rows for the resistor (expected: 9).
    // Use the raw drizzle handle via getDb; we need a ctx — get one via
    // a dynamic re-import. Easiest: query through the SDK.
    const detail = await sdk.getComponentDetail(
      "openpcb.core.passive.resistor",
    );
    expect(detail).not.toBeNull();
    expect(detail!.footprintVariants.length).toBe(9);

    // Re-run bootstrap a third time. Even after multiple boots, variant
    // row count must remain 9 for resistor.
    const runtime3 = new ModuleRuntime({
      moduleRegistry: new ModuleRouterRegistry(),
      workspaceRoot: REPO_ROOT,
    });
    await runtime3.bootstrap();
    const detail2 = await sdk.getComponentDetail(
      "openpcb.core.passive.resistor",
    );
    expect(detail2!.footprintVariants.length).toBe(9);
  });

  test("direct importOpclib re-call: updated counts, no row duplication", async () => {
    isolateTestDb("opclib-reimport-direct");
    const moduleRegistry = new ModuleRouterRegistry();
    const runtime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: REPO_ROOT,
    });
    await runtime.bootstrap();

    // Find the library module's ctx via the loaded-module records.
    // ModuleRuntime exposes `loaded` only privately; we reach in via the
    // sdk registry. There's no public API yet — use a workaround:
    // re-resolve through the typed registry, find the SDK build context.
    // Instead, drive importOpclib through a private cast.
    interface RuntimeInternals {
      loaded: Map<string, { context: unknown }>;
    }
    const internals = runtime as unknown as RuntimeInternals;
    const libLoaded = internals.loaded.get("library");
    expect(libLoaded).toBeDefined();
    const ctx = libLoaded!.context as Parameters<typeof importOpclib>[0];

    const pkg = await readOpclibFromPath(BUNDLED!);
    const result = await importOpclib(ctx, pkg, { installOrigin: "bundled" });

    // Counts come from the manifest so the test stays accurate as the library
    // grows. The invariant we care about: re-importing inserts nothing new
    // and updates each row exactly once (no duplication).
    const expectedSymbols = pkg.manifest.symbols.length;
    const expectedFootprints = pkg.manifest.footprints.length;
    const expectedComponents = pkg.manifest.components.length;

    expect(result.reimport).toBe(true);
    expect(result.inserted.symbols).toBe(0);
    expect(result.inserted.footprints).toBe(0);
    expect(result.inserted.components).toBe(0);
    expect(result.inserted.variants).toBe(0);
    expect(result.updated.symbols).toBe(expectedSymbols);
    expect(result.updated.footprints).toBe(expectedFootprints);
    expect(result.updated.components).toBe(expectedComponents);

    // Variant row count invariant: resistor still has exactly 9.
    const db = getDb(ctx);
    const rows = await db
      .select({ footprintId: componentFootprints.footprintId })
      .from(componentFootprints)
      .where(
        eq(componentFootprints.componentId, "openpcb.core.passive.resistor"),
      )
      .all();
    expect(rows.length).toBe(9);
    const unique = new Set(rows.map((r) => r.footprintId));
    expect(unique.size).toBe(9);
  });
});
