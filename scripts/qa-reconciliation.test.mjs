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
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { createVerifier } from "./qa-reconciliation.mjs";
import {
  ARCHIVE,
  buildArchiveProjection,
  disposition,
  loadSources,
  MANIFEST,
  OWNERS,
  PROJECTION,
  sha256,
  SOURCE_COMMIT,
} from "./qa-reconciliation-sources.mjs";
import { validateManifest } from "./qa-reconciliation-validation.mjs";

const repo = resolve(import.meta.dirname, "..");
const sources = loadSources(repo);
const baseline = JSON.parse(readFileSync(join(repo, MANIFEST), "utf8"));
const evidencePath = "docs/qa/2026-10-hardening/evidence/behavior.log";
const acceptedArtifacts = {
  file: () => "",
  commit: () => "",
  regression: () => "",
  ancestor: () => "",
};

function fresh() {
  const manifest = structuredClone(baseline);
  for (const root of manifest.roots) {
    root.resolution = disposition(root.tid);
    root.reproductionState = "unverified";
    root.implementationCommit = root.regressionTest = root.localEvidence = null;
    root.remainingBlocker = root.scopeExpansion
      ? "Approved programme is broader than September scope; verification pending."
      : "Verification pending.";
  }
  return manifest;
}

function copyPortableFiles(destination) {
  for (const path of [
    MANIFEST,
    OWNERS,
    PROJECTION,
    "scripts/qa-reconciliation.mjs",
    "scripts/qa-reconciliation-sources.mjs",
    "scripts/qa-reconciliation-validation.mjs",
  ]) {
    mkdirSync(dirname(join(destination, path)), { recursive: true });
    copyFileSync(join(repo, path), join(destination, path));
  }
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

function errorsFor(change, verifier = undefined) {
  const manifest = fresh();
  change(manifest);
  return validateManifest(manifest, sources, verifier);
}

function fixedRoot(manifest) {
  const root = manifest.roots[0];
  root.resolution = "fixed";
  root.reproductionState = "not-reproduced";
  root.implementationCommit = SOURCE_COMMIT;
  root.remainingBlocker = null;
  root.localEvidence = {
    path: evidencePath,
    sha256: "a".repeat(64),
    head: SOURCE_COMMIT,
    kind: "post-fix",
    notes: "Fixture: isolated reproduction no longer occurs after the fix.",
  };
  root.regressionTest = {
    kind: "behavioral",
    path: "tests/example.test.mjs",
    name: "offline rendering recovers",
    command: "node --test tests/example.test.mjs",
    result: "passed",
    commit: SOURCE_COMMIT,
    evidencePath,
    evidenceSha256: "a".repeat(64),
  };
  return root;
}

test("full baseline partitions every root and raw alias without claiming qualification", () => {
  assert.deepEqual(
    validateManifest(baseline, sources, createVerifier(repo)),
    [],
  );
  assert.equal(baseline.roots.length, 395);
  assert.equal(baseline.roots.flatMap((root) => root.rawAliases).length, 480);
  assert.equal(
    baseline.roots.filter((root) => root.original.approved).length,
    344,
  );
  assert.ok(
    fresh().roots.every((root) => root.reproductionState === "unverified"),
  );
});

test("missing root detected even when it has no raw aliases", () => {
  const errors = errorsFor((manifest) => {
    manifest.roots = manifest.roots.filter((root) => root.tid !== "T-002");
  });
  assert.ok(errors.includes("missing primary root: T-002"));
});

test("duplicate root rejected despite unchanged total count", () => {
  const errors = errorsFor((manifest) => {
    manifest.roots[1] = structuredClone(manifest.roots[0]);
  });
  assert.ok(errors.includes("duplicate primary root: T-001"));
  assert.ok(errors.includes("missing primary root: T-002"));
});

test("missing alias detected independently of root count", () => {
  const errors = errorsFor((manifest) => {
    manifest.roots[0].rawAliases = [];
  });
  assert.ok(errors.includes("missing raw coverage: Q10-001"));
});

test("duplicate raw coverage cannot hide a missing alias", () => {
  const errors = errorsFor((manifest) => {
    const root = manifest.roots.find((root) => root.rawAliases.length > 1);
    root.rawAliases[1] = structuredClone(root.rawAliases[0]);
  });
  assert.ok(
    errors.some((error) => error.startsWith("duplicate raw coverage:")),
  );
  assert.ok(errors.some((error) => error.startsWith("missing raw coverage:")));
});

test("raw alias moved to a different root rejected", () => {
  const errors = errorsFor((manifest) => {
    manifest.roots[1].rawAliases.push(manifest.roots[0].rawAliases.pop());
  });
  assert.ok(
    errors.some((error) =>
      error.includes("unknown or misplaced raw alias Q10-001"),
    ),
  );
});

test("unknown root cannot substitute for canonical root", () => {
  const errors = errorsFor((manifest) => {
    manifest.roots[0].tid = "T-396";
  });
  assert.ok(errors.includes("unknown root: T-396"));
  assert.ok(errors.includes("missing primary root: T-001"));
});

for (const field of ["task", "identifier", "workItemId"]) {
  test(`mismatched primary owner ${field} rejected`, () => {
    const errors = errorsFor((manifest) => {
      manifest.roots[0].primaryOwner[field] = "incorrect";
    });
    assert.ok(errors.includes("T-001 primary owner: canonical mismatch"));
  });
}

test("extra primary owner rejected", () => {
  const errors = errorsFor((manifest) => {
    manifest.roots[0].secondaryPrimaryOwner = manifest.roots[1].primaryOwner;
  });
  assert.ok(errors.includes("root: missing or unknown fields"));
});

for (const field of [
  "severity",
  "scope",
  "decision",
  "status",
  "approved",
  "approvalNote",
]) {
  test(`historical ${field} cannot be silently rewritten`, () => {
    const errors = errorsFor((manifest) => {
      manifest.roots[0].original[field] = "changed";
    });
    assert.ok(errors.includes("T-001 original: canonical mismatch"));
  });
}

test("raw severity and verification decisions preserved independently", () => {
  const errors = errorsFor((manifest) => {
    manifest.roots[0].rawAliases[0].rawSeverity = "S4";
  });
  assert.ok(errors.includes("T-001 alias Q10-001: canonical mismatch"));
});

test("all 15 duplicates and 4 rejected aliases retain canonical status", () => {
  const aliases = baseline.roots.flatMap((root) => root.rawAliases);
  assert.equal(
    aliases.filter((alias) => alias.status === "duplicate").length,
    15,
  );
  assert.equal(
    aliases.filter((alias) => alias.status === "rejected").length,
    4,
  );
  assert.equal(
    baseline.roots.find((root) => root.tid === "T-395").original.status,
    "refuted",
  );
});

test("historical cross-root duplicate contradiction preserved, not normalized away", () => {
  const naming = baseline.roots
    .find((root) => root.tid === "T-164")
    .rawAliases.find((alias) => alias.id === "F1B-014");
  assert.equal(naming.duplicateOf, "Q4-024");
  assert.equal(naming.duplicateRoot, "T-152");
  assert.ok(
    errorsFor((manifest) => {
      manifest.contradictions = [];
    }).includes("source contradictions: canonical mismatch"),
  );
  assert.ok(
    errorsFor((manifest) => {
      manifest.roots
        .find((root) => root.tid === "T-164")
        .rawAliases.find((alias) => alias.id === "F1B-014").duplicateRoot =
        "T-164";
    }).some((error) => error.includes("alias F1B-014: canonical mismatch")),
  );
});

for (const tid of [
  "T-304",
  "T-305",
  "T-308",
  "T-391",
  "T-392",
  "T-393",
  "T-394",
  "T-395",
]) {
  test(`${tid} disposition-only owner retained; implied fix rejected`, () => {
    assert.equal(
      baseline.roots.find((root) => root.tid === tid).primaryOwner.task,
      "H01",
    );
    const errors = errorsFor((manifest) => {
      const root = manifest.roots.find((root) => root.tid === tid);
      root.resolution = "fixed";
      root.implementationCommit = SOURCE_COMMIT;
    });
    assert.ok(
      errors.includes(`${tid}: disposition cannot imply implementation`),
    );
    assert.ok(
      errors.includes(`${tid}: disposition-only record cannot claim a fix`),
    );
  });
}

test("formerly deferred work must retain explicit expanded scope", () => {
  const errors = errorsFor((manifest) => {
    const root = manifest.roots.find((root) => root.scopeExpansion);
    root.remainingBlocker = "Future work";
    root.scopeExpansion = false;
  });
  assert.ok(
    errors.some((error) =>
      error.includes("scope expansion: canonical mismatch"),
    ),
  );
  assert.ok(
    errors.some((error) =>
      error.includes("must explicitly identify broader programme scope"),
    ),
  );
});

test("fixed without commit, behavioral regression and post-fix evidence rejected", () => {
  const errors = errorsFor((manifest) => {
    manifest.roots[0].resolution = "fixed";
  });
  assert.ok(errors.includes("T-001: fixed requires implementation commit"));
  assert.ok(errors.includes("T-001 regression test: expected object"));
  assert.ok(errors.includes("T-001: fixed requires post-fix local evidence"));
});

test("structured closure accepted only when artifact verification succeeds", () => {
  assert.deepEqual(errorsFor(fixedRoot, acceptedArtifacts), []);
  assert.ok(
    errorsFor(fixedRoot).some((error) => error.includes("verifier required")),
  );
  const rejected = { ...acceptedArtifacts, commit: () => "commit missing" };
  assert.ok(
    errorsFor(fixedRoot, rejected).some((error) =>
      error.includes("commit missing"),
    ),
  );
});

test("expanded programme scope can close after all qualification requirements pass", () => {
  const manifest = fresh();
  const expanded = manifest.roots.find((root) => root.scopeExpansion);
  Object.assign(expanded, {
    ...fixedRoot(fresh()),
    tid: expanded.tid,
    rawAliases: expanded.rawAliases,
    original: expanded.original,
    primaryOwner: expanded.primaryOwner,
    programmeDisposition: expanded.programmeDisposition,
    scopeExpansion: true,
    historicalEvidence: expanded.historicalEvidence,
  });
  assert.deepEqual(validateManifest(manifest, sources, acceptedArtifacts), []);
});

test("static source scan cannot qualify as behavioral regression", () => {
  const errors = errorsFor((manifest) => {
    fixedRoot(manifest).regressionTest.kind = "source-scan";
  }, acceptedArtifacts);
  assert.ok(
    errors.includes("T-001 regression test: behavioral regression required"),
  );
});

test("failed behavioral regression cannot qualify a fixed root", () => {
  const errors = errorsFor((manifest) => {
    fixedRoot(manifest).regressionTest.result = "failed";
  }, acceptedArtifacts);
  assert.ok(errors.includes("T-001 regression test: passing result required"));
});

test("fresh reproduction claim requires fresh evidence", () => {
  const errors = errorsFor((manifest) => {
    manifest.roots[0].reproductionState = "reproduced";
  });
  assert.ok(
    errors.includes("T-001: reproduction state requires fresh local evidence"),
  );
});

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

test("commit ancestry failures block closure", () => {
  const verifier = {
    ...acceptedArtifacts,
    ancestor: () => "evidence HEAD excludes fix",
  };
  assert.ok(
    errorsFor(fixedRoot, verifier).some((error) =>
      error.includes("evidence HEAD excludes fix"),
    ),
  );
});

test("fingerprints protect historical sources", () => {
  assert.ok(
    errorsFor((manifest) => {
      manifest.sources[0].sha256 = "0".repeat(64);
    }).includes("source fingerprints: canonical mismatch"),
  );
});

test("malformed JSON structures fail closed without throwing", () => {
  for (const input of [null, [], {}, { ...fresh(), roots: "wrong" }]) {
    assert.ok(validateManifest(input, sources).length > 0);
  }
  const errors = errorsFor((manifest) => {
    manifest.roots[0].rawAliases = [null];
    manifest.roots[0].localEvidence = [];
    manifest.roots.find((root) => root.scopeExpansion).remainingBlocker = 123;
  });
  assert.ok(errors.includes("T-001: malformed raw alias"));
  assert.ok(errors.includes("T-001 local evidence: expected object"));
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
