/// <reference types="vite/client" />

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

interface ElectronAPI {
  onBackendReady: (callback: (payload: ElectronBackendPayload) => void) => void;
  getBackendUrl: () => Promise<ElectronBackendPayload | null>;
  secureStorage?: ElectronSecureStorage;
  preferences?: ElectronPreferences;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
