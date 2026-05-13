import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { spawnSidecar, killSidecar, getBackendPayload } from "./sidecar.js";
import { initializeAutoUpdater } from "./updater.js";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 600,
    title: "OpenPCB (Electron)",
    webPreferences: {
      preload: join(import.meta.dirname, "..", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[electron] Failed to load ${url}: ${code} ${description}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[electron] Renderer process gone: ${details.reason}`);
  });
}

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
  </body>
</html>`;
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

// IPC: fallback for getting backend URL if event was missed
ipcMain.handle("get-backend-url", () => {
  return getBackendPayload();
});

app.whenReady().then(async () => {
  // In dev mode, the backend runs separately via `npm run dev:backend`
  // and Vite proxies /api and /ws to it. No sidecar spawn needed.
  // In prod, we spawn the compiled sidecar binary ourselves and load
  // the frontend from the backend's static file server.
  if (app.isPackaged) {
    try {
      const result = await spawnSidecar();
      console.log(`[electron] Sidecar ready: port=${result.port}`);
      createWindow();
      if (mainWindow) {
        loadWindow(mainWindow, result.url);
      }
      initializeAutoUpdater();
    } catch (err) {
      console.error("[electron] Failed to start sidecar:", err);
      createWindow();
      if (mainWindow) {
        loadStartupError(mainWindow, err);
      }
    }
  } else {
    console.log("[electron] Dev mode: using external backend via Vite proxy");
    createWindow();
    if (mainWindow) {
      loadWindow(mainWindow, "http://127.0.0.1:1420");
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      const payload = getBackendPayload();
      if (payload && mainWindow) {
        loadWindow(mainWindow, payload.url);
      } else if (!app.isPackaged && mainWindow) {
        loadWindow(mainWindow, "http://127.0.0.1:1420");
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
  killSidecar();
});
