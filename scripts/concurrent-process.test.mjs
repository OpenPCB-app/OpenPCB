import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { quote } = require("shell-quote");
const cli = path.resolve(
  path.dirname(require.resolve("concurrently")),
  "dist/bin/concurrently.js",
);

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "openpcb concurrent "));
  writeFileSync(
    path.join(root, "arguments.cjs"),
    "require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));",
  );
  return root;
}

function concurrent(root, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
  });
}

for (const placeholder of ["@", "*", "1"]) {
  test(`concurrently preserves quoted ${placeholder} arguments`, () => {
    const root = fixture();
    const values = [
      "space value",
      "literal 'quote'",
      "$(echo unsafe); & |",
      "line\nbreak",
    ];
    try {
      const output = path.join(root, "arguments.json");
      const command = `${quote([process.execPath, path.join(root, "arguments.cjs"), output])} {${placeholder}}`;
      const result = concurrent(root, [
        "--raw",
        "--passthrough-arguments",
        command,
        "--",
        ...values,
      ]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const expected =
        placeholder === "@"
          ? values
          : [placeholder === "*" ? values.join(" ") : values[0]];
      assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("concurrently terminates a running sibling when another child fails", () => {
  const root = fixture();
  try {
    writeFileSync(
      path.join(root, "sibling.cjs"),
      "require('node:fs').writeFileSync('sibling.pid', String(process.pid)); setInterval(() => {}, 1000);",
    );
    writeFileSync(
      path.join(root, "failure.cjs"),
      "const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync('sibling.pid')) { clearInterval(timer); process.exit(7); } }, 10);",
    );
    const commands = ["sibling.cjs", "failure.cjs"].map((name) =>
      quote([process.execPath, path.join(root, name)]),
    );
    const result = concurrent(root, [
      "--raw",
      "--kill-others-on-fail",
      ...commands,
    ]);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const pid = Number(readFileSync(path.join(root, "sibling.pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
