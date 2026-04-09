/// <reference types="vite/client" />

interface ElectronBackendPayload {
  url: string;
  port: number;
  startupContractVersion?: number;
  startupLicenseState?: string;
  startupLicenseCode?: string;
}

interface ElectronAPI {
  onBackendReady: (callback: (payload: ElectronBackendPayload) => void) => void;
  getBackendUrl: () => Promise<ElectronBackendPayload | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
