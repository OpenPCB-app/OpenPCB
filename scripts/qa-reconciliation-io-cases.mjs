import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createVerifier } from "./qa-reconciliation.mjs";
import {
  ARCHIVE,
  buildArchiveProjection,
  loadSources,
  MANIFEST,
  OWNERS,
  PROJECTION,
  sha256,
} from "./qa-reconciliation-sources.mjs";
import {
  repo,
  sources,
  baseline,
  evidencePath,
  fresh,
} from "./qa-reconciliation-fixtures.mjs";

function copyPortableFiles(destination) {
  for (const path of [
    OWNERS,
    PROJECTION,
    "scripts/qa-reconciliation.mjs",
    "scripts/qa-reconciliation-sources.mjs",
    "scripts/qa-reconciliation-validation.mjs",
  ]) {
    mkdirSync(dirname(join(destination, path)), { recursive: true });
    copyFileSync(join(repo, path), join(destination, path));
  }
  // Source portability is independent of qualifications requiring Git and evidence.
  writeFileSync(
    join(destination, MANIFEST),
    JSON.stringify(fresh(), null, 2) + "\n",
  );
}

function syntheticArchive(destination) {
  for (const { path } of sources.files) {
    if (path === OWNERS) continue;
    mkdirSync(dirname(join(destination, path)), { recursive: true });
    writeFileSync(join(destination, path), "Synthetic archive fixture\n");
  }
  writeFileSync(
    join(destination, ARCHIVE, "data/triage.json"),
    JSON.stringify(sources.triage),
  );
  writeFileSync(
    join(destination, ARCHIVE, "data/triage-approved.json"),
    JSON.stringify(sources.approved),
  );
  for (const collection of ["raw", "verified"]) {
    const grouped = Map.groupBy(sources[collection], (item) => item.path);
    for (const [path, records] of grouped) {
      const values = records.map((item) => item.record);
      const bytes =
        collection === "raw"
          ? values.map((value) => JSON.stringify(value)).join("\n") + "\n"
          : JSON.stringify(values);
      writeFileSync(join(destination, path), bytes);
    }
  }
}

test("archived screenshots cannot stand in for hashed fresh evidence", () => {
  const verifier = createVerifier(repo);
  assert.match(
    verifier.file(
      "docs/qa/2026-09-ui-qa/evidence/shots/q10/dark/020-C1-designer-schem-signedout.png",
      "a".repeat(64),
    ),
    /fresh evidence must live/,
  );
});

test("artifact verifier checks exact bytes, traversal, symlink escapes and missing files", () => {
  const temporary = mkdtempSync(join(tmpdir(), "openpcb-reconciliation-"));
  try {
    mkdirSync(dirname(join(temporary, evidencePath)), { recursive: true });
    writeFileSync(
      join(temporary, evidencePath),
      "passed behavioral assertions\n",
    );
    const verifier = createVerifier(temporary);
    const hash = sha256(readFileSync(join(temporary, evidencePath)));
    assert.equal(verifier.file(evidencePath, hash), "");
    assert.match(
      verifier.file(evidencePath, "0".repeat(64)),
      /SHA-256 mismatch/,
    );
    assert.match(
      verifier.file(`${dirname(evidencePath)}/missing.log`, hash),
      /artifact unavailable/,
    );
    assert.match(
      verifier.file(`${dirname(evidencePath)}/../../outside`, hash),
      /traversal/,
    );
    symlinkSync(
      join(repo, OWNERS),
      join(temporary, `${dirname(evidencePath)}/escape.log`),
    );
    assert.match(
      verifier.file(`${dirname(evidencePath)}/escape.log`, hash),
      /symlink escapes/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("Git verifier checks real commit availability and committed regression source", () => {
  const verifier = createVerifier(repo);
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  assert.equal(verifier.commit(head), "");
  assert.match(verifier.commit("0".repeat(40)), /commit missing/);
  assert.equal(verifier.ancestor(head, head), "");
  assert.match(verifier.regression(head, "CLAUDE.md"), /test source file/);
  const tests = execFileSync(
    "git",
    ["-C", repo, "ls-tree", "-r", "--name-only", head],
    { encoding: "utf8" },
  );
  const path = tests
    .split("\n")
    .find(
      (path) =>
        path.startsWith("src/core/backend/tests/") &&
        path.endsWith(".test.ts") &&
        verifier.regression(head, path) === "",
    );
  assert.ok(path);
  assert.equal(verifier.regression(head, path), "");
});

test("pinned owner snapshot cannot be rewritten in isolation", () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "openpcb-reconciliation-owner-"),
  );
  try {
    mkdirSync(dirname(join(temporary, OWNERS)), { recursive: true });
    writeFileSync(join(temporary, OWNERS), "{}");
    assert.throws(
      () => loadSources(temporary),
      /Pinned owner snapshot SHA-256 mismatch/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("pinned projection modifications rejected independently of manifest", () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "openpcb-reconciliation-sources-"),
  );
  try {
    copyPortableFiles(temporary);
    writeFileSync(join(temporary, PROJECTION), "{}");
    assert.throws(
      () => loadSources(temporary),
      /Pinned source projection SHA-256 mismatch/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("archive mode rejects canonical projection drift with original files present", () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "openpcb-reconciliation-archive-"),
  );
  try {
    copyPortableFiles(temporary);
    syntheticArchive(temporary);
    const rebuilt = buildArchiveProjection(temporary);
    for (const field of ["triage", "approved", "raw", "verified"]) {
      assert.deepEqual(rebuilt[field], sources[field]);
    }
    const triage = structuredClone(sources.triage);
    triage[0].title = "Silently revised historical claim";
    writeFileSync(
      join(temporary, ARCHIVE, "data/triage.json"),
      JSON.stringify(triage),
    );
    assert.notDeepEqual(
      buildArchiveProjection(temporary).triage,
      sources.triage,
    );
    assert.throws(
      () => loadSources(temporary, { verifyArchive: true }),
      /Original QA archive projection\/fingerprints mismatch/,
    );
    const failed = spawnSync(
      process.execPath,
      [join(temporary, "scripts/qa-reconciliation.mjs"), "--verify-archive"],
      {
        cwd: temporary,
        encoding: "utf8",
      },
    );
    assert.equal(failed.status, 1);
    assert.match(
      failed.stderr,
      /Original QA archive projection\/fingerprints mismatch/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("clean checkout validates pinned projection without archive; explicit archive mode fails", () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "openpcb-reconciliation-portable-"),
  );
  try {
    copyPortableFiles(temporary);
    const script = join(temporary, "scripts/qa-reconciliation.mjs");
    const portable = spawnSync(process.execPath, [script], {
      cwd: temporary,
      encoding: "utf8",
    });
    assert.equal(portable.status, 0, portable.stderr);
    assert.match(portable.stdout, /395 roots; 480 raw aliases/);
    assert.match(portable.stdout, /original archive not inspected/);
    const archive = spawnSync(process.execPath, [script, "--verify-archive"], {
      cwd: temporary,
      encoding: "utf8",
    });
    assert.equal(archive.status, 1);
    assert.match(
      archive.stderr,
      /Original QA archive verification unavailable/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("CLI validates default manifest and exits nonzero for corrupted fixture", () => {
  const script = join(repo, "scripts/qa-reconciliation.mjs");
  const success = spawnSync(process.execPath, [script], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /395 roots; 480 raw aliases/);
  assert.ok(
    success.stdout.includes(
      `${baseline.roots.filter((root) => root.resolution === "fixed").length} qualified fixes`,
    ),
  );
  const temporary = mkdtempSync(join(tmpdir(), "openpcb-reconciliation-cli-"));
  try {
    const fixture = fresh();
    fixture.roots.pop();
    const path = join(temporary, "bad.json");
    writeFileSync(path, JSON.stringify(fixture));
    const failure = spawnSync(process.execPath, [script, path], {
      cwd: repo,
      encoding: "utf8",
    });
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /missing primary root: T-395/);
    writeFileSync(path, "{invalid");
    const invalid = spawnSync(process.execPath, [script, path], {
      cwd: repo,
      encoding: "utf8",
    });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Reconciliation unavailable:/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
