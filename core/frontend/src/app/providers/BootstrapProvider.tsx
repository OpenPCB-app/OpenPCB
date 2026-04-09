import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BootstrapState } from "../../../../contracts/app/bootstrap";
import type { ModuleRegistryResponse } from "../../../../contracts/modules/registry";
import { useRuntime } from "./RuntimeProvider";

interface BootstrapContextValue extends BootstrapState {}

const BootstrapContext = createContext<BootstrapContextValue | null>(null);

export function BootstrapProvider({ children }: { children: ReactNode }) {
  const { runtime, backendURL, error: runtimeError } = useRuntime();
  const [state, setState] = useState<BootstrapState>({
    status: "idle",
    runtime: null,
    backendURL: null,
    error: null,
    moduleRegistry: null,
  });

  useEffect(() => {
    if (runtimeError) {
      setState({
        status: "error",
        runtime,
        backendURL,
        error: runtimeError,
        moduleRegistry: null,
      });
      return;
    }

    if (!backendURL) {
      setState((prev) => ({ ...prev, status: "loading", runtime, moduleRegistry: null }));
      return;
    }

    let mounted = true;
    const controller = new AbortController();

    const initialize = async () => {
      setState({
        status: "loading",
        runtime,
        backendURL,
        error: null,
        moduleRegistry: null,
      });

      try {
        const timeout = setTimeout(() => controller.abort(), 5000);
        const [healthResponse, registryResponse] = await Promise.all([
          fetch(`${backendURL}/api/health`, {
            signal: controller.signal,
          }),
          fetch(`${backendURL}/api/modules/registry`, {
            signal: controller.signal,
          }),
        ]);
        clearTimeout(timeout);

        if (!healthResponse.ok) {
          throw new Error(`Backend health check failed: HTTP ${healthResponse.status}`);
        }
        if (!registryResponse.ok) {
          throw new Error(`Module registry bootstrap failed: HTTP ${registryResponse.status}`);
        }

        const moduleRegistry = (await registryResponse.json()) as ModuleRegistryResponse;

        if (mounted) {
          setState({
            status: "ready",
            runtime,
            backendURL,
            error: null,
            moduleRegistry,
          });
        }
      } catch (err) {
        if (mounted) {
          setState({
            status: "error",
            runtime,
            backendURL,
            error: err instanceof Error ? err.message : "Failed to initialize app",
            moduleRegistry: null,
          });
        }
      }
    };

    void initialize();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [runtime, backendURL, runtimeError]);

  const value = useMemo(() => state, [state]);

  return <BootstrapContext.Provider value={value}>{children}</BootstrapContext.Provider>;
}

export function useBootstrap() {
  const context = useContext(BootstrapContext);
  if (!context) {
    throw new Error("useBootstrap must be used within BootstrapProvider");
  }
  return context;
}
