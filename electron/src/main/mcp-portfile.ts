import { app } from "electron";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { log as electronLog } from "./logger.js";

const log = electronLog.scope("mcp");

/** Bumped when the file's shape changes, so an old shim fails loudly. */
export const MCP_PORTFILE_VERSION = 1;
export const MCP_PORTFILE_NAME = "mcp.json";
const MCP_ROUTE = "/api/modules/assistant/mcp";

export interface McpPortfile {
  version: number;
  url: string;
  port: number;
  token: string;
  pid: number;
  appVersion: string;
}

let token: string | null = null;

/**
 * The backend binds an ephemeral port (`PORT=0`) and only Electron main learns
 * the real one, so an external MCP client has nothing to connect to without
 * this file. It carries the URL and the bearer token together — the token is
 * generated fresh per launch and never persisted anywhere else.
 *
 * Written at 0600: the token is the only gate on a write-capable endpoint, and
 * the file sits in a user-data directory other accounts may be able to list.
 */
export function ensureMcpToken(): string {
  token ??= randomBytes(32).toString("hex");
  return token;
}

function portfilePath(appDataDir: string): string {
  return join(appDataDir, MCP_PORTFILE_NAME);
}

function processAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without delivering.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user — alive, and
    // deleting its portfile would break a running instance. Only ESRCH proves
    // the process is gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The pid recorded in an existing portfile, if a live process owns it. */
function liveOwnerPid(filePath: string): number | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as
      | Partial<McpPortfile>
      | null;
    const pid = parsed?.pid;
    if (typeof pid === "number" && pid !== process.pid && processAlive(pid)) {
      return pid;
    }
  } catch {
    // Unparseable file is stale by definition.
  }
  return null;
}

/**
 * Remove a portfile left behind by a crashed run. Only ever deletes a file
 * whose recorded pid is gone — a live second instance is not ours to clear
 * (and `requestSingleInstanceLock` should have prevented one anyway).
 */
export function clearStaleMcpPortfile(appDataDir: string): void {
  const filePath = portfilePath(appDataDir);
  const owner = liveOwnerPid(filePath);
  if (owner !== null) {
    log.warn(`Leaving MCP portfile owned by live pid ${owner}; not overwriting.`);
    return;
  }
  rmSync(filePath, { force: true });
}

export function writeMcpPortfile(input: {
  appDataDir: string;
  url: string;
  port: number;
}): McpPortfile | null {
  const contents: McpPortfile = {
    version: MCP_PORTFILE_VERSION,
    url: `${input.url}${MCP_ROUTE}`,
    port: input.port,
    token: ensureMcpToken(),
    pid: process.pid,
    appVersion: app.getVersion(),
  };
  const filePath = portfilePath(input.appDataDir);
  const owner = liveOwnerPid(filePath);
  if (owner !== null) {
    // Another live instance serves MCP; overwriting its file would point its
    // clients at us with a token they do not have.
    log.warn(`MCP portfile belongs to live pid ${owner}; not writing ours.`);
    return null;
  }
  try {
    // Write-then-rename so a shim polling the file never reads it half
    // written. The temp file is created 0600 and rename keeps the mode.
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(contents, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmpPath, filePath);
    log.info(`MCP portfile written: ${filePath}`);
    return contents;
  } catch (error) {
    // Non-fatal: the app still runs, only the MCP shim loses its discovery
    // path. HTTP clients pointed at the URL directly are unaffected.
    log.warn(`Failed to write MCP portfile: ${String(error)}`);
    return null;
  }
}

export function removeMcpPortfile(appDataDir: string): void {
  try {
    rmSync(portfilePath(appDataDir), { force: true });
  } catch (error) {
    log.warn(`Failed to remove MCP portfile: ${String(error)}`);
  }
}
