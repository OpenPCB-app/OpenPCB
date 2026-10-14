import { useState, useEffect, useCallback, useMemo } from "react";
import type { ModuleSpaceProps } from "../../../core/contracts/modules/frontend-entry";
import { KnowledgeApiProvider } from "./KnowledgeApiContext";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { PageEditor } from "./components/Editor/PageEditor";
import { usePage, useKnowledgeApi, useKnowledgePageUpdates } from "./hooks";
import { getPageSaveCoordinator } from "./lib/page-save-coordinator";
import { useTreeStore } from "./stores/tree-store";
import type { PageUpdateEvent } from "../shared/types";

const DEFAULT_WORKSPACE = "default";

function KnowledgeSpaceInner({
  backendURL,
  moduleId,
  designId,
}: ModuleSpaceProps) {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const api = useKnowledgeApi();
  const coordinator = useMemo(() => getPageSaveCoordinator(api), [api]);

  const {
    page,
    isLoading: isPageLoading,
    error: pageError,
    refresh: refreshPage,
    setPage,
  } = usePage(selectedPageId);

  const requestRefresh = useTreeStore((state) => state.requestRefresh);

  const handlePageUpdate = useCallback(
    (event: PageUpdateEvent) => {
      if (!selectedPageId) return;
      if (event.pageId !== selectedPageId) return;

      if (coordinator.isOwnRequest(event.requestId)) return;
      const dirty = coordinator.isDirty(selectedPageId);
      coordinator.remoteChanged(selectedPageId);
      if (!dirty) void refreshPage();
    },
    [coordinator, refreshPage, selectedPageId],
  );

  const handleReconnectAfterOutage = useCallback(() => {
    if (!selectedPageId) return;
    if (coordinator.isDirty(selectedPageId)) {
      void coordinator.verifyAfterReconnect(selectedPageId);
      return;
    }
    coordinator.remoteChanged(selectedPageId);
    void refreshPage();
  }, [coordinator, refreshPage, selectedPageId]);

  useKnowledgePageUpdates(
    backendURL,
    moduleId,
    handlePageUpdate,
    handleReconnectAfterOutage,
  );

  useEffect(() => {
    setSelectedPageId(null);
    setPage(null);
  }, [designId, setPage]);

  const handlePageDeleted = useCallback(
    (deletedPageId: string) => {
      if (!selectedPageId) return;
      if (deletedPageId === selectedPageId) {
        setSelectedPageId(null);
        setPage(null);
      }
    },
    [selectedPageId, setPage],
  );

  return (
    <div className="flex h-full w-full bg-surface-app text-text-primary">
      <div className="w-[260px] flex-shrink-0 border-r border-slate-200 bg-surface-app dark:border-slate-800">
        <Sidebar
          selectedPageId={selectedPageId}
          onSelectPage={setSelectedPageId}
          onPageDeleted={handlePageDeleted}
          designId={designId}
        />
      </div>
      <div className="min-w-0 flex-1 bg-surface-card">
        <PageEditor
          pageId={selectedPageId}
          page={page}
          isLoading={isPageLoading}
          error={pageError}
          refreshPage={refreshPage}
          onPageChange={setPage}
          onPageDeleted={handlePageDeleted}
          workspaceId={DEFAULT_WORKSPACE}
          designId={designId}
          onSelectPage={setSelectedPageId}
          onRefreshTree={requestRefresh}
        />
      </div>
    </div>
  );
}

export function KnowledgeSpace(props: ModuleSpaceProps) {
  return (
    <KnowledgeApiProvider
      backendURL={props.backendURL}
      moduleId={props.moduleId}
    >
      <KnowledgeSpaceInner {...props} />
    </KnowledgeApiProvider>
  );
}
