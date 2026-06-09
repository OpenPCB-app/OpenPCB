// electron-log/preload exposes a renderer-side bridge over the global
// `__electronLog` symbol so renderer code calling electron-log/renderer routes
// to the main process logger (and disk).
import "electron-log/preload";
import { contextBridge, ipcRenderer } from "electron";

interface BackendReadyPayload {
  url: string;
  port: number;
  startupContractVersion: number;
  startupLicenseState: string;
  startupLicenseCode: string;
}

interface DiagnosticsPaths {
  logs: string;
  crashDumps: string;
  userData: string;
  appVersion: string;
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

contextBridge.exposeInMainWorld("electronAPI", {
  onBackendReady: (callback: (payload: BackendReadyPayload) => void) => {
    ipcRenderer.on("backend-ready", (_event, payload: BackendReadyPayload) => {
      callback(payload);
    });
  },
  getBackendUrl: (): Promise<BackendReadyPayload | null> => {
    return ipcRenderer.invoke("get-backend-url");
  },
  openLogsFolder: (): Promise<{ dir: string; error: string | null }> => {
    return ipcRenderer.invoke("diagnostics:open-logs");
  },
  openCrashDumpsFolder: (): Promise<{ dir: string; error: string | null }> => {
    return ipcRenderer.invoke("diagnostics:open-crash-dumps");
  },
  getDiagnosticsPaths: (): Promise<DiagnosticsPaths> => {
    return ipcRenderer.invoke("diagnostics:paths");
  },
  getAppVersions: (): Promise<AppVersions> => {
    return ipcRenderer.invoke("app:get-versions");
  },
  openUserDataFolder: (): Promise<{ dir: string; error: string | null }> => {
    return ipcRenderer.invoke("diagnostics:open-user-data");
  },
  onDeepLink: (callback: (url: string) => void) => {
    ipcRenderer.on("deep-link", (_event, url: string) => callback(url));
  },
  flushPendingDeepLink: (): Promise<string | null> => {
    return ipcRenderer.invoke("deep-link:pending");
  },
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-external", url),
  secureStorage: {
    get: (key: string): Promise<string | null> =>
      ipcRenderer.invoke("secure-storage:get", key),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke("secure-storage:set", key, value),
    remove: (key: string): Promise<void> =>
      ipcRenderer.invoke("secure-storage:remove", key),
  },
  preferences: {
    getTelemetryOptIn: (): Promise<boolean> =>
      ipcRenderer.invoke("prefs:get-telemetry-opt-in"),
    setTelemetryOptIn: (value: boolean): Promise<void> =>
      ipcRenderer.invoke("prefs:set-telemetry-opt-in", value),
  },
  window: {
    setOverlayTheme: (theme: {
      color: string;
      symbolColor: string;
    }): Promise<void> => ipcRenderer.invoke("window:set-overlay-theme", theme),
  },
});

contextBridge.exposeInMainWorld("updater", {
  check: (): Promise<void> => ipcRenderer.invoke("updater:check"),
  download: (): Promise<void> => ipcRenderer.invoke("updater:download"),
  install: (): Promise<void> => ipcRenderer.invoke("updater:install"),
  openReleases: (): Promise<void> =>
    ipcRenderer.invoke("updater:open-releases"),
  onStatus: (callback: (status: unknown) => void) => {
    ipcRenderer.on("updater:status", (_event, status) => callback(status));
  },
  onProgress: (callback: (progress: unknown) => void) => {
    ipcRenderer.on("updater:progress", (_event, progress) =>
      callback(progress),
    );
  },
});
