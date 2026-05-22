import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolution order:
 *   1. OPENPCB_BUNDLED_LIBRARY_PATH (absolute file or dir)
 *   2. Electron resources path: $resourcesPath/core-library/*.opclib
 *   3. Dev fallback A: <OpenPCB-parent>/CoreLibrary/dist/*.opclib
 *      (lets contributors iterate on the external repo via
 *      `npm run dev:corelib` without manually copying)
 *   4. Dev fallback B: <OpenPCB-repo>/resources/core-library/*.opclib
 *
 * When multiple `.opclib` files exist in a directory, the highest semver
 * version (parsed from the filename suffix) wins. `1.10.0` correctly beats
 * `1.9.0` and `1.0.0`; lexicographic sort doesn't.
 */
interface LocateBundledOpclibOptions {
  repoRoot?: string;
  electronResources?: string | null;
  nodeEnv?: string;
}

export async function locateBundledOpclib(
  options: LocateBundledOpclibOptions = {},
): Promise<string | null> {
  const fromEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
  if (fromEnv) {
    const stats = await statSafe(fromEnv);
    if (stats?.isFile()) return fromEnv;
    if (stats?.isDirectory()) {
      const hit = await latestOpclibIn(fromEnv);
      if (hit) return hit;
    }
  }

  const electronResources =
    "electronResources" in options
      ? (options.electronResources ?? undefined)
      : (process as { resourcesPath?: string }).resourcesPath;
  if (electronResources) {
    const dir = path.join(electronResources, "core-library");
    const hit = await latestOpclibIn(dir);
    if (hit) return hit;
  }

  const repoRoot = options.repoRoot
    ? path.resolve(options.repoRoot)
    : process.env.OPENPCB_WORKSPACE_ROOT
      ? path.resolve(process.env.OPENPCB_WORKSPACE_ROOT, "..")
      : path.resolve(MODULE_DIR, "..", "..", "..", "..", "..");
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

  if (nodeEnv !== "production") {
    const devCoreLibrary = await latestOpclibIn(
      path.join(repoRoot, "..", "CoreLibrary", "dist"),
    );
    if (devCoreLibrary) return devCoreLibrary;
  }

  const repoBundled = await latestOpclibIn(
    path.join(repoRoot, "resources", "core-library"),
  );
  if (repoBundled) return repoBundled;

  return null;
}

const VERSION_RE = /(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?\.opclib$/;

function parseVersion(filename: string): [number, number, number] | null {
  const m = VERSION_RE.exec(filename);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

async function latestOpclibIn(dir: string): Promise<string | null> {
  try {
    const entries = await readdir(dir);
    const matches = entries
      .filter((n) => n.endsWith(".opclib"))
      .map((n) => ({ name: n, ver: parseVersion(n) }))
      .filter(
        (m): m is { name: string; ver: [number, number, number] } =>
          m.ver !== null,
      );
    if (matches.length === 0) return null;
    matches.sort((a, b) => {
      if (a.ver[0] !== b.ver[0]) return b.ver[0] - a.ver[0];
      if (a.ver[1] !== b.ver[1]) return b.ver[1] - a.ver[1];
      return b.ver[2] - a.ver[2];
    });
    return path.join(dir, matches[0]!.name);
  } catch {
    return null;
  }
}

async function statSafe(
  p: string,
): Promise<{ isFile(): boolean; isDirectory(): boolean } | null> {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}
