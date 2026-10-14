import assert from "node:assert/strict";
import { test } from "node:test";
import { run, scanManifests, scanSources } from "./check-no-ai-core.mjs";

test("the repository is clean", () => {
  assert.deepEqual(run(process.cwd()), []);
});

test("imports, requires and dynamic imports are flagged", () => {
  const errors = scanSources([
    { file: "src/a.ts", text: 'import x from "@openpcb/ai-core";' },
    { file: "electron/src/b.ts", text: "const y = require('@openpcb/ai-core/runtime');" },
    { file: "tests/c.ts", text: "await import(`@openpcb/ai-core`);" },
  ]);
  assert.equal(errors.length, 3);
});

test("generated declarations are flagged", () => {
  const errors = scanSources([
    { file: "src/core/frontend/src/generated/sdk/a.d.ts", text: 'export * from "@openpcb/ai-core";' },
  ]);
  assert.equal(errors.length, 1);
});

test("unrelated packages and the guard itself pass", () => {
  assert.deepEqual(scanSources([
    { file: "src/a.ts", text: 'import x from "@openpcb/ai-core-other";' },
    { file: "scripts/check-no-ai-core.mjs", text: 'const P = "@openpcb/ai-core";' },
  ]), []);
});

test("manifest and lock dependencies are flagged", () => {
  const errors = scanManifests(
    { dependencies: { "@openpcb/ai-core": "1.0.0" } },
    { packages: { "node_modules/@openpcb/ai-core": {}, "node_modules/x": { dependencies: { "@openpcb/ai-core": "*" } } } },
  );
  assert.equal(errors.length, 3);
  assert.deepEqual(scanManifests({ dependencies: {} }, { packages: {} }), []);
});
