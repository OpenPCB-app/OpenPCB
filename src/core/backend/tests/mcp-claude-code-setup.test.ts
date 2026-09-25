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
  connectClaudeCode,
  disconnectClaudeCode,
  type CliEnv,
  type RunResult,
} from "../../../../electron/src/main/claude-code-cli";
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
  test("Windows runs the .cmd launcher through cmd /c", () => {
    expect(stdioServerConfig("win32", "C:\\Users\\u\\AppData\\Roaming\\OpenPCB\\mcp\\openpcb-mcp.cmd")).toEqual({
      type: "stdio",
      command: "cmd",
      args: ["/c", "C:\\Users\\u\\AppData\\Roaming\\OpenPCB\\mcp\\openpcb-mcp.cmd"],
    });
    const launcher = windowsLauncher({ exec: "C:\\A\\OpenPCB.exe", shimPath: "C:\\B\\shim.js" });
    expect(launcher).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    expect(launcher).toContain("\r\n");
  });

  test("commands register for every project and quote paths with spaces", () => {
    const snippets = mcpSnippets({
      platform: "darwin",
      launcherPath: "/Users/u/Library/Application Support/OpenPCB/mcp/openpcb-mcp",
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

describe("generated plugin", () => {
  let h: McpHarness;
  beforeAll(async () => {
    h = await bootMcpHarness("mcp-claude-code-setup");
  });

  test("marketplace, manifest and .mcp.json point at the launcher, version = app", () => {
    const files = buildPluginMarketplace({
      appVersion: "9.9.9",
      templateFiles: readTree(TEMPLATE),
      server: { command: "/x/openpcb-mcp", args: [] },
    });
    const market = JSON.parse(files[".claude-plugin/marketplace.json"]!);
    expect(market.name).toBe("openpcb-desktop");
    expect(market.plugins[0]).toMatchObject({ name: "openpcb", source: "./openpcb", version: "9.9.9" });
    expect(JSON.parse(files["openpcb/.claude-plugin/plugin.json"]!).version).toBe("9.9.9");
    expect(JSON.parse(files["openpcb/.mcp.json"]!)).toEqual({
      mcpServers: { openpcb: { command: "/x/openpcb-mcp", args: [] } },
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
const LAUNCHER = "/home/u/.config/OpenPCB/mcp/openpcb-mcp";

describe("one-click connect", () => {
  test("plugin mode adds the marketplace, installs, and drops our duplicate server", async () => {
    let installed = false;
    const { env, calls } = fakeCli((args) => {
      const cmd = args.join(" ");
      if (cmd === "--version") return OK("2.1.282 (Claude Code)");
      if (cmd === "plugin list --json") return OK(installed ? '[{"id":"openpcb@openpcb-desktop","version":"1.0.0"}]' : "[]");
      if (cmd === "plugin marketplace list --json") return OK("[]");
      if (cmd === "mcp get openpcb") return OK(`openpcb:\n  Command: ${LAUNCHER}`);
      if (cmd.startsWith("plugin install")) installed = true;
      return OK();
    });
    const result = await connectClaudeCode(env, {
      mode: "plugin",
      marketplaceDir: "/home/u/.config/OpenPCB/claude-code/marketplace",
      serverConfig: { type: "stdio", command: LAUNCHER, args: [] },
      appVersion: "1.0.0",
      launcherPath: LAUNCHER,
    });
    expect(result.ok).toBe(true);
    const joined = calls.map((c) => c.join(" "));
    expect(joined).toContain("plugin marketplace add /home/u/.config/OpenPCB/claude-code/marketplace");
    expect(joined).toContain("plugin install openpcb@openpcb-desktop --scope user");
    expect(joined).toContain("mcp remove openpcb --scope user");
    const status = await claudeCodeStatus(env, { appVersion: "1.0.0", launcherPath: LAUNCHER });
    expect(status.plugin.installed).toBe(true);
    expect(status.updateAvailable).toBe(false);
  });

  test("an installed older plugin is updated in place", async () => {
    const { env, calls } = fakeCli((args) => {
      const cmd = args.join(" ");
      if (cmd === "plugin list --json") return OK('[{"id":"openpcb@openpcb-desktop","version":"0.9.0"}]');
      if (cmd === "plugin marketplace list --json") return OK('[{"name":"openpcb-desktop","path":"/m"}]');
      if (cmd === "mcp get openpcb") return { code: 1, stdout: "", stderr: "not found" };
      return OK();
    });
    const status = await claudeCodeStatus(env, { appVersion: "1.0.0", launcherPath: LAUNCHER });
    expect(status.updateAvailable).toBe(true);
    await connectClaudeCode(env, {
      mode: "plugin",
      marketplaceDir: "/m",
      serverConfig: { type: "stdio", command: LAUNCHER, args: [] },
      appVersion: "1.0.0",
      launcherPath: LAUNCHER,
    });
    const joined = calls.map((c) => c.join(" "));
    expect(joined).toContain("plugin marketplace update openpcb-desktop");
    expect(joined).toContain("plugin update openpcb@openpcb-desktop --scope user");
  });

  test("server mode refuses to replace someone else's 'openpcb' server", async () => {
    const { env } = fakeCli((args) => {
      const cmd = args.join(" ");
      if (cmd === "plugin list --json" || cmd === "plugin marketplace list --json") return OK("[]");
      if (cmd === "mcp get openpcb") return OK("openpcb:\n  Command: /usr/bin/something-else");
      return OK();
    });
    const result = await connectClaudeCode(env, {
      mode: "server",
      marketplaceDir: null,
      serverConfig: { type: "stdio", command: LAUNCHER, args: [] },
      appVersion: "1.0.0",
      launcherPath: LAUNCHER,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("does not point at OpenPCB");
  });

  test("server mode registers at user scope; disconnect removes only ours", async () => {
    let registered = false;
    const { env, calls } = fakeCli((args) => {
      const cmd = args.join(" ");
      if (cmd === "plugin list --json" || cmd === "plugin marketplace list --json") return OK("[]");
      if (cmd === "mcp get openpcb") return registered ? OK(`Command: ${LAUNCHER}`) : { code: 1, stdout: "", stderr: "" };
      if (args[0] === "mcp" && args[1] === "add-json") registered = true;
      if (args[0] === "mcp" && args[1] === "remove") registered = false;
      return OK();
    });
    const connect = await connectClaudeCode(env, {
      mode: "server",
      marketplaceDir: null,
      serverConfig: { type: "stdio", command: LAUNCHER, args: [] },
      appVersion: "1.0.0",
      launcherPath: LAUNCHER,
    });
    expect(connect.ok).toBe(true);
    const add = calls.find((c) => c[1] === "add-json")!;
    expect(add).toEqual([
      "mcp",
      "add-json",
      "openpcb",
      JSON.stringify({ type: "stdio", command: LAUNCHER, args: [] }),
      "--scope",
      "user",
    ]);
    const disconnect = await disconnectClaudeCode(env, { appVersion: "1.0.0", launcherPath: LAUNCHER });
    expect(disconnect.ok).toBe(true);
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
    const result = await connectClaudeCode(env, {
      mode: "plugin",
      marketplaceDir: "/m",
      serverConfig: { type: "stdio", command: LAUNCHER, args: [] },
      appVersion: "1.0.0",
      launcherPath: LAUNCHER,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });
});

