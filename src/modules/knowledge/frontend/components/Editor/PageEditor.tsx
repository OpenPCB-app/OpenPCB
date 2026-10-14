import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, AlertCircle, FileText } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { Button } from "@shared/frontend/ui/button";
import { confirmDialog } from "@shared/frontend/ui/dialog-host-store";
import { useKnowledgeApi } from "../../hooks";
import { usePageDraft } from "../../hooks/usePageDraft";
import { useTreeStore } from "../../stores/tree-store";
import { TiptapEditor } from "./TiptapEditor";
import { PdfViewer } from "./PdfViewer";
import { FixedToolbar } from "./FixedToolbar";
import { LinkDialog } from "./LinkDialog";
import { findParentNode } from "../Sidebar/PageTree";
import { formatRelativeTime } from "../../lib/format";
import { deletePageWithDrafts } from "../../lib/delete-page-with-drafts";
import type { Page, PageTreeNode } from "../../../shared/types";

interface PageEditorProps {
  pageId: string | null;
  page: Page | null;
  isLoading: boolean;
  error: string | null;
  refreshPage: () => Promise<void>;
  onPageChange?: (page: Page) => void;
  onPageDeleted?: (id: string) => void;
  workspaceId?: string | null;
  designId?: string | null;
  onSelectPage?: (id: string) => void;
  onSaveRequestId?: (requestId: string) => void;
  onRefreshTree?: () => void;
}

/** Ancestor titles for a page, root-first. Empty if the page isn't in the tree. */
function buildBreadcrumb(tree: PageTreeNode[], pageId: string): string[] {
  const crumbs: string[] = [];
  let currentId = pageId;
  for (let i = 0; i < 50; i++) {
    const parent = findParentNode(tree, currentId);
    if (!parent) break;
    crumbs.unshift(parent.title);
    currentId = parent.id;
  }
  return crumbs;
}

export function PageEditor({
  pageId,
  page,
  isLoading,
  error,
  refreshPage,
  onPageDeleted,
  designId,
  onSelectPage,
  onRefreshTree,
}: PageEditorProps) {
  const api = useKnowledgeApi();
  const { draft, coordinator } = usePageDraft(
    page?.id === pageId ? page : null,
  );
  const [editorOwner, setEditorOwner] = useState<{
    id: string;
    editor: Editor;
  } | null>(null);
  const editor =
    editorOwner?.id === pageId && !editorOwner.editor.isDestroyed
      ? editorOwner.editor
      : null;
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [, tick] = useState(0);
  const tree = useTreeStore((state) => state.tree);
  const title = draft?.title ?? page?.title ?? "";
  const saveStatus = draft?.status ?? "idle";
  const [countOwner, setCountOwner] = useState<{
    editor: Editor;
    count: number;
  } | null>(null);
  const wordCount =
    editor && countOwner?.editor === editor ? countOwner.count : 0;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const update = () => {
      if (editor.isDestroyed) return;
      const text = editor.getText().trim();
      setCountOwner({ editor, count: text ? text.split(/\s+/).length : 0 });
    };
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  useEffect(() => {
    setLinkDialogOpen(false);
  }, [pageId]);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (onRefreshTree) return coordinator.subscribeTitleSaves(onRefreshTree);
  }, [coordinator, onRefreshTree]);

  const handleReady = useCallback(
    (ready: Editor | null, departed?: Editor) => {
      if (ready) {
        if (pageId) setEditorOwner({ id: pageId, editor: ready });
        return;
      }
      // The departing editor may unmount after pageId already moved on; match by identity.
      setEditorOwner((current) =>
        departed
          ? current?.editor === departed
            ? null
            : current
          : current?.id === pageId
            ? null
            : current,
      );
      if (departed)
        setCountOwner((current) =>
          current?.editor === departed ? null : current,
        );
    },
    [pageId],
  );

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (pageId && draft) coordinator.setTitle(pageId, event.target.value);
  };

  const handleCreatePage = useCallback(async () => {
    if (!onSelectPage) return;
    setIsCreating(true);
    try {
      const newPage = await api.createPage({
        workspace_id: "default",
        project_id: designId ?? undefined,
        title: "Untitled",
      });
      if (newPage) {
        onRefreshTree?.();
        onSelectPage(newPage.id);
      }
    } catch (err) {
      console.error("Failed to create page:", err);
    } finally {
      setIsCreating(false);
    }
  }, [api, designId, onSelectPage, onRefreshTree]);

  const handleDeletePage = useCallback(async () => {
    if (!pageId || !page || page.is_project_root) return;
    const confirmed = await confirmDialog({
      title: `Delete "${page.title}"?`,
      description: "This page and its subpages will be deleted.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deletePageWithDrafts(api, tree, pageId);
      onPageDeleted?.(pageId);
      onRefreshTree?.();
    } catch (err) {
      console.error("Failed to delete page:", err);
    }
  }, [pageId, page, api, tree, onPageDeleted, onRefreshTree]);

  if (!pageId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-card border border-dashed border-slate-300 bg-surface-card px-6 py-12 text-center dark:border-slate-700">
          <FileText className="mx-auto h-10 w-10 text-text-tertiary" />
          <p className="mt-3 text-sm text-text-secondary">No page selected</p>
          <p className="mt-1 text-xs text-text-tertiary">
            Select a page from the sidebar or create a new one.
          </p>
          {onSelectPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="h-4 w-4" />}
                onClick={handleCreatePage}
                disabled={isCreating}
              >
                New page
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const effectivePage = draft?.page ?? page;
  const effectiveContent = draft?.content ?? effectivePage?.content_json;
  const breadcrumb = buildBreadcrumb(tree, pageId);
  const editedRelative = effectivePage
    ? formatRelativeTime(effectivePage.updated_at)
    : null;
  const pdfData =
    effectiveContent?.engine === "pdf" ? effectiveContent.data : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 px-4 pt-2">
          <input
            type="text"
            value={title}
            disabled={!draft?.ready}
            onChange={handleTitleChange}
            aria-label="Page title"
            placeholder="Page title"
            onBlur={() => coordinator.finishTitle(pageId)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              coordinator.finishTitle(pageId);
              if (editor && !editor.isDestroyed) editor.commands.focus("start");
            }}
            className="flex-1 bg-transparent text-lg font-semibold text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          <div className="flex items-center gap-1">
            {saveStatus !== "idle" && (
              <span
                role="status"
                aria-label="Page save status"
                className={`rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] dark:bg-slate-800 ${
                  saveStatus === "saved"
                    ? "text-status-success"
                    : saveStatus === "error"
                      ? "text-status-danger"
                      : "text-text-tertiary"
                }`}
              >
                {saveStatus === "pending" && "Unsaved"}
                {saveStatus === "saving" && "Saving…"}
                {saveStatus === "saved" && "Saved"}
                {saveStatus === "error" && "Not saved"}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              title="New page"
              aria-label="New page"
              icon={
                isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )
              }
              onClick={handleCreatePage}
              disabled={isCreating}
            />
            <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
            <Button
              variant="ghost"
              size="sm"
              title="Delete page"
              aria-label="Delete page"
              className="hover:text-status-danger"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={handleDeletePage}
              disabled={!page || page.is_project_root}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-4 pb-2 pt-1 text-[11px] text-text-tertiary">
          {breadcrumb.length > 0 && (
            <>
              <span className="truncate">{breadcrumb.join(" / ")}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {editedRelative && (
            <>
              <span>edited {editedRelative}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {pdfData ? (
            <span>
              {pdfData.pageCount
                ? `${pdfData.pageCount} ${pdfData.pageCount === 1 ? "page" : "pages"}`
                : "PDF"}
            </span>
          ) : (
            <span>
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
          )}
        </div>
      </div>

      {draft?.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-border bg-status-danger-soft px-4 py-2 text-xs text-status-danger"
        >
          <span>
            {draft.error}{" "}
            {draft.durability === "durable"
              ? "Draft retained on this Mac."
              : "Draft retained while this app stays open."}
          </span>
          {draft.conflict ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={saveStatus === "saving"}
                onClick={() => void coordinator.reload(pageId, true)}
              >
                Keep draft and retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saveStatus === "saving"}
                onClick={() => void coordinator.reload(pageId, false)}
              >
                Discard draft and reload
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => coordinator.retry(pageId)}
              >
                Retry save
              </Button>
              {draft.recovered && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void coordinator.reload(pageId, false)}
                >
                  Discard draft and reload
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {error && effectivePage && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-border bg-status-danger-soft px-4 py-2 text-xs text-status-danger"
        >
          <AlertCircle className="h-4 w-4" />
          <span>Could not refresh this page: {error}</span>
          <Button size="sm" variant="ghost" onClick={() => void refreshPage()}>
            Retry
          </Button>
        </div>
      )}

      {draft?.durability === "error" && (
        <div role="alert" className="px-4 py-2 text-xs text-status-danger">
          Draft not durably retained on this Mac. {draft.durabilityError}
        </div>
      )}
      {draft?.durability === "writing" && (
        <div role="status" className="px-4 py-1 text-xs text-text-secondary">
          Retaining recovery draft…
        </div>
      )}

      {editor && !pdfData && (
        <FixedToolbar
          editor={editor}
          onLinkClick={() => setLinkDialogOpen(true)}
        />
      )}

      {pdfData ? (
        <div className="min-h-0 flex-1">
          <PdfViewer
            pdfUrl={api.pdfUrl(effectivePage!.id)}
            fileName={pdfData.fileName}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {(isLoading && !page) || (effectivePage && !draft?.ready) ? (
            <div className="p-4 text-sm text-text-tertiary">
              Loading page...
            </div>
          ) : error && !effectivePage ? (
            <div className="flex items-center gap-2 p-4 text-sm text-status-danger">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          ) : effectivePage ? (
            <TiptapEditor
              key={`${effectivePage.id}:${effectiveContent?.engine}:${draft?.documentGeneration ?? 0}`}
              initialContent={effectiveContent}
              onChange={(content) =>
                coordinator.setContent(effectivePage.id, content)
              }
              onReady={handleReady}
              readOnly={false}
            />
          ) : null}
        </div>
      )}

      {editor && !pdfData && (
        <LinkDialog
          editor={editor}
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
        />
      )}
    </div>
  );
}
