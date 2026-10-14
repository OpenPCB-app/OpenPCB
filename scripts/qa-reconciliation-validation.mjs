import { isDeepStrictEqual } from "node:util";
import {
  disposition,
  originalRoot,
  rawAlias,
  SOURCE_COMMIT,
  sourceContradictions,
} from "./qa-reconciliation-sources.mjs";

const COMMIT = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROOT_KEYS = [
  "tid",
  "rawAliases",
  "original",
  "primaryOwner",
  "programmeDisposition",
  "scopeExpansion",
  "resolution",
  "reproductionState",
  "implementationCommit",
  "regressionTest",
  "localEvidence",
  "historicalEvidence",
  "remainingBlocker",
];
const STATES = ["unverified", "reproduced", "not-reproduced", "blocked"];

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function checkKeys(value, keys, label, errors) {
  if (!object(value)) {
    errors.push(`${label}: expected object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  if (!isDeepStrictEqual(actual, [...keys].sort()))
    errors.push(`${label}: missing or unknown fields`);
  return true;
}

function equal(actual, expected, label, errors) {
  if (!isDeepStrictEqual(actual, expected))
    errors.push(`${label}: canonical mismatch`);
}

function validateMetadata(manifest, sources, errors) {
  if (
    !checkKeys(
      manifest,
      [
        "schemaVersion",
        "sourceCommit",
        "purpose",
        "expectedRoots",
        "expectedRawAliases",
        "historicallyApprovedRoots",
        "sources",
        "contradictions",
        "roots",
      ],
      "manifest",
      errors,
    )
  )
    return false;
  equal(manifest.schemaVersion, 1, "schemaVersion", errors);
  equal(manifest.sourceCommit, SOURCE_COMMIT, "sourceCommit", errors);
  equal(
    manifest.purpose,
    "Code-coupled QA qualification evidence; Plane remains the task and knowledge source of truth.",
    "purpose",
    errors,
  );
  equal(manifest.expectedRoots, 395, "expectedRoots", errors);
  equal(manifest.expectedRawAliases, 480, "expectedRawAliases", errors);
  equal(
    manifest.historicallyApprovedRoots,
    344,
    "historicallyApprovedRoots",
    errors,
  );
  equal(manifest.sources, sources.files, "source fingerprints", errors);
  equal(
    manifest.contradictions,
    sourceContradictions(sources),
    "source contradictions",
    errors,
  );
  if (!Array.isArray(manifest.roots)) {
    errors.push("roots: expected array");
    return false;
  }
  return true;
}

function validateOriginal(root, canonical, sources, errors) {
  const approved = sources.approved.find((item) => item.tid === canonical.tid);
  const owner = sources.ownership.owners.find(
    (item) => item.tid === canonical.tid,
  );
  equal(
    root.original,
    originalRoot(canonical, approved),
    `${root.tid} original`,
    errors,
  );
  equal(
    root.primaryOwner,
    owner.primaryOwner,
    `${root.tid} primary owner`,
    errors,
  );
  equal(
    root.programmeDisposition,
    owner.disposition,
    `${root.tid} programme disposition`,
    errors,
  );
  equal(
    root.historicalEvidence,
    canonical.evidence,
    `${root.tid} historical evidence`,
    errors,
  );
  const expanded = !approved.approved && disposition(root.tid) === "pending";
  equal(root.scopeExpansion, expanded, `${root.tid} scope expansion`, errors);
  if (
    expanded &&
    root.resolution !== "fixed" &&
    (!nonempty(root.remainingBlocker) ||
      !root.remainingBlocker.includes("broader than September"))
  ) {
    errors.push(
      `${root.tid}: formerly deferred work must explicitly identify broader programme scope`,
    );
  }
}

function validateAliases(root, canonical, sources, covered, errors) {
  if (!Array.isArray(root.rawAliases)) {
    errors.push(`${root.tid} raw aliases: expected array`);
    return;
  }
  const expected = new Set(canonical.ids);
  const local = new Set();
  for (const alias of root.rawAliases) {
    if (!object(alias) || !nonempty(alias.id)) {
      errors.push(`${root.tid}: malformed raw alias`);
      continue;
    }
    if (covered.has(alias.id))
      errors.push(`duplicate raw coverage: ${alias.id}`);
    covered.add(alias.id);
    local.add(alias.id);
    if (!expected.has(alias.id))
      errors.push(`${root.tid}: unknown or misplaced raw alias ${alias.id}`);
    else
      equal(
        alias,
        rawAlias(alias.id, sources),
        `${root.tid} alias ${alias.id}`,
        errors,
      );
  }
  for (const id of expected)
    if (!local.has(id)) errors.push(`${root.tid}: missing raw alias ${id}`);
}

function validateEvidence(value, label, verifier, errors) {
  if (
    !checkKeys(
      value,
      ["path", "sha256", "head", "kind", "notes"],
      label,
      errors,
    )
  )
    return false;
  let valid = true;
  for (const key of ["path", "notes"]) {
    if (!nonempty(value[key])) {
      errors.push(`${label}: ${key} required`);
      valid = false;
    }
  }
  if (!HASH.test(value.sha256)) {
    errors.push(`${label}: SHA-256 required`);
    valid = false;
  }
  if (!COMMIT.test(value.head)) {
    errors.push(`${label}: full HEAD required`);
    valid = false;
  }
  if (!["reproduction", "post-fix"].includes(value.kind)) {
    errors.push(`${label}: unsupported evidence kind`);
    valid = false;
  }
  if (valid) {
    const failure =
      verifier?.file(value.path, value.sha256) ?? "artifact verifier required";
    if (failure) errors.push(`${label}: ${failure}`);
    const commitFailure =
      verifier?.commit(value.head) ?? "commit verifier required";
    if (commitFailure) errors.push(`${label}: ${commitFailure}`);
  }
  return valid;
}

function validateRegression(test, tid, verifier, errors) {
  const label = `${tid} regression test`;
  if (
    !checkKeys(
      test,
      [
        "kind",
        "path",
        "name",
        "command",
        "result",
        "commit",
        "evidencePath",
        "evidenceSha256",
      ],
      label,
      errors,
    )
  )
    return;
  if (test.kind !== "behavioral")
    errors.push(`${label}: behavioral regression required`);
  if (test.result !== "passed")
    errors.push(`${label}: passing result required`);
  for (const key of ["path", "name", "command", "evidencePath"]) {
    if (!nonempty(test[key])) errors.push(`${label}: ${key} required`);
  }
  if (!COMMIT.test(test.commit))
    errors.push(`${label}: committed regression required`);
  if (!HASH.test(test.evidenceSha256))
    errors.push(`${label}: evidence SHA-256 required`);
  if (nonempty(test.evidencePath) && HASH.test(test.evidenceSha256)) {
    const failure =
      verifier?.file(test.evidencePath, test.evidenceSha256) ??
      "artifact verifier required";
    if (failure) errors.push(`${label}: ${failure}`);
  }
  if (nonempty(test.path) && COMMIT.test(test.commit)) {
    const failure =
      verifier?.regression(test.commit, test.path) ??
      "regression verifier required";
    if (failure) errors.push(`${label}: ${failure}`);
  }
}

function validateFixed(root, verifier, errors) {
  const tid = root.tid;
  if (!COMMIT.test(root.implementationCommit))
    errors.push(`${tid}: fixed requires implementation commit`);
  else {
    const failure =
      verifier?.commit(root.implementationCommit) ?? "commit verifier required";
    if (failure) errors.push(`${tid} implementation commit: ${failure}`);
  }
  validateRegression(root.regressionTest, tid, verifier, errors);
  if (!object(root.localEvidence) || root.localEvidence.kind !== "post-fix") {
    errors.push(`${tid}: fixed requires post-fix local evidence`);
  }
  if (root.reproductionState !== "not-reproduced")
    errors.push(`${tid}: fixed requires not-reproduced state`);
  if (root.remainingBlocker !== null)
    errors.push(`${tid}: fixed cannot retain a remaining blocker`);
  if (
    COMMIT.test(root.localEvidence?.head) &&
    COMMIT.test(root.implementationCommit)
  ) {
    const failure =
      verifier?.ancestor(root.implementationCommit, root.localEvidence.head) ??
      "commit ancestry verifier required";
    if (failure) errors.push(`${tid}: ${failure}`);
  }
  if (
    COMMIT.test(root.localEvidence?.head) &&
    COMMIT.test(root.regressionTest?.commit)
  ) {
    const failure =
      verifier?.ancestor(root.regressionTest.commit, root.localEvidence.head) ??
      "regression ancestry verifier required";
    if (failure) errors.push(`${tid}: ${failure}`);
  }
}

function validateQualification(root, verifier, errors) {
  if (!STATES.includes(root.reproductionState))
    errors.push(`${root.tid}: unsupported reproduction state`);
  const expectedDisposition = disposition(root.tid);
  const allowed =
    expectedDisposition === "pending"
      ? ["pending", "fixed"]
      : [expectedDisposition];
  if (!allowed.includes(root.resolution))
    errors.push(`${root.tid}: disposition cannot imply implementation`);
  if (root.resolution !== "fixed" && !nonempty(root.remainingBlocker)) {
    errors.push(
      `${root.tid}: unresolved qualification requires remaining blocker`,
    );
  }
  if (
    root.implementationCommit !== null &&
    !COMMIT.test(root.implementationCommit)
  ) {
    errors.push(`${root.tid}: implementation commit must be full SHA or null`);
  }
  if (root.resolution !== "fixed" && COMMIT.test(root.implementationCommit)) {
    const failure =
      verifier?.commit(root.implementationCommit) ?? "commit verifier required";
    if (failure) errors.push(`${root.tid} implementation commit: ${failure}`);
  }
  if (root.localEvidence !== null)
    validateEvidence(
      root.localEvidence,
      `${root.tid} local evidence`,
      verifier,
      errors,
    );
  if (
    ["reproduced", "not-reproduced"].includes(root.reproductionState) &&
    root.localEvidence === null
  ) {
    errors.push(
      `${root.tid}: reproduction state requires fresh local evidence`,
    );
  }
  if (root.reproductionState === "unverified" && root.localEvidence !== null) {
    errors.push(
      `${root.tid}: unverified state cannot claim fresh local evidence`,
    );
  }
  if (
    expectedDisposition !== "pending" &&
    (root.implementationCommit !== null || root.regressionTest !== null)
  )
    errors.push(`${root.tid}: disposition-only record cannot claim a fix`);
  if (root.resolution === "fixed") validateFixed(root, verifier, errors);
  else if (root.regressionTest !== null)
    validateRegression(root.regressionTest, root.tid, verifier, errors);
}

export function validateManifest(manifest, sources, verifier) {
  const errors = [];
  if (!validateMetadata(manifest, sources, errors)) return errors;
  const roots = new Set();
  const covered = new Set();
  for (const root of manifest.roots) {
    if (!checkKeys(root, ROOT_KEYS, "root", errors)) continue;
    if (roots.has(root.tid)) errors.push(`duplicate primary root: ${root.tid}`);
    roots.add(root.tid);
    const canonical = sources.triage.find((item) => item.tid === root.tid);
    if (!canonical) {
      errors.push(`unknown root: ${root.tid}`);
      continue;
    }
    validateOriginal(root, canonical, sources, errors);
    validateAliases(root, canonical, sources, covered, errors);
    validateQualification(root, verifier, errors);
  }
  for (const canonical of sources.triage) {
    if (!roots.has(canonical.tid))
      errors.push(`missing primary root: ${canonical.tid}`);
  }
  for (const { record } of sources.raw) {
    if (!covered.has(record.id))
      errors.push(`missing raw coverage: ${record.id}`);
  }
  if (manifest.roots.length !== 395)
    errors.push("root count must be exactly 395");
  if (covered.size !== 480)
    errors.push("raw coverage must be exactly 480 distinct aliases");
  return errors;
}
