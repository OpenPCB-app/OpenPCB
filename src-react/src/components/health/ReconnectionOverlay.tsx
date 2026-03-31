import { useState, useRef, useEffect } from "react";
import { useHealthCheck } from "@/hooks/useHealthCheck";
import { Button } from "@/components/ui/button";
import { commands } from "@/../../src-ts/shared/generated/tauri-bindings";
import { AlertTriangle, RefreshCw, Power } from "lucide-react";

export function ReconnectionOverlay() {
  const { status, failureCount, checkNow } = useHealthCheck();
  const [isRestarting, setIsRestarting] = useState(false);
  const isMountedRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (status !== "disconnected" || failureCount < 3) {
    return null;
  }

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      await commands.bridgeInvoke({
        namespace: "bun",
        command: "restart",
        payload: {},
      });
      timeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          checkNow();
          setIsRestarting(false);
        }
      }, 3000);
    } catch (error) {
      console.error("Failed to restart backend:", error);
      if (isMountedRef.current) {
        setIsRestarting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-lg border bg-card p-8 shadow-lg text-card-foreground">
        <div className="rounded-full bg-destructive/10 p-4">
          <AlertTriangle className="h-10 w-10 text-destructive" />
        </div>

        <div className="text-center">
          <h2 className="text-xl font-semibold">Connection Lost</h2>
          <p className="mt-2 text-muted-foreground">
            Unable to communicate with the OpenPCB backend.
            <br />
            Retrying connection... (Attempt {failureCount})
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full sm:flex-row sm:justify-center">
          <Button
            variant="outline"
            onClick={() => checkNow()}
            className="w-full sm:w-auto gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Retry Now
          </Button>

          {failureCount >= 5 && (
            <Button
              variant="destructive"
              onClick={handleRestart}
              disabled={isRestarting}
              className="w-full sm:w-auto gap-2"
            >
              <Power className="h-4 w-4" />
              {isRestarting ? "Restarting..." : "Restart Backend"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
