import { useState, useCallback } from "react";
import { useBackendURL } from "@/contexts/BackendURLContext";
import type {
  AlternateBranchesResponse,
  ActivateBranchResponse,
  ArchiveBranchResponse,
  CreateBranchInput,
  CreateBranchResponse,
} from "@shared/types/branch.types";

export interface UseBranchesReturn {
  loading: boolean;
  error: string | null;
  getAlternateBranches: (
    messageId: string,
  ) => Promise<AlternateBranchesResponse>;
  activateBranch: (messageId: string) => Promise<ActivateBranchResponse>;
  archiveBranch: (messageId: string) => Promise<ArchiveBranchResponse>;
  createBranch: (
    parentMessageId: string,
    input: CreateBranchInput,
  ) => Promise<CreateBranchResponse>;
}

export function useBranches(): UseBranchesReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { backendURL, isReady } = useBackendURL();

  const getAlternateBranches = useCallback(
    async (messageId: string): Promise<AlternateBranchesResponse> => {
      if (!isReady || !backendURL) throw new Error("Backend not ready");

      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `${backendURL}/api/messages/${messageId}/branches`,
        );

        if (!res.ok) {
          throw new Error("Failed to fetch branches");
        }

        const json = await res.json();
        return json.data || json;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch branches";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [backendURL, isReady],
  );

  const activateBranch = useCallback(
    async (messageId: string): Promise<ActivateBranchResponse> => {
      if (!isReady || !backendURL) throw new Error("Backend not ready");

      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `${backendURL}/api/messages/${messageId}/activate`,
          {
            method: "POST",
          },
        );

        if (!res.ok) {
          throw new Error("Failed to activate branch");
        }

        const json = await res.json();
        return json.data || json;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to activate branch";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [backendURL, isReady],
  );

  const archiveBranch = useCallback(
    async (messageId: string): Promise<ArchiveBranchResponse> => {
      if (!isReady || !backendURL) throw new Error("Backend not ready");

      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `${backendURL}/api/messages/${messageId}/archive`,
          {
            method: "POST",
          },
        );

        if (!res.ok) {
          throw new Error("Failed to archive branch");
        }

        const json = await res.json();
        return json.data || json;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to archive branch";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [backendURL, isReady],
  );

  const createBranch = useCallback(
    async (
      parentMessageId: string,
      input: CreateBranchInput,
    ): Promise<CreateBranchResponse> => {
      if (!isReady || !backendURL) throw new Error("Backend not ready");

      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `${backendURL}/api/messages/${parentMessageId}/branch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );

        if (!res.ok) {
          throw new Error("Failed to create branch");
        }

        const json = await res.json();
        return json.data || json;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create branch";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [backendURL, isReady],
  );

  return {
    loading,
    error,
    getAlternateBranches,
    activateBranch,
    archiveBranch,
    createBranch,
  };
}
