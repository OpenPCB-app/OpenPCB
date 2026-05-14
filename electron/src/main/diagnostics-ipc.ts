import { app, ipcMain, shell } from "electron";
import { getCrashDumpsDir } from "./crash.js";

let registered = false;

export function registerDiagnosticsIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("diagnostics:open-logs", async () => {
    const dir = app.getPath("logs");
    const err = await shell.openPath(dir);
    return { dir, error: err || null };
  });

  ipcMain.handle("diagnostics:open-crash-dumps", async () => {
    const dir = getCrashDumpsDir();
    const err = await shell.openPath(dir);
    return { dir, error: err || null };
  });

  ipcMain.handle("diagnostics:paths", () => ({
    logs: app.getPath("logs"),
    crashDumps: getCrashDumpsDir(),
    userData: app.getPath("userData"),
    appVersion: app.getVersion(),
  }));
}
