/**
 * What the stable MCP launcher looks like — pure functions, no `electron`
 * import, so Bun tests can pin the scripts and snippets down.
 *
 * Why a launcher in the user-data dir at all: the bridge (`shim.js`) ships
 * inside the app bundle, and a path into the bundle is not stable. An
 * AppImage mounts at a new `/tmp/.mount_*` path on every launch, the portable
 * Windows build extracts to a temp dir, an unsigned macOS app launched from
 * the DMG or Downloads runs "translocated" from a random read-only path, and
 * any app moves when the user reinstalls it elsewhere. Claude Code's config
 * must not change when any of that happens, so it points at
 * `<userData>/mcp/openpcb-mcp` — a launcher Electron main rewrites on every
 * launch to exec whatever binary is current.
 */

export type LauncherPlatform = "darwin" | "win32" | "linux";

export interface ExecResolution {
  /** Binary that runs the bridge (the app itself, as Node via ELECTRON_RUN_AS_NODE). */
  exec: string;
  kind: "installed" | "appimage" | "portable" | "translocated";
  /** Set when the launcher should warn the user (translocation). */
  warning: string | null;
}

/**
 * macOS Gatekeeper App Translocation (and running straight from the mounted
 * DMG) hands an unsigned app a path that disappears when it quits.
 */
export function isEphemeralMacPath(path: string): boolean {
  return path.includes("/AppTranslocation/") || path.startsWith("/Volumes/");
}

/**
 * The binary the launcher should exec. `APPIMAGE` / `PORTABLE_EXECUTABLE_FILE`
 * point at the file the user actually launched (stable); `execPath` inside
 * them is a temp mount / extraction.
 */
export function resolveLauncherExec(input: {
  platform: LauncherPlatform;
  execPath: string;
  env: Record<string, string | undefined>;
  /** exec recorded by a previous launch, reused when this one is ephemeral. */
  previousExec?: string | null;
}): ExecResolution {
  if (input.platform === "linux" && input.env.APPIMAGE) {
    return { exec: input.env.APPIMAGE, kind: "appimage", warning: null };
  }
  if (input.platform === "win32" && input.env.PORTABLE_EXECUTABLE_FILE) {
    return {
      exec: input.env.PORTABLE_EXECUTABLE_FILE,
      kind: "portable",
      warning: null,
    };
  }
  if (input.platform === "darwin" && isEphemeralMacPath(input.execPath)) {
    return {
      exec: input.previousExec && !isEphemeralMacPath(input.previousExec)
        ? input.previousExec
        : input.execPath,
      kind: "translocated",
      warning:
        "OpenPCB is running from a temporary location (opened from the disk image or Downloads). Move OpenPCB to the Applications folder and reopen it so Claude Code can keep finding it.",
    };
  }
  return { exec: input.execPath, kind: "installed", warning: null };
}

export function launcherFileName(platform: LauncherPlatform): string {
  return platform === "win32" ? "openpcb-mcp.cmd" : "openpcb-mcp";
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** POSIX launcher: exec the app as Node on the bridge, falling back to a system node. */
export function posixLauncher(input: { exec: string; shimPath: string }): string {
  return [
    "#!/bin/sh",
    "# openpcb-mcp — stdio MCP bridge into the running OpenPCB app.",
    "# Written by OpenPCB on every launch; do not edit. Point MCP clients here.",
    "set -eu",
    `exec_path=${shQuote(input.exec)}`,
    `shim=${shQuote(input.shimPath)}`,
    'if [ ! -f "$shim" ]; then',
    '  echo "openpcb-mcp: bridge missing at $shim — start OpenPCB once to reinstall it." >&2',
    "  exit 1",
    "fi",
    'if [ -x "$exec_path" ]; then',
    '  ELECTRON_RUN_AS_NODE=1 exec "$exec_path" "$shim" "$@"',
    "fi",
    "if command -v node >/dev/null 2>&1; then",
    '  exec node "$shim" "$@"',
    "fi",
    'echo "openpcb-mcp: OpenPCB is no longer at $exec_path and no system node was found. Start OpenPCB once so it can update this launcher." >&2',
    "exit 1",
    "",
  ].join("\n");
}

function cmdQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Windows launcher (run as `cmd /c openpcb-mcp.cmd`). */
export function windowsLauncher(input: { exec: string; shimPath: string }): string {
  return [
    "@echo off",
    "rem openpcb-mcp - stdio MCP bridge into the running OpenPCB app.",
    "rem Written by OpenPCB on every launch; do not edit. Point MCP clients here.",
    "setlocal",
    `set "EXEC_PATH=${input.exec}"`,
    `set "SHIM=${input.shimPath}"`,
    'if not exist "%SHIM%" (',
    "  echo openpcb-mcp: bridge missing - start OpenPCB once to reinstall it. 1>&2",
    "  exit /b 1",
    ")",
    'if exist "%EXEC_PATH%" (',
    '  set "ELECTRON_RUN_AS_NODE=1"',
    `  ${cmdQuote("%EXEC_PATH%")} ${cmdQuote("%SHIM%")} %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    "where node >nul 2>&1",
    "if %ERRORLEVEL%==0 (",
    `  node ${cmdQuote("%SHIM%")} %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    "echo openpcb-mcp: OpenPCB is no longer at %EXEC_PATH% and no system node was found. Start OpenPCB once. 1>&2",
    "exit /b 1",
    "",
  ].join("\r\n");
}

export function launcherScript(
  platform: LauncherPlatform,
  input: { exec: string; shimPath: string },
): string {
  return platform === "win32" ? windowsLauncher(input) : posixLauncher(input);
}

/**
 * The stdio server entry an MCP client needs. Windows cannot spawn a `.cmd`
 * without a shell (Node's spawn refuses since CVE-2024-27980), so the
 * launcher runs through `cmd /c`.
 */
export function stdioServerConfig(
  platform: LauncherPlatform,
  launcherPath: string,
): { type: "stdio"; command: string; args: string[] } {
  return platform === "win32"
    ? { type: "stdio", command: "cmd", args: ["/c", launcherPath] }
    : { type: "stdio", command: launcherPath, args: [] };
}

export interface McpSnippet {
  id: string;
  label: string;
  hint: string;
  value: string;
}

function posixArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=-]+$/.test(value) ? value : shQuote(value);
}

function winArg(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Copy-paste setup for the Settings panel. `--scope user` registers the server
 * for every project; the default `local` scope would tie it to whichever
 * directory the user happened to run the command in.
 */
export function mcpSnippets(input: {
  platform: LauncherPlatform;
  launcherPath: string;
  marketplaceDir: string | null;
}): McpSnippet[] {
  const config = stdioServerConfig(input.platform, input.launcherPath);
  const quote = input.platform === "win32" ? winArg : posixArg;
  const command = [config.command, ...config.args].map(quote).join(" ");
  const snippets: McpSnippet[] = [];
  if (input.marketplaceDir) {
    snippets.push({
      id: "claude-code-plugin",
      label: "Claude Code — plugin (recommended)",
      hint: "Adds the OpenPCB tools plus workflow skills (/openpcb:… ). Run in a terminal.",
      value: [
        `claude plugin marketplace add ${quote(input.marketplaceDir)}`,
        "claude plugin install openpcb@openpcb-desktop --scope user",
      ].join("\n"),
    });
  }
  snippets.push({
    id: "claude-code-server",
    label: "Claude Code — MCP server only",
    hint: "Registers just the tools, for every project. Run in a terminal.",
    value: `claude mcp add --scope user openpcb -- ${command}`,
  });
  snippets.push({
    id: "claude-desktop",
    label: "Claude Desktop",
    hint: "Merge into claude_desktop_config.json, then restart Claude Desktop.",
    value: JSON.stringify(
      { mcpServers: { openpcb: { command: config.command, args: config.args } } },
      null,
      2,
    ),
  });
  return snippets;
}
