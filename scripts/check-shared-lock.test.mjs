import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSharedLock } from "./check-shared-lock.mjs";

function fixture() {
  const name = "@openpcb/opclib-pack";
  const specifier = "github:OpenPCB-app/shared#opclib-pack-v0.3.0";
  return {
    manifest: { dependencies: { [name]: specifier } },
    lock: { packages: {
      "": { dependencies: { [name]: specifier } },
      [`node_modules/${name}`]: {
        version: "0.3.0",
        resolved: `git+ssh://git@github.com/OpenPCB-app/shared.git#${"a".repeat(40)}`,
      },
    } },
  };
}

test("published tag and immutable lock version agree", () => {
  const { manifest, lock } = fixture();
  assert.deepEqual(validateSharedLock(manifest, lock), []);
});

test("the historical stale opclib lock fails", () => {
  const { manifest, lock } = fixture();
  lock.packages["node_modules/@openpcb/opclib-pack"].version = "0.2.0";
  assert.match(validateSharedLock(manifest, lock).join("\n"), /locked version 0\.2\.0 differs from tag version 0\.3\.0/);
});

test("mutable resolutions and mismatched declarations fail", () => {
  const { manifest, lock } = fixture();
  lock.packages["node_modules/@openpcb/opclib-pack"].resolved = "github:OpenPCB-app/shared#main";
  lock.packages[""].dependencies["@openpcb/opclib-pack"] = "github:OpenPCB-app/shared#opclib-pack-v0.2.0";
  assert.equal(validateSharedLock(manifest, lock).length, 2);
});
