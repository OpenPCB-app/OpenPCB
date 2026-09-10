#!/usr/bin/env node
/**
 * Smoke test for the BUILT DRC worker (execution contract 09 §8) — the
 * `electron/dist/main/drc-worker.js` artifact Electron actually spawns, run on
 * plain Node, compared BYTE FOR BYTE with the in-thread engine's report for the
 * same golden. This stands in for the packaged asar-unpacked entry, which no
 * standard-gate suite exercises (§9).
 *
 * Self-contained: the golden loader and the reference engine are TypeScript,
 * so this script asks Bun (a dev dependency) for the projection and the
 * reference bytes, then spawns the bundle with `node:worker_threads`.
 *
 *   npm run build --workspace electron && node scripts/drc-worker-smoke.mjs [golden-name]
 *
 * (`npm run test:drc-worker-smoke` does both.) Exit 0 on byte identity.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = process.argv[2] ?? "golden-census-2l";
const bundle = path.join(repoRoot, "electron", "dist", "main", "drc-worker.js");
const backendDir = path.join(repoRoot, "src", "core", "backend");

function fail(message) {
  console.error(`drc-worker-smoke: FAIL — ${message}`);
  process.exit(1);
}

if (!existsSync(bundle)) {
  fail(`${bundle} is missing — run \`npm run build --workspace electron\` first`);
}

// Reference: the projection and the in-thread report bytes, from Bun.
const bunScript = `
  import { readFileSync } from "node:fs";
  import { fixtureToProjection } from "./tests/helpers/drc-golden";
  import { runDrc } from "../../shared/drc/drc-engine";
  const fixture = JSON.parse(readFileSync("tests/fixtures/drc/golden/${golden}.json", "utf8"));
  const projection = fixtureToProjection(fixture);
  process.stdout.write(JSON.stringify({
    projection,
    reference: JSON.stringify(runDrc(projection)),
  }));
`;
let reference;
try {
  const out = execFileSync("bun", ["-e", bunScript], {
    cwd: backendDir,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  reference = JSON.parse(out);
} catch (error) {
  fail(`could not compute the Bun reference: ${error instanceof Error ? error.message : String(error)}`);
}

const worker = new Worker(bundle);
const cancel = new SharedArrayBuffer(4);
const timeout = setTimeout(() => fail("timed out waiting for the worker"), 60_000);
let finished = false;

worker.on("error", (error) => fail(`worker error: ${error.message}`));
worker.on("exit", (code) => {
  // `terminate()` after a PASS exits with code 1 by design; only an exit
  // BEFORE the reply is a failure.
  if (!finished && code !== 0) fail(`worker exited with code ${code}`);
});
worker.on("message", (message) => {
  if (message.type === "ready") {
    worker.postMessage({
      type: "run",
      runId: "smoke",
      projection: reference.projection,
      rawFootprints: null,
      cancel,
    });
    return;
  }
  if (message.type === "progress") return;
  clearTimeout(timeout);
  finished = true;
  if (message.type !== "done") {
    fail(`worker replied ${message.type}: ${message.message ?? ""}`);
  }
  const actual = JSON.stringify(message.report);
  if (actual !== reference.reference) {
    fail(
      `report bytes differ from the in-thread engine on ${golden} ` +
        `(${actual.length} vs ${reference.reference.length} chars)`,
    );
  }
  console.log(
    `drc-worker-smoke: PASS — ${bundle} reproduced ${golden} byte for byte ` +
      `(${message.report.violations.length} violations, ${actual.length} chars)`,
  );
  void worker.terminate();
});
