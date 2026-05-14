import { app } from "electron";
import electronUpdater, { type AppUpdater } from "electron-updater";
import { log as electronLog } from "./logger.js";
import { Sentry } from "./sentry.js";

const log = electronLog.scope("updater");
let initialized = false;

function getAutoUpdater(): AppUpdater {
  const updaterModule = electronUpdater as unknown as {
    autoUpdater: AppUpdater;
  };
  return updaterModule.autoUpdater;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function getUpdateChannel(): string {
  const os =
    process.platform === "darwin"
      ? "mac"
      : process.platform === "win32"
        ? "win"
        : process.platform;
  return `beta-${os}-${process.arch}`;
}

export function initializeAutoUpdater(): void {
  if (initialized || !app.isPackaged) {
    return;
  }
  initialized = true;

  const autoUpdater = getAutoUpdater();
  // Route electron-updater's internal logs through electron-log so update
  // failures land in the same main.log as everything else.
  autoUpdater.logger = log;

  const channel = getUpdateChannel();
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    log.info(`Checking for ${channel} updates`);
  });
  autoUpdater.on("update-available", (info) => {
    log.info(`Update available: ${info.version}`);
  });
  autoUpdater.on("update-not-available", (info) => {
    log.info(`No update available: ${info.version}`);
  });
  autoUpdater.on("download-progress", (progress) => {
    log.info(`Download ${progress.percent.toFixed(1)}%`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    log.info(`Update downloaded: ${info.version}`);
  });
  autoUpdater.on("error", (error) => {
    log.warn(formatError(error));
    Sentry.captureException(error, { tags: { component: "updater" } });
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
      log.warn(formatError(error));
      Sentry.captureException(error, {
        tags: { component: "updater", phase: "check" },
      });
    });
  }, 5_000);
}
