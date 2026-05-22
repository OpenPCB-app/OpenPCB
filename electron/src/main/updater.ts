import { app, BrowserWindow, ipcMain, shell } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import { log as electronLog } from "./logger.js";

const log = electronLog.scope("updater");
const REPO_OWNER = "andrejvysny";
const REPO_NAME = "OpenPCB";
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const GITHUB_API_LATEST = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

type UpdaterState =
  | { state: "checking" }
  | { state: "current" }
  | { state: "available"; version: string; notes: string | null }
  | { state: "available-manual"; version: string; url: string }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

type UpdaterProgress = {
  percent: number;
  transferred: number;
  total: number;
};

function send(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

// Targets where electron-updater can apply an in-place update.
// Everything else falls back to a GitHub-API notify-only check.
function canAutoUpdate(): boolean {
  if (!app.isPackaged) return false;
  // macOS ad-hoc signature → Squirrel.Mac rejects the update. Enable once
  // proper Developer ID + notarization lands.
  if (process.platform === "darwin") return false;
  // electron-builder emits no latest.yml for portable targets.
  if (process.env.PORTABLE_EXECUTABLE_FILE) return false;
  // deb/rpm: system pkg manager owns updates; only AppImage exports $APPIMAGE.
  if (process.platform === "linux" && !process.env.APPIMAGE) return false;
  // AppImageLauncher mounts on a read-only FUSE path — can't rewrite in place.
  if (process.env.APPIMAGE?.includes("appimagelauncherfs")) return false;
  return true;
}

function normaliseReleaseNotes(
  notes: UpdateInfo["releaseNotes"],
): string | null {
  if (!notes) return null;
  if (typeof notes === "string") return notes;
  return notes
    .map((n) => (typeof n === "string" ? n : `${n.version}\n${n.note ?? ""}`))
    .join("\n\n");
}

export function initUpdater(): void {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true;
  autoUpdater.allowDowngrade = false;

  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
  }

  autoUpdater.on("checking-for-update", () => {
    log.info("checking for update");
    send("updater:status", { state: "checking" } satisfies UpdaterState);
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    log.info(`update available: ${info.version}`);
    send("updater:status", {
      state: "available",
      version: info.version,
      notes: normaliseReleaseNotes(info.releaseNotes),
    } satisfies UpdaterState);
  });

  autoUpdater.on("update-not-available", () => {
    log.info("no update available");
    send("updater:status", { state: "current" } satisfies UpdaterState);
  });

  autoUpdater.on("download-progress", (p) => {
    send("updater:progress", {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
    } satisfies UpdaterProgress);
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    log.info(`update downloaded: ${info.version}`);
    send("updater:status", {
      state: "downloaded",
      version: info.version,
    } satisfies UpdaterState);
  });

  autoUpdater.on("error", (err: Error) => {
    log.error("updater error", err);
    send("updater:status", {
      state: "error",
      message: err?.message ?? String(err),
    } satisfies UpdaterState);
  });

  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) {
      send("updater:status", { state: "current" } satisfies UpdaterState);
      return;
    }
    if (canAutoUpdate()) {
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        log.error("checkForUpdates failed", err);
      }
      return;
    }
    await checkViaGithubApi();
  });

  ipcMain.handle("updater:download", () => {
    if (!canAutoUpdate()) return;
    return autoUpdater.downloadUpdate();
  });

  ipcMain.handle("updater:install", () => {
    if (!canAutoUpdate()) return;
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle("updater:open-releases", () =>
    shell.openExternal(RELEASES_URL),
  );

  // Initial check: 10s after startup so the app settles first.
  setTimeout(() => {
    if (!app.isPackaged) return;
    if (canAutoUpdate()) {
      autoUpdater
        .checkForUpdates()
        .catch((err) => log.error("initial check failed", err));
    } else {
      void checkViaGithubApi();
    }
  }, 10_000);
}

async function checkViaGithubApi(): Promise<void> {
  try {
    const res = await fetch(GITHUB_API_LATEST, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      log.warn(`github api check returned ${res.status}`);
      return;
    }
    const json = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
    };
    const latest = (json.tag_name ?? "").replace(/^v/, "");
    const current = app.getVersion();
    if (latest && latest !== current) {
      log.info(`github fallback: ${current} → ${latest}`);
      send("updater:status", {
        state: "available-manual",
        version: latest,
        url: json.html_url ?? RELEASES_URL,
      } satisfies UpdaterState);
    } else {
      send("updater:status", { state: "current" } satisfies UpdaterState);
    }
  } catch (err) {
    log.warn("github api check failed", err);
  }
}
