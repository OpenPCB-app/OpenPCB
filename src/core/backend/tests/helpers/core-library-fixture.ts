import { test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCoreLibraryFixture } from "./core-library-fixture-data";
export { buildCoreLibraryFixture, CORE_LIBRARY_FIXTURE_COUNT } from "./core-library-fixture-data";

/** Keep bundle selection scoped to the test, including status requests after bootstrap. */
export function coreLibraryFixturePath(): string {
  const bundle = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
  if (!bundle) throw new Error("CoreLibrary test fixture is not active");
  return bundle;
}

export function coreLibraryTest(name: string, run: () => void | Promise<void>): void {
  test(name, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openpcb-core-fixture-"));
    const previous = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const bundle = path.join(root, "openpcb-core-library-1.0.0.opclib");
    try {
      await writeFile(bundle, buildCoreLibraryFixture());
      process.env.OPENPCB_BUNDLED_LIBRARY_PATH = bundle;
      await run();
    } finally {
      if (previous === undefined) delete process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
      else process.env.OPENPCB_BUNDLED_LIBRARY_PATH = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
}
