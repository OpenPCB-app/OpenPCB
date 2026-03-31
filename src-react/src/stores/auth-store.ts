import { create } from "zustand";

export type AuthStatus = "pending" | "loading" | "blocked" | "ready";

interface AuthState {
  status: AuthStatus;
  isLicensed: boolean;
  error: string | null;
  features: string[];
  tier: string;

  setStatus: (status: AuthStatus) => void;
  setLicensed: (isLicensed: boolean) => void;
  setError: (error: string | null) => void;
  setFeatures: (features: string[]) => void;
  setTier: (tier: string) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "pending",
  isLicensed: false,
  error: null,
  features: [],
  tier: "",

  setStatus: (status) => set({ status }),
  setLicensed: (isLicensed) => set({ isLicensed }),
  setError: (error) => set({ error }),
  setFeatures: (features) => set({ features }),
  setTier: (tier) => set({ tier }),
  reset: () =>
    set({
      status: "pending",
      isLicensed: false,
      error: null,
      features: [],
      tier: "",
    }),
}));
