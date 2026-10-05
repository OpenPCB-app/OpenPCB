import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { Page } from "../../shared/types";
import { useKnowledgeApi } from "../KnowledgeApiContext";
import { getPageSaveCoordinator } from "../lib/page-save-coordinator";

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
  const coordinator = useMemo(() => getPageSaveCoordinator(api), [api]);
  const subscribe = useCallback(
    (listener: () => void) => coordinator.subscribePage(pageId, listener),
    [coordinator, pageId],
  );
  const draft = useSyncExternalStore(
    subscribe,
    () => coordinator.snapshot(pageId),
    () => null,
  );
  const currentPageIdRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const setPage = useCallback((nextPage: Page | null) => {
    ++requestSeqRef.current;
    abortControllerRef.current?.abort();
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

    const observedVersion = coordinator.version(pageId);
    setIsLoading(true);
    setError(null);
    try {
      const loadedPage = await api.getPage(pageId, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        currentPageIdRef.current !== pageId ||
        requestSeqRef.current !== currentRequestSeq
      )
        return;
      const accepted = loadedPage
        ? await coordinator.prepareRemote(loadedPage, observedVersion)
        : true;
      if (
        !controller.signal.aborted &&
        currentPageIdRef.current === pageId &&
        requestSeqRef.current === currentRequestSeq
      ) {
        if (accepted) {
          setPageState(loadedPage);
        }
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
  }, [pageId, api, coordinator]);

  useEffect(() => {
    currentPageIdRef.current = pageId;
    void refresh();
  }, [pageId, refresh]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    page: draft?.page ?? (page?.id === pageId ? page : null),
    isLoading,
    error,
    refresh,
    setPage,
    mutatePage,
  };
}
