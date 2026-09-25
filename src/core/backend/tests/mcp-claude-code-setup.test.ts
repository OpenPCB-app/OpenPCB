/**
 * Claude Code setup (electron/src/main/*): the stable launcher, the setup
 * snippets, the generated local plugin (with a drift check against the live
 * MCP tool list) and the one-click CLI flow. Pure modules, tested under Bun
 * because the electron workspace has no test runner.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  mcpSnippets,
  posixLauncher,
  resolveLauncherExec,
  stdioServerConfig,
  windowsLauncher,
} from "../../../../electron/src/main/mcp-launcher-content";
import {
  buildPluginMarketplace,
  toolNamesInSkill,
} from "../../../../electron/src/main/claude-plugin-content";
import {
  claudeCodeStatus,
  claudeInvocation,
  connectClaudeCode,
  disconnectClaudeCode,
  parseMcpGet,
  type CliEnv,
  type RunResult,
  type StatusInput,
} from "../../../../electron/src/main/claude-code-cli";
import {
  clearRegistration,
  readRegistration,
  writeRegistration,
} from "../../../../electron/src/main/claude-registration";
import {
  cmdShimTarget,
  escapeCmdArgument,
  escapeCmdCommand,
} from "../../../../electron/src/main/win-cmd";
import type { StdioServerConfig } from "../../../../electron/src/main/mcp-launcher-content";
import { bootMcpHarness, MCP_TOKEN, type McpHarness } from "./helpers/mcp-harness";

const REPO = path.resolve(import.meta.dir, "../../../..");
const TEMPLATE = path.join(REPO, "electron/resources/claude-plugin/openpcb");

function readTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files[path.relative(root, full).split(path.sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

describe("launcher exec resolution", () => {
  test("AppImage and portable builds exec the file the user launched, not the temp mount", () => {
    expect(
      resolveLauncherExec({
        platform: "linux",
        execPath: "/tmp/.mount_OpenPCBx/openpcb",
        env: { APPIMAGE: "/home/u/Apps/OpenPCB.AppImage" },
      }).exec,
    ).toBe("/home/u/Apps/OpenPCB.AppImage");
    expect(
      resolveLauncherExec({
        platform: "win32",
        execPath: "C:\\Users\\u\\AppData\\Local\\Temp\\x\\OpenPCB.exe",
        env: { PORTABLE_EXECUTABLE_FILE: "D:\\Tools\\OpenPCB-Portable.exe" },
      }).exec,
    ).toBe("D:\\Tools\\OpenPCB-Portable.exe");
  });

  test("a translocated macOS app keeps the last good exec and warns", () => {
    const r = resolveLauncherExec({
      platform: "darwin",
      execPath: "/private/var/folders/x/AppTranslocation/ABC/d/OpenPCB.app/Contents/MacOS/OpenPCB",
      env: {},
      previousExec: "/Applications/OpenPCB.app/Contents/MacOS/OpenPCB",
    });
    expect(r.kind).toBe("translocated");
    expect(r.exec).toBe("/Applications/OpenPCB.app/Contents/MacOS/OpenPCB");
    expect(r.warning).toContain("Applications");
  });

  test("an installed app execs itself", () => {
    const r = resolveLauncherExec({
      platform: "darwin",
      execPath: "/Applications/OpenPCB.app/Contents/MacOS/OpenPCB",
      env: {},
    });
    expect(r).toEqual({
      exec: "/Applications/OpenPCB.app/Contents/MacOS/OpenPCB",
      kind: "installed",
      warning: null,
    });
  });
});

describe("setup snippets", () => {
  const WIN_TARGET = {
    launcherPath: "C:\\Users\\Jo & Ann\\AppData\\Roaming\\OpenPCB\\mcp\\openpcb-mcp.cmd",
    exec: "C:\\Users\\Jo & Ann\\AppData\\Local\\Programs\\OpenPCB\\OpenPCB.exe",
    shimPath: "C:\\Users\\Jo & Ann\\AppData\\Roaming\\OpenPCB\\mcp\\shim.js",
  };

  test("Windows registers the app binary with ELECTRON_RUN_AS_NODE — no cmd.exe in the transport", () => {
    expect(stdioServerConfig("win32", WIN_TARGET)).toEqual({
      type: "stdio",
      command: WIN_TARGET.exec,
      args: [WIN_TARGET.shimPath],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    const snippets = mcpSnippets({ platform: "win32", target: WIN_TARGET, marketplaceDir: null });
    const server = snippets.find((s) => s.id === "claude-code-server")!;
    expect(server.hint).toContain("PowerShell");
    expect(server.value).toBe(
      `claude mcp add --scope user openpcb -e ELECTRON_RUN_AS_NODE=1 -- '${WIN_TARGET.exec}' '${WIN_TARGET.shimPath}'`,
    );
    const desktop = JSON.parse(snippets.find((s) => s.id === "claude-desktop")!.value);
    expect(desktop.mcpServers.openpcb).toEqual({
      command: WIN_TARGET.exec,
      args: [WIN_TARGET.shimPath],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  test("the fallback .cmd launcher survives %, & and non-ASCII paths", () => {
    const launcher = windowsLauncher({ exec: "C:\\50% off\\Jo & Ann\\OpenPCB.exe", shimPath: "C:\\Zoë\\shim.js" });
    expect(launcher).toContain('set "EXEC_PATH=C:\\50%% off\\Jo & Ann\\OpenPCB.exe"');
    expect(launcher).toContain("chcp 65001");
    expect(launcher).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    expect(launcher).toContain('no longer at "%EXEC_PATH%"');
    expect(launcher).toContain("\r\n");
  });

  test("macOS / Linux register the launcher for every project and quote paths with spaces", () => {
    const snippets = mcpSnippets({
      platform: "darwin",
      target: {
        launcherPath: "/Users/u/Library/Application Support/OpenPCB/mcp/openpcb-mcp",
        exec: "/Applications/OpenPCB.app/Contents/MacOS/OpenPCB",
        shimPath: "/Users/u/Library/Application Support/OpenPCB/mcp/shim.js",
      },
      marketplaceDir: "/Users/u/Library/Application Support/OpenPCB/claude-code/marketplace",
    });
    const server = snippets.find((s) => s.id === "claude-code-server")!.value;
    expect(server).toBe(
      "claude mcp add --scope user openpcb -- '/Users/u/Library/Application Support/OpenPCB/mcp/openpcb-mcp'",
    );
    const plugin = snippets.find((s) => s.id === "claude-code-plugin")!.value;
    expect(plugin).toContain("claude plugin marketplace add '/Users/u/Library/Application Support/OpenPCB/claude-code/marketplace'");
    expect(plugin).toContain("claude plugin install openpcb@openpcb-desktop --scope user");
    const desktop = JSON.parse(snippets.find((s) => s.id === "claude-desktop")!.value);
    expect(desktop.mcpServers.openpcb.command).toContain("openpcb-mcp");
  });
});

describe("Windows command lines", () => {
  // cross-spawn's own implementation is the reference for the port.
  const reference = require("cross-spawn/lib/util/escape") as {
    argument(arg: string, doubleEscape?: boolean): string;
    command(cmd: string): string;
  };
  const vectors = [
    "plain",
    "with space",
    "C:\\Users\\Jo & Ann\\x",
    "50% off",
    "caret^and(paren)",
    'quote"inside',
    "trailing\\",
    'back\\"slash-quote',
    "Zoë 😀 <>|;,*?!`[]",
    "{\"type\":\"stdio\",\"command\":\"C:\\\\x y\\\\a.exe\"}",
  ];

  test("argument escaping matches cross-spawn for awkward inputs", () => {
    for (const vector of vectors) {
      expect(escapeCmdArgument(vector)).toBe(reference.argument(vector));
      expect(escapeCmdArgument(vector, true)).toBe(reference.argument(vector, true));
      expect(escapeCmdCommand(vector)).toBe(reference.command(vector));
    }
  });

  test("an npm cmd-shim is resolved to node + script, so cmd.exe is never involved", () => {
    const shim = [
      "@ECHO off",
      "GOTO start",
      ":find_dp0",
      "SET dp0=%~dp0",
      "EXIT /b",
      ":start",
      "SETLOCAL",
      "CALL :find_dp0",
      "",
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ") ELSE (",
      '  SET "_prog=node"',
      "  SET PATHEXT=%PATHEXT:;.JS;=;%",
      ")",
      "",
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
    ].join("\r\n");
    expect(cmdShimTarget(shim)).toEqual({
      path: "node_modules\\@anthropic-ai\\claude-code\\cli.js",
      kind: "script",
    });
    const cli = "C:\\Users\\Jo & Ann\\AppData\\Roaming\\npm\\claude.cmd";
    const script = "C:\\Users\\Jo & Ann\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js";
    const node = "C:\\Program Files\\nodejs\\node.exe";
    const env: CliEnv = {
      platform: "win32",
      env: { PATH: "C:\\Program Files\\nodejs;C:\\Windows" },
      homedir: "C:\\Users\\Jo & Ann",
      exists: (p) => p === cli || p === script || p === node,
      readFile: (p) => (p === cli ? shim : null),
      run: async () => ({ code: 0, stdout: "", stderr: "" }),
    };
    expect(claudeInvocation(env, cli)).toEqual({ file: node, prefix: [script] });
    // An unreadable .cmd falls back to cmd.exe with every argument escaped.
    const fallback = claudeInvocation({ ...env, readFile: () => null }, cli);
    expect(fallback.file).toBe("cmd.exe");
    expect(fallback.cmdLine!(["mcp", "get", "a & b"])).toBe(
      `"${reference.command(cli)} ${reference.argument("mcp", true)} ${reference.argument("get", true)} ${reference.argument("a & b", true)}"`,
    );
  });
});

describe("registration record", () => {
  test("round-trips and keeps the installation id across reconnects", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openpcb-reg-"));
    try {
      expect(readRegistration(dir)).toBeNull();
      const config: StdioServerConfig = { type: "stdio", command: "/x/openpcb-mcp", args: [] };
      const first = writeRegistration(dir, {
        mode: "server",
        serverName: "openpcb",
        scope: "user",
        config,
        appVersion: "1.0.0",
      });
      const second = writeRegistration(dir, {
        mode: "plugin",
        serverName: "openpcb",
        scope: "user",
        config,
        appVersion: "1.0.1",
      });
      expect(second.installationId).toBe(first.installationId);
      expect(readRegistration(dir)?.mode).toBe("plugin");
      clearRegistration(dir);
      expect(readRegistration(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("generated plugin", () => {
  let h: McpHarness;
  beforeAll(async () => {
    h = await bootMcpHarness("mcp-claude-code-setup");
  });

  test("marketplace, manifest and .mcp.json point at the launcher, version = app", () => {
    const files = buildPluginMarketplace({
      appVersion: "9.9.9",
      templateFiles: readTree(TEMPLATE),
      server: { command: "C:\\A\\OpenPCB.exe", args: ["C:\\B\\shim.js"], env: { ELECTRON_RUN_AS_NODE: "1" } },
    });
    const market = JSON.parse(files[".claude-plugin/marketplace.json"]!);
    expect(market.name).toBe("openpcb-desktop");
    expect(market.plugins[0]).toMatchObject({ name: "openpcb", source: "./openpcb", version: "9.9.9" });
    expect(JSON.parse(files["openpcb/.claude-plugin/plugin.json"]!).version).toBe("9.9.9");
    expect(JSON.parse(files["openpcb/.mcp.json"]!)).toEqual({
      mcpServers: {
        openpcb: { command: "C:\\A\\OpenPCB.exe", args: ["C:\\B\\shim.js"], env: { ELECTRON_RUN_AS_NODE: "1" } },
      },
    });
    expect(Object.keys(files).filter((f) => f.endsWith("SKILL.md")).length).toBeGreaterThanOrEqual(6);
    expect(files["openpcb/README.md"]).toBeUndefined();
  });

  test("every tool a skill names exists on the MCP server (writes on)", async () => {
    h.enable({ writes: true });
    const listed = new Set((await h.listTools()).map((t) => t.name as string));
    const template = readTree(TEMPLATE);
    for (const [file, contents] of Object.entries(template)) {
      if (!file.endsWith("SKILL.md")) continue;
      for (const name of toolNamesInSkill(contents)) {
        if (!listed.has(name)) throw new Error(`${file} names unknown tool ${name}`);
      }
    }
  });

  test("the generated POSIX launcher starts the bridge and serves a real MCP client", async () => {
    if (process.platform === "win32") return;
    const { Client } = await import("@modelcontextprotocol/client");
    const { StdioClientTransport } = await import("@modelcontextprotocol/client/stdio");
    h.enable();
    const dir = mkdtempSync(path.join(os.tmpdir(), "openpcb-launcher-"));
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => h.server.fetch(req) });
    try {
      const portfile = path.join(dir, "mcp.json");
      writeFileSync(
        portfile,
        JSON.stringify({
          version: 1,
          url: `http://127.0.0.1:${server.port}/api/modules/assistant/mcp`,
          port: server.port,
          token: MCP_TOKEN,
          pid: process.pid,
          appVersion: "test",
        }),
      );
      // Bun stands in for the Electron binary: it ignores ELECTRON_RUN_AS_NODE
      // and runs the bridge source directly.
      const launcher = path.join(dir, "openpcb-mcp");
      writeFileSync(
        launcher,
        posixLauncher({
          exec: process.execPath,
          shimPath: path.join(REPO, "electron/src/mcp-shim/index.ts"),
        }),
      );
      chmodSync(launcher, 0o755);
      const client = new Client({ name: "launcher-e2e", version: "1.0.0" });
      await client.connect(
        new StdioClientTransport({
          command: launcher,
          args: [],
          env: { ...(process.env as Record<string, string>), OPENPCB_MCP_PORTFILE: portfile },
          stderr: "ignore",
        }),
      );
      try {
        const tools = await client.listTools();
        expect(tools.tools.map((t) => t.name)).toContain("designer_get_pcb_layout");
      } finally {
        await client.close();
      }
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

/** A scripted `claude` CLI. */
function fakeCli(script: (args: string[]) => RunResult) {
  const calls: string[][] = [];
  const env: CliEnv = {
    platform: "linux",
    env: { PATH: "/fake/bin", SHELL: "/bin/sh" },
    homedir: "/home/u",
    exists: (p) => p === "/fake/bin/claude",
    run: async (file, args) => {
      if (file !== "/fake/bin/claude") return { code: 1, stdout: "", stderr: "" };
      calls.push(args);
      return script(args);
    },
  };
  return { env, calls };
}

const OK = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const MISSING: RunResult = { code: 1, stdout: "", stderr: 'No MCP server named "openpcb". Configured servers: ' };
const LAUNCHER = "/home/u/.config/OpenPCB/mcp/openpcb-mcp";
const SERVER: StdioServerConfig = { type: "stdio", command: LAUNCHER, args: [] };
const MARKET = "/home/u/.config/OpenPCB/claude-code/marketplace";

/** `claude mcp get` as Claude Code 2.1.282 prints it (captured from the real CLI). */
function mcpGet(command: string, args = "", env: Record<string, string> = {}, scope = "User config (available in all your projects)"): RunResult {
  const envLines = Object.entries(env).map(([k, v]) => `    ${k}=${v}`);
  return OK(
    [
      "openpcb:",
      `  Scope: ${scope}`,
      "  Status: ✓ Connected",
      "  Type: stdio",
      `  Command: ${command}`,
      `  Args: ${args}`,
      "  Environment:",
      ...envLines,
      "",
      "To remove this server, run: claude mcp remove openpcb -s user",
    ].join("\n"),
  );
}

function statusInput(over: Partial<StatusInput> = {}): StatusInput {
  return { appVersion: "1.0.0", expectedServer: SERVER, registration: null, marketplaceDir: MARKET, ...over };
}

describe("mcp get parsing", () => {
  test("reads scope, command, args and environment from the real output format", () => {
    const info = parseMcpGet(
      mcpGet("C:\\Program Files\\OpenPCB\\OpenPCB.exe", "C:\\Users\\Jo & Ann\\shim.js", { ELECTRON_RUN_AS_NODE: "1" }).stdout,
    );
    expect(info).toEqual({
      scope: "User config (available in all your projects)",
      type: "stdio",
      command: "C:\\Program Files\\OpenPCB\\OpenPCB.exe",
      args: "C:\\Users\\Jo & Ann\\shim.js",
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });
});

describe("one-click connect", () => {
  test("plugin mode adds the marketplace, installs, and drops our duplicate server", async () => {
    let installed = false;
    const { env, calls } = fakeCli((args) => {
      const cmd = args.join(" ");
      if (cmd === "--version") return OK("2.1.282 (Claude Code)");
      if (cmd === "plugin list --json") return OK(installed ? '[{"id":"openpcb@openpcb-desktop","version":"1.0.0"}]' : "[]");
      if (cmd === "plugin marketplace list --json") return OK("[]");
      if (cmd === "mcp get openpcb") return mcpGet(LAUNCHER);
      if (cmd.startsWith("plugin install")) installed = true;
      return OK();
    });
    const result = await connectClaudeCode(env, { ...statusInput(), mode: "plugin", serverConfig: SERVER });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("/reload-plugins");
    expect(result.registration).toMatchObject({ mode: "plugin", config: SERVER, marketplaceDir: MARKET });
    const joined = calls.map((c) => c.join(" "));
    expect(joined).toContain(`plugin marketplace add ${MARKET}`);
    expect(joined).toContain("plugin install openpcb@openpcb-desktop --scope user");
    expect(joined).toContain("mcp remove openpcb --scope user");
    const status = await claudeCodeStatus(env, statusInput({ registration: { installationId: "i", registeredAt: "t", ...result.registration! } }));
    expect(status.plugin.installed).toBe(true);
    expect(status.updateAvailable).toBe(false);
  });

  test("an installed older plugin is updated in place", async () => {
    const { env, calls } = fakeCli((args) => {
      const cmd = args.join(" ");
      if (cmd === "plugin list --json") return OK('[{"id":"openpcb@openpcb-desktop","version":"0.9.0"}]');
      if (cmd === "plugin marketplace list --json") return OK(`[{"name":"openpcb-desktop","path":"${MARKET}"}]`);
      if (cmd === "mcp get openpcb") return MISSING;
      return OK();
    });
    const status = await claudeCodeStatus(env, statusInput());
    expect(status.updateAvailable).toBe(true);
    await connectClaudeCode(env, { ...statusInput(), mode: "plugin", serverConfig: SERVER });
    const joined = calls.map((c) => c.join(" "));
    expect(joined).toContain("plugin marketplace update openpcb-desktop");
    expect(joined).toContain("plugin update openpcb@openpcb-desktop --scope user");
  });

  test("a same-named marketplace that is not ours is left alone", async () => {
    const { env, calls } = fakeCli((args) => {
      const cmd = args.join(" ");
      if (cmd === "plugin list --json") return OK("[]");
      if (cmd === "plugin marketplace list --json") return OK('[{"name":"openpcb-desktop","path":"/somewhere/else"}]');
      if (cmd === "mcp get openpcb") return MISSING;
      return OK();
    });
    const result = await connectClaudeCode(env, { ...statusInput(), mode: "plugin", serverConfig: SERVER });
    expect(result.ok).toBe(false);
    expect(calls.map((c) => c.join(" ")).some((c) => c.startsWith("plugin marketplace update"))).toBe(false);
  });

  test("ownership is exact: a look-alike path or a project-scope server is not ours", async () => {
    for (const other of [
      mcpGet("/usr/local/bin/openpcb-mcp"),
      mcpGet(`${LAUNCHER}-fork`),
      mcpGet(LAUNCHER, "", {}, "Project config (shared via .mcp.json)"),
    ]) {
      const { env, calls } = fakeCli((args) => {
        const cmd = args.join(" ");
        if (cmd === "plugin list --json" || cmd === "plugin marketplace list --json") return OK("[]");
        if (cmd === "mcp get openpcb") return other;
        return OK();
      });
      const result = await connectClaudeCode(env, { ...statusInput(), mode: "server", serverConfig: SERVER });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("did not register");
      const disconnect = await disconnectClaudeCode(env, statusInput());
      expect(disconnect.ok).toBe(true);
      expect(calls.map((c) => c.join(" ")).some((c) => c.startsWith("mcp remove"))).toBe(false);
    }
  });

  test("an app that moved is detected from the record and offered as an update", async () => {
    const oldExec = "D:\\Old\\OpenPCB.exe";
    const shim = "C:\\Users\\u\\AppData\\Roaming\\OpenPCB\\mcp\\shim.js";
    const recorded: StdioServerConfig = { type: "stdio", command: oldExec, args: [shim], env: { ELECTRON_RUN_AS_NODE: "1" } };
    const expected: StdioServerConfig = { ...recorded, command: "C:\\Programs\\OpenPCB\\OpenPCB.exe" };
    const { env } = fakeCli((args) => {
      const cmd = args.join(" ");
      if (cmd === "plugin list --json" || cmd === "plugin marketplace list --json") return OK("[]");
      if (cmd === "mcp get openpcb") return mcpGet(oldExec, shim, { ELECTRON_RUN_AS_NODE: "1" });
      return OK();
    });
    const status = await claudeCodeStatus(env, {
      appVersion: "1.0.0",
      expectedServer: expected,
      registration: { installationId: "i", registeredAt: "t", mode: "server", serverName: "openpcb", scope: "user", config: recorded, appVersion: "0.9.0" },
    });
    expect(status.server.ownedByOpenPcb).toBe(true);
    expect(status.server.outdated).toBe(true);
    expect(status.updateAvailable).toBe(true);
    expect(status.registeredMode).toBe("server");
  });

  test("server mode registers at user scope with mcp add; disconnect removes only ours", async () => {
    let registered = false;
    const { env, calls } = fakeCli((args) => {
      const cmd = args.join(" ");
      if (cmd === "plugin list --json" || cmd === "plugin marketplace list --json") return OK("[]");
      if (cmd === "mcp get openpcb") return registered ? mcpGet(LAUNCHER) : MISSING;
      if (args[0] === "mcp" && args[1] === "add") registered = true;
      if (args[0] === "mcp" && args[1] === "remove") registered = false;
      return OK();
    });
    const connect = await connectClaudeCode(env, { ...statusInput(), mode: "server", serverConfig: SERVER });
    expect(connect.ok).toBe(true);
    const add = calls.find((c) => c[0] === "mcp" && c[1] === "add")!;
    expect(add).toEqual(["mcp", "add", "--scope", "user", "openpcb", "--", LAUNCHER]);
    const disconnect = await disconnectClaudeCode(env, statusInput());
    expect(disconnect.ok).toBe(true);
    expect(disconnect.clearRegistration).toBe(true);
    expect(registered).toBe(false);
  });

  test("no CLI → an actionable message, nothing run", async () => {
    const env: CliEnv = {
      platform: "linux",
      env: { PATH: "/nowhere", SHELL: "/bin/sh" },
      homedir: "/home/u",
      exists: () => false,
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
    };
    const result = await connectClaudeCode(env, { ...statusInput(), mode: "plugin", serverConfig: SERVER });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });
});
