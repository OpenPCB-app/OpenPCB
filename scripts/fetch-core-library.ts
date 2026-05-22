#!/usr/bin/env bun
/**
 * Fetch the latest `.opclib` release from the CoreLibrary GitHub repo into
 * `resources/core-library/` so Electron packaging picks it up as a bundled
 * resource. Verifies SHA256SUMS before keeping the file.
 *
 * Usage:
 *   bun scripts/fetch-core-library.ts          # latest stable release
 *   bun scripts/fetch-core-library.ts v1.2.3    # explicit tag
 *
 * Env:
 *   OPENPCB_SKIP_CORELIB_FETCH=1   skip entirely (CI without GH access, offline)
 *   OPENPCB_CORELIB_REPO=owner/name override default `OpenPCB-app/CoreLibrary`
 *   OPENPCB_CORELIB_TAG=v1.2.3      same as positional tag arg
 *
 * Requires `gh` CLI in PATH and authenticated (or anonymous for public repos).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.OPENPCB_SKIP_CORELIB_FETCH === "1") {
  console.log("[corelib:fetch] OPENPCB_SKIP_CORELIB_FETCH=1; skipping");
  process.exit(0);
}

const REPO = process.env.OPENPCB_CORELIB_REPO ?? "OpenPCB-app/CoreLibrary";
const TAG = process.argv[2] ?? process.env.OPENPCB_CORELIB_TAG ?? "";
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const OUT_DIR = path.join(REPO_ROOT, "resources", "core-library");

function run(cmd: string, args: string[], opts: { cwd?: string } = {}) {
  const r = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "inherit"],
    cwd: opts.cwd,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with status ${r.status}`);
  }
  return r.stdout.toString();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function ghAvailable(): boolean {
  const r = spawnSync("gh", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

if (!ghAvailable()) {
  console.error(
    "[corelib:fetch] gh CLI not found in PATH. Install https://cli.github.com/ or set OPENPCB_SKIP_CORELIB_FETCH=1.",
  );
  process.exit(1);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "openpcb-corelib-"));
try {
  console.log(
    `[corelib:fetch] downloading from ${REPO}${TAG ? ` tag=${TAG}` : " (latest)"} into ${tmp}`,
  );
  const args = [
    "release",
    "download",
    ...(TAG ? [TAG] : []),
    "--repo",
    REPO,
    "--pattern",
    "*.opclib",
    "--pattern",
    "SHA256SUMS",
    "--dir",
    tmp,
    "--clobber",
  ];
  run("gh", args);

  const files = readdirSync(tmp);
  const opclib = files.find((f) => f.endsWith(".opclib"));
  const sums = files.find((f) => f === "SHA256SUMS");
  if (!opclib) throw new Error("no .opclib asset in release");
  if (!sums) {
    console.warn(
      "[corelib:fetch] WARNING: SHA256SUMS missing from release; skipping integrity check",
    );
  } else {
    const sumsText = readFileSync(path.join(tmp, sums), "utf8");
    const line = sumsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.endsWith(opclib));
    if (!line) {
      throw new Error(`SHA256SUMS does not list ${opclib}`);
    }
    const declared = line.split(/\s+/)[0]!;
    const actual = sha256(readFileSync(path.join(tmp, opclib)));
    if (declared !== actual) {
      throw new Error(
        `sha256 mismatch for ${opclib}: declared=${declared} actual=${actual}`,
      );
    }
    console.log(`[corelib:fetch] sha256 ok (${actual})`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  // Wipe any stale .opclib files so locator picks the new one cleanly.
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith(".opclib")) rmSync(path.join(OUT_DIR, f));
  }
  const target = path.join(OUT_DIR, opclib);
  const { writeFileSync } = require("node:fs");
  writeFileSync(target, readFileSync(path.join(tmp, opclib)));
  console.log(`[corelib:fetch] wrote ${target}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
