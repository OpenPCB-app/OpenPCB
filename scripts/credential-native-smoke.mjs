#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron");
const safeFailureCodes = new Set([
  "UNAVAILABLE", "LOCKED", "CORRUPT", "UNSUPPORTED_FORMAT", "WRITE_FAILED", "INVALID_REQUEST",
  "RECONNECT_REQUIRED", "NOT_READY", "FORBIDDEN", "INVALID_SMOKE_PROFILE", "READBACK_MISMATCH",
  "PLAINTEXT_PERSISTED", "PERMISSIONS_MISMATCH", "NATIVE_SMOKE_FAILED",
]);

class NativeStageError extends Error {
  constructor(stage, code) {
    super("NATIVE_PROCESS_FAILED");
    this.stage = stage;
    this.code = code;
  }
}

function runStage(bundle, directory, stage) {
  return new Promise((resolveStage, reject) => {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [bundle, `--credential-stage=${stage}`, `--credential-smoke-root=${directory}`], {
      cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const capture = (chunk) => { output = (output + chunk.toString()).slice(-1024 * 1024); };
    child.stdout.on("data", capture);
    // Only the structured static-code result below is exported, never raw OS failure details.
    child.stderr.on("data", capture);
    const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 45_000);
    child.on("error", () => { clearTimeout(timeout); reject(new NativeStageError(stage, "NATIVE_PROCESS_FAILED")); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const line = output.split("\n").find((entry) => entry.startsWith("CREDENTIAL_NATIVE_RESULT "));
      let result;
      try { result = JSON.parse(line?.slice("CREDENTIAL_NATIVE_RESULT ".length) ?? "null"); } catch { result = null; }
      if (code !== 0 || result?.passed !== true || result.stage !== stage || result.packaged !== false) {
        reject(new NativeStageError(stage, safeFailureCodes.has(result?.code) ? result.code : "NATIVE_PROCESS_FAILED"));
      } else resolveStage(result);
    });
  });
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "openpcb-credential-native-"));
  try {
    for (const name of ["profile", "logs", "crash-dumps"]) await mkdir(join(directory, name), { mode: 0o700 });
    await writeFile(join(directory, "smoke-profile.json"), JSON.stringify({ purpose: "openpcb-credential-native-smoke" }), { mode: 0o600 });
    const bundle = join(directory, "credential-native-smoke.cjs");
    await build({
      entryPoints: [join(root, "electron/tests/credential-native-smoke.ts")], outfile: bundle,
      bundle: true, platform: "node", format: "cjs", target: "node24", external: ["electron"], logLevel: "silent",
    });
    const results = [];
    for (const stage of ["write", "read", "rotate", "read", "clear", "read-cleared"]) {
      results.push(await runStage(bundle, directory, stage));
    }
    if (new Set(results.map((result) => result.pid)).size !== results.length) throw new Error("NATIVE_PROCESS_RESTART_NOT_PROVEN");
    console.log(JSON.stringify({
      passed: true, isolatedTemporaryProfile: true, realCredentialsUsed: false,
      processRestart: true, packaged: false, artifactSha256: createHash("sha256").update(await readFile(bundle)).digest("hex"),
      stages: results,
    }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

main().catch((error) => {
  const result = error instanceof NativeStageError
    ? { passed: false, stage: error.stage, code: error.code }
    : { passed: false, code: error instanceof Error && error.message === "NATIVE_PROCESS_RESTART_NOT_PROVEN"
      ? error.message : "NATIVE_SMOKE_FAILED" };
  console.error(JSON.stringify(result));
  process.exitCode = 1;
});
