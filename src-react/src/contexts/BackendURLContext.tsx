import React, { createContext, useContext, useState, useEffect } from "react";
import { setBackendURL } from "@shared/sdk/mutator";

interface BackendReadyPayload {
  url: string;
  port: number;
  startupContractVersion: number;
  startupLicenseState: "active" | "grace" | "restricted" | "blocked";
  startupLicenseCode: string;
}

interface BackendURLContextType {
  backendURL: string | null;
  isReady: boolean;
  startupContractVersion: number | null;
  startupLicenseState: "active" | "grace" | "restricted" | "blocked" | null;
  startupLicenseCode: string | null;
  loadedModules: string[];
}

const BackendURLContext = createContext<BackendURLContextType>({
  backendURL: null,
  isReady: false,
  startupContractVersion: null,
  startupLicenseState: null,
  startupLicenseCode: null,
  loadedModules: [],
});

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function isElectronRuntime(): boolean {
  return typeof window !== "undefined" && "electronAPI" in window;
}

export const BackendURLProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [backendURL, setBackendURLState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [startupContractVersion, setStartupContractVersion] = useState<
    number | null
  >(null);
  const [startupLicenseState, setStartupLicenseState] = useState<
    "active" | "grace" | "restricted" | "blocked" | null
  >(null);
  const [startupLicenseCode, setStartupLicenseCode] = useState<string | null>(
    null,
  );
  const [loadedModules, setLoadedModules] = useState<string[]>([]);

  useEffect(() => {
    // Electron runtime: receive backend URL via IPC from main process
    if (isElectronRuntime()) {
      const api = (
        window as unknown as {
          electronAPI: {
            onBackendReady: (
              cb: (payload: BackendReadyPayload) => void,
            ) => void;
            getBackendUrl: () => Promise<BackendReadyPayload | null>;
          };
        }
      ).electronAPI;

      let received = false;

      api.onBackendReady((payload) => {
        received = true;
        console.log("[BackendURL] Electron backend-ready:", payload);
        setBackendURLState(payload.url);
        setBackendURL(payload.url);
        setStartupContractVersion(payload.startupContractVersion);
        setStartupLicenseState(
          payload.startupLicenseState as BackendURLContextType["startupLicenseState"],
        );
        setStartupLicenseCode(payload.startupLicenseCode);
        setIsReady(true);
      });

      // Immediately check if sidecar URL is already available
      const checkImmediately = async () => {
        const payload = await api.getBackendUrl();
        if (received) return;
        if (payload?.url) {
          received = true;
          console.log(
            "[BackendURL] Electron backend URL via IPC:",
            payload.url,
          );
          setBackendURLState(payload.url);
          setBackendURL(payload.url);
          setStartupContractVersion(payload.startupContractVersion);
          setStartupLicenseState(
            payload.startupLicenseState as BackendURLContextType["startupLicenseState"],
          );
          setStartupLicenseCode(payload.startupLicenseCode);
          setIsReady(true);
        } else {
          // Dev mode: no sidecar, fall back to Vite proxy (same origin)
          console.log("[BackendURL] Electron dev mode: using Vite proxy");
          const baseUrl = window.location.origin;
          setBackendURLState(baseUrl);
          setBackendURL(baseUrl);
          setStartupContractVersion(1);
          setStartupLicenseState("active");
          setStartupLicenseCode("ELECTRON_DEV");
          setIsReady(true);
        }
      };
      void checkImmediately();

      return () => {
        received = true;
      };
    }

    // Browser runtime: use Vite proxy (same origin)
    if (!isTauriRuntime()) {
      const baseUrl = window.location.origin;
      setBackendURLState(baseUrl);
      setBackendURL(baseUrl);

      const bootstrapWeb = async () => {
        try {
          const response = await fetch(`${baseUrl}/api`);
          if (!response.ok) {
            throw new Error(
              `Failed to bootstrap backend metadata: HTTP ${response.status}`,
            );
          }

          const payload = (await response.json()) as {
            startupContractVersion?: number;
            startupLicenseState?: "active" | "grace" | "restricted" | "blocked";
            startupLicenseCode?: string;
            loadedModules?: string[];
          };

          setStartupContractVersion(payload.startupContractVersion ?? 1);
          setStartupLicenseState(payload.startupLicenseState ?? "active");
          setStartupLicenseCode(payload.startupLicenseCode ?? "WEB_MODE");
          setLoadedModules(
            Array.isArray(payload.loadedModules) ? payload.loadedModules : [],
          );
          setIsReady(true);
        } catch (error) {
          console.error(
            "[BackendURL] Failed to bootstrap browser backend URL:",
            error,
          );
          setIsReady(false);
        }
      };

      void bootstrapWeb();
      return;
    }

    // Tauri runtime: listen for backend-ready event from Rust
    let eventReceived = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const setupListener = async () => {
      const eventApi = await import("@tauri-apps/api/event");
      const tauriBindings = await import("@shared/generated/tauri-bindings");

      const unlisten = await eventApi.listen<BackendReadyPayload>(
        "backend-ready",
        (event) => {
          if (cancelled) return;
          console.log(
            "[BackendURL] Received backend-ready event:",
            event.payload,
          );
          eventReceived = true;
          setBackendURLState(event.payload.url);
          setBackendURL(event.payload.url); // Update SDK mutator
          setStartupContractVersion(event.payload.startupContractVersion);
          setStartupLicenseState(event.payload.startupLicenseState);
          setStartupLicenseCode(event.payload.startupLicenseCode);
          setIsReady(true);
        },
      );

      // Fallback: If event not received within 2 seconds, query via Tauri command
      timeoutId = setTimeout(async () => {
        if (!eventReceived && !cancelled) {
          console.warn(
            "[BackendURL] Event not received after 2s, querying via Tauri command...",
          );
          try {
            const result = await tauriBindings.commands.bridgeInvoke({
              namespace: "bun",
              command: "getBackendUrl",
              payload: {},
            });

            const maybeResult = result as {
              status?: string;
              result?: {
                url?: string;
                startupContractVersion?: number;
                startupLicenseState?:
                  | "active"
                  | "grace"
                  | "restricted"
                  | "blocked";
                startupLicenseCode?: string;
              };
              data?: {
                status?: string;
                result?: {
                  url?: string;
                  startupContractVersion?: number;
                  startupLicenseState?:
                    | "active"
                    | "grace"
                    | "restricted"
                    | "blocked";
                  startupLicenseCode?: string;
                };
              };
            };

            const payload = maybeResult.result ?? maybeResult.data?.result;
            if (!cancelled && maybeResult.status === "ok" && payload?.url) {
              const url = payload.url;
              console.log("[BackendURL] Retrieved via command:", url);
              setBackendURLState(url);
              setBackendURL(url);
              setStartupContractVersion(payload.startupContractVersion ?? 1);
              setStartupLicenseState(payload.startupLicenseState ?? "active");
              setStartupLicenseCode(
                payload.startupLicenseCode ?? "DEV_MODE_BYPASS",
              );
              setIsReady(true);
            } else if (!cancelled) {
              console.error("[BackendURL] Bridge returned error:", result);
              setIsReady(false);
              setBackendURLState(null);
            }
          } catch (error) {
            if (!cancelled) {
              console.error("[BackendURL] Failed to get backend URL:", error);
              console.error(
                "[BackendURL] Backend is not available. Please check if Bun sidecar is running.",
              );
              setIsReady(false);
              setBackendURLState(null);
            }
          }
        }
      }, 2000); // Increased to 2000ms for slower systems

      return unlisten;
    };

    const unlistenPromise = setupListener();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!backendURL || !isReady) return;

    const refreshLoadedModules = async () => {
      try {
        const response = await fetch(`${backendURL}/api`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          loadedModules?: string[];
        };
        setLoadedModules(
          Array.isArray(payload.loadedModules) ? payload.loadedModules : [],
        );
      } catch {
        // no-op
      }
    };

    void refreshLoadedModules();
  }, [backendURL, isReady]);

  return (
    <BackendURLContext.Provider
      value={{
        backendURL,
        isReady,
        startupContractVersion,
        startupLicenseState,
        startupLicenseCode,
        loadedModules,
      }}
    >
      {children}
    </BackendURLContext.Provider>
  );
};

export const useBackendURL = () => {
  const context = useContext(BackendURLContext);
  if (!context) {
    throw new Error("useBackendURL must be used within BackendURLProvider");
  }
  return context;
};
