import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  disposition,
  loadSources,
  MANIFEST,
} from "./qa-reconciliation-sources.mjs";

export const repo = resolve(import.meta.dirname, "..");
export const sources = loadSources(repo);
export const baseline = JSON.parse(readFileSync(join(repo, MANIFEST), "utf8"));
export const evidencePath = "docs/qa/2026-10-hardening/evidence/behavior.log";

export function fresh() {
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
