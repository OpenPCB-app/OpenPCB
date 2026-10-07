/// <reference types="vite/client" />
import type { RendererCredentials } from "../../contracts/credentials/renderer";
import type { RendererLocalApi } from "../../contracts/security/local-api";

declare global {
  interface ElectronBackendPayload {
    url: string;
    port: number;
    startupContractVersion?: number;
    startupLicenseState?: string;
    startupLicenseCode?: string;
  }

  interface ElectronSecureStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  }

  interface ElectronPreferences {
    getTelemetryOptIn(): Promise<boolean>;
    setTelemetryOptIn(value: boolean): Promise<void>;
  }

  interface AppVersions {
    app: string;
    electron: string;
    chromium: string;
    node: string;
    v8: string;
    platform: string;
    arch: string;
    osRelease: string;
  }

  interface FolderOpenResult {
    dir: string;
    error: string | null;
  }

  interface ElectronAPI {
    /** Dev-only marketing-capture flag (OPENPCB_CAPTURE=1); absent in normal runs. */
    captureMode?: boolean;
    onBackendReady: (
      callback: (payload: ElectronBackendPayload) => void,
    ) => void;
    getBackendUrl: () => Promise<ElectronBackendPayload | null>;
    getDiagnosticsPaths?: () => Promise<{
      logs: string;
      crashDumps: string;
      userData: string;
      appVersion: string;
    }>;
    getAppVersions?: () => Promise<AppVersions>;
    getMcpConfig?: () => Promise<McpConfig>;
    openLogsFolder?: () => Promise<FolderOpenResult>;
    openCrashDumpsFolder?: () => Promise<FolderOpenResult>;
    openUserDataFolder?: () => Promise<FolderOpenResult>;
    credentials?: RendererCredentials;
    localApi?: RendererLocalApi;
    /** Supabase cloud session compatibility only; cannot resolve provider or SIWC vault refs. */
    secureStorage?: ElectronSecureStorage;
    preferences?: ElectronPreferences;
    openExternal?: (url: string) => Promise<void>;
    window?: {
      setOverlayTheme: (theme: {
        color: string;
        symbolColor: string;
      }) => Promise<void>;
    };
  }

  /** Mirrors the `mcp:config` IPC payload in electron/src/main/diagnostics-ipc.ts. */
  interface McpConfig {
    /** Absolute path to the bundled stdio launcher; null when unpackaged. */
    shimPath: string | null;
    shimAvailable: boolean;
    portfilePath: string;
    /** Streamable HTTP endpoint; null until the backend is listening. */
    url: string | null;
    token: string;
  }

  // Mirrors UpdaterState in electron/src/main/updater.ts.
  type UpdaterStatus =
    | { state: "checking" }
    | { state: "current" }
    | { state: "available"; version: string; notes: string | null }
    | { state: "available-manual"; version: string; url: string }
    | { state: "downloaded"; version: string }
    | { state: "error"; message: string };

  interface UpdaterProgress {
    percent: number;
    transferred: number;
    total: number;
  }

  interface ElectronUpdater {
    check(): Promise<void>;
    download(): Promise<void>;
    install(): Promise<void>;
    openReleases(): Promise<void>;
    onStatus(callback: (status: UpdaterStatus) => void): void;
    onProgress(callback: (progress: UpdaterProgress) => void): void;
  }

  interface Window {
    electronAPI?: ElectronAPI;
    updater?: ElectronUpdater;
  }
}

export {};
