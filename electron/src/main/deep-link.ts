// Handles `openpcb://` deep links (invite acceptance, OAuth return URLs).
// Cross-platform: macOS uses `open-url`; Windows/Linux use second-instance argv.
import { app, BrowserWindow } from "electron";
import { log } from "./logger.js";

const SCHEME = "openpcb";

let pendingUrl: string | null = null;
let targetWindow: (() => BrowserWindow | null) | null = null;

export function initDeepLink(getWindow: () => BrowserWindow | null): void {
  targetWindow = getWindow;

  // OS-level scheme registration. On dev/macOS this needs the bundle id;
  // setAsDefaultProtocolClient writes Info.plist-equivalent metadata at runtime.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(SCHEME, process.execPath, [
        require("node:path").resolve(process.argv[1] ?? ""),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }

  // macOS: triggered when an openpcb:// URL is opened externally.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliver(url);
  });

  // Windows / Linux: deep-link arrives as argv on a second app instance.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on("second-instance", (_event, argv) => {
    const url = argv.find((a) => a.startsWith(`${SCHEME}://`));
    if (url) deliver(url);
    // also bring the window forward
    const w = targetWindow?.();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  // Catch a deep link present on cold-start (Windows/Linux).
  const initial = process.argv.find((a) => a.startsWith(`${SCHEME}://`));
  if (initial) pendingUrl = initial;
}

function deliver(url: string): void {
  log.info(`[deep-link] received ${url}`);
  const w = targetWindow?.();
  if (!w || w.webContents.isLoading()) {
    pendingUrl = url;
    return;
  }
  w.webContents.send("deep-link", url);
}

// Renderer calls this once the React side is ready to receive deep links.
export function flushPending(): string | null {
  const url = pendingUrl;
  pendingUrl = null;
  return url;
}
