import { useState, useEffect, useCallback, useRef } from "react";
import type { Page } from "../../shared/types";
import { useKnowledgeApi } from "./useKnowledgeApi";

interface UsePageResult {
  page: Page | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setPage: (page: Page | null) => void;
  mutatePage: (mutator: (current: Page | null) => Page | null) => void;
}

export function usePage(pageId: string | null): UsePageResult {
  const [page, setPageState] = useState<Page | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = useKnowledgeApi();
  const currentPageIdRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const setPage = useCallback((nextPage: Page | null) => {
    setPageState(nextPage);
  }, []);

  const mutatePage = useCallback(
    (mutator: (current: Page | null) => Page | null) => {
      setPageState((current) => mutator(current));
    },
    [],
  );

  const refresh = useCallback(async () => {
    const currentRequestSeq = ++requestSeqRef.current;
    abortControllerRef.current?.abort();

    if (!pageId) {
      setPageState(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);
    try {
      const loadedPage = await api.getPage(pageId, { signal: controller.signal });
      if (
        !controller.signal.aborted &&
        currentPageIdRef.current === pageId &&
        requestSeqRef.current === currentRequestSeq
      ) {
        setPageState(loadedPage);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      if (
        currentPageIdRef.current === pageId &&
        requestSeqRef.current === currentRequestSeq
      ) {
        setError(err instanceof Error ? err.message : "Failed to load page");
      }
    } finally {
      if (
        !controller.signal.aborted &&
        currentPageIdRef.current === pageId &&
        requestSeqRef.current === currentRequestSeq
      ) {
        setIsLoading(false);
      }
    }
  }, [pageId, api]);

  useEffect(() => {
    currentPageIdRef.current = pageId;
    void refresh();
  }, [pageId, refresh]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return { page, isLoading, error, refresh, setPage, mutatePage };
}
