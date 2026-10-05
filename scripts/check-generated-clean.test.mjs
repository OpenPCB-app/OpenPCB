import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { findGeneratedChanges } from "./check-generated-clean.mjs";

function fixture(t) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "openpcb-generated-check-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const result = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  mkdirSync(path.join(cwd, "src/core/frontend/src/generated/sdk"), { recursive: true });
  return cwd;
}

test("clean generation ignores unrelated untracked files", (t) => {
  const cwd = fixture(t);
  writeFileSync(path.join(cwd, "unrelated.txt"), "keep\n");
  assert.equal(findGeneratedChanges(cwd), "");
});

test("new generated SDK files fail the drift check", (t) => {
  const cwd = fixture(t);
  writeFileSync(path.join(cwd, "src/core/frontend/src/generated/sdk/new client.ts"), "export {};\n");
  assert.match(findGeneratedChanges(cwd), /\?\?.*new client\.ts/);
  const checker = fileURLToPath(new URL("./check-generated-clean.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [checker], { cwd, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /new client\.ts/);
});

test("staged generated files and further tracked edits fail the drift check", (t) => {
  const cwd = fixture(t);
  const relative = "src/core/frontend/src/generated/modules.ts";
  writeFileSync(path.join(cwd, relative), "export {};\n");
  assert.equal(spawnSync("git", ["add", relative], { cwd }).status, 0);
  assert.match(findGeneratedChanges(cwd), /^A /);
  writeFileSync(path.join(cwd, relative), "export const changed = true;\n");
  assert.match(findGeneratedChanges(cwd), /^AM/);
});

test("ignored generated files cannot hide drift", (t) => {
  const cwd = fixture(t);
  writeFileSync(path.join(cwd, ".gitignore"), "*.generated.ts\n");
  writeFileSync(path.join(cwd, "src/core/frontend/src/generated/sdk/hidden.generated.ts"), "export {};\n");
  assert.match(findGeneratedChanges(cwd), /^!!/);
});

test("git errors fail closed", (t) => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "openpcb-no-git-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.throws(() => findGeneratedChanges(cwd), /not a git repository/);
});
