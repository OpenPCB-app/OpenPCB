import { useState, useEffect, useCallback } from "react";
import { listFiles } from "@/lib/api/file-api";
import type {
  FileReferenceWithChat,
  FileTypeFilter,
} from "@shared/types/file.types";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";

export interface UseFilesReturn {
  files: FileReferenceWithChat[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useFiles(options?: {
  type?: FileTypeFilter;
  limit?: number;
}): UseFilesReturn {
  const [files, setFiles] = useState<FileReferenceWithChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isReady } = useBackendURL();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const fetchFiles = useCallback(async () => {
    if (!isReady || !activeWorkspaceId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await listFiles(activeWorkspaceId, options);
      setFiles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
      console.error("Error fetching files:", err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, isReady, options?.type, options?.limit]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  return {
    files,
    loading,
    error,
    refetch: fetchFiles,
  };
}
