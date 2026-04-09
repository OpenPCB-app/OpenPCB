import { contextBridge, ipcRenderer } from "electron";

interface BackendReadyPayload {
  url: string;
  port: number;
  startupContractVersion: number;
  startupLicenseState: string;
  startupLicenseCode: string;
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
});
