import { useCallback, useEffect, useMemo, useState } from "react";
import { customFetch } from "@shared/sdk/mutator";
import { useBackendURL } from "@/contexts/BackendURLContext";
import type { FileRecord } from "@shared/types/file.types";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || "API request failed");
  }
  return response.data;
}

export interface UseMediaFilesReturn {
  files: FileRecord[];
  imageFiles: FileRecord[];
  documentFiles: FileRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMediaFiles(chatId: string | undefined): UseMediaFilesReturn {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isReady } = useBackendURL();

  const fetchFiles = useCallback(async () => {
    if (!isReady || !chatId) {
      setFiles([]);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ chatId });
      const response = await customFetch<ApiResponse<{ files: FileRecord[] }>>(
        `/api/files?${params.toString()}`,
      );

      setFiles(unwrapResponse(response).files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load media files");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [chatId, isReady]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const imageFiles = useMemo(
    () => files.filter((file) => file.mimeType.startsWith("image/")),
    [files],
  );

  const documentFiles = useMemo(
    () => files.filter((file) => !file.mimeType.startsWith("image/")),
    [files],
  );

  const refetch = useCallback(async () => {
    await fetchFiles();
  }, [fetchFiles]);

  return {
    files,
    imageFiles,
    documentFiles,
    loading,
    error,
    refetch,
  };
}
