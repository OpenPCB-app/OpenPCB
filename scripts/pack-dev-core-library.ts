#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const DEV_CORELIB_VERSION = "999.0.0-dev";
const DEV_CORELIB_CHANNEL = "nightly";

const repoRoot = path.resolve(import.meta.dir, "..");
const coreLibraryRoot = path.resolve(repoRoot, "..", "CoreLibrary");
const packScript = path.join(coreLibraryRoot, "tools", "pack.ts");

if (!existsSync(packScript)) {
  console.error(
    `[corelib:pack:dev] missing sibling CoreLibrary at ${coreLibraryRoot}`,
  );
  console.error(
    "[corelib:pack:dev] expected ../CoreLibrary/tools/pack.ts; clone CoreLibrary beside OpenPCB and run `bun install` there.",
  );
  process.exit(1);
}

console.log(
  `[corelib:pack:dev] packing ${coreLibraryRoot} as ${DEV_CORELIB_VERSION}`,
);

const result = spawnSync(
  "bun",
  [
    "tools/pack.ts",
    `--version=${DEV_CORELIB_VERSION}`,
    `--channel=${DEV_CORELIB_CHANNEL}`,
  ],
  {
    cwd: coreLibraryRoot,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[corelib:pack:dev] failed to start bun: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    `[corelib:pack:dev] pack failed with status ${result.status ?? "unknown"}`,
  );
  process.exit(result.status ?? 1);
}

console.log(
  `[corelib:pack:dev] wrote ${path.join(
    coreLibraryRoot,
    "dist",
    `openpcb-core-library-${DEV_CORELIB_VERSION}.opclib`,
  )}`,
);
