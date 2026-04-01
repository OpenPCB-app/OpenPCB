/**
 * useDrafts Hook
 *
 * Fetches and manages component drafts from the backend.
 */

import { useState, useEffect, useCallback } from "react";
import {
  listWorkspaceComponentRecords,
  type ComponentWorkspaceRecord,
} from "@/lib/api/component-api";

export interface UseDraftsReturn {
  drafts: ComponentWorkspaceRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDrafts(): UseDraftsReturn {
  const [drafts, setDrafts] = useState<ComponentWorkspaceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const results = await listWorkspaceComponentRecords();
      setDrafts(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch drafts";
      setError(message);
      console.error("Failed to fetch drafts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  return {
    drafts,
    loading,
    error,
    refetch: fetchDrafts,
  };
}
