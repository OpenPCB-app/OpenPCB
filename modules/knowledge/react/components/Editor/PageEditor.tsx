import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import {
  RefreshCw,
  BookOpen,
  Plus,
  Loader2,
  Check,
  AlertCircle,
  ChevronRight,
  FileText,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import {
  useKnowledgeApi,
  useAutosave,
  usePageTree,
  type SaveStatus,
} from "../../hooks";
import { TiptapEditor } from "./TiptapEditor";
import { FixedToolbar } from "./FixedToolbar";
import { LinkDialog } from "./LinkDialog";
import { AiEditDialog } from "./AiEditDialog";
import type { EditorContent, Page } from "@modules/knowledge/shared/types";
import { useDebouncedCallback } from "use-debounce";
import {
  useContentEditor,
  type ContentSelection,
} from "@/hooks/useContentEditor";
import { getDefaultAISettings } from "@/lib/storage/ai-settings";
import { KnowledgeApiError } from "../../hooks/useKnowledgeApi";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type AuthorityMode = "idle" | "manual" | "ai";

const MANUAL_IDLE_TIMEOUT_MS = 3000;

interface PageEditorProps {
  pageId: string | null;
  page: Page | null;
  isLoading: boolean;
  error: string | null;
  refreshPage: () => Promise<void>;
  onPageChange?: (page: Page) => void;
  onPageDeleted?: (id: string) => void;
  workspaceId?: string | null;
  onSelectPage?: (id: string) => void;
  onDraftContentChange?: (pageId: string, content: EditorContent | null) => void;
  isAiLocked?: boolean;
  onAuthorityModeChange?: (mode: AuthorityMode) => void;
  onSaveRequestId?: (requestId: string) => void;
}

// Helper to find path in tree
const findPathInTree = (
  nodes: import("../../../shared/types").PageTreeNode[],
  targetId: string,
  path: import("../../../shared/types").PageTreeNode[] = [],
): import("../../../shared/types").PageTreeNode[] | null => {
  for (const node of nodes) {
    if (node.id === targetId) {
      return [...path, node];
    }
    if (node.children) {
      const found = findPathInTree(node.children, targetId, [...path, node]);
      if (found) return found;
    }
  }
  return null;
};

const EMOJI_PRESETS = [
  "📄",
  "📝",
  "💡",
  "📚",
  "🎯",
  "🚀",
  "🛠️",
  "📅",
  "✅",
  "📌",
];

function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function getConflictPage(error: KnowledgeApiError): Page | null {
  const payload = error.payload;
  if (!payload || typeof payload !== "object") return null;
  if (!("page" in payload)) return null;
  const page = (payload as { page?: unknown }).page;
  if (!page || typeof page !== "object") return null;
  return page as Page;
}

export function PageEditor({
  pageId,
  page,
  isLoading,
  error,
  refreshPage,
  onPageChange,
  onPageDeleted: _onPageDeleted,
  workspaceId,
  onSelectPage,
  onDraftContentChange,
  isAiLocked = false,
  onAuthorityModeChange,
  onSaveRequestId,
}: PageEditorProps) {
  const { tree, refresh: refreshTree } = usePageTree();
  // Get breadcrumbs
  const breadcrumbs = pageId ? findPathInTree(tree, pageId) : null;
  const api = useKnowledgeApi();
  const { toast } = useToast();
  const [editor, setEditor] = useState<import("@tiptap/react").Editor | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const isDeletingRef = useRef(false);
  const [isCreatingPage, setIsCreatingPage] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiSelection, setAiSelection] = useState<ContentSelection | null>(null);
  const [aiSettings] = useState(() => getDefaultAISettings());
  const {
    status: aiStatus,
    streamedText,
    error: aiError,
    startEdit,
    cancel,
    reset,
    isEditing,
  } = useContentEditor();
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictServerPage, setConflictServerPage] = useState<Page | null>(null);
  const [conflictPendingContent, setConflictPendingContent] =
    useState<EditorContent | null>(null);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);
  const updatedAtByPageRef = useRef(new Map<string, string>());
  const authorityModeRef = useRef<AuthorityMode>("idle");
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const editSeqRef = useRef(0);
    const lastAckedSeqRef = useRef(0);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const setAuthorityMode = useCallback(
    (nextMode: AuthorityMode) => {
      authorityModeRef.current = nextMode;
      onAuthorityModeChange?.(nextMode);
    },
    [onAuthorityModeChange],
  );

  // Filter out current page from breadcrumbs to avoid duplication
  const parentBreadcrumbs = breadcrumbs?.slice(0, -1);

  const handleCreatePage = useCallback(async () => {
    if (!workspaceId || !onSelectPage) return;
    setIsCreatingPage(true);
    try {
      const page = await api.createPage({
        workspace_id: workspaceId,
        title: "Untitled",
      });
      if (page) {
        await refreshTree();
        onSelectPage(page.id);
      }
    } catch (err) {
      console.error("Failed to create page:", err);
      toast({
        variant: "destructive",
        title: "Create failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsCreatingPage(false);
    }
  }, [workspaceId, onSelectPage, api, refreshTree, toast]);

  // Synchronize local state with page data
  useEffect(() => {
    if (page) {
      setTitle(page.title);
      setIcon(page.icon);
      isDeletingRef.current = false;
      onDraftContentChange?.(page.id, page.content_json);
      const updatedAtIso = toIsoTimestamp(page.updated_at);
      if (updatedAtIso) {
        updatedAtByPageRef.current.set(page.id, updatedAtIso);
      }
    }
  }, [page, onDraftContentChange]);

  useEffect(() => {
    if (aiStatus === "completed" || aiStatus === "cancelled") {
      setAiDialogOpen(false);
      setAiInstruction("");
      setAiSelection(null);
      reset();
      void refreshPage();
    }
  }, [aiStatus, refreshPage, reset]);

  useEffect(() => {
    setEditorReady(false);
  }, [pageId]);

  // Debounced meta update
  const debouncedUpdateMeta = useDebouncedCallback(
    async (updates: { title?: string; icon?: string | null }) => {
      if (!pageId || isDeletingRef.current) return;
      try {
        const updated = await api.updatePageMeta(pageId, {
          title: updates.title,
          icon: updates.icon || undefined,
        });
        if (updated) {
          const updatedAtIso = toIsoTimestamp(updated.updated_at);
          if (updatedAtIso) {
            updatedAtByPageRef.current.set(updated.id, updatedAtIso);
          }
          onPageChange?.(updated);
        }
        await refreshTree();
      } catch (err) {
        console.error("Failed to update page meta:", err);
      }
    },
    1000,
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isAiLocked) return;
    const newTitle = e.target.value;
    setTitle(newTitle);
    debouncedUpdateMeta({ title: newTitle });
  };

  const handleIconChange = (newIcon: string | null) => {
    if (isAiLocked) return;
    setIcon(newIcon);
    debouncedUpdateMeta({ icon: newIcon });
  };

  const applyCanonicalPage = useCallback(
    (nextPage: Page) => {
      const updatedAtIso = toIsoTimestamp(nextPage.updated_at);
      if (updatedAtIso) {
        updatedAtByPageRef.current.set(nextPage.id, updatedAtIso);
      }
      if (authorityModeRef.current === "manual") {
        return;
      }
      if (authorityModeRef.current === "ai") {
        return;
      }
      onPageChange?.(nextPage);
      onDraftContentChange?.(nextPage.id, nextPage.content_json);
    },
    [onDraftContentChange, onPageChange],
  );

  const handleSave = useCallback(
    async (content: EditorContent, targetPageId: string) => {
      if (
              !targetPageId ||
              targetPageId === "__none__" ||
              isDeletingRef.current
            ) {
              return;
            }
      
            const dispatchedSeq = editSeqRef.current;

      const ifUnmodifiedSince = updatedAtByPageRef.current.get(targetPageId);
      const requestId = crypto.randomUUID();
      onSaveRequestId?.(requestId);

      try {
        const result = await api.updatePageContent(targetPageId, content, {
          ifUnmodifiedSince,
          requestId,
        });
        const updated = result?.page ?? null;

        if (updated && targetPageId === pageId) {
                  if (editSeqRef.current <= dispatchedSeq) {
                    applyCanonicalPage(updated);
                  } else {
                    // Stale response — user typed more since this save was dispatched
                    // Still update timestamp for optimistic concurrency
                    const updatedAtIso = toIsoTimestamp(updated.updated_at);
                    if (updatedAtIso) {
                      updatedAtByPageRef.current.set(updated.id, updatedAtIso);
                    }
                  }
                } else if (updated) {
          const updatedAtIso = toIsoTimestamp(updated.updated_at);
          if (updatedAtIso) {
            updatedAtByPageRef.current.set(updated.id, updatedAtIso);
          }
        }
      } catch (err) {
        if (
          err instanceof KnowledgeApiError &&
          err.code === "CONTENT_CONFLICT" &&
          targetPageId === pageId
        ) {
          const serverPage = getConflictPage(err);
          if (serverPage) {
            const updatedAtIso = toIsoTimestamp(serverPage.updated_at);
            if (updatedAtIso) {
              updatedAtByPageRef.current.set(serverPage.id, updatedAtIso);
            }

            if (authorityModeRef.current === "manual") {
              // Non-blocking: preserve local edits, show toast, update timestamp
              toast({
                title: "Conflict detected",
                description:
                  "Your local edits were preserved. The server version was updated by another source.",
              });
            } else {
              // Blocking dialog for idle/ai modes
              setConflictServerPage(serverPage);
              setConflictPendingContent(content);
              setConflictDialogOpen(true);
            }
          }
          return;
        }
        toast({
          variant: "destructive",
          title: "Save failed",
          description: err instanceof Error ? err.message : "Unknown error",
        });
        throw err;
      }
    },
    [api, applyCanonicalPage, pageId, toast],
  );

  const debouncedDraftSync = useDebouncedCallback(
    (targetPageId: string, content: EditorContent) => {
      onDraftContentChange?.(targetPageId, content);
    },
    300,
  );

  const autosaveOptions = useMemo(() => ({
    saveKey: pageId ?? "__none__",
    debounceMs: 1000,
    onSave: handleSave,
    onError: (err: Error) => console.error("Autosave failed:", err),
  }), [pageId, handleSave]);

  const {
    status: saveStatus,
    triggerSave,
    flushSave,
    resetPending,
  } = useAutosave(autosaveOptions);

  // Flush pending saves when pageId changes
  useEffect(() => {
    return () => {
      flushSave();
      debouncedDraftSync.cancel();
    };
  }, [pageId, flushSave, debouncedDraftSync]);

  useEffect(() => {
      clearIdleTimer();
      setAuthorityMode("idle");
      editSeqRef.current = 0;
      lastAckedSeqRef.current = 0;
    }, [clearIdleTimer, pageId, setAuthorityMode]);

  useEffect(() => {
    if (isAiLocked) {
      clearIdleTimer();
      setAuthorityMode("ai");
      resetPending();
      return;
    }

    clearIdleTimer();
    setAuthorityMode("idle");
  }, [clearIdleTimer, isAiLocked, setAuthorityMode, resetPending]);

  useEffect(() => {
    return () => {
      clearIdleTimer();
    };
  }, [clearIdleTimer]);

  // Content change handler
  const handleContentChange = useCallback(
    (content: EditorContent) => {
      if (isAiLocked) return;
      if (conflictDialogOpen || isResolvingConflict) return;

      editSeqRef.current += 1;
            setAuthorityMode("manual");
      clearIdleTimer();
      idleTimerRef.current = setTimeout(() => {
        setAuthorityMode("idle");
      }, MANUAL_IDLE_TIMEOUT_MS);

      triggerSave(content);
      if (pageId) {
        debouncedDraftSync(pageId, content);
      }
    },
    [
      isAiLocked,
      conflictDialogOpen,
      isResolvingConflict,
      setAuthorityMode,
      clearIdleTimer,
      triggerSave,
      pageId,
      debouncedDraftSync,
    ],
  );

  const handleReloadServerVersion = useCallback(() => {
    if (conflictServerPage) {
      authorityModeRef.current = "idle";
      clearIdleTimer();
      applyCanonicalPage(conflictServerPage);
    }
    resetPending();
    setConflictDialogOpen(false);
    setConflictPendingContent(null);
    setConflictServerPage(null);
  }, [applyCanonicalPage, conflictServerPage, resetPending, clearIdleTimer]);

  const handleKeepLocalVersion = useCallback(async () => {
    if (!pageId || !conflictPendingContent || !conflictServerPage) {
      return;
    }

    setIsResolvingConflict(true);
    try {
      const ifUnmodifiedSince = toIsoTimestamp(conflictServerPage.updated_at);
      const keepRequestId = crypto.randomUUID();
      onSaveRequestId?.(keepRequestId);
      const keepResult = await api.updatePageContent(pageId, conflictPendingContent, {
        ifUnmodifiedSince: ifUnmodifiedSince ?? undefined,
        requestId: keepRequestId,
      });
      const updated = keepResult?.page ?? null;
      if (updated) {
        authorityModeRef.current = "idle";
        clearIdleTimer();
        applyCanonicalPage(updated);
      }
      resetPending();
      setConflictDialogOpen(false);
      setConflictPendingContent(null);
      setConflictServerPage(null);
    } catch (err) {
      if (err instanceof KnowledgeApiError && err.code === "CONTENT_CONFLICT") {
        const serverPage = getConflictPage(err);
        if (serverPage) {
          setConflictServerPage(serverPage);
          const updatedAtIso = toIsoTimestamp(serverPage.updated_at);
          if (updatedAtIso) {
            updatedAtByPageRef.current.set(serverPage.id, updatedAtIso);
          }
        }
        return;
      }

      toast({
        variant: "destructive",
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsResolvingConflict(false);
    }
  }, [
    api,
    applyCanonicalPage,
    conflictPendingContent,
    conflictServerPage,
    pageId,
    resetPending,
    toast,
    clearIdleTimer,
    onSaveRequestId,
  ]);

  const handleAiEdit = useCallback(
    (selection: ContentSelection) => {
      if (isAiLocked) {
        toast({
          title: "Page locked",
          description: "Wait for the AI page edit to finish.",
        });
        return;
      }
      if (!selection.selectedText?.trim()) {
        toast({
          variant: "destructive",
          title: "Select text first",
        description: "Highlight a section before using AI edit.",
      });
        return;
      }

      setAiSelection(selection);
      setAiInstruction("");
      setAiDialogOpen(true);
    },
    [isAiLocked, toast],
  );

  const handleAiSubmit = useCallback(async () => {
    if (!pageId || !aiSelection) return;
    const resolvedWorkspaceId = workspaceId ?? page?.workspace_id;
    if (!resolvedWorkspaceId) {
      toast({
        variant: "destructive",
        title: "Missing workspace",
        description: "Workspace context is required for AI edit.",
      });
      return;
    }

    const instruction = aiInstruction.trim();
    if (!instruction) return;

    await startEdit({
      target: { targetType: "knowledge.page", targetId: pageId },
      mode: "selection",
      instruction,
      selection: aiSelection,
      provider: aiSettings.provider,
      model: aiSettings.model,
      workspaceId: resolvedWorkspaceId,
      projectId: page?.project_id ?? undefined,
    });
  }, [
    aiInstruction,
    aiSelection,
    aiSettings.model,
    aiSettings.provider,
    page?.project_id,
    page?.workspace_id,
    pageId,
    startEdit,
    toast,
    workspaceId,
  ]);

  const handleAiDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open && isEditing) {
        void cancel();
      }
      setAiDialogOpen(open);
      if (!open) {
        setAiInstruction("");
        setAiSelection(null);
      }
    },
    [cancel, isEditing],
  );

  useEffect(() => {
    if (isAiLocked && aiDialogOpen) {
      setAiDialogOpen(false);
      setAiInstruction("");
      setAiSelection(null);
    }
  }, [aiDialogOpen, isAiLocked]);

  // Empty state - no page selected
  if (!pageId) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center bg-background p-8 text-center animate-in fade-in duration-300">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <BookOpen className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          Knowledge Base
        </h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Select a page from the sidebar to view or edit its content, or create
          a new page to get started.
        </p>
        {workspaceId && onSelectPage && (
          <Button
            className="mt-6"
            variant="outline"
            onClick={handleCreatePage}
            disabled={isCreatingPage}
          >
            {isCreatingPage ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Create Page
          </Button>
        )}
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
        {/* Toolbar skeleton */}
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
        {/* Content skeleton */}
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-4xl w-full p-8 md:p-12 space-y-8">
            <div className="space-y-4">
              <Skeleton className="h-12 w-3/4 rounded-md" />
              <div className="flex gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
            <div className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
            <div className="space-y-4 mt-8">
              <Skeleton className="h-32 w-full rounded-md" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !page) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-destructive font-medium">
            {error || "Page not found"}
          </p>
          <Button variant="outline" size="sm" onClick={() => refreshPage()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 h-12 z-10 transition-colors duration-200 gap-4">
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50 overflow-hidden">
            {parentBreadcrumbs?.map((node, index) => (
              <div key={node.id} className="flex items-center gap-1.5 shrink-0">
                {index > 0 && <ChevronRight className="h-3 w-3 opacity-50" />}
                <button
                  onClick={() => onSelectPage?.(node.id)}
                  className="flex items-center gap-1.5 hover:text-foreground transition-colors truncate max-w-[120px]"
                >
                  <span className="shrink-0 text-sm">{node.icon || <FileText className="h-3 w-3" />}</span>
                  <span className="truncate">{node.title}</span>
                </button>
              </div>
            ))}
            {parentBreadcrumbs && parentBreadcrumbs.length > 0 && (
              <ChevronRight className="h-3 w-3 opacity-30" />
            )}
            {/* If root or no parents, maybe show icon? */}
            {!parentBreadcrumbs?.length && (
              <span className="opacity-50 text-base">{page.icon || <FileText className="h-3.5 w-3.5" />}</span>
            )}
          </div>
        </div>

        {/* Formatting Toolbar (Center-ish) */}
        {editor && (
          <div
            className={`flex justify-center opacity-0 hover:opacity-100 transition-opacity duration-200 focus-within:opacity-100 ${
              isAiLocked ? "pointer-events-none opacity-40" : ""
            }`}
          >
            <FixedToolbar
              editor={editor}
              onLinkClick={() => setLinkDialogOpen(true)}
              className="border-none bg-transparent hover:bg-muted/50 rounded-md px-2 h-8"
            />
          </div>
        )}

        <div className="shrink-0">
          <SaveStatusIndicator status={saveStatus} />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl w-full px-8 pt-12 pb-24">
          {/* Page Header */}
          <div className="mb-8 group/header">
            {/* Page Icon */}
            <div className="mb-4 relative inline-block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="text-5xl hover:bg-accent/50 rounded-lg p-2 transition-colors -ml-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isAiLocked}
                  >
                    {icon || "📄"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="p-2 w-64">
                  <div className="grid grid-cols-5 gap-1 mb-2">
                    {EMOJI_PRESETS.map((emoji) => (
                      <button
                        key={emoji}
                        className="h-10 w-10 flex items-center justify-center text-xl hover:bg-accent rounded"
                        onClick={() => handleIconChange(emoji)}
                        disabled={isAiLocked}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs h-8"
                      onClick={() => handleIconChange(null)}
                      disabled={isAiLocked}
                    >
                      Remove Icon
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Title */}
            <input
              className="w-full text-4xl font-bold tracking-tight text-foreground bg-transparent border-none outline-none placeholder:text-muted-foreground/20 focus-visible:ring-0 p-0"
              value={title}
              onChange={handleTitleChange}
              placeholder="Untitled"
              disabled={isAiLocked}
            />

            {/* Meta info removed from top header for cleanliness */}

            <div className="mt-8 h-px w-full bg-border/40" />
          </div>

          {/* Editor Content Area */}
          <div className="min-h-[200px] w-full">
            {!editorReady && (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading editor...</span>
              </div>
            )}
            <TiptapEditor
              key={page.id} // Re-mount on page change
              initialContent={page.content_json}
              onChange={handleContentChange}
              readOnly={isAiLocked || isEditing || conflictDialogOpen || isResolvingConflict}
              onReady={(editor) => {
                setEditor(editor);
                setEditorReady(true);
              }}
              onLinkClick={() => setLinkDialogOpen(true)}
              onAiEdit={handleAiEdit}
              debounceMs={300}
            />
            {editor && (
              <LinkDialog
                editor={editor}
                open={linkDialogOpen}
                onOpenChange={setLinkDialogOpen}
              />
            )}
            <AiEditDialog
              open={aiDialogOpen}
              onOpenChange={handleAiDialogOpenChange}
              instruction={aiInstruction}
              onInstructionChange={setAiInstruction}
              onSubmit={handleAiSubmit}
              onCancel={() => handleAiDialogOpenChange(false)}
              isEditing={isEditing}
              statusLabel={
                aiStatus === "starting"
                  ? "Starting edit..."
                  : aiStatus === "streaming"
                    ? "Editing selection..."
                    : aiStatus === "applying"
                      ? "Applying changes..."
                      : undefined
              }
              streamedText={streamedText}
              error={aiError}
              selectionPreview={aiSelection?.selectedText}
              providerLabel={`${aiSettings.provider} · ${aiSettings.model}`}
            />
            <AlertDialog
              open={conflictDialogOpen}
              onOpenChange={(open) => {
                if (open) {
                  setConflictDialogOpen(true);
                }
              }}
            >
              <AlertDialogContent
                onEscapeKeyDown={(event) => event.preventDefault()}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>Page changed on another source</AlertDialogTitle>
                  <AlertDialogDescription>
                    The page was updated since your last save. Choose whether to
                    reload the latest server version or keep your local edit and
                    overwrite with your version.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    disabled={isResolvingConflict}
                    onClick={(event) => {
                      event.preventDefault();
                      handleReloadServerVersion();
                    }}
                  >
                    Reload Server
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={isResolvingConflict}
                    onClick={(event) => {
                      event.preventDefault();
                      void handleKeepLocalVersion();
                    }}
                  >
                    {isResolvingConflict ? "Saving..." : "Keep Local"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Save status indicator component
 */
function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;

  return (
    <div className="flex items-center gap-1 text-xs shrink-0">
      {status === "saving" && (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground hidden sm:inline">
            Saving...
          </span>
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="h-3 w-3 text-green-500" />
          <span className="text-green-500 hidden sm:inline">Saved</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-3 w-3 text-destructive" />
          <span className="text-destructive hidden sm:inline">
            Failed to save
          </span>
        </>
      )}
    </div>
  );
}
