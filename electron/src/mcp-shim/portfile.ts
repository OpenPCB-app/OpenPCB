/**
 * Discovery of the running OpenPCB instance through its MCP portfile.
 *
 * Pure (no `electron` import) so the shim runs as plain Node and Bun tests can
 * drive it. The portfile is written by Electron main after the backend is
 * listening (`electron/src/main/mcp-portfile.ts`) and removed on quit.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface Portfile {
  version: number;
  url: string;
  port: number;
  token: string;
  pid: number;
  appVersion: string;
}

export const SUPPORTED_PORTFILE_VERSION = 1;
export const PORTFILE_NAME = "mcp.json";

export interface DiscoveryEnv {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  homedir: string;
  /** Whether a pid is a live process. Injected for tests. */
  processAlive(pid: number): boolean;
  readFile(path: string): string | null;
}

export function defaultDiscoveryEnv(): DiscoveryEnv {
  return {
    env: process.env,
    platform: platform(),
    homedir: homedir(),
    processAlive,
    readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
  };
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user — alive.
    // Only ESRCH ("no such process") proves it is gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Electron's `app.getPath("userData")` locations, reproduced without Electron. */
export function userDataDirs(env: DiscoveryEnv): string[] {
  // "OpenPCB" is the packaged productName; "openpcb-electron" is the package
  // name an unpackaged `npm run dev:electron` falls back to.
  const names = ["OpenPCB", "openpcb-electron"];
  switch (env.platform) {
    case "darwin":
      return names.map((n) =>
        join(env.homedir, "Library", "Application Support", n),
      );
    case "win32": {
      const appData = env.env.APPDATA ?? join(env.homedir, "AppData", "Roaming");
      return names.map((n) => join(appData, n));
    }
    default: {
      const config = env.env.XDG_CONFIG_HOME ?? join(env.homedir, ".config");
      return names.map((n) => join(config, n));
    }
  }
}

/**
 * Candidate portfile paths, most likely first. The `dev` subdirectory is where
 * an unpackaged run puts its data (`backend-server.ts:getAppDataDir`).
 */
export function candidatePaths(env: DiscoveryEnv): string[] {
  const override = env.env.OPENPCB_MCP_PORTFILE;
  if (override) return [override];
  return userDataDirs(env).flatMap((dir) => [
    join(dir, PORTFILE_NAME),
    join(dir, "dev", PORTFILE_NAME),
  ]);
}

export type DiscoveryResult =
  | { ok: true; portfile: Portfile; path: string }
  | { ok: false; reason: "not-running" | "incompatible"; message: string; checked: string[] };

/** Find the portfile of a live OpenPCB instance. Never throws. */
export function discoverPortfile(env: DiscoveryEnv): DiscoveryResult {
  const checked: string[] = [];
  let incompatible: string | null = null;
  for (const path of candidatePaths(env)) {
    checked.push(path);
    const raw = env.readFile(path);
    if (raw === null) continue;
    let parsed: Partial<Portfile>;
    try {
      parsed = JSON.parse(raw) as Partial<Portfile>;
    } catch {
      continue;
    }
    if (parsed.version !== SUPPORTED_PORTFILE_VERSION) {
      incompatible = `The OpenPCB portfile at ${path} is version ${String(parsed.version)}; this bridge understands ${SUPPORTED_PORTFILE_VERSION}. Update OpenPCB so the bridge and the app match.`;
      continue;
    }
    if (
      typeof parsed.url !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.pid !== "number"
    ) {
      continue;
    }
    // A file left by a crashed run points at a dead port; treating it as live
    // produces a confusing connection error instead of a useful one.
    if (!env.processAlive(parsed.pid)) continue;
    return { ok: true, portfile: parsed as Portfile, path };
  }
  if (incompatible) {
    return { ok: false, reason: "incompatible", message: incompatible, checked };
  }
  return {
    ok: false,
    reason: "not-running",
    message:
      "OpenPCB is not running. Ask the user to start the OpenPCB app (and enable Settings → Assistant → MCP), then retry.",
    checked,
  };
}

/** Directory the bridge may keep its cache in (next to the portfile). */
export function cacheDir(env: DiscoveryEnv, found?: string | null): string | null {
  if (found) return dirname(found);
  const first = candidatePaths(env)[0];
  return first ? dirname(first) : null;
}
