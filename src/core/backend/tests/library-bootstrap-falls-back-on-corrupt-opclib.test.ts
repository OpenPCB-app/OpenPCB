import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MODULE_SDK_TOKENS, type LibrarySDK } from "../../../sdks";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

describe("bootstrap falls back when bundled .opclib is corrupt", () => {
  let bundleDir: string;
  let prevBundleEnv: string | undefined;

  beforeEach(async () => {
    resetSharedSqliteForTesting();
    process.env.OPENPCB_DB_PATH = path.join(
      os.tmpdir(),
      `opclib-corrupt-${Date.now()}-${crypto.randomUUID()}.sqlite`,
    );
    bundleDir = await mkdtemp(path.join(os.tmpdir(), "opclib-corrupt-bundle-"));
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = bundleDir;
  });

  afterEach(async () => {
    if (prevBundleEnv === undefined)
      delete process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    else process.env.OPENPCB_BUNDLED_LIBRARY_PATH = prevBundleEnv;
    await rm(bundleDir, { recursive: true, force: true });
  });

  test("truncated .opclib does not import; openpcb.core not installed", async () => {
    // 16 bytes of junk — definitely not a valid ZIP.
    await writeFile(
      path.join(bundleDir, "openpcb-core-library-1.0.0.opclib"),
      new Uint8Array([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
        0x0c, 0x0d, 0x0e, 0x0f,
      ]),
    );

    const runtime = new ModuleRuntime({
      moduleRegistry: new ModuleRouterRegistry(),
      workspaceRoot: REPO_ROOT,
    });
    await runtime.bootstrap();

    const sdk = runtime
      .getSdkRegistry()
      .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);

    const all = await sdk.searchComponents({ query: "", limit: 100 });
    const ids = all.map((c) => c.id);
    // Import failed and no builtin seeder exists anymore.
    expect(ids).not.toContain("openpcb.core.passive.resistor");
    expect(ids).not.toContain("openpcb.core.passive.capacitor");
  });
});
