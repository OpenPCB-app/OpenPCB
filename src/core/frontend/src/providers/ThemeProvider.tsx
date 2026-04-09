import * as React from "react";
import {
  applyThemeClass,
  initializeTheme,
  subscribeToSystemTheme,
  updateThemePreference,
  type ThemeMode,
  type ThemePreference,
} from "@/lib/theme";

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

  React.useEffect(() => {
    const init = initializeTheme();
    setPreferenceState(init.preference);
    setMode(init.mode);
    setIsReady(true);
  }, []);

  React.useEffect(() => {
    if (!isReady) return;
    applyThemeClass(mode);
  }, [isReady, mode]);

  React.useEffect(() => {
    if (!isReady || preference !== "system") {
      return;
    }
    return subscribeToSystemTheme((nextMode) => {
      setMode(nextMode);
    });
  }, [isReady, preference]);

  const setPreference = React.useCallback(
    async (nextPreference: ThemePreference) => {
      setPreferenceState(nextPreference);
      const { mode: resolvedMode } = updateThemePreference(nextPreference);
      setMode(resolvedMode);
    },
    [],
  );

  const value = React.useMemo(
    () => ({ preference, mode, isReady, setPreference }),
    [preference, mode, isReady, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
