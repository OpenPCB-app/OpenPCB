import * as React from "react";
import {
  applyThemeClass,
  initializeTheme,
  subscribeToSystemTheme,
  updateThemePreference,
  type ThemeMode,
  type ThemePreference,
  type ThemeSubscriptionDisposer,
} from "../lib/theme";

// Re-export types for convenience
export type { ThemeMode, ThemePreference } from "../lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  mode: ThemeMode;
  isReady: boolean;
  setPreference: (preference: ThemePreference) => Promise<void>;
};

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [preference, setPreferenceState] = React.useState<ThemePreference>("system");
  const [mode, setMode] = React.useState<ThemeMode>("light");
  const [isReady, setIsReady] = React.useState(false);

  // Initialize theme on mount
  React.useEffect(() => {
    let cancelled = false;

    void initializeTheme()
      .then(({ preference: initialPreference, mode: initialMode }) => {
        if (cancelled) return;
        setPreferenceState(initialPreference);
        setMode(initialMode);
        setIsReady(true);
      })
      .catch(() => {
        setIsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Apply theme class whenever mode changes
  React.useEffect(() => {
    if (isReady) {
      applyThemeClass(mode);
    }
  }, [isReady, mode]);

  // Subscribe to system theme changes when preference is "system"
  React.useEffect(() => {
    if (!isReady || preference !== "system") {
      return undefined;
    }

    let disposed = false;
    let disposer: ThemeSubscriptionDisposer | null = null;

    void subscribeToSystemTheme((nextMode) => {
      setMode(nextMode);
    })
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        disposer = stop;
      })
      .catch(() => {
        /* no-op */
      });

    return () => {
      disposed = true;
      disposer?.();
    };
  }, [isReady, preference]);

  const setPreference = React.useCallback(
    async (nextPreference: ThemePreference) => {
      if (nextPreference === preference) {
        return;
      }

      setPreferenceState(nextPreference);
      
      try {
        const { mode: resolvedMode } = await updateThemePreference(nextPreference);
        setMode(resolvedMode);
      } catch {
        // If update fails, state will revert on next render
      }
    },
    [preference]
  );

  const value = React.useMemo(
    () => ({ preference, mode, isReady, setPreference }),
    [preference, mode, isReady, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
