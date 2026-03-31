import React, { createContext, useContext, useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/../../src-ts/shared/generated/tauri-bindings";
import { setBackendURL } from "@/../../src-ts/shared/sdk/mutator";

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

export const BackendURLProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [backendURL, setBackendURLState] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [startupContractVersion, setStartupContractVersion] = useState<number | null>(null);
    const [startupLicenseState, setStartupLicenseState] = useState<"active" | "grace" | "restricted" | "blocked" | null>(null);
    const [startupLicenseCode, setStartupLicenseCode] = useState<string | null>(null);

    useEffect(() => {
        let eventReceived = false;

        // Listen for backend-ready event from Rust
        const setupListener = async () => {
            const unlisten = await listen<BackendReadyPayload>("backend-ready", (event) => {
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
            setTimeout(async () => {
                if (!eventReceived) {
                    console.warn("[BackendURL] Event not received after 2s, querying via Tauri command...");
                    try {
                        const result = await commands.bridgeInvoke({
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
                        if (maybeResult.status === "ok" && payload?.url) {
                            const url = payload.url;
                            console.log("[BackendURL] Retrieved via command:", url);
                            setBackendURLState(url);
                            setBackendURL(url);
                            setStartupContractVersion(payload.startupContractVersion ?? 1);
                            setStartupLicenseState(payload.startupLicenseState ?? "active");
                            setStartupLicenseCode(payload.startupLicenseCode ?? "DEV_MODE_BYPASS");
                            setIsReady(true);
                        } else {
                            console.error("[BackendURL] Bridge returned error:", result);
                            setIsReady(false);
                            setBackendURLState(null);
                        }
                    } catch (error) {
                        console.error("[BackendURL] Failed to get backend URL:", error);
                        console.error("[BackendURL] Backend is not available. Please check if Bun sidecar is running.");
                        setIsReady(false);
                        setBackendURLState(null);
                    }
                }
            }, 2000);  // Increased to 2000ms for slower systems

            return unlisten;
        };

        const unlistenPromise = setupListener();

        return () => {
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
