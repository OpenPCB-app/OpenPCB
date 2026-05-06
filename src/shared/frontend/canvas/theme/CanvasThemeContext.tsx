import * as React from "react";
import type { CanvasTheme, CanvasThemeMode } from "./canvasTheme";
import { getCanvasTheme } from "./canvasTheme";

export interface CanvasThemeContextValue {
  theme: CanvasTheme;
  mode: CanvasThemeMode;
}

const CanvasThemeContext = React.createContext<CanvasThemeContextValue | undefined>(undefined);

export function useCanvasTheme(): CanvasThemeContextValue {
  const context = React.useContext(CanvasThemeContext);
  if (!context) {
    throw new Error("useCanvasTheme must be used within a CanvasThemeProvider");
  }
  return context;
}

export function CanvasThemeProvider({
  mode,
  children,
}: {
  mode: CanvasThemeMode;
  children: React.ReactNode;
}): React.ReactElement {
  const value = React.useMemo(
    () => ({ theme: getCanvasTheme(mode), mode }),
    [mode],
  );

  return (
    <CanvasThemeContext.Provider value={value}>
      {children}
    </CanvasThemeContext.Provider>
  );
}
