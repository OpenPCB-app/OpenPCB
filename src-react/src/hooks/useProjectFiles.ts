import { useState, useCallback, useEffect, useRef } from "react";
import * as fileClient from "@shared/sdk/file-client";
import type { FileRecord } from "@shared/types/file.types";
import { useBackendURL } from "@/contexts/BackendURLContext";

export interface UseProjectFilesOptions {
  workspaceId: string;
  projectId?: string;
  autoFetch?: boolean;
}

export interface UseProjectFilesReturn {
  files: FileRecord[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
}

export function useProjectFiles({
  workspaceId,
  projectId,
  autoFetch = true,
}: UseProjectFilesOptions): UseProjectFilesReturn {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { isReady } = useBackendURL();
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchFiles = useCallback(async () => {
    if (!workspaceId || !isReady) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const result = await fileClient.listFiles({ workspaceId, projectId });

      if (!controller.signal.aborted) {
        setFiles(result);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }

      if (!controller.signal.aborted) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [workspaceId, projectId, isReady]);

  const deleteFile = useCallback(async (id: string) => {
    try {
      await fileClient.softDeleteFile(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, []);

  useEffect(() => {
    if (autoFetch) {
      fetchFiles();
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchFiles, autoFetch]);

  return {
    files,
    isLoading,
    error,
    refetch: fetchFiles,
    deleteFile,
  };
}
