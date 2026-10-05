import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const ARCHIVE = "docs/qa/2026-09-ui-qa";
export const MANIFEST = "docs/qa/2026-10-hardening/reconciliation.json";
export const OWNERS = "docs/qa/2026-10-hardening/reconciliation-owners.json";
export const PROJECTION =
  "docs/qa/2026-10-hardening/reconciliation-sources.json";
export const SOURCE_COMMIT = "798f9fdc7d0018f081f2a27f3fa2bc9d96f8e2c4";
const OWNER_SHA =
  "5ad0126dd29010c5f389180e26998afe0684bde2ea16eb6e9382402fbaa6b49f";
const SOURCES_SHA =
  "b51969b0b7793d4dbebe46649ed7610e578ec09ab2fc40a224ec9e07191a0742";
const PROJECTION_SHA =
  "569598b273febb98dc615d99f1a18595e045b40a2f98174083417365beb02d7a";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(repo, path) {
  return JSON.parse(readFileSync(join(repo, path), "utf8"));
}

function dataFiles(repo, directory) {
  return readdirSync(join(repo, ARCHIVE, directory))
    .sort()
    .map((name) => `${ARCHIVE}/${directory}/${name}`);
}

function inventorySources(repo) {
  const documents = [
    "README.md",
    "TRIAGE-full.md",
    "09-approved-scope.md",
    "05-rejected.md",
    "07-coverage.md",
    "08-method.md",
    "fix/FIX_PROTOCOL.md",
    "fix/results/wave-a-crossowner.md",
    "data/method/QA_PROTOCOL.md",
  ].map((path) => `${ARCHIVE}/${path}`);
  const paths = [
    ...documents,
    ...dataFiles(repo, "areas"),
    ...dataFiles(repo, "data/raw"),
    ...dataFiles(repo, "data/verified"),
    ...dataFiles(repo, "data/coverage"),
    `${ARCHIVE}/data/triage.json`,
    `${ARCHIVE}/data/triage-approved.json`,
    OWNERS,
  ].sort();
  return paths.map((path) => ({
    path,
    sha256: sha256(readFileSync(join(repo, path))),
  }));
}

export function buildArchiveProjection(repo) {
  const raw = dataFiles(repo, "data/raw").flatMap((path) =>
    readFileSync(join(repo, path), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const record = JSON.parse(line);
        return { record: { id: record.id, severity: record.severity }, path };
      }),
  );
  const verified = dataFiles(repo, "data/verified").flatMap((path) =>
    readJson(repo, path).map((record) => ({
      record: {
        id: record.id,
        severity: record.severity,
        status: record.status,
        verification: { verdict: record.verification?.verdict ?? null },
        duplicateOf: record.duplicateOf ?? null,
        mergedIds: record.mergedIds ?? [],
      },
      path,
    })),
  );
  const triage = readJson(repo, `${ARCHIVE}/data/triage.json`).map((root) => ({
    tid: root.tid,
    ids: root.ids,
    title: root.title,
    area: root.area,
    severity: root.severity,
    scope: root.scope,
    decision: root.decision,
    recommendation: root.recommendation,
    status: root.status,
    owner: root.owner,
    knownRef: root.knownRef,
    knownStatus: root.knownStatus,
    note: root.note,
    evidence: root.evidence,
  }));
  const approved = readJson(repo, `${ARCHIVE}/data/triage-approved.json`).map(
    (root) => ({
      tid: root.tid,
      approved: root.approved,
      fixOwner: root.fixOwner ?? null,
      approvalNote: root.approvalNote ?? null,
    }),
  );
  return {
    schemaVersion: 1,
    sourceCommit: SOURCE_COMMIT,
    triage,
    approved,
    raw,
    verified,
    files: inventorySources(repo),
  };
}

export function loadSources(repo, { verifyArchive = false } = {}) {
  const ownerBytes = readFileSync(join(repo, OWNERS));
  if (sha256(ownerBytes) !== OWNER_SHA)
    throw new Error("Pinned owner snapshot SHA-256 mismatch");
  const projectionBytes = readFileSync(join(repo, PROJECTION));
  if (sha256(projectionBytes) !== PROJECTION_SHA)
    throw new Error("Pinned source projection SHA-256 mismatch");
  const projection = JSON.parse(projectionBytes.toString("utf8"));
  if (verifyArchive) verifyArchiveProjection(repo, projection);
  const sources = {
    ...projection,
    ownership: JSON.parse(ownerBytes.toString("utf8")),
  };
  if (sha256(JSON.stringify(sources.files)) !== SOURCES_SHA) {
    throw new Error("Pinned QA archive/source fingerprints mismatch");
  }
  assertSources(sources);
  return sources;
}

function verifyArchiveProjection(repo, expected) {
  let actual;
  try {
    actual = buildArchiveProjection(repo);
  } catch (error) {
    throw new Error(
      `Original QA archive verification unavailable: ${error.message}`,
    );
  }
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error("Original QA archive projection/fingerprints mismatch");
  }
}

function assertUnique(records, key, expected, name) {
  const ids = records.map((record) => record[key]);
  if (ids.length !== expected || new Set(ids).size !== expected) {
    throw new Error(
      `Canonical ${name} must contain ${expected} distinct ${key} values`,
    );
  }
}

function assertSources(sources) {
  assertUnique(sources.triage, "tid", 395, "triage");
  assertUnique(sources.approved, "tid", 395, "approved triage");
  assertUnique(sources.ownership.owners, "tid", 395, "owners");
  assertUnique(
    sources.raw.map((item) => item.record),
    "id",
    480,
    "raw findings",
  );
  assertUnique(
    sources.verified.map((item) => item.record),
    "id",
    480,
    "verified findings",
  );
  const aliases = sources.triage.flatMap((root) => root.ids);
  if (aliases.length !== 480 || new Set(aliases).size !== 480) {
    throw new Error(
      "Canonical triage must partition all 480 raw aliases exactly once",
    );
  }
  for (let number = 1; number <= 395; number++) {
    const tid = `T-${String(number).padStart(3, "0")}`;
    if (!sources.triage.some((root) => root.tid === tid))
      throw new Error(`Canonical root missing: ${tid}`);
  }
  const rawIds = new Set(sources.raw.map((item) => item.record.id));
  if (aliases.some((id) => !rawIds.has(id)))
    throw new Error("Canonical triage references an unknown raw alias");
  if (sources.approved.filter((root) => root.approved).length !== 344) {
    throw new Error("Historical approval count must remain 344");
  }
}

export function originalRoot(root, approved) {
  return {
    title: root.title,
    area: root.area,
    severity: root.severity,
    scope: root.scope,
    decision: root.decision,
    recommendation: root.recommendation,
    status: root.status,
    owner: root.owner,
    knownRef: root.knownRef,
    knownStatus: root.knownStatus,
    note: root.note,
    approved: approved.approved,
    fixOwner: approved.fixOwner ?? null,
    approvalNote: approved.approvalNote ?? null,
  };
}

export function rawAlias(id, sources) {
  const raw = sources.raw.find((item) => item.record.id === id);
  const verified = sources.verified.find((item) => item.record.id === id);
  if (!raw || !verified) throw new Error(`Missing canonical alias: ${id}`);
  const record = verified.record;
  const duplicateOf = record.duplicateOf ?? null;
  const duplicateRoot = duplicateOf
    ? sources.triage.find((root) => root.ids.includes(duplicateOf))?.tid
    : null;
  if (duplicateOf && !duplicateRoot)
    throw new Error(`Unknown duplicate target: ${id}`);
  return {
    id,
    rawSeverity: raw.record.severity,
    verifiedSeverity: record.severity,
    status: record.status,
    verificationVerdict: record.verification?.verdict ?? null,
    duplicateOf,
    duplicateRoot,
    mergedIds: record.mergedIds ?? [],
    rawSource: raw.path,
    verifiedSource: verified.path,
  };
}

export function disposition(tid) {
  if (["T-304", "T-305", "T-308"].includes(tid)) return "proposal";
  if (["T-391", "T-392", "T-393", "T-394"].includes(tid))
    return "intentional-wont-fix";
  if (tid === "T-395") return "refuted";
  return "pending";
}

export function sourceContradictions(sources) {
  return sources.verified.flatMap(({ record }) => {
    if (!record.duplicateOf) return [];
    const root = sources.triage.find((root) => root.ids.includes(record.id));
    const target = sources.triage.find((root) =>
      root.ids.includes(record.duplicateOf),
    );
    if (root.tid === target.tid) return [];
    return [
      {
        kind: "historical-duplicate-root-split",
        alias: record.id,
        root: root.tid,
        duplicateOf: record.duplicateOf,
        duplicateRoot: target.tid,
        blocker:
          "Archive splits backend export naming into T-164 while verifier points to T-152. " +
          "Preserve both canonical roots and the original duplicate link; owning tasks must reconcile scope.",
      },
    ];
  });
}
