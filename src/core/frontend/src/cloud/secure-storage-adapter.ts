import type { SupportedStorage } from "@supabase/supabase-js";

// Warn once if falling back to localStorage (browser/dev mode only).
let warnedAboutFallback = false;

function warnFallback(): void {
  if (warnedAboutFallback) return;
  warnedAboutFallback = true;
  console.warn(
    "[secure-storage] electronAPI.secureStorage not available — falling back to localStorage (dev/browser mode only)",
  );
}

function makeElectronAdapter(
  api: NonNullable<Window["electronAPI"]>["secureStorage"],
): SupportedStorage {
  return {
    getItem: (key: string) => api!.get(key),
    setItem: (key: string, value: string) => api!.set(key, value),
    removeItem: (key: string) => api!.remove(key),
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

  const api = window.electronAPI?.secureStorage;
  if (api) {
    return makeElectronAdapter(api);
  }

  warnFallback();
  return makeLocalStorageAdapter();
}
