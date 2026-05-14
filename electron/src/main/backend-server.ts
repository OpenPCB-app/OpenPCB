import { app, BrowserWindow } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log as electronLog } from "./logger.js";
import { Sentry } from "./sentry.js";
import { startBackendRuntime } from "../../../src/core/backend/runtime";
import type { StartedBackendRuntime } from "../../../src/core/backend/runtime";

const log = electronLog.scope("backend");

interface BackendReadyPayload {
  url: string;
  port: number;
  startupContractVersion: number;
  startupLicenseState: string;
  startupLicenseCode: string;
}

let runtime: StartedBackendRuntime | null = null;
let backendPayload: BackendReadyPayload | null = null;

function getAppDataDir(): string {
  const base = app.getPath("userData");
  return app.isPackaged ? base : join(base, "dev");
}

function getWorkspaceRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "src");
  }
  return join(app.getAppPath(), "..", "src");
}

function getStaticDir(): string | null {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, "dist")
    : join(app.getAppPath(), "..", "src", "core", "frontend", "dist");
  return existsSync(candidate) ? candidate : null;
}

function configureBackendEnvironment(): void {
  const appDataDir = getAppDataDir();
  mkdirSync(appDataDir, { recursive: true });

  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.APP_DATA_DIR = appDataDir;
  process.env.OPENPCB_DB_PATH = join(appDataDir, "openpcb.sqlite");
  process.env.OPENPCB_WORKSPACE_ROOT = getWorkspaceRoot();
  process.env.NODE_ENV = app.isPackaged ? "production" : "development";
  process.env.OPENPCB_ALLOW_UNAUTHENTICATED_API = "true";
  process.env.OPENPCB_LOG_DIR = app.getPath("logs");
  process.env.OPENPCB_SENTRY_ENV ??= app.isPackaged
    ? "production"
    : "development";
  process.env.OPENPCB_SENTRY_RELEASE = `openpcb@${app.getVersion()}`;

  const staticDir = getStaticDir();
  if (staticDir) {
    process.env.OPENPCB_STATIC_DIR = staticDir;
  } else {
    delete process.env.OPENPCB_STATIC_DIR;
  }

  log.info(`APP_DATA_DIR: ${appDataDir}`);
  log.info(`OPENPCB_WORKSPACE_ROOT: ${process.env.OPENPCB_WORKSPACE_ROOT}`);
  log.info(`OPENPCB_STATIC_DIR: ${process.env.OPENPCB_STATIC_DIR ?? "<none>"}`);
}

export function getBackendPayload(): BackendReadyPayload | null {
  return backendPayload;
}

export async function startBackendServer(): Promise<BackendReadyPayload> {
  if (runtime && backendPayload) return backendPayload;

  configureBackendEnvironment();
  try {
    runtime = await startBackendRuntime({ host: "127.0.0.1", port: 0 });
    backendPayload = {
      url: runtime.url,
      port: runtime.port,
      startupContractVersion: 1,
      startupLicenseState: "active",
      startupLicenseCode: "ELECTRON_BACKEND",
    };

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("backend-ready", backendPayload);
    }

    log.info(`Backend ready at ${runtime.url}`);
    return backendPayload;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { component: "backend", phase: "start" },
    });
    throw error;
  }
}

export async function stopBackendServer(): Promise<void> {
  if (!runtime) return;
  const current = runtime;
  runtime = null;
  backendPayload = null;
  await current.close();
}
