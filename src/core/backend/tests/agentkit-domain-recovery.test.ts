import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

test("Node AgentKit authenticated domain crash recovery", () => {
  const root = path.resolve(import.meta.dir, "../../../..");
  const directory = mkdtempSync(path.join(os.tmpdir(), "openpcb-agentkit-recovery-node-"));
  try {
    symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
    const built = spawnSync(path.join(root, "node_modules/.bin/esbuild"), [
      "src/core/backend/tests/fixtures/agentkit-domain-recovery.node.ts",
      "src/core/backend/tests/fixtures/agentkit-domain-recovery-crash.node.ts",
      "--bundle", "--platform=node", "--format=esm", "--out-extension:.js=.mjs",
      "--external:agentkit", "--external:agentkit/*", "--external:better-sqlite3",
      "--banner:js=import { createRequire as createFixtureRequire } from 'node:module'; const require = createFixtureRequire(import.meta.url);",
      `--outdir=${directory}`,
    ], { cwd: root, encoding: "utf8" });
    expect(built.status, built.stderr).toBe(0);
    const checked = spawnSync("node", ["--test", path.join(directory, "agentkit-domain-recovery.node.mjs")], {
      cwd: root, encoding: "utf8", timeout: 65000,
    });
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 75000);
