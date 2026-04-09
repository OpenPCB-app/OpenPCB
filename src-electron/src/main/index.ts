import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { spawnSidecar, killSidecar, getBackendPayload } from "./sidecar.js";

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

  const isDev = !app.isPackaged;
  if (isDev) {
    // Dev: load from Vite dev server (API proxy handles backend routing)
    mainWindow.loadURL("http://127.0.0.1:1420");
    mainWindow.webContents.openDevTools();
  } else {
    // Prod: load pre-built frontend app packaged as extra resource
    mainWindow.loadFile(join(process.resourcesPath, "frontend-dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC: fallback for getting backend URL if event was missed
ipcMain.handle("get-backend-url", () => {
  return getBackendPayload();
});

app.whenReady().then(async () => {
  // In dev mode, the backend runs separately via `npm run dev:backend`
  // and Vite proxies /api and /ws to it. No sidecar spawn needed.
  // In prod, we spawn the compiled sidecar binary ourselves.
  if (app.isPackaged) {
    try {
      const result = await spawnSidecar();
      console.log(`[electron] Sidecar ready: port=${result.port}`);
    } catch (err) {
      console.error("[electron] Failed to start sidecar:", err);
    }
  } else {
    console.log("[electron] Dev mode: using external backend via Vite proxy");
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
