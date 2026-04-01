import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

let pendingUpdate: Update | null = null;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

interface UpdateState {
  updateAvailable: boolean;
  version: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  downloading: boolean;
  downloadProgress: number;
  downloadedBytes: number;
  totalBytes: number;
  installing: boolean;
  error: string | null;
  dismissed: boolean;

  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismiss: () => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  updateAvailable: false,
  version: null,
  releaseNotes: null,
  releaseDate: null,
  downloading: false,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  installing: false,
  error: null,
  dismissed: false,

  checkForUpdate: async () => {
    if (!isTauriRuntime()) {
      return;
    }

    try {
      const update = await check();
      if (update) {
        pendingUpdate = update;
        set({
          updateAvailable: true,
          version: update.version,
          releaseNotes: update.body ?? null,
          releaseDate: update.date ?? null,
          error: null,
        });
      }
    } catch (e) {
      console.warn("Update check failed:", e);
    }
  },

  downloadAndInstall: async () => {
    if (!isTauriRuntime()) {
      return;
    }

    if (!pendingUpdate) return;

    set({ downloading: true, error: null, downloadProgress: 0 });

    try {
      let totalLen = 0;
      let downloaded = 0;

      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalLen = event.data.contentLength ?? 0;
          set({ totalBytes: totalLen });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = totalLen > 0 ? Math.round((downloaded / totalLen) * 100) : 0;
          set({
            downloadedBytes: downloaded,
            downloadProgress: progress,
          });
        } else if (event.event === "Finished") {
          set({ downloading: false, installing: true });
        }
      });

      await relaunch();
    } catch (e) {
      set({
        downloading: false,
        installing: false,
        error: e instanceof Error ? e.message : "Download failed",
      });
    }
  },

  dismiss: () => set({ dismissed: true }),

  reset: () => {
    pendingUpdate = null;
    set({
      updateAvailable: false,
      version: null,
      releaseNotes: null,
      releaseDate: null,
      downloading: false,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      installing: false,
      error: null,
      dismissed: false,
    });
  },
}));
