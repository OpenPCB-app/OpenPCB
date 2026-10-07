import { app, BrowserWindow } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { LocalApiBootstrap } from "../../../src/core/contracts/security/local-api";
import { log as electronLog } from "./logger.js";
import { Sentry } from "./sentry.js";
import { getTelemetryOptIn } from "./preferences.js";
import { configureProviderCredentials, getCredentialSecretStore } from "./credential-runtime.js";
import { settleShutdownSteps } from "./graceful-quit.js";
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
let startup: Promise<BackendReadyPayload> | null = null;
let shutdown: Promise<void> | null = null;
let drcConfigured = false;
const localApiToken = randomBytes(32).toString("hex");
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
  delete process.env.OPENPCB_ALLOW_UNAUTHENTICATED_API;
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

export function getLocalApiBootstrap(): LocalApiBootstrap | null {
  return backendPayload ? { url: backendPayload.url, token: localApiToken } : null;
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
  drcConfigured = true;
  log.info(`DRC worker entry: ${entry}`);
}

async function closeCurrentRuntime(): Promise<void> {
  const current = runtime;
  await settleShutdownSteps([
    () => current?.close(),
    () => drcConfigured ? disposeDrcWorker() : undefined,
    () => removeMcpPortfile(getAppDataDir()),
    () => {
      runtime = null;
      backendPayload = null;
      drcConfigured = false;
      configureProviderCredentials(null);
    },
  ]);
}

async function startRuntimeWithRequiredModules(): Promise<StartedBackendRuntime> {
  runtime = await startBackendRuntime({
    host: "127.0.0.1", port: 0, secretStore: getCredentialSecretStore(),
    localApi: { token: localApiToken, rendererOrigins: app.isPackaged ? [] : ["http://127.0.0.1:1420"] },
  });
  log.info(`Module registry:\n${summarizeModuleSnapshot(runtime.snapshot)}`);
  assertRequiredModulesLoaded(runtime.snapshot);
  configureProviderCredentials(runtime.providerCredentials ?? null);
  return runtime;
}

async function bootBackendServer(): Promise<BackendReadyPayload> {
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
    await closeCurrentRuntime().catch(() => {
      log.warn("Backend startup cleanup failed after cleanup attempts.");
    });
    try {
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

export function startBackendServer(): Promise<BackendReadyPayload> {
  if (shutdown) return Promise.reject(new Error("Backend shutdown has started"));
  startup ??= bootBackendServer();
  return startup;
}

export function stopBackendServer(): Promise<void> {
  // A quit during startup must also close the runtime that startup creates.
  shutdown ??= Promise.resolve().then(async () => {
    await startup?.catch(() => undefined);
    await closeCurrentRuntime();
  });
  return shutdown;
}

export function getMcpPortfilePath(): string {
  return join(getAppDataDir(), "mcp.json");
}
