import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkDistribution, restrictedDependencies } from "./check-siwc-distribution.mjs";

test("rejects direct, aliased and transitive DevKit dependencies", () => {
  for (const manifest of [
    { dependencies: { "@siwc/local": "1.0.0" } },
    { optionalDependencies: { renamed: "npm:@siwc/local@1.0.0" } },
    { dependencies: { renamed: "github:openai/sign-in-with-chatgpt-devkit#abc" } },
    { packages: { "node_modules/renamed": { name: "@siwc/react" } } },
    { packages: { "node_modules/renamed": { resolved: "https://registry.npmjs.org/@siwc%2flocal/-/local.tgz" } } },
    { packages: { "node_modules/parent": { dependencies: { "@siwc/local": "*" } } } },
  ]) assert.ok(restrictedDependencies(manifest).length > 0);
});

test("independently authored AgentKit and existing providers remain permitted", () => {
  assert.deepEqual(restrictedDependencies({ dependencies: { agentkit: "0.6.0", openai: "6.0.0" } }), []);
});

test("current distribution has no unapproved DevKit dependency", async () => {
  await checkDistribution(fileURLToPath(new URL("..", import.meta.url)));
});
