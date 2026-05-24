import { app, BrowserWindow } from "electron";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { log as electronLog } from "./logger.js";
import { Sentry } from "./sentry.js";
import { startBackendRuntime } from "../../../src/core/backend/runtime";
import type { StartedBackendRuntime } from "../../../src/core/backend/runtime";
import type { ModuleRegistryResponse } from "../../../src/core/contracts/modules/registry";
import { resetSharedSqlite } from "../../../src/core/backend/db/sqlite-client";

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
const REQUIRED_DESKTOP_MODULES = ["library", "designer", "assistant"] as const;

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

function summarizeModuleSnapshot(snapshot: ModuleRegistryResponse): string {
  if (snapshot.modules.length === 0) {
    return "No module manifests were discovered.";
  }

  return snapshot.modules
    .map((module) => {
      const reason = module.reason ? ` — ${module.reason}` : "";
      return `${module.id}: ${module.status}${reason}`;
    })
    .join("\n");
}

function assertRequiredModulesLoaded(snapshot: ModuleRegistryResponse): void {
  const missing = REQUIRED_DESKTOP_MODULES.filter(
    (id) => !snapshot.loadedModules.includes(id),
  );
  if (missing.length === 0) return;

  throw new Error(
    `Desktop backend started, but required module(s) failed to load: ${missing.join(
      ", ",
    )}\n\nModule registry:\n${summarizeModuleSnapshot(snapshot)}`,
  );
}

async function closeCurrentRuntime(): Promise<void> {
  if (!runtime) return;
  const current = runtime;
  runtime = null;
  await current.close().catch((error: unknown) => {
    log.warn(`Failed to close backend after startup failure: ${String(error)}`);
  });
}

function resetDesktopDatabase(): void {
  const dbPath = process.env.OPENPCB_DB_PATH;
  if (!dbPath) return;

  resetSharedSqlite();
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(candidate, { force: true });
  }
  log.warn(`Reset local desktop database after module startup failure: ${dbPath}`);
}

async function startRuntimeWithRequiredModules(): Promise<StartedBackendRuntime> {
  runtime = await startBackendRuntime({ host: "127.0.0.1", port: 0 });
  log.info(`Module registry:\n${summarizeModuleSnapshot(runtime.snapshot)}`);

  try {
    assertRequiredModulesLoaded(runtime.snapshot);
    return runtime;
  } catch {
    // Pre-1.0 desktop builds are allowed to discard local data. This recovers
    // stale development databases after schema resets instead of surfacing
    // misleading module 404s to the renderer.
    await closeCurrentRuntime();
    resetDesktopDatabase();

    runtime = await startBackendRuntime({ host: "127.0.0.1", port: 0 });
    log.info(
      `Module registry after database reset:\n${summarizeModuleSnapshot(
        runtime.snapshot,
      )}`,
    );
    assertRequiredModulesLoaded(runtime.snapshot);
    return runtime;
  }
}

export async function startBackendServer(): Promise<BackendReadyPayload> {
  if (runtime && backendPayload) return backendPayload;

  configureBackendEnvironment();
  try {
    const startedRuntime = await startRuntimeWithRequiredModules();
    backendPayload = {
      url: startedRuntime.url,
      port: startedRuntime.port,
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
