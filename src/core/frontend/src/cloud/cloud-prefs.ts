import { create } from "zustand";

// User-controlled cloud preferences, persisted to localStorage so they survive
// reloads (and are shared across the renderer without prop-drilling). Currently
// just the project-sync master switch: when off, NO project data is sent to the
// cloud — the designer attaches no cloud headers, so command mirroring and
// cloud-linking are fully disabled even while signed in.

const SYNC_KEY = "openpcb.cloud.projectSyncEnabled";

function loadSyncEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(SYNC_KEY);
  return v === null ? true : v === "true"; // default ON
}

interface CloudPrefsState {
  projectSyncEnabled: boolean;
  setProjectSyncEnabled: (value: boolean) => void;
}

export const useCloudPrefs = create<CloudPrefsState>((set) => ({
  projectSyncEnabled: loadSyncEnabled(),
  setProjectSyncEnabled: (value: boolean) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SYNC_KEY, String(value));
    }
    set({ projectSyncEnabled: value });
  },
}));
