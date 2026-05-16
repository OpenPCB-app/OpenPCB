// Boot order is intentional: crashReporter and Sentry MUST be initialized
// before any window opens or any child process spawns. electron-log is
// initialized first so the rest of bootstrap is captured to disk.
import { app, BrowserWindow, ipcMain } from "electron";
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

initLogger();
initCrashReporter();
const sentryEnabled = initSentry();

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

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 600,
    title: "OpenPCB (Electron)",
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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

app.whenReady().then(async () => {
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
