import { useState, useEffect, useCallback } from "react";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";
import type {
  UsageSummaryResponse,
  BudgetStatusResponse,
  CreateUsageBudgetInput,
  UpdateUsageBudgetInput,
  UsageBudgetData,
} from "@shared/types/usage.types";

export function useUsageSummary(
  period: "day" | "week" | "month" | "all" = "month",
) {
  const [summary, setSummary] = useState<UsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { backendURL, isReady } = useBackendURL();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const fetchSummary = useCallback(async () => {
    if (!isReady || !backendURL || !activeWorkspaceId) return;

    try {
      setLoading(true);
      setError(null);

      const url = new URL(`${backendURL}/api/usage/summary`);
      url.searchParams.append("workspaceId", activeWorkspaceId);
      url.searchParams.append("period", period);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch usage summary");

      const json = await res.json();
      setSummary(json.data || json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load usage summary",
      );
      console.error("Error fetching usage summary:", err);
    } finally {
      setLoading(false);
    }
  }, [backendURL, isReady, activeWorkspaceId, period]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return { summary, loading, error, refetch: fetchSummary };
}

export function useBudgetStatus() {
  const [status, setStatus] = useState<BudgetStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { backendURL, isReady } = useBackendURL();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const fetchStatus = useCallback(async () => {
    if (!isReady || !backendURL || !activeWorkspaceId) return;

    try {
      setLoading(true);
      setError(null);

      const url = new URL(`${backendURL}/api/budgets/status`);
      url.searchParams.append("workspaceId", activeWorkspaceId);

      const res = await fetch(url.toString());
      if (res.status === 404) {
        setStatus(null);
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch budget status");

      const json = await res.json();
      setStatus(json.data || json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load budget status",
      );
      console.error("Error fetching budget status:", err);
    } finally {
      setLoading(false);
    }
  }, [backendURL, isReady, activeWorkspaceId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { status, loading, error, refetch: fetchStatus };
}

export function useBudgetMutations() {
  const { backendURL, isReady } = useBackendURL();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const createBudget = async (
    input: Omit<CreateUsageBudgetInput, "workspaceId">,
  ): Promise<UsageBudgetData> => {
    if (!isReady || !backendURL) throw new Error("Backend not ready");
    if (!activeWorkspaceId) throw new Error("No workspace ID");

    const res = await fetch(`${backendURL}/api/budgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, workspaceId: activeWorkspaceId }),
    });

    if (!res.ok) throw new Error("Failed to create budget");
    return res.json();
  };

  const updateBudget = async (
    id: string,
    input: UpdateUsageBudgetInput,
  ): Promise<UsageBudgetData> => {
    if (!isReady || !backendURL) throw new Error("Backend not ready");

    const res = await fetch(`${backendURL}/api/budgets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) throw new Error("Failed to update budget");
    return res.json();
  };

  const deleteBudget = async (id: string): Promise<void> => {
    if (!isReady || !backendURL) throw new Error("Backend not ready");

    const res = await fetch(`${backendURL}/api/budgets/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) throw new Error("Failed to delete budget");
  };

  return { createBudget, updateBudget, deleteBudget };
}
