import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

test("Node AgentKit provider preference HTTP integration", () => {
  const root = path.resolve(import.meta.dir, "../../../..");
  const directory = mkdtempSync(path.join(os.tmpdir(), "openpcb-agentkit-provider-node-"));
  try {
    symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
    const output = path.join(directory, "providers.mjs");
    const built = spawnSync(path.join(root, "node_modules/.bin/esbuild"), [
      "src/core/backend/tests/fixtures/agentkit-provider-http.node.ts", "--bundle", "--platform=node",
      "--format=esm", "--external:agentkit", "--external:agentkit/*", "--external:better-sqlite3",
      "--banner:js=import { createRequire as createFixtureRequire } from 'node:module'; const require = createFixtureRequire(import.meta.url);",
      `--outfile=${output}`,
    ], { cwd: root, encoding: "utf8" });
    expect(built.status, built.stderr).toBe(0);
    const checked = spawnSync("node", ["--test", output], { cwd: root, encoding: "utf8", timeout: 60000 });
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 65000);
