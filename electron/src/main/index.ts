// Boot order is intentional: crashReporter and Sentry MUST be initialized
// before any window opens or any child process spawns. electron-log is
// initialized first so the rest of bootstrap is captured to disk.
import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { join } from "node:path";
import { initLogger, log } from "./logger.js";
import { initCrashReporter } from "./crash.js";
import { initSentry } from "./sentry.js";
import { Sentry } from "./sentry.js";
import { registerDiagnosticsIpc } from "./diagnostics-ipc.js";
import {
  startBackendServer,
  stopBackendServer,
  getBackendPayload,
} from "./backend-server.js";
import { initUpdater } from "./updater.js";
import { initDeepLink, flushPending } from "./deep-link.js";
import {
  getSecureItem,
  setSecureItem,
  removeSecureItem,
} from "./secure-storage.js";
import { getTelemetryOptIn, setTelemetryOptIn } from "./preferences.js";

initLogger();
initCrashReporter();
const sentryEnabled = initSentry();

if (!app.isPackaged) {
  // Vite dev mode needs inline/eval/blob script allowances for React Refresh
  // and worker hot-loading. Keep Electron's security warning disabled only for
  // this dev-only renderer; packaged builds keep the strict production CSP.
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

if (process.env.OPENPCB_DEBUG === "1" || !app.isPackaged) {
  app.commandLine.appendSwitch("enable-logging");
  app.commandLine.appendSwitch(
    "log-file",
    join(app.getPath("logs"), "chromium.log"),
  );
  app.commandLine.appendSwitch("enable-stack-dumping");
}

log.info(
  `[boot] OpenPCB ${app.getVersion()} | packaged=${app.isPackaged} | sentry=${sentryEnabled} | platform=${process.platform}-${process.arch}`,
);

registerDiagnosticsIpc();
initUpdater();
initDeepLink(() => mainWindow);

let mainWindow: BrowserWindow | null = null;

function installSecurityPolicy(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    },
  );

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {};
    const devCsp = [
      "default-src 'self' http://127.0.0.1:*",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://127.0.0.1:*",
      "style-src 'self' 'unsafe-inline' http://127.0.0.1:*",
      "img-src 'self' data: blob: http://127.0.0.1:*",
      "font-src 'self' data: http://127.0.0.1:* https://cdn.jsdelivr.net",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https://cdn.jsdelivr.net",
      "worker-src 'self' blob: http://127.0.0.1:*",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    const prodCsp = [
      "default-src 'self' http://127.0.0.1:*",
      "script-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://cdn.jsdelivr.net",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https://cdn.jsdelivr.net",
      "worker-src 'self' blob:",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    responseHeaders["Content-Security-Policy"] = [
      app.isPackaged ? prodCsp : devCsp,
    ];
    callback({ responseHeaders });
  });
}

function isAllowedAppUrl(url: string): boolean {
  const payload = getBackendPayload();
  const allowed = new Set<string>();
  if (payload) allowed.add(payload.url);
  if (!app.isPackaged) allowed.add("http://127.0.0.1:1420");

  try {
    const parsed = new URL(url);
    return allowed.has(parsed.origin);
  } catch {
    return false;
  }
}

const TITLEBAR_HEIGHT = 36;

function createWindow(): void {
  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "OpenPCB",
    // Dark --surface-app: avoids a white flash before React paints (a brief
    // dark frame is far less jarring than white on a dark-default app).
    backgroundColor: "#0f1520",
    show: false,
    // Themed custom title bar: hide the native strip. macOS keeps native
    // traffic lights (positioned to center in the 36px strip); Windows/Linux
    // get the Window Controls Overlay (native min/max/close drawn over the
    // bar), re-themed at runtime via "window:set-overlay-theme".
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : {
          titleBarOverlay: {
            color: "#0b1018",
            symbolColor: "#f3f4f6",
            height: TITLEBAR_HEIGHT,
          },
        }),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, code, description, url) => {
      log.error(`[window] did-fail-load ${url}: ${code} ${description}`);
    },
  );

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error(
      `[window] renderer gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
    if (sentryEnabled && details.reason !== "clean-exit") {
      Sentry.captureMessage(
        `Renderer process gone: ${details.reason}`,
        "error",
      );
    }
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    log.error(`[window] preload-error ${preloadPath}: ${error?.message}`);
    if (sentryEnabled) Sentry.captureException(error);
  });

  mainWindow.webContents.on("unresponsive", () => {
    log.warn("[window] renderer unresponsive");
  });
  mainWindow.webContents.on("responsive", () => {
    log.info("[window] renderer responsive again");
  });
}

app.on("child-process-gone", (_event, details) => {
  log.error(
    `[app] child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name ?? ""}`,
  );
  if (sentryEnabled && details.reason !== "clean-exit") {
    Sentry.captureMessage(
      `Child process gone: ${details.type} ${details.reason}`,
      "error",
    );
  }
});

function loadWindow(window: BrowserWindow, url: string): void {
  window.loadURL(url);
  if (!app.isPackaged) {
    window.webContents.openDevTools();
  }
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  };
  return value.replace(/[&<>"]/g, (char) => entities[char] ?? char);
}

function loadStartupError(window: BrowserWindow, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OpenPCB startup failed</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 48px; color: #111827; }
      pre { white-space: pre-wrap; background: #f3f4f6; padding: 16px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <h1>OpenPCB could not start</h1>
    <p>The desktop backend failed to start, so the frontend cannot render.</p>
    <pre>${escapeHtml(message)}</pre>
    <p style="margin-top:24px;font-size:13px;color:#6b7280">Logs: ${escapeHtml(app.getPath("logs"))}</p>
  </body>
</html>`;
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

ipcMain.handle("get-backend-url", () => {
  return getBackendPayload();
});

ipcMain.handle("deep-link:pending", () => flushPending());

ipcMain.handle("secure-storage:get", (_e, key: string) => getSecureItem(key));
ipcMain.handle("secure-storage:set", (_e, key: string, value: string) =>
  setSecureItem(key, value),
);
ipcMain.handle("secure-storage:remove", (_e, key: string) =>
  removeSecureItem(key),
);

ipcMain.handle("prefs:get-telemetry-opt-in", () => getTelemetryOptIn());
ipcMain.handle("prefs:set-telemetry-opt-in", (_e, value: boolean) =>
  setTelemetryOptIn(value),
);

// Re-theme the Window Controls Overlay (min/max/close) when the renderer
// switches light/dark. No-op on macOS (native traffic lights aren't
// recolorable this way); Windows/Linux only.
ipcMain.handle(
  "window:set-overlay-theme",
  (_e, theme: { color: string; symbolColor: string }) => {
    if (process.platform === "darwin" || !mainWindow) return;
    try {
      mainWindow.setTitleBarOverlay({
        color: theme.color,
        symbolColor: theme.symbolColor,
        height: TITLEBAR_HEIGHT,
      });
    } catch {
      // setTitleBarOverlay throws if titleBarOverlay wasn't enabled; ignore.
    }
  },
);

app.whenReady().then(async () => {
  installSecurityPolicy();

  try {
    const result = await startBackendServer();
    log.info(`[electron] Backend ready: port=${result.port}`);
  } catch (err) {
    log.error("[electron] Failed to start backend:", err);
    if (sentryEnabled) Sentry.captureException(err);
    createWindow();
    if (mainWindow) {
      loadStartupError(mainWindow, err);
    }
    return;
  }

  if (app.isPackaged) {
    try {
      createWindow();
      const result = getBackendPayload();
      if (!result) {
        throw new Error("Backend payload unavailable after startup");
      }
      if (mainWindow) {
        loadWindow(mainWindow, result.url);
      }
    } catch (err) {
      log.error("[electron] Failed to load packaged window:", err);
      if (sentryEnabled) Sentry.captureException(err);
      createWindow();
      if (mainWindow) {
        loadStartupError(mainWindow, err);
      }
    }
  } else {
    log.info("[electron] Dev mode: using Vite renderer and Electron backend");
    createWindow();
    if (mainWindow) {
      loadWindow(mainWindow, "http://127.0.0.1:1420");
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      const payload = getBackendPayload();
      if (!app.isPackaged && mainWindow) {
        loadWindow(mainWindow, "http://127.0.0.1:1420");
      } else if (payload && mainWindow) {
        loadWindow(mainWindow, payload.url);
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void stopBackendServer();
});
