#!/usr/bin/env bun
/**
 * Fetch a CoreLibrary `.opclib` release and verify it end-to-end:
 *
 *   1. Resolve tag (CLI arg → env → latest stable from GitHub API)
 *   2. Download `.opclib` + `SHA256SUMS` + `openpcb-core.pub`
 *   3. Verify SHA-256 against `SHA256SUMS`
 *   4. Verify Ed25519 signature against the committed trusted public key
 *      (`resources/keys/*.pub`) — fail if no key matches
 *   5. Validate manifest: `library.id === "openpcb.core"`, `components.length >= MIN`
 *   6. Copy artifact + sums into `.build/core-library/` (CI) and
 *      `resources/core-library/` (local dev parity)
 *   7. Emit JSON summary on stdout for `release.yml` to consume:
 *        {"tag":"v0.1.0-beta.0","version":"0.1.0-beta.0","components":17,...}
 *
 * Usage:
 *   bun scripts/fetch-core-library.ts                  # latest stable
 *   bun scripts/fetch-core-library.ts --tag=v1.2.3     # explicit tag
 *   bun scripts/fetch-core-library.ts v1.2.3           # positional alias
 *
 * Env:
 *   OPENPCB_SKIP_CORELIB_FETCH=1     skip entirely (offline)
 *   OPENPCB_CORELIB_REPO=owner/name  override default `OpenPCB-app/CoreLibrary`
 *   OPENPCB_CORELIB_TAG=v1.2.3       same as --tag
 *   OPENPCB_CORELIB_MIN_COMPONENTS=N override the default ≥10 guard
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
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { verifyManifest } from "@openpcb/opclib-pack";

const REPO = process.env.OPENPCB_CORELIB_REPO ?? "OpenPCB-app/CoreLibrary";
const MIN_COMPONENTS = Number(
  process.env.OPENPCB_CORELIB_MIN_COMPONENTS ?? "10",
);
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const BUILD_DIR = path.join(REPO_ROOT, ".build", "core-library");
const RESOURCES_DIR = path.join(REPO_ROOT, "resources", "core-library");
const KEYS_DIR = path.join(REPO_ROOT, "resources", "keys");

if (process.env.OPENPCB_SKIP_CORELIB_FETCH === "1") {
  console.error("[corelib:fetch] OPENPCB_SKIP_CORELIB_FETCH=1; skipping");
  process.exit(0);
}

function parseTagArg(): string {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--tag=")) return a.slice("--tag=".length);
    if (!a.startsWith("--")) return a;
  }
  return process.env.OPENPCB_CORELIB_TAG ?? "";
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; allowFail?: boolean } = {},
): { stdout: string; status: number | null } {
  const r = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "inherit"],
    cwd: opts.cwd,
  });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(" ")} exited with status ${r.status}`);
  }
  return { stdout: r.stdout?.toString() ?? "", status: r.status };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function ghAvailable(): boolean {
  return spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0;
}

function resolveLatestStableTag(): string {
  // Avoid passing a `--jq` filter through spawnSync (Windows cmd.exe mangles
  // the brackets). Fetch full JSON and filter in JS.
  const r = run("gh", ["api", `repos/${REPO}/releases`]);
  let releases: Array<{ tag_name: string; prerelease: boolean }>;
  try {
    releases = JSON.parse(r.stdout) as Array<{
      tag_name: string;
      prerelease: boolean;
    }>;
  } catch (err) {
    throw new Error(
      `failed to parse gh releases response: ${(err as Error).message}`,
    );
  }
  const stable = releases.find((r) => r.prerelease === false);
  if (!stable) {
    throw new Error(
      `no stable (non-prerelease) releases found on ${REPO}. Use --tag to pin or publish a stable release first.`,
    );
  }
  return stable.tag_name;
}

if (!ghAvailable()) {
  console.error(
    "[corelib:fetch] gh CLI not found in PATH. Install https://cli.github.com/ or set OPENPCB_SKIP_CORELIB_FETCH=1.",
  );
  process.exit(1);
}

const requestedTag = parseTagArg();
const tag = requestedTag || resolveLatestStableTag();
const tmp = mkdtempSync(path.join(os.tmpdir(), "openpcb-corelib-"));

try {
  console.error(`[corelib:fetch] tag=${tag} repo=${REPO} tmp=${tmp}`);
  run("gh", [
    "release",
    "download",
    tag,
    "--repo",
    REPO,
    "--pattern",
    "*.opclib",
    "--pattern",
    "SHA256SUMS",
    "--pattern",
    "openpcb-core.pub",
    "--dir",
    tmp,
    "--clobber",
  ]);

  const files = readdirSync(tmp);
  const opclib = files.find((f) => f.endsWith(".opclib"));
  if (!opclib) throw new Error("no .opclib asset in release");
  const opclibBytes = new Uint8Array(readFileSync(path.join(tmp, opclib)));

  // Step 3: SHA-256.
  const sums = files.find((f) => f === "SHA256SUMS");
  if (!sums) {
    throw new Error(
      "SHA256SUMS missing from release — refusing to ship unsigned/unverified .opclib",
    );
  }
  const sumsText = readFileSync(path.join(tmp, sums), "utf8");
  const line = sumsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.endsWith(opclib));
  if (!line) throw new Error(`SHA256SUMS does not list ${opclib}`);
  const declared = line.split(/\s+/)[0]!;
  const actual = sha256Hex(opclibBytes);
  if (declared !== actual) {
    throw new Error(
      `sha256 mismatch for ${opclib}: declared=${declared} actual=${actual}`,
    );
  }
  console.error(`[corelib:fetch] sha256 ok (${actual.slice(0, 16)}…)`);

  // Step 4: Ed25519 signature against committed trusted keys.
  const entries = unzipSync(opclibBytes, {
    filter: (f) => f.name === "library.json",
  });
  const manifestBytes = entries["library.json"];
  if (!manifestBytes) {
    throw new Error("library.json missing from .opclib");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes));
  // Build trusted key set from committed resources/keys/*.pub.
  const trustedKeys = new Map<string, Buffer>();
  if (existsSync(KEYS_DIR)) {
    for (const f of readdirSync(KEYS_DIR)) {
      if (!f.endsWith(".pub")) continue;
      const keyId = f.replace(/\.pub$/, "");
      trustedKeys.set(keyId, readFileSync(path.join(KEYS_DIR, f)));
    }
  }
  // If release publishes openpcb-core.pub, accept only if its PEM contents
  // match a committed key. Normalize line endings (Windows checkouts can
  // convert LF → CRLF on the committed file, breaking byte comparison).
  const releasedPub = files.find((f) => f === "openpcb-core.pub");
  if (releasedPub) {
    const releasedKeyText = readFileSync(path.join(tmp, releasedPub), "utf8")
      .replace(/\r\n/g, "\n")
      .trim();
    let matched = false;
    for (const [, committed] of trustedKeys) {
      const committedText = committed
        .toString("utf8")
        .replace(/\r\n/g, "\n")
        .trim();
      if (committedText === releasedKeyText) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new Error(
        "released openpcb-core.pub does not match any trusted key in resources/keys/ — refusing to trust",
      );
    }
  }

  // Signature is enforced when present. Unsigned releases are allowed for now
  // (CoreLibrary's release.yml only signs when OPCLIB_SIGNING_KEY secret is
  // set). Once the secret is wired up, change this to fail-closed.
  let verifiedKeyId = "";
  if (manifest.signature) {
    const verify = verifyManifest(manifest, {
      resolveKey: (keyId) => trustedKeys.get(keyId),
    });
    if (!verify.valid) {
      throw new Error(
        `signature verification failed: keyId=${verify.keyId ?? "(none)"} reason=${verify.reason}`,
      );
    }
    verifiedKeyId = verify.keyId ?? "";
    console.error(`[corelib:fetch] ed25519 ok (keyId=${verifiedKeyId})`);
  } else {
    console.error(
      "[corelib:fetch] WARNING: manifest unsigned — relying on SHA256SUMS only. Configure OPCLIB_SIGNING_KEY on CoreLibrary repo to enforce signatures.",
    );
  }

  // Step 5: Manifest sanity.
  if (manifest.library?.id !== "openpcb.core") {
    throw new Error(
      `manifest library.id mismatch: ${manifest.library?.id ?? "(missing)"}`,
    );
  }
  const counts = {
    components: Array.isArray(manifest.components)
      ? manifest.components.length
      : 0,
    footprints: Array.isArray(manifest.footprints)
      ? manifest.footprints.length
      : 0,
    symbols: Array.isArray(manifest.symbols) ? manifest.symbols.length : 0,
    models3d: Array.isArray(manifest.models3d) ? manifest.models3d.length : 0,
  };
  if (counts.components < MIN_COMPONENTS) {
    throw new Error(
      `manifest has only ${counts.components} components (< ${MIN_COMPONENTS} threshold). Refusing to ship a stub library.`,
    );
  }
  console.error(
    `[corelib:fetch] manifest ok — ${counts.symbols} symbols, ${counts.footprints} footprints, ${counts.components} components`,
  );

  // Step 6: Copy into .build/ and resources/.
  for (const dir of [BUILD_DIR, RESOURCES_DIR]) {
    mkdirSync(dir, { recursive: true });
    // Wipe stale .opclib so the locator picks the new one unambiguously.
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".opclib") || f === "SHA256SUMS") {
        rmSync(path.join(dir, f));
      }
    }
    writeFileSync(path.join(dir, opclib), opclibBytes);
    writeFileSync(path.join(dir, "SHA256SUMS"), sumsText);
  }
  console.error(
    `[corelib:fetch] wrote .build/core-library/${opclib} + resources/core-library/${opclib}`,
  );

  // Step 7: JSON summary on stdout for $GITHUB_OUTPUT consumption.
  const summary = {
    tag,
    version: manifest.library?.version ?? "",
    artifact: opclib,
    sha256: actual,
    keyId: verifiedKeyId,
    symbols: counts.symbols,
    footprints: counts.footprints,
    components: counts.components,
    models3d: counts.models3d,
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
