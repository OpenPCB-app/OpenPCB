import os from "node:os";
import { existsSync } from "node:fs";
import { app, ipcMain, shell } from "electron";
import { getCrashDumpsDir } from "./crash.js";
import {
  getAppDataDir,
  getBackendPayload,
  getClaudeMarketplaceDir,
  getMcpPortfilePath,
} from "./backend-server.js";
import {
  clearRegistration,
  readRegistration,
  writeRegistration,
} from "./claude-registration.js";
import { ensureMcpToken } from "./mcp-portfile.js";
import { getInstalledMcpLauncher } from "./mcp-launcher.js";
import {
  mcpSnippets,
  stdioServerConfig,
  type LauncherPlatform,
  type McpServerTarget,
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

/** The launcher this launch installed, as a server target (null if missing). */
function serverTarget(): McpServerTarget | null {
  const launcher = getInstalledMcpLauncher();
  return launcher
    ? { launcherPath: launcher.launcherPath, exec: launcher.exec.exec, shimPath: launcher.shimPath }
    : null;
}

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
            target: serverTarget()!,
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
  // `claude` CLI with fixed arguments, only on an explicit click. The
  // registration record (claude-registration.ts) is what makes ownership
  // exact: only what this installation registered is updated or removed.
  const statusInput = () => {
    const target = serverTarget();
    const marketplaceDir = getClaudeMarketplaceDir();
    return {
      appVersion: app.getVersion(),
      expectedServer: target ? stdioServerConfig(launcherPlatform(), target) : null,
      registration: readRegistration(getAppDataDir()),
      marketplaceDir: existsSync(marketplaceDir) ? marketplaceDir : null,
    };
  };
  ipcMain.handle("mcp:claude-code:status", () =>
    claudeCodeStatus(defaultCliEnv(), statusInput()),
  );
  ipcMain.handle(
    "mcp:claude-code:connect",
    async (_event, mode: unknown) => {
      const target = serverTarget();
      if (!target) {
        return {
          ok: false,
          message: "The OpenPCB MCP launcher is not installed; restart OpenPCB.",
          log: [],
        };
      }
      const input = statusInput();
      const result = await connectClaudeCode(defaultCliEnv(), {
        ...input,
        mode: mode === "server" ? "server" : "plugin",
        serverConfig: stdioServerConfig(launcherPlatform(), target),
      });
      if (result.ok && result.registration) {
        writeRegistration(getAppDataDir(), result.registration);
      }
      return { ok: result.ok, message: result.message, log: result.log };
    },
  );
  ipcMain.handle("mcp:claude-code:disconnect", async () => {
    const result = await disconnectClaudeCode(defaultCliEnv(), statusInput());
    if (result.ok && result.clearRegistration) clearRegistration(getAppDataDir());
    return { ok: result.ok, message: result.message, log: result.log };
  });

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
