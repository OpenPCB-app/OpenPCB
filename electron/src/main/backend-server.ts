import { app, BrowserWindow } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log as electronLog } from "./logger.js";
import { Sentry } from "./sentry.js";
import { getTelemetryOptIn } from "./preferences.js";
import { configureProviderCredentials, getCredentialSecretStore } from "./credential-runtime.js";
import { startBackendRuntime } from "../../../src/core/backend/runtime";
import type { StartedBackendRuntime } from "../../../src/core/backend/runtime";
import type { ModuleRegistryResponse } from "../../../src/core/contracts/modules/registry";
import {
  disposeDrcWorker,
  setDrcWorkerEntry,
} from "../../../src/shared/drc/worker/drc-worker-client";
import {
  clearStaleMcpPortfile,
  ensureMcpToken,
  removeMcpPortfile,
  writeMcpPortfile,
} from "./mcp-portfile.js";

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
  // B11: the backend runs in-process here, so it must honour the same single
  // consent decision as Electron main and the renderer. Without this it would
  // fall back to "no opt-in recorded" and stay off, which is the safe default.
  process.env.OPENPCB_TELEMETRY_OPT_IN = getTelemetryOptIn() ? "1" : "0";
  // Bearer for the MCP endpoint. Generated per launch and handed to the
  // backend here; the matching value reaches external clients only through the
  // 0600 portfile written after the server is listening.
  process.env.OPENPCB_MCP_TOKEN = ensureMcpToken();

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

/**
 * The DRC worker entry is a separate tsup bundle, spawned as a file — packaged
 * it lives outside app.asar (execution contract 09 §2.1). `app.getAppPath()`
 * is the `electron/` directory in dev, the same base `getStaticDir` walks from.
 */
function configureDrcWorkerEntry(): void {
  const entry = app.isPackaged
    ? join(
        process.resourcesPath,
        "app.asar.unpacked",
        "dist",
        "main",
        "drc-worker.js",
      )
    : join(app.getAppPath(), "dist", "main", "drc-worker.js");
  setDrcWorkerEntry(entry);
  log.info(`DRC worker entry: ${entry}`);
}

async function closeCurrentRuntime(): Promise<void> {
  const current = runtime;
  runtime = null;
  backendPayload = null;
  configureProviderCredentials(null);
  // The worker holds a thread that outlives the runtime otherwise.
  await disposeDrcWorker().catch((error: unknown) => {
    log.warn(`Failed to dispose the DRC worker: ${String(error)}`);
  });
  await current?.close().catch((error: unknown) => {
    log.warn(`Failed to close backend after startup failure: ${String(error)}`);
  });
}

async function startRuntimeWithRequiredModules(): Promise<StartedBackendRuntime> {
  runtime = await startBackendRuntime({ host: "127.0.0.1", port: 0, secretStore: getCredentialSecretStore() });
  log.info(`Module registry:\n${summarizeModuleSnapshot(runtime.snapshot)}`);
  assertRequiredModulesLoaded(runtime.snapshot);
  configureProviderCredentials(runtime.providerCredentials ?? null);
  return runtime;
}

export async function startBackendServer(): Promise<BackendReadyPayload> {
  if (runtime && backendPayload) return backendPayload;

  configureBackendEnvironment();
  configureDrcWorkerEntry();
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

    const appDataDir = getAppDataDir();
    clearStaleMcpPortfile(appDataDir);
    writeMcpPortfile({
      appDataDir,
      url: startedRuntime.url,
      port: startedRuntime.port,
    });

    log.info(`Backend ready at ${startedRuntime.url}`);
    return backendPayload;
  } catch (error) {
    await closeCurrentRuntime();
    try {
      removeMcpPortfile(getAppDataDir());
      Sentry.captureException(error, {
        tags: { component: "backend", phase: "start" },
      });
    } catch (reportingError) {
      log.warn(
        `Failed to report backend startup failure: ${String(reportingError)}`,
      );
    }
    throw error;
  }
}

export async function stopBackendServer(): Promise<void> {
  // Drop the portfile even if the runtime is already gone, so a stale URL is
  // never left pointing at a dead port.
  removeMcpPortfile(getAppDataDir());
  backendPayload = null;
  configureProviderCredentials(null);
  if (!runtime) return;
  const current = runtime;
  runtime = null;
  // The DRC worker thread would keep the process alive past a clean quit —
  // `unref()` is not relied on (execution contract 09 §2.3).
  await disposeDrcWorker().catch((error: unknown) => {
    log.warn(`Failed to dispose the DRC worker: ${String(error)}`);
  });
  await current.close();
}

export function getMcpPortfilePath(): string {
  return join(getAppDataDir(), "mcp.json");
}
