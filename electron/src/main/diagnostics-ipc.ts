import os from "node:os";
import { existsSync } from "node:fs";
import { app, ipcMain, shell } from "electron";
import { getCrashDumpsDir } from "./crash.js";
import {
  getBackendPayload,
  getClaudeMarketplaceDir,
  getMcpPortfilePath,
} from "./backend-server.js";
import { ensureMcpToken } from "./mcp-portfile.js";
import { getInstalledMcpLauncher } from "./mcp-launcher.js";
import {
  mcpSnippets,
  stdioServerConfig,
  type LauncherPlatform,
} from "./mcp-launcher-content.js";
import {
  claudeCodeStatus,
  connectClaudeCode,
  defaultCliEnv,
  disconnectClaudeCode,
} from "./claude-code-cli.js";

function launcherPlatform(): LauncherPlatform {
  return process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "linux";
}

let registered = false;

export function registerDiagnosticsIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("diagnostics:open-logs", async () => {
    const dir = app.getPath("logs");
    const err = await shell.openPath(dir);
    return { dir, error: err || null };
  });

  ipcMain.handle("diagnostics:open-crash-dumps", async () => {
    const dir = getCrashDumpsDir();
    const err = await shell.openPath(dir);
    return { dir, error: err || null };
  });

  ipcMain.handle("diagnostics:open-user-data", async () => {
    const dir = app.getPath("userData");
    const err = await shell.openPath(dir);
    return { dir, error: err || null };
  });

  ipcMain.handle("diagnostics:paths", () => ({
    logs: app.getPath("logs"),
    crashDumps: getCrashDumpsDir(),
    userData: app.getPath("userData"),
    appVersion: app.getVersion(),
  }));

  // Everything the Settings panel needs to connect an MCP client. The paths
  // point at the stable launcher in the user-data dir (rewritten every launch),
  // never into the app bundle, which moves (AppImage, portable, translocation).
  ipcMain.handle("mcp:config", () => {
    const launcher = getInstalledMcpLauncher();
    const marketplaceDir = getClaudeMarketplaceDir();
    const hasMarketplace = existsSync(marketplaceDir);
    return {
      launcherPath: launcher?.launcherPath ?? null,
      launcherWarning: launcher?.exec.warning ?? null,
      marketplaceDir: hasMarketplace ? marketplaceDir : null,
      snippets: launcher
        ? mcpSnippets({
            platform: launcherPlatform(),
            launcherPath: launcher.launcherPath,
            marketplaceDir: hasMarketplace ? marketplaceDir : null,
          })
        : [],
      portfilePath: getMcpPortfilePath(),
      url: getBackendPayload()
        ? `${getBackendPayload()?.url}/api/modules/assistant/mcp`
        : null,
      token: ensureMcpToken(),
    };
  });

  // One-click Claude Code setup (claude-code-cli.ts). Runs the user's own
  // `claude` CLI with fixed arguments, only on an explicit click.
  const cliInput = () => ({
    appVersion: app.getVersion(),
    launcherPath: getInstalledMcpLauncher()?.launcherPath ?? null,
  });
  ipcMain.handle("mcp:claude-code:status", () =>
    claudeCodeStatus(defaultCliEnv(), cliInput()),
  );
  ipcMain.handle(
    "mcp:claude-code:connect",
    (_event, mode: unknown) => {
      const launcher = getInstalledMcpLauncher();
      if (!launcher) {
        return {
          ok: false,
          message: "The OpenPCB MCP launcher is not installed; restart OpenPCB.",
          log: [],
        };
      }
      const marketplaceDir = getClaudeMarketplaceDir();
      return connectClaudeCode(defaultCliEnv(), {
        ...cliInput(),
        mode: mode === "server" ? "server" : "plugin",
        marketplaceDir: existsSync(marketplaceDir) ? marketplaceDir : null,
        serverConfig: stdioServerConfig(launcherPlatform(), launcher.launcherPath),
      });
    },
  );
  ipcMain.handle("mcp:claude-code:disconnect", () =>
    disconnectClaudeCode(defaultCliEnv(), cliInput()),
  );

  ipcMain.handle("app:get-versions", () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
  }));
}
