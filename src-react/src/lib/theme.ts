import { setTheme as setAppTheme } from "@tauri-apps/api/app";
import { TauriEvent, listen } from "@tauri-apps/api/event";

type Unlisten = () => void;

export type ThemeMode = "light" | "dark";
export type ThemePreference = "system" | ThemeMode;
export type ThemeSubscriptionDisposer = Unlisten;

const STORAGE_KEY = "theme";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isTauri(): boolean {
  return isBrowser() && "__TAURI__" in window;
}

function getStoredPreference(): ThemePreference | null {
  if (!isBrowser()) return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return null;
  } catch {
    return null;
  }
}

function storePreference(pref: ThemePreference): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore storage errors */
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

function getMediaQuery(): MediaQueryList | null {
  if (!isBrowser() || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia("(prefers-color-scheme: dark)");
}

async function getSystemTheme(): Promise<ThemeMode> {
  const media = getMediaQuery();
  if (media && typeof media.matches === "boolean") {
    return media.matches ? "dark" : "light";
  }
  return "light";
}

async function setTauriTheme(preference: ThemePreference): Promise<void> {
  if (!isTauri()) return;
  try {
    if (preference === "system") {
      await setAppTheme(null);
    } else {
      await setAppTheme(preference);
    }
  } catch {
    // ignore errors when not running inside Tauri or when the API is unavailable
  }
}

export async function initializeTheme(): Promise<{ preference: ThemePreference; mode: ThemeMode }> {
  const preference = getStoredPreference() ?? "system";
  const mode = preference === "system" ? await getSystemTheme() : preference;

  applyThemeClass(mode);
  await setTauriTheme(preference);

  return { preference, mode };
}

export async function updateThemePreference(preference: ThemePreference): Promise<{ mode: ThemeMode }> {
  storePreference(preference);

  await setTauriTheme(preference);
  const mode = preference === "system" ? await getSystemTheme() : preference;
  applyThemeClass(mode);

  return { mode };
}

export async function subscribeToSystemTheme(
  callback: (mode: ThemeMode) => void,
): Promise<Unlisten> {
  if (!isBrowser()) {
    return () => {};
  }

  const disposers: Unlisten[] = [];

  const media = getMediaQuery();
  if (media) {
    const handleMediaChange = (event: MediaQueryListEvent | MediaQueryList): void => {
      const matches = "matches" in event ? event.matches : media.matches;
      callback(matches ? "dark" : "light");
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleMediaChange);
      disposers.push(() => media.removeEventListener("change", handleMediaChange));
    } else if (typeof media.addListener === "function") {
      // Safari <14 fallback
      media.addListener(handleMediaChange);
      disposers.push(() => {
        media.removeListener(handleMediaChange);
      });
    }
  }

  if (isTauri()) {
    try {
      const unlisten = await listen<string>(TauriEvent.WINDOW_THEME_CHANGED, (event) => {
        const payload = event.payload;
        if (payload === "dark" || payload === "light") {
          callback(payload);
        }
      });
      disposers.push(() => {
        unlisten();
      });
    } catch {
      // ignore when theme events are unavailable
    }
  }

  return () => {
    disposers.forEach((dispose) => dispose());
  };
}

export function getThemePreference(): ThemePreference {
  return getStoredPreference() ?? "system";
}

export async function resolveCurrentMode(): Promise<ThemeMode> {
  const pref = getThemePreference();
  return pref === "system" ? await getSystemTheme() : pref;
}
