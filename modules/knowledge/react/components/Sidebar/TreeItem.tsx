import { useCallback, memo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  GripVertical,
  Plus,
  MoreHorizontal,
  Trash2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { useTreeStore } from "../../stores/tree-store";
import { useKnowledgeApi } from "../../hooks/useKnowledgeApi";
import type { PageTreeNode } from "../../../shared/types";

export interface TreeItemProps {
  node: PageTreeNode;
  level?: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  workspaceId?: string | null;
  onRefresh?: () => void | Promise<void>;
  /** Callback when a page is deleted */
  onPageDeleted?: (id: string) => void;
  /** Whether this item is being dragged */
  isDragging?: boolean;
  /** Whether this item is a drop target */
  isDropTarget?: boolean;
  /** Drop indicator position */
  dropPosition?: "before" | "after" | "inside" | null;
  /** Drag handle props from dnd-kit */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Whether drag is disabled */
  dragDisabled?: boolean;
  /** Whether page writes are locked due to AI edit lifecycle */
  writeLocked?: boolean;
  /** Whether this item has keyboard focus */
  isFocused?: boolean;
  /**
   * When true, children are rendered by the parent (flat list)
   * and this component should not render them recursively
   */
  flatMode?: boolean;
}

export const TreeItem = memo(function TreeItem({
  node,
  level = 0,
  selectedId,
  onSelect,
  workspaceId,
  onRefresh,
  onPageDeleted,
  isDragging = false,
  isDropTarget = false,
  dropPosition = null,
  dragHandleProps,
  dragDisabled = false,
  writeLocked = false,
  isFocused = false,
  flatMode = false,
}: TreeItemProps) {
  const {
    isExpanded,
    setExpanded,
    selectedIds,
    toggleSelected,
    selectRange,
    clearSelection,
    lastSelectedId,
    requestRefresh,
  } = useTreeStore();
  const api = useKnowledgeApi();
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;
  const isMultiSelected = selectedIds.has(node.id);
  const hasSelection = selectedIds.size > 0;
  const expanded = isExpanded(node.id);

  // Indentation based on level
  const paddingLeft = `${level * 12 + 4}px`;

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      // Ctrl/Cmd+click: toggle selection
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        toggleSelected(node.id);
        return;
      }
      // Shift+click: range selection
      if (e.shiftKey && lastSelectedId) {
        e.preventDefault();
        selectRange(node.id);
        return;
      }
      // Normal click: clear selection and navigate
      clearSelection();
      onSelect(node.id);
    },
    [node.id, onSelect, toggleSelected, selectRange, clearSelection, lastSelectedId]
  );

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleSelected(node.id);
    },
    [node.id, toggleSelected]
  );

  const handleAddChild = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (writeLocked) return;
      if (!workspaceId) return;
      try {
        const page = await api.createPage({
          workspace_id: workspaceId,
          project_id: node.project_id || undefined,
          parent_id: node.id,
          title: "Untitled",
        });
        if (page) {
          setExpanded(node.id, true);
          await onRefresh?.();
          onSelect(page.id);
        }
      } catch (err) {
        console.error("Failed to create child page:", err);
      }
    },
    [workspaceId, writeLocked, api, node, onRefresh, onSelect, setExpanded]
  );

  const handleDelete = useCallback(
    (e?: React.MouseEvent | React.KeyboardEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      setShowDeleteDialog(true);
    },
    []
  );

  const handleConfirmDelete = useCallback(
    async () => {
      setIsDeleting(true);
      try {
        await api.deletePage(node.id);
        onPageDeleted?.(node.id);
        await onRefresh?.();
        toast({
          title: "Page deleted",
          description: `"${node.title}" has been deleted`,
          action: (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void (async () => {
                  try {
                    await api.restorePage(node.id);
                    requestRefresh();
                    toast({
                      title: "Page restored",
                      description: `"${node.title}" has been restored`,
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
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        toast({
          variant: "destructive",
          title: "Delete failed",
          description:
            errorMessage.includes("BACKEND_NOT_READY")
              ? "Backend is not ready yet. Please try again."
              : errorMessage.includes("ROOT_LOCKED")
                ? "Project root pages cannot be deleted."
                : errorMessage.includes("PAGE_NOT_FOUND")
                  ? "This page no longer exists."
                  : `Failed to delete page: ${errorMessage}`,
        });
      } finally {
        setIsDeleting(false);
        setShowDeleteDialog(false);
      }
    },
    [api, node, onRefresh, onPageDeleted, toast]
  );

  return (
    <>
      <Collapsible
        open={expanded}
        onOpenChange={(open) => setExpanded(node.id, open)}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              data-node-id={node.id}
              className={cn(
                "group relative flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-sm font-medium transition-colors cursor-default",
                "hover:bg-accent/50",
                isSelected && "bg-accent/80 text-accent-foreground",
                isMultiSelected && !isSelected && "bg-primary/10",
                isFocused && !isSelected && "ring-1 ring-ring/30",
                isDragging && "opacity-50",
                isDropTarget && dropPosition === "inside" && "bg-accent/30"
              )}
              style={{ paddingLeft }}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              {/* Drop indicator line - before */}
              {isDropTarget && dropPosition === "before" && (
                <div
                  className="absolute left-2 right-2 top-0 h-0.5 bg-primary rounded-full z-10"
                  style={{ transform: "translateY(-50%)" }}
                />
              )}

              {/* Checkbox for multi-selection - visible on hover or when items selected */}
              {(isHovered || hasSelection) && (
                <div
                  className={cn(
                    "absolute left-1 z-10 shrink-0 w-5 flex items-center justify-center transition-opacity",
                    !hasSelection && "opacity-0 group-hover:opacity-100"
                  )}
                  style={{ left: Math.max(0, (level * 12)) + 'px' }}
                  onClick={handleCheckboxClick}
                >
                  <Checkbox
                    checked={isMultiSelected}
                    className="h-3.5 w-3.5 bg-background shadow-none"
                  />
                </div>
              )}

              {/* Drag handle */}
              {!dragDisabled && !hasSelection && (
                <div
                  {...dragHandleProps}
                  className={cn(
                    "h-5 w-4 shrink-0 flex items-center justify-center cursor-grab opacity-0 group-hover:opacity-40 hover:opacity-100 transition-opacity",
                    isDragging && "cursor-grabbing opacity-100"
                  )}
                >
                  <GripVertical className="h-3 w-3" />
                </div>
              )}

              {/* Collapse toggle */}
              <div className="h-5 w-5 shrink-0 flex items-center justify-center">
                {hasChildren ? (
                  <CollapsibleTrigger asChild>
                    <button
                      className="h-4 w-4 rounded-sm hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex items-center justify-center"
                      onClick={handleToggle}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                ) : (
                  <div className="h-3 w-3 rounded-full bg-muted-foreground/10 group-hover:bg-muted-foreground/20 transition-colors" />
                )}
              </div>

              {/* Page button */}
              <button
                className="flex flex-1 items-center gap-2 truncate text-left focus-visible:outline-none py-0.5 min-w-0"
                onClick={handleRowClick}
              >
                <span className="shrink-0 text-base leading-none opacity-80 group-hover:opacity-100 transition-opacity">
                  {node.icon ? (
                    node.icon
                  ) : node.is_project_root ? (
                    <Folder className="h-4 w-4 text-blue-500" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <span className={cn(
                  "truncate text-[13px] text-muted-foreground group-hover:text-foreground transition-colors",
                  isSelected && "text-foreground font-medium"
                )}>
                  {node.title}
                </span>
              </button>

              {/* Action Buttons */}
              <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                {!node.is_project_root && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        disabled={isDeleting || writeLocked}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(e);
                        }}
                        disabled={writeLocked}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={handleAddChild}
                  disabled={writeLocked}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Drop indicator line - after */}
              {isDropTarget && dropPosition === "after" && (
                <div
                  className="absolute left-2 right-2 bottom-0 h-0.5 bg-primary rounded-full z-10"
                  style={{ transform: "translateY(50%)" }}
                />
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem onClick={handleAddChild} disabled={writeLocked}>
              <Plus className="h-4 w-4 mr-2" />
              Add subpage
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => handleDelete()}
              className="text-destructive focus:text-destructive"
              disabled={node.is_project_root || writeLocked}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Only render children recursively when NOT in flat mode */}
        {hasChildren && !flatMode && (
          <CollapsibleContent>
            <div>
              {node.children!.map((child) => (
                <TreeItem
                  key={child.id}
                  node={child}
                  level={level + 1}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  workspaceId={workspaceId}
                  onRefresh={onRefresh}
                  onPageDeleted={onPageDeleted}
                  dragDisabled={dragDisabled}
                  writeLocked={writeLocked}
                />
              ))}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{node.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the page and all its subpages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
