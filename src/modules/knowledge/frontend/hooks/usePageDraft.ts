import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { Page } from "../../shared/types";
import { useKnowledgeApi } from "../KnowledgeApiContext";
import { getPageSaveCoordinator } from "../lib/page-save-coordinator";

export function usePageDraft(page: Page | null) {
  const api = useKnowledgeApi();
  const coordinator = useMemo(() => getPageSaveCoordinator(api), [api]);
  const id = page?.id ?? null;
  useEffect(() => {
    if (page && !coordinator.snapshot(page.id))
      void coordinator.prepareRemote(page);
  }, [coordinator, page]);
  const subscribe = useCallback(
    (listener: () => void) => coordinator.subscribePage(id, listener),
    [coordinator, id],
  );
  const draft = useSyncExternalStore(
    subscribe,
    () => coordinator.snapshot(id),
    () => null,
  );
  return { draft, coordinator };
}
