/**
 * One-click "Connect Claude Code": drive the user's own `claude` CLI to
 * register OpenPCB, report the connection state, update and disconnect.
 *
 * No `electron` import, and the process runner is injected, so Bun tests can
 * exercise the whole flow against a fake CLI.
 *
 * Security posture: only on an explicit click in Settings; `execFile` with a
 * fixed argv (never a shell string, never user text); a timeout on every run;
 * and it only ever removes registrations that point at OpenPCB's own launcher.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  MARKETPLACE_NAME,
  MCP_SERVER_NAME,
  PLUGIN_NAME,
} from "./claude-plugin-content.js";

export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (file: string, args: string[], timeoutMs: number) => Promise<RunResult>;

export const defaultRunner: Runner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : error
              ? 1
              : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });

export interface CliEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
  exists(path: string): boolean;
  run: Runner;
}

export function defaultCliEnv(): CliEnv {
  return {
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    exists: existsSync,
    run: defaultRunner,
  };
}

function candidateNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
}

/**
 * Find the `claude` binary. A GUI app on macOS does not inherit the user's
 * shell PATH, so after PATH, ask the login shell, then try the places the
 * native installer and npm put it.
 */
export async function locateClaudeCli(env: CliEnv): Promise<string | null> {
  const names = candidateNames(env.platform);
  for (const dir of (env.env.PATH ?? "").split(env.platform === "win32" ? ";" : delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (env.exists(candidate)) return candidate;
    }
  }
  if (env.platform !== "win32") {
    const shell = env.env.SHELL || "/bin/sh";
    const probe = await env.run(shell, ["-ilc", "command -v claude"], 3_000);
    const found = probe.stdout
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("/"));
    if (probe.code === 0 && found && env.exists(found)) return found;
  }
  const home = env.homedir;
  const known =
    env.platform === "win32"
      ? [
          join(home, ".local", "bin", "claude.exe"),
          join(env.env.APPDATA ?? join(home, "AppData", "Roaming"), "npm", "claude.cmd"),
        ]
      : [
          join(home, ".local", "bin", "claude"),
          join(home, ".claude", "local", "claude"),
          "/opt/homebrew/bin/claude",
          "/usr/local/bin/claude",
          join(home, ".npm-global", "bin", "claude"),
        ];
  return known.find((path) => env.exists(path)) ?? null;
}

/** Run the CLI; a `.cmd` shim on Windows needs cmd.exe (Node will not spawn it directly). */
function runClaude(env: CliEnv, cli: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  if (env.platform === "win32" && /\.cmd$/i.test(cli)) {
    return env.run("cmd.exe", ["/d", "/s", "/c", cli, ...args], timeoutMs);
  }
  return env.run(cli, args, timeoutMs);
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface ClaudeCodeStatus {
  cliPath: string | null;
  cliVersion: string | null;
  /** The OpenPCB plugin is installed (any scope). */
  plugin: { installed: boolean; version: string | null; enabled: boolean };
  /** The OpenPCB local marketplace is registered. */
  marketplace: { registered: boolean; path: string | null };
  /** A plain `openpcb` MCP server is registered (the "server only" setup). */
  server: { registered: boolean; ownedByOpenPcb: boolean };
  /** The installed plugin is older than this app. */
  updateAvailable: boolean;
}

interface PluginListEntry {
  id: string;
  version?: string;
  enabled?: boolean;
}

interface MarketplaceListEntry {
  name: string;
  path?: string;
}

export async function claudeCodeStatus(
  env: CliEnv,
  input: { appVersion: string; launcherPath: string | null },
): Promise<ClaudeCodeStatus> {
  const cliPath = await locateClaudeCli(env);
  const empty: ClaudeCodeStatus = {
    cliPath,
    cliVersion: null,
    plugin: { installed: false, version: null, enabled: false },
    marketplace: { registered: false, path: null },
    server: { registered: false, ownedByOpenPcb: false },
    updateAvailable: false,
  };
  if (!cliPath) return empty;
  const [version, plugins, marketplaces, server] = await Promise.all([
    runClaude(env, cliPath, ["--version"], 15_000),
    runClaude(env, cliPath, ["plugin", "list", "--json"], 30_000),
    runClaude(env, cliPath, ["plugin", "marketplace", "list", "--json"], 30_000),
    runClaude(env, cliPath, ["mcp", "get", MCP_SERVER_NAME], 30_000),
  ]);
  const plugin = (parseJson<PluginListEntry[]>(plugins.stdout) ?? []).find(
    (entry) => entry.id === PLUGIN_ID,
  );
  const marketplace = (parseJson<MarketplaceListEntry[]>(marketplaces.stdout) ?? []).find(
    (entry) => entry.name === MARKETPLACE_NAME,
  );
  const serverText = `${server.stdout}\n${server.stderr}`;
  return {
    cliPath,
    cliVersion: version.code === 0 ? version.stdout.trim().split(/\s+/)[0] ?? null : null,
    plugin: {
      installed: Boolean(plugin),
      version: plugin?.version ?? null,
      enabled: plugin?.enabled !== false && Boolean(plugin),
    },
    marketplace: { registered: Boolean(marketplace), path: marketplace?.path ?? null },
    server: {
      registered: server.code === 0,
      ownedByOpenPcb:
        server.code === 0 &&
        (Boolean(input.launcherPath && serverText.includes(input.launcherPath)) ||
          /openpcb-mcp/.test(serverText)),
    },
    updateAvailable: Boolean(plugin?.version && plugin.version !== input.appVersion),
  };
}

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Every CLI call made, for the Settings panel's "details". */
  log: Array<{ args: string[]; code: number; output: string }>;
}

async function step(
  env: CliEnv,
  cli: string,
  args: string[],
  log: ActionResult["log"],
): Promise<RunResult> {
  const result = await runClaude(env, cli, args);
  log.push({ args, code: result.code, output: `${result.stdout}${result.stderr}`.trim().slice(0, 2_000) });
  return result;
}

const NO_CLI =
  "Claude Code was not found. Install it (https://code.claude.com), then click Connect again — or copy the command below into a terminal.";

/**
 * Register OpenPCB with Claude Code.
 * - `plugin` (recommended): add/refresh the local marketplace, install or
 *   update the plugin (MCP server + skills). A plain `openpcb` server that
 *   points at our launcher is removed so tools are not listed twice.
 * - `server`: register only the MCP server, user scope.
 */
export async function connectClaudeCode(
  env: CliEnv,
  input: {
    mode: "plugin" | "server";
    marketplaceDir: string | null;
    serverConfig: { type: "stdio"; command: string; args: string[] };
    appVersion: string;
    launcherPath: string | null;
  },
): Promise<ActionResult> {
  const log: ActionResult["log"] = [];
  const cli = await locateClaudeCli(env);
  if (!cli) return { ok: false, message: NO_CLI, log };
  const status = await claudeCodeStatus(env, input);

  if (input.mode === "server") {
    if (status.server.registered) {
      if (!status.server.ownedByOpenPcb) {
        return {
          ok: false,
          message: `Claude Code already has an MCP server named "${MCP_SERVER_NAME}" that does not point at OpenPCB. Remove or rename it first (claude mcp remove ${MCP_SERVER_NAME}).`,
          log,
        };
      }
      await step(env, cli, ["mcp", "remove", MCP_SERVER_NAME, "--scope", "user"], log);
    }
    const added = await step(
      env,
      cli,
      ["mcp", "add-json", MCP_SERVER_NAME, JSON.stringify(input.serverConfig), "--scope", "user"],
      log,
    );
    return added.code === 0
      ? { ok: true, message: "Connected: Claude Code can use OpenPCB in every project. Restart open Claude Code sessions (or run /mcp) to pick it up.", log }
      : { ok: false, message: "Claude Code refused to add the server — see details.", log };
  }

  if (!input.marketplaceDir) {
    return { ok: false, message: "The OpenPCB plugin files are missing from this install; use “MCP server only”.", log };
  }
  const market = status.marketplace.registered
    ? await step(env, cli, ["plugin", "marketplace", "update", MARKETPLACE_NAME], log)
    : await step(env, cli, ["plugin", "marketplace", "add", input.marketplaceDir], log);
  if (market.code !== 0) {
    return { ok: false, message: "Claude Code could not read OpenPCB's plugin marketplace — see details.", log };
  }
  const plugin = status.plugin.installed
    ? await step(env, cli, ["plugin", "update", PLUGIN_ID, "--scope", "user"], log)
    : await step(env, cli, ["plugin", "install", PLUGIN_ID, "--scope", "user"], log);
  if (plugin.code !== 0) {
    return { ok: false, message: "Claude Code could not install the OpenPCB plugin — see details.", log };
  }
  if (status.server.registered && status.server.ownedByOpenPcb) {
    // The plugin brings its own server; drop the plain one so every tool is not listed twice.
    await step(env, cli, ["mcp", "remove", MCP_SERVER_NAME, "--scope", "user"], log);
  }
  return {
    ok: true,
    message: status.plugin.installed
      ? "Updated the OpenPCB plugin. Restart open Claude Code sessions to apply it."
      : "Connected: the OpenPCB plugin (tools + skills) is installed for every project. Restart open Claude Code sessions to pick it up.",
    log,
  };
}

export async function disconnectClaudeCode(
  env: CliEnv,
  input: { appVersion: string; launcherPath: string | null },
): Promise<ActionResult> {
  const log: ActionResult["log"] = [];
  const cli = await locateClaudeCli(env);
  if (!cli) return { ok: false, message: NO_CLI, log };
  const status = await claudeCodeStatus(env, input);
  if (status.plugin.installed) {
    await step(env, cli, ["plugin", "uninstall", PLUGIN_ID, "--scope", "user"], log);
  }
  if (status.marketplace.registered) {
    await step(env, cli, ["plugin", "marketplace", "remove", MARKETPLACE_NAME], log);
  }
  if (status.server.registered && status.server.ownedByOpenPcb) {
    await step(env, cli, ["mcp", "remove", MCP_SERVER_NAME, "--scope", "user"], log);
  }
  const failed = log.filter((entry) => entry.code !== 0);
  return failed.length === 0
    ? { ok: true, message: log.length === 0 ? "OpenPCB was not registered with Claude Code." : "Disconnected OpenPCB from Claude Code.", log }
    : { ok: false, message: "Some Claude Code registrations could not be removed — see details.", log };
}
