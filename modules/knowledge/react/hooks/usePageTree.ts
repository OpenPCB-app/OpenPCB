import { useEffect, useCallback, useRef } from "react";
import type { PageTreeNode } from "../../shared/types";
import { useKnowledgeApi } from "./useKnowledgeApi";
import { useTreeStore } from "../stores/tree-store";
import { useAppStore } from "@/stores/app-store";

interface UsePageTreeResult {
  tree: PageTreeNode[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePageTree(workspaceId?: string | null): UsePageTreeResult {
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const resolvedWorkspaceId = workspaceId ?? activeWorkspaceId ?? null;
  const {
    tree,
    setTree,
    setWorkspaceId,
    isLoading,
    setIsLoading,
    error,
    setError,
    refreshToken,
  } = useTreeStore();
  const api = useKnowledgeApi();

  const refresh = useCallback(async () => {
    if (!resolvedWorkspaceId) {
      setTree([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const pages = await api.getWorkspaceTree(resolvedWorkspaceId);
      setTree(pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pages");
    } finally {
      setIsLoading(false);
    }
  }, [resolvedWorkspaceId, api, setTree, setIsLoading, setError]);

  useEffect(() => {
    if (refreshToken > 0) {
      void refresh();
    }
  }, [refreshToken, refresh]);

  useEffect(() => {
    setWorkspaceId(resolvedWorkspaceId);
  }, [resolvedWorkspaceId, setWorkspaceId]);

  // Track if we've done initial fetch for this workspace
  const hasFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!resolvedWorkspaceId) return;

    // Fetch on mount or when workspace changes
    // Use ref to track if we've already fetched for this workspace
    if (hasFetchedRef.current !== resolvedWorkspaceId && !isLoading) {
      hasFetchedRef.current = resolvedWorkspaceId;
      void refresh();
    }
  }, [refresh, isLoading, resolvedWorkspaceId]);

  return { tree, isLoading, error, refresh };
}
