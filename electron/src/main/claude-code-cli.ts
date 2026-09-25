/**
 * One-click "Connect Claude Code": drive the user's own `claude` CLI to
 * register OpenPCB, report the connection state, update and disconnect.
 *
 * No `electron` import, and the process runner and file reads are injected,
 * so Bun tests exercise the whole flow against a fake CLI on any OS.
 *
 * Security posture:
 * - Runs only on an explicit click in Settings.
 * - The CLI is spawned with a fixed argv, never a shell string and never user
 *   text. An npm-installed `claude.cmd` on Windows is resolved to the script
 *   or exe it wraps and spawned directly; only an unrecognisable .cmd goes
 *   through cmd.exe, escaped for it (win-cmd.ts).
 * - A timeout on every run.
 * - Ownership is exact: it only replaces or removes a registration whose
 *   command and arguments match what this installation registered
 *   (claude-registration.ts) or would register now — never one that merely
 *   shares the name.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  MARKETPLACE_NAME,
  MCP_SERVER_NAME,
  PLUGIN_NAME,
} from "./claude-plugin-content.js";
import type { ClaudeRegistration } from "./claude-registration.js";
import type { StdioServerConfig } from "./mcp-launcher-content.js";
import { cmdCommandLine, cmdShimTarget, reparsesArguments } from "./win-cmd.js";

export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (
  file: string,
  args: string[],
  timeoutMs: number,
  options?: { verbatim?: boolean },
) => Promise<RunResult>;

export const defaultRunner: Runner = (file, args, timeoutMs, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        windowsVerbatimArguments: options?.verbatim === true,
      },
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
  /** File contents, or null — used to read an npm cmd-shim on Windows. */
  readFile?(path: string): string | null;
}

export function defaultCliEnv(): CliEnv {
  return {
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    exists: existsSync,
    run: defaultRunner,
    readFile: (file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
  };
}

function pathApi(env: CliEnv): typeof path.posix {
  return env.platform === "win32" ? path.win32 : path.posix;
}

function candidateNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
}

function pathDirs(env: CliEnv): string[] {
  return (env.env.PATH ?? env.env.Path ?? "")
    .split(env.platform === "win32" ? ";" : ":")
    .filter(Boolean);
}

/**
 * Find the `claude` binary. A GUI app on macOS does not inherit the user's
 * shell PATH, so after PATH, ask the login shell, then try the places the
 * native installer and npm put it.
 */
export async function locateClaudeCli(env: CliEnv): Promise<string | null> {
  const p = pathApi(env);
  const names = candidateNames(env.platform);
  for (const dir of pathDirs(env)) {
    for (const name of names) {
      const candidate = p.join(dir, name);
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
          p.join(home, ".local", "bin", "claude.exe"),
          p.join(env.env.APPDATA ?? p.join(home, "AppData", "Roaming"), "npm", "claude.cmd"),
        ]
      : [
          p.join(home, ".local", "bin", "claude"),
          p.join(home, ".claude", "local", "claude"),
          "/opt/homebrew/bin/claude",
          "/usr/local/bin/claude",
          p.join(home, ".npm-global", "bin", "claude"),
        ];
  return known.find((candidate) => env.exists(candidate)) ?? null;
}

interface Invocation {
  file: string;
  prefix: string[];
  /** Run `file` as cmd.exe with this pre-escaped /c payload. */
  cmdLine?: (args: string[]) => string;
}

/**
 * How to run the CLI. A Windows `.cmd` is an npm cmd-shim around
 * `node …\cli.js` (or an .exe): run that directly, so no argument ever
 * crosses cmd.exe's parser. Only a .cmd we cannot read falls back to cmd.exe,
 * with every argument escaped for it.
 */
export function claudeInvocation(env: CliEnv, cli: string): Invocation {
  if (env.platform !== "win32" || !/\.cmd$/i.test(cli)) return { file: cli, prefix: [] };
  const p = path.win32;
  const content = env.readFile?.(cli) ?? null;
  const target = content ? cmdShimTarget(content) : null;
  if (target) {
    const resolved = p.join(p.dirname(cli), target.path);
    if (env.exists(resolved)) {
      if (target.kind === "exe") return { file: resolved, prefix: [] };
      const bundledNode = p.join(p.dirname(cli), "node.exe");
      const node = env.exists(bundledNode)
        ? bundledNode
        : pathDirs(env)
            .map((dir) => p.join(dir, "node.exe"))
            .find((candidate) => env.exists(candidate));
      if (node) return { file: node, prefix: [resolved] };
    }
  }
  const doubleEscape = reparsesArguments(content);
  return {
    file: env.env.ComSpec || env.env.COMSPEC || "cmd.exe",
    prefix: [],
    cmdLine: (args) => cmdCommandLine(cli, args, doubleEscape),
  };
}

function runClaude(env: CliEnv, cli: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  const invocation = claudeInvocation(env, cli);
  if (invocation.cmdLine) {
    return env.run(invocation.file, ["/d", "/s", "/c", invocation.cmdLine(args)], timeoutMs, {
      verbatim: true,
    });
  }
  return env.run(invocation.file, [...invocation.prefix, ...args], timeoutMs);
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** What `claude mcp get <name>` prints (2.1.x), as far as ownership needs it. */
export interface McpGetInfo {
  scope: string | null;
  type: string | null;
  command: string | null;
  /** The `Args:` line — the CLI joins arguments with single spaces. */
  args: string;
  env: Record<string, string>;
}

export function parseMcpGet(text: string): McpGetInfo {
  const info: McpGetInfo = { scope: null, type: null, command: null, args: "", env: {} };
  let inEnv = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const field = /^\s{2}([A-Za-z]+):\s?(.*)$/.exec(line);
    if (field) {
      const [, key, value] = field;
      inEnv = key === "Environment";
      if (key === "Scope") info.scope = value!.trim();
      else if (key === "Type") info.type = value!.trim();
      else if (key === "Command") info.command = value!.trim();
      else if (key === "Args") info.args = value!.trim();
      continue;
    }
    const envLine = /^\s{4,}([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (inEnv && envLine) {
      info.env[envLine[1]!] = envLine[2]!;
      continue;
    }
    if (line.trim()) inEnv = false;
  }
  return info;
}

/** Does a registration printed by `mcp get` run exactly this server? */
export function registrationMatches(
  info: McpGetInfo,
  config: StdioServerConfig,
  platform: NodeJS.Platform,
): boolean {
  const norm =
    platform === "win32"
      ? (value: string) => value.replace(/\//g, "\\").toLowerCase()
      : (value: string) => value;
  if (info.command === null || norm(info.command) !== norm(config.command)) return false;
  if (norm(info.args) !== norm(config.args.join(" "))) return false;
  for (const [key, value] of Object.entries(config.env ?? {})) {
    if (info.env[key] !== value) return false;
  }
  return true;
}

function sameConfig(a: StdioServerConfig, b: StdioServerConfig, platform: NodeJS.Platform): boolean {
  const norm = platform === "win32" ? (v: string) => v.toLowerCase() : (v: string) => v;
  return (
    norm(a.command) === norm(b.command) &&
    a.args.length === b.args.length &&
    a.args.every((arg, i) => norm(arg) === norm(b.args[i]!)) &&
    JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {})
  );
}

export interface ClaudeCodeStatus {
  cliPath: string | null;
  cliVersion: string | null;
  /** The OpenPCB plugin is installed (any scope). */
  plugin: { installed: boolean; version: string | null; enabled: boolean };
  /** The OpenPCB local marketplace is registered (and points at ours). */
  marketplace: { registered: boolean; path: string | null; ours: boolean };
  /**
   * A plain `openpcb` MCP server: registered at all, and whether it is ours
   * (its command + args match our record or what we would register now) —
   * `outdated` when ours but not what we would register now (app moved).
   */
  server: { registered: boolean; ownedByOpenPcb: boolean; outdated: boolean };
  /** How this installation connected Claude Code, per its record. */
  registeredMode: "plugin" | "server" | null;
  /** Something OpenPCB registered needs refreshing (plugin version or moved app). */
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

export interface StatusInput {
  appVersion: string;
  /** The server entry this app would register now (null: launcher missing). */
  expectedServer: StdioServerConfig | null;
  /** This installation's record of what it registered. */
  registration: ClaudeRegistration | null;
  /** Our generated marketplace directory. */
  marketplaceDir?: string | null;
}

export async function claudeCodeStatus(env: CliEnv, input: StatusInput): Promise<ClaudeCodeStatus> {
  const cliPath = await locateClaudeCli(env);
  const empty: ClaudeCodeStatus = {
    cliPath,
    cliVersion: null,
    plugin: { installed: false, version: null, enabled: false },
    marketplace: { registered: false, path: null, ours: false },
    server: { registered: false, ownedByOpenPcb: false, outdated: false },
    registeredMode: input.registration?.mode ?? null,
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
  const info = server.code === 0 ? parseMcpGet(server.stdout) : null;
  const userScope = Boolean(info?.scope && /user/i.test(info.scope));
  const matchesRecord = Boolean(
    info && input.registration?.mode === "server" && registrationMatches(info, input.registration.config, env.platform),
  );
  const matchesExpected = Boolean(
    info && input.expectedServer && registrationMatches(info, input.expectedServer, env.platform),
  );
  const owned = userScope && (matchesRecord || matchesExpected);
  const serverOutdated = owned && !matchesExpected;
  const pluginOutdated = Boolean(
    plugin &&
      ((plugin.version && plugin.version !== input.appVersion) ||
        (input.registration?.mode === "plugin" &&
          input.expectedServer &&
          !sameConfig(input.registration.config, input.expectedServer, env.platform))),
  );
  const ours = Boolean(
    marketplace &&
      (!input.marketplaceDir || !marketplace.path || pathApi(env).resolve(marketplace.path) === pathApi(env).resolve(input.marketplaceDir)),
  );
  return {
    cliPath,
    cliVersion: version.code === 0 ? version.stdout.trim().split(/\s+/)[0] ?? null : null,
    plugin: {
      installed: Boolean(plugin),
      version: plugin?.version ?? null,
      enabled: plugin?.enabled !== false && Boolean(plugin),
    },
    marketplace: { registered: Boolean(marketplace), path: marketplace?.path ?? null, ours },
    server: { registered: server.code === 0, ownedByOpenPcb: owned, outdated: serverOutdated },
    registeredMode: input.registration?.mode ?? (plugin ? "plugin" : owned ? "server" : null),
    updateAvailable: pluginOutdated || serverOutdated,
  };
}

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Every CLI call made, for the Settings panel's "details". */
  log: Array<{ args: string[]; code: number; output: string }>;
  /** What to record as registered (connect), or that the record goes (disconnect). */
  registration?: Omit<ClaudeRegistration, "installationId" | "registeredAt">;
  clearRegistration?: boolean;
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

/** `claude mcp add --scope user openpcb [-e K=V…] -- <command> <args…>` */
export function mcpAddArgs(config: StdioServerConfig): string[] {
  const envFlags = Object.entries(config.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  return ["mcp", "add", "--scope", "user", MCP_SERVER_NAME, ...envFlags, "--", config.command, ...config.args];
}

export interface ConnectInput extends StatusInput {
  mode: "plugin" | "server";
  serverConfig: StdioServerConfig;
}

/**
 * Register OpenPCB with Claude Code.
 * - `plugin` (recommended): add/refresh the local marketplace, install or
 *   update the plugin (MCP server + skills). A plain `openpcb` server that is
 *   ours is removed so tools are not listed twice.
 * - `server`: register only the MCP server, user scope.
 */
export async function connectClaudeCode(env: CliEnv, input: ConnectInput): Promise<ActionResult> {
  const log: ActionResult["log"] = [];
  const cli = await locateClaudeCli(env);
  if (!cli) return { ok: false, message: NO_CLI, log };
  const status = await claudeCodeStatus(env, { ...input, expectedServer: input.serverConfig });

  if (input.mode === "server") {
    if (status.server.registered) {
      if (!status.server.ownedByOpenPcb) {
        return {
          ok: false,
          message: `Claude Code already has an MCP server named "${MCP_SERVER_NAME}" that OpenPCB did not register. Remove or rename it first (claude mcp remove ${MCP_SERVER_NAME}).`,
          log,
        };
      }
      await step(env, cli, ["mcp", "remove", MCP_SERVER_NAME, "--scope", "user"], log);
    }
    const added = await step(env, cli, mcpAddArgs(input.serverConfig), log);
    return added.code === 0
      ? {
          ok: true,
          message: status.server.registered
            ? "Updated the OpenPCB MCP server. In open Claude Code sessions run /mcp and reconnect openpcb (or start a new session)."
            : "Connected: Claude Code can use OpenPCB in every project. In open Claude Code sessions run /mcp and reconnect openpcb (or start a new session).",
          log,
          registration: {
            mode: "server",
            serverName: MCP_SERVER_NAME,
            scope: "user",
            config: input.serverConfig,
            appVersion: input.appVersion,
          },
        }
      : { ok: false, message: "Claude Code refused to add the server — see details.", log };
  }

  if (!input.marketplaceDir) {
    return { ok: false, message: "The OpenPCB plugin files are missing from this install; use “MCP server only”.", log };
  }
  if (status.marketplace.registered && !status.marketplace.ours) {
    return {
      ok: false,
      message: `Claude Code has a different plugin marketplace named "${MARKETPLACE_NAME}" (${status.marketplace.path ?? "unknown path"}). Remove it first: claude plugin marketplace remove ${MARKETPLACE_NAME}.`,
      log,
    };
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
    // The plugin brings its own server; drop our plain one so every tool is not listed twice.
    await step(env, cli, ["mcp", "remove", MCP_SERVER_NAME, "--scope", "user"], log);
  }
  return {
    ok: true,
    message: status.plugin.installed
      ? "Updated the OpenPCB plugin. In open Claude Code sessions run /reload-plugins (or start a new session)."
      : "Connected: the OpenPCB plugin (tools + skills) is installed for every project. In open Claude Code sessions run /reload-plugins (or start a new session).",
    log,
    registration: {
      mode: "plugin",
      serverName: MCP_SERVER_NAME,
      scope: "user",
      config: input.serverConfig,
      pluginId: PLUGIN_ID,
      marketplaceDir: input.marketplaceDir,
      appVersion: input.appVersion,
    },
  };
}

export async function disconnectClaudeCode(env: CliEnv, input: StatusInput): Promise<ActionResult> {
  const log: ActionResult["log"] = [];
  const cli = await locateClaudeCli(env);
  if (!cli) return { ok: false, message: NO_CLI, log };
  const status = await claudeCodeStatus(env, input);
  if (status.plugin.installed) {
    await step(env, cli, ["plugin", "uninstall", PLUGIN_ID, "--scope", "user"], log);
  }
  if (status.marketplace.registered && status.marketplace.ours) {
    await step(env, cli, ["plugin", "marketplace", "remove", MARKETPLACE_NAME], log);
  }
  if (status.server.registered && status.server.ownedByOpenPcb) {
    await step(env, cli, ["mcp", "remove", MCP_SERVER_NAME, "--scope", "user"], log);
  }
  const failed = log.filter((entry) => entry.code !== 0);
  return failed.length === 0
    ? {
        ok: true,
        message: log.length === 0 ? "OpenPCB was not registered with Claude Code." : "Disconnected OpenPCB from Claude Code.",
        log,
        clearRegistration: true,
      }
    : { ok: false, message: "Some Claude Code registrations could not be removed — see details.", log };
}
