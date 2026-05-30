import * as React from "react";
import { useRuntime } from "@/providers/RuntimeProvider";
import { useTheme } from "@/providers/ThemeProvider";

// Keep in sync with TITLEBAR_HEIGHT in electron/src/main/index.ts and the
// setTitleBarOverlay height, or the native Window Controls Overlay buttons
// (Windows/Linux) misalign with this strip.
const TITLEBAR_HEIGHT = 36;

const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().includes("MAC");

// Mirrors index.css --surface-rail / --text-primary. Solid hex only — the
// Window Controls Overlay rejects rgba() colors. Keyed on the resolved theme
// mode rather than read from getComputedStyle, because this child effect fires
// before ThemeProvider's .dark-class effect (React runs child effects first),
// so computed styles would be stale on a theme switch.
const OVERLAY: Record<
  "light" | "dark",
  { color: string; symbolColor: string }
> = {
  dark: { color: "#0b1018", symbolColor: "#f3f4f6" },
  light: { color: "#ffffff", symbolColor: "#111827" },
};

/**
 * Themed custom window title bar for the Electron desktop shell.
 *
 * Renders nothing in the browser (web) runtime. In Electron it draws a slim
 * draggable strip matching the app theme; macOS keeps its native traffic
 * lights (cleared by the left padding) and Windows/Linux keep the native
 * Window Controls Overlay (drawn over the right edge by the OS).
 */
export function TitleBar(): React.ReactElement | null {
  const { runtime } = useRuntime();
  const { mode } = useTheme();

  React.useEffect(() => {
    if (isMac) return; // native traffic lights aren't recolorable this way
    void window.electronAPI?.window?.setOverlayTheme(OVERLAY[mode]);
  }, [mode]);

  if (runtime !== "electron") return null;

  return (
    <div
      role="presentation"
      aria-hidden="true"
      style={
        {
          height: TITLEBAR_HEIGHT,
          WebkitAppRegion: "drag",
          // macOS: clear the native traffic lights on the left.
          paddingLeft: isMac ? 80 : 8,
        } as React.CSSProperties
      }
      className="flex shrink-0 select-none items-center justify-center border-b border-slate-200 bg-surface-rail dark:border-slate-700"
    >
      <span className="text-xs font-medium tracking-wide text-text-secondary">
        OpenPCB
      </span>
    </div>
  );
}
