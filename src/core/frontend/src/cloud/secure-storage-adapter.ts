import type { SupportedStorage } from "@supabase/supabase-js";

interface ElectronSecureStorageBridge {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface ElectronAPIShape {
  secureStorage?: ElectronSecureStorageBridge;
}

function getElectronAPI(): ElectronAPIShape | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { electronAPI?: ElectronAPIShape }).electronAPI;
}

let warnedAboutFallback = false;

function warnFallback(): void {
  if (warnedAboutFallback) return;
  warnedAboutFallback = true;
  console.warn(
    "[secure-storage] electronAPI.secureStorage not available — falling back to localStorage (dev/browser mode only)",
  );
}

function makeElectronAdapter(
  api: ElectronSecureStorageBridge,
): SupportedStorage {
  return {
    getItem: (key: string) => api.get(key),
    setItem: (key: string, value: string) => api.set(key, value),
    removeItem: (key: string) => api.remove(key),
  };
}

function makeLocalStorageAdapter(): SupportedStorage {
  return {
    getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
    setItem: (key: string, value: string) => {
      localStorage.setItem(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      localStorage.removeItem(key);
      return Promise.resolve();
    },
  };
}

export function createCloudStorage(): SupportedStorage | undefined {
  if (typeof window === "undefined") return undefined;

  const api = getElectronAPI()?.secureStorage;
  if (api) {
    return makeElectronAdapter(api);
  }

  warnFallback();
  return makeLocalStorageAdapter();
}
