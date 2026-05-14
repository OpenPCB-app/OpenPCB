import { spawn, type ChildProcess } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  type WriteStream,
} from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { log as electronLog } from "./logger.js";
import { Sentry } from "./sentry.js";

const log = electronLog.scope("sidecar");

interface BackendReadyPayload {
  url: string;
  port: number;
  startupContractVersion: number;
  startupLicenseState: string;
  startupLicenseCode: string;
}

let sidecarProcess: ChildProcess | null = null;
let discoveredPort: number | null = null;
let backendPayload: BackendReadyPayload | null = null;
let sidecarLogStream: WriteStream | null = null;

const SIDECAR_STARTUP_TIMEOUT_MS = 30_000;

function getSidecarPath(): string {
  const platform = process.platform;
  const arch = process.arch;

  const tripleMap: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
  };

  const triple = tripleMap[`${platform}-${arch}`];
  if (!triple) {
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }

  const ext = platform === "win32" ? ".exe" : "";
  const binaryName = `bun-backend-${triple}${ext}`;

  if (app.isPackaged) {
    return join(process.resourcesPath, "bin", binaryName);
  }

  // Dev mode: binary in project root bin/
  // app.getAppPath() returns electron/, so go up one level to project root
  const devPath = join(app.getAppPath(), "..", "bin", binaryName);
  if (existsSync(devPath)) return devPath;

  // Fallback: try from cwd
  const cwdPath = join(process.cwd(), "bin", binaryName);
  if (existsSync(cwdPath)) return cwdPath;

  throw new Error(
    `Sidecar binary not found. Run 'npm run bun:compile' first. Tried:\n  ${devPath}\n  ${cwdPath}`,
  );
}

function getAppDataDir(): string {
  const base = app.getPath("userData");
  return app.isPackaged ? base : join(base, "dev");
}

function getBackendWorkspaceRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "src");
  }
  return join(app.getAppPath(), "..", "src");
}

function openSidecarLogStream(): WriteStream {
  if (sidecarLogStream && !sidecarLogStream.closed) {
    return sidecarLogStream;
  }
  const logsDir = app.getPath("logs");
  mkdirSync(logsDir, { recursive: true });
  const stream = createWriteStream(join(logsDir, "sidecar.log"), {
    flags: "a",
  });
  stream.on("error", (err) => {
    log.warn(`[sidecar-log] write stream error: ${err.message}`);
  });
  sidecarLogStream = stream;
  return stream;
}

function writeSidecarLine(channel: "stdout" | "stderr", line: string): void {
  if (!line) return;
  try {
    const ts = new Date().toISOString();
    openSidecarLogStream().write(`[${ts}] [${channel}] ${line}\n`);
  } catch {
    // Logging failure must never break the sidecar.
  }
}

export function getBackendPayload(): BackendReadyPayload | null {
  return backendPayload;
}

export function spawnSidecar(): Promise<BackendReadyPayload> {
  return new Promise((resolve, reject) => {
    const binaryPath = getSidecarPath();
    const appDataDir = getAppDataDir();
    const workspaceRoot = getBackendWorkspaceRoot();

    // Ensure data directory exists before sidecar tries to create DB
    mkdirSync(appDataDir, { recursive: true });

    log.info(`Spawning: ${binaryPath}`);
    log.info(`APP_DATA_DIR: ${appDataDir}`);
    log.info(`OPENPCB_WORKSPACE_ROOT: ${workspaceRoot}`);

    const child = spawn(binaryPath, [], {
      env: {
        ...process.env,
        PORT: "0",
        APP_DATA_DIR: appDataDir,
        OPENPCB_DB_PATH: join(appDataDir, "openpcb.sqlite"),
        OPENPCB_WORKSPACE_ROOT: workspaceRoot,
        OPENPCB_STATIC_DIR: app.isPackaged
          ? join(process.resourcesPath, "frontend-dist")
          : join(app.getAppPath(), "..", "src", "core", "frontend", "dist"),
        NODE_ENV: app.isPackaged ? "production" : "development",
        OPENPCB_ALLOW_UNAUTHENTICATED_API: "true",
        OPENPCB_LOG_DIR: app.getPath("logs"),
        // Forward Sentry config to the sidecar; the compiled binary also inlines
        // DSN/release/env at build time via scripts/compile-bun-sidecar.ts, but
        // these env values let dev / unsigned builds still report.
        OPENPCB_SENTRY_DSN: process.env.OPENPCB_SENTRY_DSN ?? "",
        OPENPCB_SENTRY_ENV:
          process.env.OPENPCB_SENTRY_ENV ??
          (app.isPackaged ? "production" : "development"),
        OPENPCB_SENTRY_RELEASE: `openpcb@${app.getVersion()}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    sidecarProcess = child;
    let resolved = false;
    let stdoutBuffer = "";
    let stderrTail = "";

    const rejectStartup = (message: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(new Error(message));
    };

    const timeout = setTimeout(() => {
      rejectStartup(
        `Sidecar startup timed out after ${SIDECAR_STARTUP_TIMEOUT_MS / 1000}s${
          stderrTail ? `\nLast stderr:\n${stderrTail}` : ""
        }`,
      );
    }, SIDECAR_STARTUP_TIMEOUT_MS);

    child.stdout?.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) writeSidecarLine("stdout", trimmed);

        if (resolved && discoveredPort) {
          if (trimmed) log.debug(trimmed);
          continue;
        }

        try {
          const json = JSON.parse(line) as {
            serverPort?: number;
            startupContractVersion?: number;
            startupLicenseState?: string;
            startupLicenseCode?: string;
          };
          if (typeof json.serverPort === "number") {
            discoveredPort = json.serverPort;
            const payload: BackendReadyPayload = {
              url: `http://127.0.0.1:${json.serverPort}`,
              port: json.serverPort,
              startupContractVersion: json.startupContractVersion ?? 1,
              startupLicenseState: json.startupLicenseState ?? "active",
              startupLicenseCode: json.startupLicenseCode ?? "ELECTRON_DEV",
            };
            backendPayload = payload;

            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send("backend-ready", payload);
            }

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              log.info(`Backend ready at port ${json.serverPort}`);
              resolve(payload);
            }
          }
        } catch {
          if (trimmed) log.debug(trimmed);
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const message = data.toString().trimEnd();
      stderrTail = `${stderrTail}\n${message}`.slice(-4000).trimStart();
      writeSidecarLine("stderr", message);
      log.warn(message);
    });

    child.on("error", (err) => {
      log.error(`Failed to spawn: ${err.message}`);
      Sentry.captureException(err, {
        tags: { component: "sidecar", phase: "spawn" },
      });
      rejectStartup(`Sidecar failed to start: ${err.message}`);
    });

    child.on("exit", (code, signal) => {
      log.warn(`Process exited code=${code} signal=${signal}`);
      const exitedAbnormally =
        code !== 0 && code !== null && signal !== "SIGTERM";
      if (exitedAbnormally) {
        const err = new Error(
          `Sidecar exited abnormally: code=${code ?? "null"} signal=${signal ?? "null"}`,
        );
        Sentry.captureException(err, {
          tags: { component: "sidecar", phase: "exit" },
          extra: {
            exitCode: code,
            signal,
            stderrTail: stderrTail.slice(-4000),
            backendReady: backendPayload !== null,
          },
        });
      }
      sidecarProcess = null;
      discoveredPort = null;
      backendPayload = null;
      rejectStartup(
        `Sidecar exited before becoming ready: code=${code ?? "null"} signal=${
          signal ?? "null"
        }${stderrTail ? `\nLast stderr:\n${stderrTail}` : ""}`,
      );
    });
  });
}

export function killSidecar(): void {
  if (sidecarProcess) {
    log.info("Sending SIGTERM");
    sidecarProcess.kill("SIGTERM");
    sidecarProcess = null;
    discoveredPort = null;
    backendPayload = null;
  }
  if (sidecarLogStream && !sidecarLogStream.closed) {
    sidecarLogStream.end();
    sidecarLogStream = null;
  }
}
