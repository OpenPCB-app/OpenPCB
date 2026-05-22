import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { locateBundledOpclib } from "../../../modules/library/backend/sync/package-locator";

describe("package-locator semver sort", () => {
  let dir: string;
  let prevEnv: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "opclib-locator-"));
    prevEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = dir;
  });

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    else process.env.OPENPCB_BUNDLED_LIBRARY_PATH = prevEnv;
    await rm(dir, { recursive: true, force: true });
  });

  test("picks 1.10.0 over 1.9.0 and 1.0.0", async () => {
    await writeFile(path.join(dir, "openpcb-core-library-0.9.0.opclib"), "");
    await writeFile(path.join(dir, "openpcb-core-library-1.0.0.opclib"), "");
    await writeFile(path.join(dir, "openpcb-core-library-1.9.0.opclib"), "");
    await writeFile(path.join(dir, "openpcb-core-library-1.10.0.opclib"), "");

    const hit = await locateBundledOpclib();
    expect(hit).toBe(path.join(dir, "openpcb-core-library-1.10.0.opclib"));
  });

  test("ignores filenames without a parseable version", async () => {
    await writeFile(path.join(dir, "openpcb-core-library-nightly.opclib"), "");
    await writeFile(path.join(dir, "openpcb-core-library-1.2.3.opclib"), "");
    const hit = await locateBundledOpclib();
    expect(hit).toBe(path.join(dir, "openpcb-core-library-1.2.3.opclib"));
  });
});

describe("package-locator dev fallback precedence", () => {
  let root: string;
  let prevEnv: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "opclib-locator-root-"));
    prevEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    delete process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
  });

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    else process.env.OPENPCB_BUNDLED_LIBRARY_PATH = prevEnv;
    await rm(root, { recursive: true, force: true });
  });

  test("prefers sibling CoreLibrary dist over repo resources in development", async () => {
    const repoRoot = path.join(root, "OpenPCB");
    const resourceDir = path.join(repoRoot, "resources", "core-library");
    const coreDist = path.join(root, "CoreLibrary", "dist");
    await mkdir(resourceDir, { recursive: true });
    await mkdir(coreDist, { recursive: true });
    await writeFile(
      path.join(resourceDir, "openpcb-core-library-1.0.0.opclib"),
      "",
    );
    await writeFile(
      path.join(coreDist, "openpcb-core-library-999.0.0-dev.opclib"),
      "",
    );

    const hit = await locateBundledOpclib({
      repoRoot,
      electronResources: null,
      nodeEnv: "development",
    });
    expect(hit).toBe(
      path.join(coreDist, "openpcb-core-library-999.0.0-dev.opclib"),
    );
  });

  test("ignores sibling CoreLibrary dist in production", async () => {
    const repoRoot = path.join(root, "OpenPCB");
    const resourceDir = path.join(repoRoot, "resources", "core-library");
    const coreDist = path.join(root, "CoreLibrary", "dist");
    await mkdir(resourceDir, { recursive: true });
    await mkdir(coreDist, { recursive: true });
    await writeFile(
      path.join(resourceDir, "openpcb-core-library-1.0.0.opclib"),
      "",
    );
    await writeFile(
      path.join(coreDist, "openpcb-core-library-999.0.0-dev.opclib"),
      "",
    );

    const hit = await locateBundledOpclib({
      repoRoot,
      electronResources: null,
      nodeEnv: "production",
    });
    expect(hit).toBe(
      path.join(resourceDir, "openpcb-core-library-1.0.0.opclib"),
    );
  });
});
