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
}

const BackendURLContext = createContext<BackendURLContextType>({
    backendURL: null,
    isReady: false,
    startupContractVersion: null,
    startupLicenseState: null,
    startupLicenseCode: null,
});

function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI__" in window;
}

export const BackendURLProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [backendURL, setBackendURLState] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [startupContractVersion, setStartupContractVersion] = useState<number | null>(null);
    const [startupLicenseState, setStartupLicenseState] = useState<"active" | "grace" | "restricted" | "blocked" | null>(null);
    const [startupLicenseCode, setStartupLicenseCode] = useState<string | null>(null);

    useEffect(() => {
        if (!isTauriRuntime()) {
            const baseUrl = window.location.origin;
            setBackendURLState(baseUrl);
            setBackendURL(baseUrl);

            const bootstrapWeb = async () => {
                try {
                    const response = await fetch(`${baseUrl}/api`);
                    if (!response.ok) {
                        throw new Error(`Failed to bootstrap backend metadata: HTTP ${response.status}`);
                    }

                    const payload = await response.json() as {
                        startupContractVersion?: number;
                        startupLicenseState?: "active" | "grace" | "restricted" | "blocked";
                        startupLicenseCode?: string;
                    };

                    setStartupContractVersion(payload.startupContractVersion ?? 1);
                    setStartupLicenseState(payload.startupLicenseState ?? "active");
                    setStartupLicenseCode(payload.startupLicenseCode ?? "WEB_MODE");
                    setIsReady(true);
                } catch (error) {
                    console.error("[BackendURL] Failed to bootstrap browser backend URL:", error);
                    setIsReady(false);
                }
            };

            void bootstrapWeb();
            return;
        }

        let eventReceived = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;

        // Listen for backend-ready event from Rust
        const setupListener = async () => {
            const eventApi = await import("@tauri-apps/api/event");
            const tauriBindings = await import("@shared/generated/tauri-bindings");

            const unlisten = await eventApi.listen<BackendReadyPayload>("backend-ready", (event) => {
                if (cancelled) return;
                console.log("[BackendURL] Received backend-ready event:", event.payload);
                eventReceived = true;
                setBackendURLState(event.payload.url);
                setBackendURL(event.payload.url);  // Update SDK mutator
                setStartupContractVersion(event.payload.startupContractVersion);
                setStartupLicenseState(event.payload.startupLicenseState);
                setStartupLicenseCode(event.payload.startupLicenseCode);
                setIsReady(true);
            });

            // Fallback: If event not received within 2 seconds, query via Tauri command
            timeoutId = setTimeout(async () => {
                if (!eventReceived && !cancelled) {
                    console.warn("[BackendURL] Event not received after 2s, querying via Tauri command...");
                    try {
                        const result = await tauriBindings.commands.bridgeInvoke({
                            namespace: "bun",
                            command: "getBackendUrl",
                            payload: {}
                        });

                        const maybeResult = (result as {
                            status?: string;
                            result?: {
                                url?: string;
                                startupContractVersion?: number;
                                startupLicenseState?: "active" | "grace" | "restricted" | "blocked";
                                startupLicenseCode?: string;
                            };
                            data?: {
                                status?: string;
                                result?: {
                                    url?: string;
                                    startupContractVersion?: number;
                                    startupLicenseState?: "active" | "grace" | "restricted" | "blocked";
                                    startupLicenseCode?: string;
                                };
                            };
                        });

                        const payload = maybeResult.result ?? maybeResult.data?.result;
                        if (!cancelled && maybeResult.status === "ok" && payload?.url) {
                            const url = payload.url;
                            console.log("[BackendURL] Retrieved via command:", url);
                            setBackendURLState(url);
                            setBackendURL(url);
                            setStartupContractVersion(payload.startupContractVersion ?? 1);
                            setStartupLicenseState(payload.startupLicenseState ?? "active");
                            setStartupLicenseCode(payload.startupLicenseCode ?? "DEV_MODE_BYPASS");
                            setIsReady(true);
                        } else if (!cancelled) {
                            console.error("[BackendURL] Bridge returned error:", result);
                            setIsReady(false);
                            setBackendURLState(null);
                        }
                    } catch (error) {
                        if (!cancelled) {
                            console.error("[BackendURL] Failed to get backend URL:", error);
                            console.error("[BackendURL] Backend is not available. Please check if Bun sidecar is running.");
                            setIsReady(false);
                            setBackendURLState(null);
                        }
                    }
                }
            }, 2000);  // Increased to 2000ms for slower systems

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

    return (
        <BackendURLContext.Provider value={{
            backendURL,
            isReady,
            startupContractVersion,
            startupLicenseState,
            startupLicenseCode,
        }}>
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
