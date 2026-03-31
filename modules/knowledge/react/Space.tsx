import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { PageEditor, type AuthorityMode } from "./components/Editor/PageEditor";
import { PropertiesPanel } from "./components/Properties/PropertiesPanel";
import { PageChatPanel } from "./components/Chat/PageChatPanel";
import { useTreeStore, isDescendant } from "./stores/tree-store";
import { useAppStore } from "@/stores/app-store";
import { useRegisterSidebarButtons } from "@/contexts/SidebarButtonsContext";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  MoreVertical,
  Settings,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { usePage, useKnowledgeApi, usePageTree, useKnowledgePageUpdates } from "./hooks";
import { useToast } from "@/components/ui/use-toast";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { useDebouncedCallback } from "use-debounce";
import type { EditorContent, Page, PageUpdateEvent } from "../shared/types";
import type { EditAppliedEvent, EditLifecycleEvent } from "./hooks/usePageChat";

// Storage keys
const PANEL_STATE_KEY = "knowledge:panel:state";
const PANEL_WIDTH_KEY = "knowledge:panel:width";

// Panel state type
type PanelState = "none" | "properties" | "chat";

// Default panel width in pixels
const DEFAULT_PANEL_WIDTH = 320;

export function Space() {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [draftPageContent, setDraftPageContent] = useState<{
    pageId: string;
    content: EditorContent;
  } | null>(null);
  const selectedPageAuthorityModeRef = useRef<AuthorityMode>("idle");
  const deferredPageUpdateRef = useRef<PageUpdateEvent | null>(null);
  const deferredReconnectRefreshRef = useRef(false);
  const recentRequestIdsRef = useRef<Set<string>>(new Set());
  const [aiEditCountsByPage, setAiEditCountsByPage] = useState<Map<string, number>>(
    () => new Map(),
  );
  const tree = useTreeStore((state) => state.tree);
  const requestRefresh = useTreeStore((state) => state.requestRefresh);
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const { setRightTopButtons, clearButtons } = useRegisterSidebarButtons();
  const {
    page,
    isLoading: isPageLoading,
    error: pageError,
    refresh: refreshPage,
    setPage,
  } = usePage(selectedPageId);
  const pageForChat = useMemo(() => {
    if (!page) return null;
    if (page.id !== selectedPageId) return null;
    if (draftPageContent?.pageId !== page.id) return page;
    return {
      ...page,
      content_json: draftPageContent.content,
    };
  }, [page, draftPageContent, selectedPageId]);
  const api = useKnowledgeApi();
  const { refresh: refreshTree } = usePageTree();
  const { toast } = useToast();

  const handlePageUpdate = useCallback(
    (event: PageUpdateEvent) => {
      if (!selectedPageId) return;
      if (event.pageId !== selectedPageId) return;

      if (event.requestId && recentRequestIdsRef.current.has(event.requestId)) {
        recentRequestIdsRef.current.delete(event.requestId);
        return;
      }

      const authorityMode = selectedPageAuthorityModeRef.current;
      if (authorityMode === "idle") {
        void refreshPage();
        return;
      }

      if (authorityMode === "manual" || authorityMode === "ai") {
        deferredPageUpdateRef.current = event;
      }
    },
    [refreshPage, selectedPageId],
  );

  const handleReconnectAfterOutage = useCallback(() => {
    if (!selectedPageId) {
      return;
    }

    if (selectedPageAuthorityModeRef.current === "idle") {
      deferredReconnectRefreshRef.current = false;
      void refreshPage();
      return;
    }

    deferredReconnectRefreshRef.current = true;
  }, [selectedPageId, refreshPage]);

  useKnowledgePageUpdates(
    activeWorkspaceId,
    handlePageUpdate,
    handleReconnectAfterOutage,
  );

  // Panel state: which panel is active (none, properties, or chat)
  const [panelState, setPanelState] = useState<PanelState>(() => {
    const saved = localStorage.getItem(PANEL_STATE_KEY);
    if (saved === "properties" || saved === "chat" || saved === "none") {
      return saved;
    }
    return "none";
  });

  // Panel width (persisted)
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem(PANEL_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_PANEL_WIDTH;
  });

  // Debounced width persistence
  const debouncedSaveWidth = useDebouncedCallback((w: number) => {
    localStorage.setItem(PANEL_WIDTH_KEY, w.toString());
  }, 300);

  // Persist panel state
  useEffect(() => {
    localStorage.setItem(PANEL_STATE_KEY, panelState);
  }, [panelState]);

  // Toggle handlers
  const toggleProperties = useCallback(() => {
    setPanelState((prev) => (prev === "properties" ? "none" : "properties"));
  }, []);

  const toggleChat = useCallback(() => {
    setPanelState((prev) => (prev === "chat" ? "none" : "chat"));
  }, []);

  const closePanel = useCallback(() => {
    setPanelState("none");
  }, []);

  const handleDraftContentChange = useCallback(
    (pageId: string, content: EditorContent | null) => {
      if (!content) {
        setDraftPageContent((prev) =>
          prev?.pageId === pageId ? null : prev,
        );
        return;
      }
      setDraftPageContent({ pageId, content });
    },
    [],
  );

  useEffect(() => {
    setDraftPageContent((prev) =>
      prev && prev.pageId === selectedPageId ? prev : null,
    );
    deferredPageUpdateRef.current = null;
    deferredReconnectRefreshRef.current = false;
    selectedPageAuthorityModeRef.current = "idle";
  }, [selectedPageId]);

  useEffect(() => {
    setSelectedPageId(null);
    setDraftPageContent(null);
    setAiEditCountsByPage(new Map());
    deferredPageUpdateRef.current = null;
    deferredReconnectRefreshRef.current = false;
    selectedPageAuthorityModeRef.current = "idle";
    setPanelState("none");
    setPage(null);
  }, [activeWorkspaceId, setPage]);

  const handleAuthorityModeChange = useCallback(
    (mode: AuthorityMode) => {
      const previousMode = selectedPageAuthorityModeRef.current;
      selectedPageAuthorityModeRef.current = mode;
      if (mode !== "idle" || previousMode === "idle") {
        return;
      }

      const deferred = deferredPageUpdateRef.current;
      const reconnectRefreshPending = deferredReconnectRefreshRef.current;
      if (!deferred && !reconnectRefreshPending) {
        return;
      }

      deferredPageUpdateRef.current = null;
      deferredReconnectRefreshRef.current = false;

      if (!selectedPageId) {
        return;
      }

      if (!deferred || deferred.pageId === selectedPageId) {
        void refreshPage();
      }
    },
    [refreshPage, selectedPageId],
  );

  const handleSaveRequestId = useCallback((requestId: string) => {
    const recentRequestIds = recentRequestIdsRef.current;
    if (recentRequestIds.has(requestId)) {
      recentRequestIds.delete(requestId);
    }
    recentRequestIds.add(requestId);
    while (recentRequestIds.size > 50) {
      const oldestRequestId = recentRequestIds.values().next().value;
      if (!oldestRequestId) break;
      recentRequestIds.delete(oldestRequestId);
    }
  }, []);

  const isPageAiLocked = useCallback(
    (pageId: string | null | undefined): boolean => {
      if (!pageId) return false;
      return (aiEditCountsByPage.get(pageId) ?? 0) > 0;
    },
    [aiEditCountsByPage],
  );

  const lockedPageIds = useMemo(
    () =>
      new Set(
        Array.from(aiEditCountsByPage.entries())
          .filter(([, count]) => count > 0)
          .map(([pageId]) => pageId),
      ),
    [aiEditCountsByPage],
  );
  const selectedPageLocked = isPageAiLocked(selectedPageId);

  const handleChatEditLifecycleEvent = useCallback((event: EditLifecycleEvent) => {
    setAiEditCountsByPage((prev) => {
      const next = new Map(prev);
      const currentCount = next.get(event.documentId) ?? 0;
      if (event.status === "started") {
        next.set(event.documentId, currentCount + 1);
        return next;
      }

      const decremented = Math.max(0, currentCount - 1);
      if (decremented === 0) {
        next.delete(event.documentId);
      } else {
        next.set(event.documentId, decremented);
      }
      return next;
    });
  }, []);

  const handleChatEditApplied = useCallback(
    (event: EditAppliedEvent) => {
      setDraftPageContent((prev) =>
        prev?.pageId === event.documentId ? null : prev,
      );
      if (selectedPageId === event.documentId) {
        void refreshPage();
      }
    },
    [refreshPage, selectedPageId],
  );

  const handleCanonicalPageChange = useCallback(
    (updatedPage: Page) => {
      if (!selectedPageId || updatedPage.id !== selectedPageId) return;
      setPage(updatedPage);
    },
    [selectedPageId, setPage],
  );

  // Handle page deletion - clear selection if deleted page is selected
  const handlePageDeleted = useCallback(
    (deletedPageId: string) => {
      if (!selectedPageId) return;
      if (
        selectedPageId === deletedPageId ||
        isDescendant(tree, deletedPageId, selectedPageId)
      ) {
        setSelectedPageId(null);
        setPage(null);
      }
    },
    [selectedPageId, setPage, tree],
  );

  const handleDeletePage = useCallback(async () => {
    if (!selectedPageId || !page) return;
    if (page.is_project_root) {
      toast({
        variant: "destructive",
        title: "Delete blocked",
        description: "Project root pages cannot be deleted.",
      });
      return;
    }
    if (!window.confirm("Are you sure you want to delete this page?")) {
      return;
    }
    try {
      const deletedPageId = selectedPageId;
      const deletedPageTitle = page.title;
      await api.deletePage(deletedPageId);
      handlePageDeleted(deletedPageId);
      await refreshTree();
      toast({
        title: "Page deleted",
        description: `"${deletedPageTitle}" has been deleted`,
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void (async () => {
                try {
                  await api.restorePage(deletedPageId);
                  requestRefresh();
                  toast({
                    title: "Page restored",
                    description: `"${deletedPageTitle}" has been restored`,
                  });
                } catch (err) {
                  console.error("Failed to restore page:", err);
                  toast({
                    variant: "destructive",
                    title: "Restore failed",
                    description: err instanceof Error ? err.message : "Unknown error",
                  });
                }
              })();
            }}
          >
            Undo
          </Button>
        ),
      });
    } catch (err) {
      console.error("Failed to delete page:", err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: errorMessage,
      });
    }
  }, [selectedPageId, page, api, handlePageDeleted, refreshTree, toast, requestRefresh]);

  // Register sidebar buttons
  useEffect(() => {
    if (!selectedPageId || !page) {
      clearButtons();
      return;
    }

    const buttons = [
      <Tooltip key="properties-toggle">
        <TooltipTrigger asChild>
          <Button
            variant={panelState === "properties" ? "default" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={toggleProperties}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Properties</TooltipContent>
      </Tooltip>,
      <Tooltip key="chat-toggle">
        <TooltipTrigger asChild>
          <Button
            variant={panelState === "chat" ? "default" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={toggleChat}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Chat</TooltipContent>
      </Tooltip>,
      <DropdownMenu key="page-menu">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {!page.is_project_root && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={handleDeletePage}
              disabled={selectedPageLocked}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Page
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>,
    ];

    setRightTopButtons(buttons);

    return () => clearButtons();
  }, [
    selectedPageId,
    page,
    panelState,
    toggleProperties,
    toggleChat,
    handleDeletePage,
    selectedPageLocked,
    setRightTopButtons,
    clearButtons,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+. to toggle between panels
      if (e.metaKey && e.key === ".") {
        e.preventDefault();
        setPanelState((prev) => {
          if (prev === "none") return "properties";
          if (prev === "properties") return "chat";
          return "none";
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const panelWidthPercent = useMemo(
    () => Math.round((panelWidth / window.innerWidth) * 100),
    [panelWidth],
  );

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="h-full w-full bg-background text-foreground"
    >
      {/* Left Sidebar - Fixed-ish width */}
      <ResizablePanel
        defaultSize={20}
        minSize={15}
        maxSize={30}
        className="h-full"
      >
        <Sidebar
          selectedPageId={selectedPageId}
          onSelectPage={setSelectedPageId}
          onPageDeleted={handlePageDeleted}
          lockedPageIds={lockedPageIds}
        />
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Main Editor */}
      <ResizablePanel defaultSize={50} minSize={30}>
        <ModuleErrorBoundary moduleId="knowledge" componentName="PageEditor">
          <PageEditor
            pageId={selectedPageId}
            page={page}
            isLoading={isPageLoading}
            error={pageError}
            refreshPage={refreshPage}
            onPageChange={handleCanonicalPageChange}
            onPageDeleted={handlePageDeleted}
            workspaceId={activeWorkspaceId}
            onSelectPage={setSelectedPageId}
            onDraftContentChange={handleDraftContentChange}
            isAiLocked={selectedPageLocked}
            onAuthorityModeChange={handleAuthorityModeChange}
            onSaveRequestId={handleSaveRequestId}
          />
        </ModuleErrorBoundary>
      </ResizablePanel>

      {/* Right Panel (Properties or Chat) - Conditional */}
      {panelState !== "none" && selectedPageId && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={panelWidthPercent}
            minSize={15}
            maxSize={40}
            onResize={(size) => {
              const w = Math.round((size / 100) * window.innerWidth);
              setPanelWidth(w);
              debouncedSaveWidth(w);
            }}
            className="h-full border-l border-border"
          >
            {panelState === "properties" && (
              <PropertiesPanel
                pageId={selectedPageId}
                page={page}
                isLoading={isPageLoading}
                error={pageError}
                onPageChange={handleCanonicalPageChange}
                onClose={closePanel}
                isReadOnly={selectedPageLocked}
              />
            )}
            {panelState === "chat" && pageForChat && (
              <PageChatPanel
                pageId={selectedPageId}
                page={pageForChat}
                workspaceId={activeWorkspaceId}
                onClose={closePanel}
                onSelectPage={setSelectedPageId}
                onEditApplied={handleChatEditApplied}
                onEditLifecycleEvent={handleChatEditLifecycleEvent}
                inputDisabled={selectedPageLocked}
              />
            )}
            {panelState === "chat" && !pageForChat && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading page context...
              </div>
            )}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
