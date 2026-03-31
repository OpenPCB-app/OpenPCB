import { useState, useEffect, useCallback, useRef } from "react";
import { useBackendURL } from "@/contexts/BackendURLContext";

export type ConnectionStatus = "connected" | "checking" | "disconnected";

export interface HealthCheckState {
  status: ConnectionStatus;
  failureCount: number;
  lastChecked: number | null;
  checkNow: () => Promise<void>;
}

export const useHealthCheck = (): HealthCheckState => {
  const { backendURL, isReady } = useBackendURL();
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [failureCount, setFailureCount] = useState(0);
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const statusRef = useRef<ConnectionStatus>(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const checkHealth = useCallback(async () => {
    if (!backendURL) {
      if (mountedRef.current) {
        setStatus("disconnected");
      }
      return;
    }

    if (mountedRef.current) {
      setStatus("checking");
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${backendURL}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const json = await response.json();
        if (json.ok && json.data?.status === "ok") {
          if (mountedRef.current) {
            setStatus("connected");
            setFailureCount(0);
            setLastChecked(Date.now());
          }
        } else {
          throw new Error("Invalid health response");
        }
      } else {
        throw new Error(`Health check failed: ${response.status}`);
      }
    } catch (error) {
      console.warn("[HealthCheck] Failed:", error);
      if (mountedRef.current) {
        setStatus("disconnected");
        setFailureCount((prev) => prev + 1);
      }
    }
  }, [backendURL]);

  useEffect(() => {
    if (!isReady || !backendURL) return;

    const scheduleNext = () => {
      const interval = statusRef.current === "disconnected" ? 2000 : 10000;
      timerRef.current = setTimeout(async () => {
        await checkHealth();
        if (mountedRef.current) {
          scheduleNext();
        }
      }, interval);
    };

    checkHealth().then(() => {
      if (mountedRef.current) {
        scheduleNext();
      }
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [backendURL, isReady, checkHealth]);

  return {
    status,
    failureCount,
    lastChecked,
    checkNow: checkHealth,
  };
};
