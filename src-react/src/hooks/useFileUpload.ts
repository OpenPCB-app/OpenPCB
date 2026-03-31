/**
 * File Upload Hooks
 *
 * React hooks for file upload operations with progress tracking.
 */

import { useState, useCallback, useRef } from "react";
import type { FileRecord, FileVersionRecord } from "@shared/types/file.types";
import * as fileClient from "@shared/sdk/file-client";

export interface UseFileUploadOptions {
  workspaceId: string;
  projectId?: string;
  spaceId?: string;
  process?: boolean;
  onSuccess?: (file: FileRecord) => void;
  onError?: (error: Error) => void;
}

export interface FileUploadState {
  isUploading: boolean;
  progress: number;
  error: Error | null;
  file: FileRecord | null;
}

export function useFileUpload(options: UseFileUploadOptions) {
  const [state, setState] = useState<FileUploadState>({
    isUploading: false,
    progress: 0,
    error: null,
    file: null,
  });

  const abortRef = useRef(false);

  const upload = useCallback(
    async (file: File): Promise<FileRecord | null> => {
      abortRef.current = false;
      setState({
        isUploading: true,
        progress: 0,
        error: null,
        file: null,
      });

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("workspaceId", options.workspaceId);

        if (options.projectId) {
          formData.append("projectId", options.projectId);
        }
        if (options.spaceId) {
          formData.append("spaceId", options.spaceId);
        }

        const result = await fileClient.uploadFile(formData);

        if (abortRef.current) {
          return null;
        }

        setState({
          isUploading: false,
          progress: 100,
          error: null,
          file: result,
        });

        options.onSuccess?.(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (!abortRef.current) {
          setState({
            isUploading: false,
            progress: 0,
            error,
            file: null,
          });
          options.onError?.(error);
        }

        return null;
      }
    },
    [options]
  );

  const uploadChunked = useCallback(
    async (file: File): Promise<FileRecord | null> => {
      abortRef.current = false;
      setState({
        isUploading: true,
        progress: 0,
        error: null,
        file: null,
      });

      try {
        const result = await fileClient.uploadFileChunked(
          file,
          {
            workspaceId: options.workspaceId,
            projectId: options.projectId,
            spaceId: options.spaceId,
          },
          {
            onProgress: (progress) => {
              if (!abortRef.current) {
                setState((prev) => ({
                  ...prev,
                  progress: Math.round(progress * 100),
                }));
              }
            },
          }
        );

        if (abortRef.current) {
          return null;
        }

        setState({
          isUploading: false,
          progress: 100,
          error: null,
          file: result,
        });

        options.onSuccess?.(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (!abortRef.current) {
          setState({
            isUploading: false,
            progress: 0,
            error,
            file: null,
          });
          options.onError?.(error);
        }

        return null;
      }
    },
    [options]
  );

  const cancel = useCallback(() => {
    abortRef.current = true;
    setState((prev) => ({
      ...prev,
      isUploading: false,
    }));
  }, []);

  const reset = useCallback(() => {
    setState({
      isUploading: false,
      progress: 0,
      error: null,
      file: null,
    });
  }, []);

  return {
    ...state,
    upload,
    uploadChunked,
    cancel,
    reset,
  };
}

export interface UseFileVersionsOptions {
  onUploadSuccess?: (version: FileVersionRecord) => void;
  onRestoreSuccess?: (file: FileRecord) => void;
  onError?: (error: Error) => void;
}

export function useFileVersions(fileId: string, options?: UseFileVersionsOptions) {
  const [versions, setVersions] = useState<FileVersionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadVersions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await fileClient.listVersions(fileId);
      setVersions(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      options?.onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [fileId, options]);

  const uploadVersion = useCallback(
    async (file: File, comment?: string): Promise<FileVersionRecord | null> => {
      setIsUploading(true);
      setError(null);

      try {
        const result = await fileClient.uploadVersion(fileId, file, { comment });
        setVersions((prev) => [result.version, ...prev]);
        options?.onUploadSuccess?.(result.version);
        return result.version;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options?.onError?.(error);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [fileId, options]
  );

  const restoreVersion = useCallback(
    async (version: number): Promise<FileRecord | null> => {
      setError(null);

      try {
        const result = await fileClient.restoreVersion(fileId, version);
        // Reload versions after restore
        await loadVersions();
        options?.onRestoreSuccess?.(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options?.onError?.(error);
        return null;
      }
    },
    [fileId, loadVersions, options]
  );

  const deleteVersion = useCallback(
    async (version: number): Promise<boolean> => {
      setError(null);

      try {
        await fileClient.deleteVersion(fileId, version);
        setVersions((prev) => prev.filter((v) => v.versionNumber !== version));
        return true;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options?.onError?.(error);
        return false;
      }
    },
    [fileId, options]
  );

  return {
    versions,
    isLoading,
    isUploading,
    error,
    loadVersions,
    uploadVersion,
    restoreVersion,
    deleteVersion,
  };
}
