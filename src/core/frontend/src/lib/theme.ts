export type ThemeMode = "light" | "dark";
export type ThemePreference = "system" | ThemeMode;

const STORAGE_KEY = "theme";

type Unsubscribe = () => void;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function getMediaQuery(): MediaQueryList | null {
  if (!isBrowser() || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia("(prefers-color-scheme: dark)");
}

function getSystemMode(): ThemeMode {
  const media = getMediaQuery();
  return media?.matches ? "dark" : "light";
}

function getStoredPreference(): ThemePreference | null {
  if (!isBrowser()) return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "system" || value === "light" || value === "dark") {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function storePreference(preference: ThemePreference): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // ignore
  }
}

export function applyThemeClass(mode: ThemeMode): void {
  if (!isBrowser()) return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(mode);
  root.dataset.colorMode = mode;
  root.style.setProperty("color-scheme", mode);
}

export function initializeTheme(): { preference: ThemePreference; mode: ThemeMode } {
  const preference = getStoredPreference() ?? "system";
  const mode = preference === "system" ? getSystemMode() : preference;
  applyThemeClass(mode);
  return { preference, mode };
}

export function updateThemePreference(preference: ThemePreference): { mode: ThemeMode } {
  storePreference(preference);
  const mode = preference === "system" ? getSystemMode() : preference;
  applyThemeClass(mode);
  return { mode };
}

export function subscribeToSystemTheme(callback: (mode: ThemeMode) => void): Unsubscribe {
  const media = getMediaQuery();
  if (!media) {
    return () => {};
  }

  const handler = (event: MediaQueryListEvent) => {
    callback(event.matches ? "dark" : "light");
  };

  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
