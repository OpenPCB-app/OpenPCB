import { app } from "electron";
import electronUpdater, { type AppUpdater } from "electron-updater";

let initialized = false;

function getAutoUpdater(): AppUpdater {
  const updaterModule = electronUpdater as unknown as { autoUpdater: AppUpdater };
  return updaterModule.autoUpdater;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function getUpdateChannel(): string {
  const os = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
  return `beta-${os}-${process.arch}`;
}

export function initializeAutoUpdater(): void {
  if (initialized || !app.isPackaged) {
    return;
  }
  initialized = true;

  const autoUpdater = getAutoUpdater();
  const channel = getUpdateChannel();
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log(`[updater] Checking for ${channel} updates`);
  });
  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] Update available: ${info.version}`);
  });
  autoUpdater.on("update-not-available", (info) => {
    console.log(`[updater] No update available: ${info.version}`);
  });
  autoUpdater.on("download-progress", (progress) => {
    console.log(`[updater] Download ${progress.percent.toFixed(1)}%`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[updater] Update downloaded: ${info.version}`);
  });
  autoUpdater.on("error", (error) => {
    console.warn(`[updater] ${formatError(error)}`);
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
      console.warn(`[updater] ${formatError(error)}`);
    });
  }, 5_000);
}
