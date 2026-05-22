/**
 * Trusted Ed25519 public keys for `.opclib` signature verification.
 *
 * Keys live as PEM files under `resources/keys/*.pub` (Electron resources at
 * runtime, repo path during dev). Filename = key id (e.g.
 * `resources/keys/openpcb-core-2026.pub` → keyId `openpcb-core-2026`).
 *
 * Loaded eagerly on first request; cheap to re-read so we re-scan on each
 * `getTrustedKeys()` call to allow hot-swapping during dev. In tests we
 * accept an override via `OPENPCB_TRUSTED_KEYS_DIR`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function candidateKeyDirs(): string[] {
  const dirs: string[] = [];
  const override = process.env.OPENPCB_TRUSTED_KEYS_DIR;
  if (override) dirs.push(path.resolve(override));

  // Electron packaged: process.resourcesPath/keys
  const resourcesPath = (process as unknown as { resourcesPath?: string })
    .resourcesPath;
  if (resourcesPath) dirs.push(path.join(resourcesPath, "keys"));

  // Dev: OPENPCB_WORKSPACE_ROOT points at <repo>/src; resources live alongside.
  const workspaceRoot = process.env.OPENPCB_WORKSPACE_ROOT;
  if (workspaceRoot) {
    dirs.push(path.resolve(workspaceRoot, "..", "resources", "keys"));
  }

  // Final fallback: cwd/resources/keys (Bun test harness, dev backend run from repo).
  dirs.push(path.resolve(process.cwd(), "resources", "keys"));

  return dirs.filter((d, i, arr) => arr.indexOf(d) === i);
}

export interface TrustedKey {
  keyId: string;
  pem: string;
  source: string;
}

export function loadTrustedKeys(): Map<string, TrustedKey> {
  const map = new Map<string, TrustedKey>();
  for (const dir of candidateKeyDirs()) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith(".pub")) continue;
      const keyId = file.slice(0, -".pub".length);
      if (map.has(keyId)) continue;
      const abs = path.join(dir, file);
      let pem: string;
      try {
        pem = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      map.set(keyId, { keyId, pem, source: abs });
    }
  }
  return map;
}

export function makeResolver(): (keyId: string) => string | undefined {
  const keys = loadTrustedKeys();
  return (keyId) => keys.get(keyId)?.pem;
}
