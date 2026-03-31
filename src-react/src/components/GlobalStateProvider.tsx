import React, { useEffect } from "react";
import { useAppStore } from "../stores/app-store";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { WorkspaceCreateDialog } from "./workspace/WorkspaceCreateDialog";

interface GlobalStateProviderProps {
  children: React.ReactNode;
}

export function GlobalStateProvider({ children }: GlobalStateProviderProps) {
  const { isReady, backendURL } = useBackendURL();
  const { isInitialized, fetchInitialState, isLoading, error, workspaces } =
    useAppStore();

  useEffect(() => {
    if (!isInitialized && isReady) {
      fetchInitialState();
    }
  }, [isInitialized, isReady, fetchInitialState]);

  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Connecting to backend...
          </p>
          <p className="text-xs text-muted-foreground/70">
            {backendURL || "Waiting for port..."}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading && !isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading OpenPCB...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-background text-destructive">
        <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
          <h2 className="text-xl font-bold">Failed to load application</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {isInitialized && workspaces.length === 0 && (
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={() => {}}
          mandatory={true}
        />
      )}
    </>
  );
}
