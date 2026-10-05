import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const tar = require("tar");

function archive(entryPath, body = Buffer.alloc(0)) {
  const header = new tar.Header({
    path: "entry",
    size: body.length,
    type: "File",
  });
  header.encode();
  return Buffer.concat([
    new tar.Pax({ path: entryPath }).encode(),
    header.block,
    body,
    Buffer.alloc((512 - (body.length % 512)) % 512),
    Buffer.alloc(1024),
  ]);
}

function withFixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "openpcb-tar-"));
  return Promise.resolve()
    .then(() => run(root))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}

test("tar lists a deeply nested PAX member with a selection without stack overflow", () =>
  withFixture(async (root) => {
    const file = path.join(root, "deep.tar");
    writeFileSync(file, archive(`${"segment/".repeat(12000)}leaf`));
    const entries = [];
    await tar.t({ file, onReadEntry: (entry) => entries.push(entry.path) }, [
      "selected",
    ]);
    assert.deepEqual(entries, []);
  }));

test("tar rejects a bounded compressed fixture exceeding its default ratio limit", () =>
  withFixture(async (root) => {
    const file = path.join(root, "ratio.tar.gz");
    writeFileSync(
      file,
      gzipSync(archive("zeros", Buffer.alloc(8 * 1024 * 1024))),
    );
    await assert.rejects(tar.t({ file }), /max decompression ratio exceeded/);
  }));

test("tar extracts selected header content with a falsey transform", () =>
  withFixture(async (root) => {
    const file = path.join(root, "header.tar");
    writeFileSync(file, archive("node.h", Buffer.from("fixture header\n")));
    await tar.x({
      file,
      cwd: root,
      filter: (name) => name.endsWith(".h"),
      transform: () => undefined,
    });
    assert.equal(
      readFileSync(path.join(root, "node.h"), "utf8"),
      "fixture header\n",
    );
  }));
