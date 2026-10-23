import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dir, "../../../..");
const require = createRequire(import.meta.url);
const sourceUrl = (file: string): string =>
  JSON.stringify(pathToFileURL(path.join(repoRoot, file)).href);

const probe = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runDrc } from ${sourceUrl("src/shared/drc/drc-engine.ts")};
import { fixtureToProjection } from ${sourceUrl("src/core/backend/tests/helpers/drc-golden.ts")};
import { runDrcOnWorker, disposeDrcWorker, setDrcWorkerEntry } from ${sourceUrl("src/shared/drc/worker/drc-worker-client.ts")};
assert.equal(process.versions.bun, undefined);
const fixture = JSON.parse(readFileSync(new URL(${sourceUrl("src/core/backend/tests/fixtures/drc/golden/golden-census-2l.json")}), "utf8"));
const projection = fixtureToProjection(fixture);
const reference = JSON.stringify(runDrc(projection));
const input = { projection, rawFootprints: null };
let failure = null;
let progress = 0;
try {
  let first;
  if (process.argv[2]) {
    setDrcWorkerEntry(process.argv[2]);
    first = runDrcOnWorker(input).then(() => null, (error) => error.message);
    setDrcWorkerEntry(null);
  }
  const queued = runDrcOnWorker(input, { onProgress: () => progress++ });
  if (first) failure = await first;
  assert.equal(JSON.stringify(await queued), reference);
  assert.equal(JSON.stringify(await runDrcOnWorker(input)), reference);
  assert.ok(progress > 0);
  console.log(JSON.stringify({ failure, progress, violations: JSON.parse(reference).violations.length }));
} finally {
  await disposeDrcWorker();
}
`;

async function runProbe(workerSource?: string): Promise<{
  failure: string | null;
  progress: number;
  violations: number;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpcb-node-worker-"));
  try {
    const entry = path.join(directory, "probe.mjs");
    await writeFile(entry, probe);
    const args = ["--import", require.resolve("tsx"), entry];
    if (workerSource !== undefined) {
      const worker = path.join(directory, "bad-worker.mjs");
      await writeFile(worker, workerSource);
      args.push(worker);
    }
    // The source worker must find its loader and engine relative to its module,
    // even when neither the process cwd nor its entry file is in the checkout.
    const { stdout } = await run("node", args, {
      cwd: directory,
      timeout: 25_000,
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("source Node worker matches the golden without an entry override or repo cwd", async () => {
  const result = await runProbe();
  expect(result.failure).toBeNull();
  expect(result.progress).toBeGreaterThan(0);
  expect(result.violations).toBeGreaterThan(0);
}, 30_000);

test("before-ready error preserves its cause and the queued run recovers", async () => {
  const result = await runProbe('throw new Error("DRC startup sentinel");');
  expect(result.failure).toContain("DRC startup sentinel");
  expect(result.failure).not.toContain("dropped before ready");
}, 30_000);

test("before-ready exit preserves its status and the queued run recovers", async () => {
  const result = await runProbe("process.exit(7);");
  expect(result.failure).toContain("exited with code 7");
  expect(result.failure).not.toContain("dropped before ready");
}, 30_000);

test("startup timeout preserves its deadline and the queued run recovers", async () => {
  const result = await runProbe("setInterval(() => {}, 1000);");
  expect(result.failure).toContain("posted no ready message within 10000 ms");
  expect(result.failure).not.toContain("dropped before ready");
}, 30_000);
