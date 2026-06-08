#!/usr/bin/env bun
/**
 * Post-package verification: locate the embedded `.opclib` in electron-builder
 * output and re-validate its manifest. Run per matrix job in release.yml to
 * catch electron-builder shipping the wrong/incomplete library before it
 * reaches users.
 *
 * Usage:
 *   bun scripts/verify-packaged-opclib.ts <outDir>
 *
 * Resolution order:
 *   1. The per-platform UNPACKED staging dir electron-builder always emits
 *      alongside the installers, scanned recursively for an opclib whose parent
 *      directory is named `core-library`:
 *        Windows: win-unpacked/resources/core-library/
 *        Linux:   linux-unpacked/resources/core-library/
 *        macOS:   mac-<arch>/OpenPCB.app/Contents/Resources/core-library/
 *      This is what gets packed into every target (nsis, portable, dmg, zip,
 *      AppImage, deb, rpm), so verifying it covers ALL build targets on ALL
 *      platforms — crucially including the Windows .exe installers, which can't
 *      be unwrapped with stdlib tools.
 *   2. Fallback: extract a `.zip` (macOS) or `.deb` (Linux) artifact and pull
 *      the embedded `.opclib` from it.
 *
 * Validation (mirrors the runtime import invariants in opclib-importer.ts):
 *   - `library.id === "openpcb.core"`
 *   - `components.length >= OPENPCB_CORELIB_MIN_COMPONENTS` (default 10)
 *   - 3D completeness: every footprint's referenced 3D model exists and ships a
 *     GLB. This is the guard that would have caught the STEP-only v0.1.0-beta.0
 *     pack, which imported as an EMPTY library at runtime.
 *
 * Exit 0 on pass; non-zero on any failure. Logs to stderr; nothing to stdout.
 */
import { spawnSync } from "node:child_process";
import {
  type Dirent,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

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

const VERSION_RE = /(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?\.opclib$/;

function parseVersion(filename: string): [number, number, number] {
  const m = VERSION_RE.exec(filename);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/**
 * Walk `root` for files that live directly inside a `core-library/` directory
 * and end in `.opclib`. Prunes `node_modules` so we don't traverse the bundled
 * Electron runtime tree.
 */
function findUnpackedOpclibs(root: string): string[] {
  const hits: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        stack.push(p);
      } else if (
        e.isFile() &&
        e.name.endsWith(".opclib") &&
        path.basename(dir) === "core-library"
      ) {
        hits.push(p);
      }
    }
  }
  return hits;
}

function findArtifact(
  root: string,
): { path: string; kind: "zip" | "deb" } | null {
  const entries = readdirSync(root, { withFileTypes: true });
  const zip = entries.find(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".zip"),
  );
  if (zip) return { path: path.join(root, zip.name), kind: "zip" };
  const deb = entries.find(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".deb"),
  );
  if (deb) return { path: path.join(root, deb.name), kind: "deb" };
  return null;
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
  const tmp = mkdtempSync(path.join(os.tmpdir(), "openpcb-verify-"));
  const r = spawnSync("dpkg-deb", ["-x", artifact, tmp], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    fail(`dpkg-deb extraction failed: exit ${r.status}`);
  }
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

/** Validate a `.opclib`'s manifest against the runtime import invariants. */
function validateOpclibBytes(opclibBytes: Uint8Array, label: string): string {
  const inner = unzipSync(opclibBytes, {
    filter: (f) => f.name === "library.json",
  });
  const manifestBytes = inner["library.json"];
  if (!manifestBytes) fail(`library.json missing from ${label}`);
  const manifest = JSON.parse(strFromU8(manifestBytes));

  if (manifest.library?.id !== "openpcb.core") {
    fail(
      `library.id mismatch in ${label}: ${manifest.library?.id ?? "(missing)"}`,
    );
  }
  const components = Array.isArray(manifest.components)
    ? manifest.components.length
    : 0;
  if (components < MIN_COMPONENTS) {
    fail(
      `${label}: only ${components} components (< ${MIN_COMPONENTS}). Refusing to ship.`,
    );
  }

  // 3D completeness — mirror the (now non-fatal at runtime) core invariant so
  // an incomplete pack fails the BUILD instead of degrading silently in the app.
  const modelsById = new Map<string, { formats?: { glb?: unknown } }>(
    (Array.isArray(manifest.models3d) ? manifest.models3d : []).map(
      (m: { id: string }) => [m.id, m],
    ),
  );
  const defects: string[] = [];
  for (const fp of Array.isArray(manifest.footprints)
    ? manifest.footprints
    : []) {
    for (const modelId of fp.models3d ?? []) {
      const model = modelsById.get(modelId);
      if (!model) {
        defects.push(`footprint ${fp.id} → missing model ${modelId}`);
      } else if (!model.formats?.glb) {
        defects.push(`footprint ${fp.id} → model ${modelId} has no GLB`);
      }
    }
  }
  if (defects.length > 0) {
    fail(
      `${label}: ${defects.length} footprint(s) reference 3D models without a GLB — ` +
        `this pack imports as an EMPTY library at runtime. First few: ${defects
          .slice(0, 3)
          .join("; ")}`,
    );
  }

  return `openpcb.core@${manifest.library.version} (${components} components, ${modelsById.size} 3D models, GLB-complete)`;
}

// 1) Preferred: the unpacked staging dir(s) — covers every target on every OS.
const unpacked = findUnpackedOpclibs(outDir);
if (unpacked.length > 0) {
  unpacked.sort((a, b) => {
    const va = parseVersion(path.basename(a));
    const vb = parseVersion(path.basename(b));
    return vb[0] - va[0] || vb[1] - va[1] || vb[2] - va[2];
  });
  const chosen = unpacked[0]!;
  console.error(
    `[verify-packaged] inspecting unpacked ${path.relative(outDir, chosen)} (${statSync(chosen).size} bytes)` +
      (unpacked.length > 1
        ? ` [${unpacked.length} found, highest-semver chosen]`
        : ""),
  );
  const summary = validateOpclibBytes(
    new Uint8Array(readFileSync(chosen)),
    chosen,
  );
  console.error(`[verify-packaged] OK — ${summary}`);
  process.exit(0);
}

// 2) Fallback: pull from a zip/deb installer artifact.
const artifact = findArtifact(outDir);
if (!artifact) {
  fail(
    `no core-library/*.opclib found in any unpacked dir under ${outDir}, and no .zip/.deb fallback artifact present`,
  );
}
console.error(
  `[verify-packaged] no unpacked opclib; inspecting ${path.basename(artifact.path)} (${artifact.kind}, ${statSync(artifact.path).size} bytes)`,
);
const summary = validateOpclibBytes(
  extractOpclibBytes(artifact.path, artifact.kind),
  artifact.path,
);
console.error(`[verify-packaged] OK — ${summary}`);
