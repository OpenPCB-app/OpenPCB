import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppRuntime } from "../../../contracts/app/runtime";
import { detectRuntime } from "../bootstrap/detect-runtime";
import {
  listenForElectronBackendReady,
  resolveBackendURL,
} from "../bootstrap/resolve-backend-url";

interface RuntimeContextValue {
  runtime: AppRuntime;
  backendURL: string | null;
  error: string | null;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime] = useState<AppRuntime>(detectRuntime);
  const [backendURL, setBackendURL] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const url = await resolveBackendURL(runtime);
        if (mounted) {
          setBackendURL(url);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to resolve backend URL",
          );
        }
      }
    };

    void bootstrap();

    if (runtime === "electron") {
      listenForElectronBackendReady((payload) => {
        if (mounted) {
          setBackendURL(payload.url);
          setError(null);
        }
      });
    }

    return () => {
      mounted = false;
    };
  }, [runtime]);

  const value = useMemo(
    () => ({ runtime, backendURL, error }),
    [runtime, backendURL, error],
  );

  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}

export function useRuntime() {
  const context = useContext(RuntimeContext);
  if (!context) {
    throw new Error("useRuntime must be used within RuntimeProvider");
  }
  return context;
}
