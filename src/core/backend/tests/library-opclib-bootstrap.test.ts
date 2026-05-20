import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MODULE_SDK_TOKENS, type LibrarySDK } from "../../../sdks";

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

async function bootRuntime(): Promise<ModuleRuntime> {
  const moduleRegistry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: REPO_ROOT,
  });
  await runtime.bootstrap();
  return runtime;
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

    const capacitor = await sdk.resolveComponentForPlacement(
      "openpcb.core.passive.capacitor",
    );
    expect(capacitor).not.toBeNull();
    expect(capacitor!.footprintVariants.length).toBe(8);
    expect(capacitor!.footprint.footprintId).toBe(
      "openpcb.core.footprint.passive.c-0603",
    );

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
});
