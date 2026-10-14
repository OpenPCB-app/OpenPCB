import { useCallback, memo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import { Button } from "@shared/frontend/ui/button";
import { confirmDialog } from "@shared/frontend/ui/dialog-host-store";
import { useTreeStore, isDescendant } from "../../stores/tree-store";
import { useKnowledgeApi } from "../../hooks";
import { deletePageWithDrafts } from "../../lib/delete-page-with-drafts";
import type { PageTreeNode } from "../../../shared/types";
import {
  findParentNode as findParentNodeInPageTree,
  getPreviousSibling,
} from "./PageTree";

interface TreeItemProps {
  node: PageTreeNode;
  level?: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPageDeleted?: (id: string) => void;
  designId?: string | null;
}

export const TreeItem = memo(function TreeItem({
  node,
  level = 0,
  selectedId,
  onSelect,
  onPageDeleted,
  designId,
}: TreeItemProps) {
  const { isExpanded, toggleExpanded, setExpanded, tree } = useTreeStore();
  const api = useKnowledgeApi();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingChild, setIsCreatingChild] = useState(false);
  const [dropPosition, setDropPosition] = useState<
    "before" | "after" | "inside" | null
  >(null);
  const [draggedOver, setDraggedOver] = useState(false);

  const hasChildren = node.children && node.children.length > 0;
  const expanded = isExpanded(node.id);
  const isSelected = selectedId === node.id;

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleExpanded(node.id);
    },
    [node.id, toggleExpanded],
  );

  const handleCreateChild = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsCreatingChild(true);
      try {
        const page = await api.createPage({
          workspace_id: "default",
          project_id: designId ?? undefined,
          parent_id: node.id,
          title: "Untitled",
        });
        if (page) {
          setExpanded(node.id, true);
          onSelect(page.id);
        }
      } catch (err) {
        console.error("Failed to create child page:", err);
      } finally {
        setIsCreatingChild(false);
      }
    },
    [api, designId, node.id, onSelect, setExpanded],
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.is_project_root) return;
      const confirmed = await confirmDialog({
        title: `Delete "${node.title}"?`,
        description: "This page and its subpages will be deleted.",
        confirmLabel: "Delete",
        tone: "danger",
      });
      if (!confirmed) return;
      setIsDeleting(true);
      try {
        await deletePageWithDrafts(api, tree, node.id);
        onPageDeleted?.(node.id);
      } catch (err) {
        console.error("Failed to delete page:", err);
      } finally {
        setIsDeleting(false);
      }
    },
    [api, node, tree, onPageDeleted],
  );

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", node.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const height = rect.height;

    if (offsetY < height * 0.25) {
      setDropPosition("before");
    } else if (offsetY > height * 0.75) {
      setDropPosition("after");
    } else {
      setDropPosition("inside");
    }
    setDraggedOver(true);
  };

  const handleDragLeave = () => {
    setDropPosition(null);
    setDraggedOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    const position = dropPosition;
    setDropPosition(null);
    setDraggedOver(false);

    if (!draggedId || draggedId === node.id) return;
    if (isDescendant(tree, draggedId, node.id)) return;

    try {
      let target: {
        target_parent_id?: string | null;
        after_sibling_id?: string;
      };
      if (position === "inside") {
        target = { target_parent_id: node.id };
        setExpanded(node.id, true);
      } else if (position === "before") {
        const parent = findParentNodeInPageTree(tree, node.id);
        const previous = getPreviousSibling(tree, node.id);
        target = {
          target_parent_id: parent?.id ?? null,
          after_sibling_id: previous?.id,
        };
      } else {
        const parent = findParentNodeInPageTree(tree, node.id);
        target = {
          target_parent_id: parent?.id ?? null,
          after_sibling_id: node.id,
        };
      }

      await api.movePage(draggedId, target);
    } catch (err) {
      console.error("Failed to move page:", err);
    }
  };

  const paddingLeft = `${level * 16 + 4}px`;

  return (
    <div>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => onSelect(node.id)}
        className={[
          "group relative flex cursor-pointer items-center gap-1 rounded-control py-1.5 pr-1 text-sm transition-colors",
          isSelected
            ? "bg-accent-soft font-medium text-accent-text before:absolute before:bottom-1 before:left-0 before:top-1 before:w-0.5 before:rounded-full before:bg-accent"
            : "text-text-secondary hover:bg-slate-100 dark:hover:bg-slate-800",
          draggedOver && dropPosition === "inside" ? "bg-accent-soft" : "",
        ].join(" ")}
        style={{ paddingLeft }}
      >
        {dropPosition === "before" && (
          <div className="absolute left-2 right-2 top-0 h-0.5 -translate-y-1/2 rounded-full bg-violet-500" />
        )}
        {dropPosition === "after" && (
          <div className="absolute left-2 right-2 bottom-0 h-0.5 translate-y-1/2 rounded-full bg-violet-500" />
        )}

        <button
          type="button"
          onClick={handleToggle}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-text-tertiary"
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="h-4 w-4" />
          )}
        </button>

        <span className="shrink-0 text-base leading-none">
          {node.icon || (
            <FileText
              className={`h-4 w-4 ${isSelected ? "text-accent-text" : "text-text-tertiary"}`}
            />
          )}
        </span>

        <span className="min-w-0 flex-1 truncate font-medium">
          {node.title}
        </span>

        <div className="flex items-center opacity-0 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            icon={
              isCreatingChild ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )
            }
            onClick={handleCreateChild}
            disabled={isCreatingChild}
            className="h-6 w-6"
            title="Add subpage"
          />
          {!node.is_project_root && (
            <Button
              variant="ghost"
              size="sm"
              icon={
                isDeleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )
              }
              onClick={handleDelete}
              disabled={isDeleting}
              className="h-6 w-6"
              title="Delete"
            />
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children!.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onPageDeleted={onPageDeleted}
              designId={designId}
            />
          ))}
        </div>
      )}
    </div>
  );
});
