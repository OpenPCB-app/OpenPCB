#!/usr/bin/env bun
/**
 * Post-package verification: extract the embedded `.opclib` from a built
 * electron-builder artifact and re-validate its manifest. Run per matrix job
 * in release.yml to catch the case where electron-builder silently shipped
 * the wrong file (e.g. stale stub fallback).
 *
 * Usage:
 *   bun scripts/verify-packaged-opclib.ts <outDir>
 *
 * Looks for one of:
 *   <outDir>/*.zip          (macOS arch zip)
 *   <outDir>/*.dmg          (macOS — skipped; sandbox can't mount in CI)
 *   <outDir>/*.exe          (Windows — handled via 7z / installer extraction)
 *   <outDir>/*.AppImage     (Linux)
 *   <outDir>/*.deb / .rpm   (Linux)
 *
 * Strategy: extract first available artifact (preferring zip/AppImage as
 * they're the easiest to unwrap with stdlib tools), find its embedded
 * `*.opclib`, run the same content guard as fetch-core-library.ts.
 *
 * Exit 0 on pass; non-zero on any failure. Logs to stderr; nothing to stdout.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const MIN_COMPONENTS = Number(
  process.env.OPENPCB_CORELIB_MIN_COMPONENTS ?? "10",
);

function fail(msg: string): never {
  console.error(`[verify-packaged] FAIL: ${msg}`);
  process.exit(1);
}

const outDir = process.argv[2];
if (!outDir) fail("usage: bun scripts/verify-packaged-opclib.ts <outDir>");
if (!existsSync(outDir)) fail(`outDir does not exist: ${outDir}`);

function findArtifact(): { path: string; kind: "zip" | "deb" } {
  const entries = readdirSync(outDir, { withFileTypes: true });
  // Prefer zip (macOS) — stdlib-unwrappable. Otherwise .deb (Linux) — dpkg-deb
  // is pre-installed on Ubuntu runners. AppImage is intentionally not handled
  // here: extraction requires FUSE which isn't available on GH-hosted runners.
  const zip = entries.find(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".zip"),
  );
  if (zip) return { path: path.join(outDir, zip.name), kind: "zip" };
  const deb = entries.find(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".deb"),
  );
  if (deb) return { path: path.join(outDir, deb.name), kind: "deb" };
  fail(`no .zip or .deb found in ${outDir} (per-platform artifact mandatory)`);
}

function extractOpclibBytes(artifact: string, kind: "zip" | "deb"): Uint8Array {
  if (kind === "zip") {
    const zipBytes = new Uint8Array(readFileSync(artifact));
    const entries = unzipSync(zipBytes, {
      filter: (f) =>
        f.name.endsWith(".opclib") && f.name.includes("/core-library/"),
    });
    const found = Object.entries(entries);
    if (found.length === 0) {
      fail(`no core-library/*.opclib found inside ${artifact}`);
    }
    if (found.length > 1) {
      console.error(
        `[verify-packaged] WARN: multiple .opclib found, using ${found[0]![0]}`,
      );
    }
    return found[0]![1];
  }
  // .deb: unwrap via `dpkg-deb -x` into a temp dir, then walk for the
  // core-library/*.opclib. Pre-installed on Ubuntu runners (and used by
  // electron-builder itself).
  const tmp = mkdtempSync(path.join(os.tmpdir(), "openpcb-verify-"));
  const r = spawnSync("dpkg-deb", ["-x", artifact, tmp], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    fail(`dpkg-deb extraction failed: exit ${r.status}`);
  }
  // Walk dpkg-extracted tree for core-library/*.opclib (typically lives at
  // /opt/OpenPCB/resources/core-library/ inside the .deb).
  function* walk(dir: string): Generator<string> {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else yield p;
    }
  }
  let opclibPath: string | null = null;
  for (const p of walk(tmp)) {
    if (p.includes("core-library") && p.endsWith(".opclib")) {
      opclibPath = p;
      break;
    }
  }
  if (!opclibPath) {
    rmSync(tmp, { recursive: true, force: true });
    fail(`no core-library/*.opclib found inside .deb`);
  }
  const bytes = new Uint8Array(readFileSync(opclibPath));
  rmSync(tmp, { recursive: true, force: true });
  return bytes;
}

const { path: artifactPath, kind } = findArtifact();
console.error(
  `[verify-packaged] inspecting ${path.basename(artifactPath)} (${kind}, ${statSync(artifactPath).size} bytes)`,
);

const opclibBytes = extractOpclibBytes(artifactPath, kind);
const inner = unzipSync(opclibBytes, {
  filter: (f) => f.name === "library.json",
});
const manifestBytes = inner["library.json"];
if (!manifestBytes) fail("library.json missing from embedded .opclib");

const manifest = JSON.parse(strFromU8(manifestBytes));
if (manifest.library?.id !== "openpcb.core") {
  fail(`library.id mismatch: ${manifest.library?.id ?? "(missing)"}`);
}
const components = Array.isArray(manifest.components)
  ? manifest.components.length
  : 0;
if (components < MIN_COMPONENTS) {
  fail(
    `embedded library has only ${components} components (< ${MIN_COMPONENTS}). Refusing to ship.`,
  );
}

console.error(
  `[verify-packaged] OK — embedded openpcb.core@${manifest.library.version} with ${components} components`,
);
