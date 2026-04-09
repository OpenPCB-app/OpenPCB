import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

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
  // app.getAppPath() returns src-electron/, so go up one level to project root
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

export function getBackendPayload(): BackendReadyPayload | null {
  return backendPayload;
}

export function spawnSidecar(): Promise<BackendReadyPayload> {
  return new Promise((resolve, reject) => {
    const binaryPath = getSidecarPath();
    const appDataDir = getAppDataDir();

    // Ensure data directory exists before sidecar tries to create DB
    mkdirSync(appDataDir, { recursive: true });

    console.log(`[sidecar] Spawning: ${binaryPath}`);
    console.log(`[sidecar] APP_DATA_DIR: ${appDataDir}`);

    const child = spawn(binaryPath, [], {
      env: {
        ...process.env,
        PORT: "0",
        APP_DATA_DIR: appDataDir,
        NODE_ENV: app.isPackaged ? "production" : "development",
        OPENPCB_ALLOW_UNAUTHENTICATED_API: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    sidecarProcess = child;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Sidecar startup timed out after 10s"));
      }
    }, 10_000);

    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (resolved && discoveredPort) {
          // Already discovered, just log
          if (line.trim()) console.log(`[sidecar:stdout] ${line}`);
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

            // Notify all windows
            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send("backend-ready", payload);
            }

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              console.log(`[sidecar] Backend ready at port ${json.serverPort}`);
              resolve(payload);
            }
          }
        } catch {
          if (line.trim()) console.log(`[sidecar:stdout] ${line}`);
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      console.warn(`[sidecar:stderr] ${data.toString().trimEnd()}`);
    });

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Sidecar failed to start: ${err.message}`));
      }
    });

    child.on("exit", (code) => {
      console.log(`[sidecar] Process exited with code ${code}`);
      sidecarProcess = null;
      discoveredPort = null;
      backendPayload = null;
    });
  });
}

export function killSidecar(): void {
  if (sidecarProcess) {
    console.log("[sidecar] Sending SIGTERM");
    sidecarProcess.kill("SIGTERM");
    sidecarProcess = null;
    discoveredPort = null;
    backendPayload = null;
  }
}
