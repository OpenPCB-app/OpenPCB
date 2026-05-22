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
  onDeepLink: (callback: (url: string) => void) => {
    ipcRenderer.on("deep-link", (_event, url: string) => callback(url));
  },
  flushPendingDeepLink: (): Promise<string | null> => {
    return ipcRenderer.invoke("deep-link:pending");
  },
  secureStorage: {
    get: (key: string): Promise<string | null> =>
      ipcRenderer.invoke("secure-storage:get", key),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke("secure-storage:set", key, value),
    remove: (key: string): Promise<void> =>
      ipcRenderer.invoke("secure-storage:remove", key),
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
