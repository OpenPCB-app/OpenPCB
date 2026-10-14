import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

function writeFixtureFile(root, name, content) {
  const target = path.join(root, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function createFixture(layout) {
  const root = mkdtempSync(path.join(os.tmpdir(), "openpcb-electron-resolve-"));
  const modules =
    layout === "nested" ? "electron/node_modules" : "node_modules";
  writeFixtureFile(root, "package.json", '{"private":true}');
  writeFixtureFile(root, "electron/package.json", '{"name":"fixture"}');
  writeFixtureFile(
    root,
    `${modules}/electron/package.json`,
    JSON.stringify({
      name: "electron",
      version: "41.10.6",
      main: "index.cjs",
    }),
  );
  writeFixtureFile(
    root,
    `${modules}/electron/index.cjs`,
    `module.exports = ${JSON.stringify(process.execPath)};\n`,
  );
  writeFixtureFile(
    root,
    "node_modules/better-sqlite3/package.json",
    '{"name":"better-sqlite3","version":"fixture","main":"index.cjs"}',
  );
  writeFixtureFile(
    root,
    "node_modules/better-sqlite3/index.cjs",
    "module.exports = class Database { close() {} };\n",
  );
  writeFixtureFile(root, "resources/core-library/fixture.opclib", "fixture");
  writeFixtureFile(root, "scripts/ensure-electron-native-deps.mjs", "");
  copyFileSync(
    path.join(repoRoot, "scripts/ensure-electron-native-deps.mjs"),
    path.join(root, "scripts/ensure-electron-native-deps.mjs"),
  );
  copyFileSync(
    path.join(repoRoot, "electron/electron-builder.cjs"),
    path.join(root, "electron/electron-builder.cjs"),
  );
  if (layout === "hoisted") {
    mkdirSync(path.join(root, "node_modules/.bin"));
    symlinkSync(
      process.execPath,
      path.join(root, "node_modules/.bin/electron"),
    );
  }
  return root;
}

for (const layout of ["hoisted", "nested"]) {
  test(`native setup resolves ${layout} Electron and keeps private SQLite`, () => {
    const root = createFixture(layout);
    try {
      const result = spawnSync(
        process.execPath,
        [path.join(root, "scripts/ensure-electron-native-deps.mjs")],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /already matches Electron .* ABI \d+/);
      assert.equal(
        readFileSync(
          path.join(root, "electron/node_modules/better-sqlite3/index.cjs"),
          "utf8",
        ),
        readFileSync(
          path.join(root, "node_modules/better-sqlite3/index.cjs"),
          "utf8",
        ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`builder config resolves ${layout} Electron version`, () => {
    const root = createFixture(layout);
    try {
      const fixtureRequire = createRequire(
        path.join(root, "electron/package.json"),
      );
      assert.equal(
        fixtureRequire("./electron-builder.cjs").electronVersion,
        "41.10.6",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
