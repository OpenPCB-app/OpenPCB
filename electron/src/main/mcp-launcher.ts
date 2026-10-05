import { app } from "electron";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { log as electronLog } from "./logger.js";
import {
  launcherFileName,
  launcherScript,
  resolveLauncherExec,
  type ExecResolution,
  type LauncherPlatform,
} from "./mcp-launcher-content.js";

const log = electronLog.scope("mcp");

/**
 * Install the stable MCP launcher into `<appDataDir>/mcp/` on every launch
 * (see `mcp-launcher-content.ts` for why the bundle path cannot be used).
 * Copies the bridge bundle next to it so an AppImage / portable build's temp
 * mount is never referenced, and records what was installed in
 * `launcher.json` so a translocated launch can keep the last good binary.
 *
 * Non-fatal: failure only costs the MCP launcher, never the app.
 */

export interface InstalledLauncher {
  dir: string;
  launcherPath: string;
  shimPath: string;
  exec: ExecResolution;
}

interface LauncherRecord {
  exec: string;
  kind: ExecResolution["kind"];
  appVersion: string;
  updatedAt: string;
}

let installed: InstalledLauncher | null = null;

export function getInstalledMcpLauncher(): InstalledLauncher | null {
  return installed;
}

function platform(): LauncherPlatform {
  return process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "linux";
}

/** The bridge bundle this build ships: resources in a package, the tsup output in dev. */
function bundledShimPath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "mcp", "shim.js")]
    : [join(app.getAppPath(), "dist", "mcp", "shim.js")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function writeAtomic(path: string, contents: string, mode: number): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, { encoding: "utf8", mode });
  renameSync(tmp, path);
  // rename keeps the temp file's mode, but be explicit for pre-existing files
  // on filesystems that ignore the create mode.
  try {
    chmodSync(path, mode);
  } catch {
    // Windows: modes are advisory.
  }
}

function readRecord(dir: string): LauncherRecord | null {
  try {
    return JSON.parse(readFileSync(join(dir, "launcher.json"), "utf8")) as LauncherRecord;
  } catch {
    return null;
  }
}

export function installMcpLauncher(appDataDir: string): InstalledLauncher | null {
  const source = bundledShimPath();
  if (!source) {
    log.warn("MCP bridge bundle not found; launcher not installed (run `npm run build` in electron/).");
    return null;
  }
  const dir = join(appDataDir, "mcp");
  try {
    mkdirSync(dir, { recursive: true });
    const shimPath = join(dir, "shim.js");
    const tmpShim = `${shimPath}.${process.pid}.tmp`;
    copyFileSync(source, tmpShim);
    renameSync(tmpShim, shimPath);

    const exec = resolveLauncherExec({
      platform: platform(),
      execPath: process.execPath,
      env: process.env,
      previousExec: readRecord(dir)?.exec ?? null,
    });
    const launcherPath = join(dir, launcherFileName(platform()));
    writeAtomic(launcherPath, launcherScript(platform(), { exec: exec.exec, shimPath }), 0o755);
    writeAtomic(
      join(dir, "launcher.json"),
      JSON.stringify(
        {
          exec: exec.exec,
          kind: exec.kind,
          appVersion: app.getVersion(),
          updatedAt: new Date().toISOString(),
        } satisfies LauncherRecord,
        null,
        2,
      ),
      0o644,
    );
    if (exec.warning) log.warn(exec.warning);
    log.info(`MCP launcher installed: ${launcherPath} → ${exec.exec} (${exec.kind})`);
    installed = { dir, launcherPath, shimPath, exec };
    return installed;
  } catch (error) {
    log.warn(`Failed to install the MCP launcher: ${String(error)}`);
    return null;
  }
}
