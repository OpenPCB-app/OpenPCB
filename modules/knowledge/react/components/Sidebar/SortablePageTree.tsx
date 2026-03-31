import { useState, useCallback, useMemo, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Loader2,
  Plus,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/components/ui/use-toast";
import { useProjects } from "@/hooks/useProjects";
import { usePageTree } from "../../hooks/usePageTree";
import { useKnowledgeApi } from "../../hooks/useKnowledgeApi";
import { useTreeKeyboardNav } from "../../hooks/useTreeKeyboardNav";
import { useTreeStore, findNodeById } from "../../stores/tree-store";
import { SortableTreeItem } from "./SortableTreeItem";
import { TreeItem } from "./TreeItem";
import type { PageTreeNode, MovePageParams } from "../../../shared/types";

interface SortablePageTreeProps {
  workspaceId?: string | null;
  onSelectPage: (id: string) => void;
  selectedPageId: string | null;
  onPageDeleted?: (id: string) => void;
  lockedPageIds?: ReadonlySet<string>;
}

interface DropTarget {
  targetId: string;
  position: "before" | "after" | "inside";
}

/**
 * Flatten tree nodes for sortable context
 */
function flattenTree(
  nodes: PageTreeNode[],
  expandedIds: Set<string>,
  level = 0,
): Array<{ node: PageTreeNode; level: number; flatIndex: number }> {
  const result: Array<{
    node: PageTreeNode;
    level: number;
    flatIndex: number;
  }> = [];
  let index = 0;

  function traverse(nodes: PageTreeNode[], currentLevel: number) {
    for (const node of nodes) {
      result.push({ node, level: currentLevel, flatIndex: index++ });
      if (
        node.children &&
        node.children.length > 0 &&
        expandedIds.has(node.id)
      ) {
        traverse(node.children, currentLevel + 1);
      }
    }
  }

  traverse(nodes, level);
  return result;
}

/**
 * Find sibling nodes (nodes with same parent)
 */
function findSiblings(tree: PageTreeNode[], nodeId: string): PageTreeNode[] {
  // Check root level
  const rootNode = tree.find((n) => n.id === nodeId);
  if (rootNode) {
    return tree;
  }

  // Recursively find in children
  for (const node of tree) {
    if (node.children) {
      const childMatch = node.children.find((c) => c.id === nodeId);
      if (childMatch) {
        return node.children;
      }
      const result = findSiblings(node.children, nodeId);
      if (result.length > 0) {
        return result;
      }
    }
  }

  return [];
}

/**
 * Get the previous sibling ID in the flattened list
 */
function getPreviousSiblingId(
  siblings: PageTreeNode[],
  nodeId: string,
): string | undefined {
  const index = siblings.findIndex((n) => n.id === nodeId);
  if (index > 0) {
    return siblings[index - 1]?.id;
  }
  return undefined;
}

export function SortablePageTree({
  workspaceId,
  onSelectPage,
  selectedPageId,
  onPageDeleted,
  lockedPageIds,
}: SortablePageTreeProps) {
  const { tree, isLoading, error, refresh } = usePageTree(workspaceId);
  const api = useKnowledgeApi();
  const { projects: allProjects } = useProjects();
  const {
    expandedIds,
    setExpanded,
    selectedIds,
    clearSelection,
    getSelectedIds,
  } = useTreeStore();
  const { toast } = useToast();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [draggingMultiple, setDraggingMultiple] = useState(false);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [projectOpenMap, setProjectOpenMap] = useState<Record<string, boolean>>({});
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const isPageLocked = useCallback(
    (pageId: string | null | undefined) =>
      Boolean(pageId && lockedPageIds?.has(pageId)),
    [lockedPageIds],
  );

  const visibleProjects = useMemo(() => {
    return [...allProjects].sort((a, b) => {
      const orderA = a.sortOrder ?? 0;
      const orderB = b.sortOrder ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }, [allProjects]);

  useEffect(() => {
    setProjectOpenMap((prev) => {
      const next: Record<string, boolean> = {};
      for (const project of visibleProjects) {
        const existing = prev[project.id];
        next[project.id] =
          existing ?? project.preferences?.expandedByDefault === true;
      }
      return next;
    });
  }, [visibleProjects]);

  // Bulk delete handlers
  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size > 0) {
      setShowBulkDeleteDialog(true);
    }
  }, [selectedIds]);

  const handleConfirmBulkDelete = useCallback(async () => {
    const idsToDelete = getSelectedIds();
    if (idsToDelete.length === 0) return;
    const lockedToDelete = idsToDelete.filter((id) => isPageLocked(id));
    if (lockedToDelete.length > 0) {
      toast({
        variant: "destructive",
        title: "Delete blocked",
        description: "Cannot delete pages while AI edits are in progress.",
      });
      return;
    }

    setIsBulkDeleting(true);
    try {
      const result = await api.bulkDeletePages(idsToDelete);
      clearSelection();

      // Notify parent of deletions
      for (const id of result.deleted) {
        onPageDeleted?.(id);
      }

      await refresh();

      if (result.failed.length > 0) {
        toast({
          variant: "destructive",
          title: "Some deletes failed",
          description: `${result.deleted.length} deleted, ${result.failed.length} failed`,
        });
      } else {
        toast({
          title: "Pages deleted",
          description: `${result.deleted.length} pages deleted`,
        });
      }
    } catch (err) {
      console.error("Failed to bulk delete:", err);
      toast({
        variant: "destructive",
        title: "Bulk delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsBulkDeleting(false);
      setShowBulkDeleteDialog(false);
    }
  }, [getSelectedIds, isPageLocked, api, clearSelection, onPageDeleted, refresh, toast]);

  const handleCreateProjectPage = useCallback(
    async (projectId: string, projectName: string) => {
      if (!workspaceId) return;
      setCreatingProjectId(projectId);
      try {
        const root = await api.ensureProjectRoot({
          workspace_id: workspaceId,
          project_id: projectId,
          title: projectName,
        });
        if (!root) {
          throw new Error("PROJECT_ROOT_NOT_CREATED");
        }

        const page = await api.createPage({
          workspace_id: workspaceId,
          project_id: projectId,
          parent_id: root.id,
          title: "Untitled",
        });

        if (page) {
          setProjectOpenMap((prev) => ({ ...prev, [projectId]: true }));
          setExpanded(root.id, true);
          await refresh();
          onSelectPage(page.id);
        }
      } catch (err) {
        toast({
          title: "Create failed",
          description: "Failed to create project page",
          variant: "destructive",
        });
      } finally {
        setCreatingProjectId(null);
      }
    },
    [workspaceId, api, refresh, onSelectPage, setExpanded, toast],
  );

  // Keyboard navigation
  const { containerRef, focusedId, handleKeyDown } = useTreeKeyboardNav({
    tree,
    onSelectPage,
    selectedPageId,
    onBulkDelete: handleBulkDelete,
  });

  // Sensors for drag detection
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const draggedId = event.active.id as string;
      if (isPageLocked(draggedId)) {
        setActiveId(null);
        setDropTarget(null);
        setDraggingMultiple(false);
        return;
      }
      setActiveId(draggedId);

      // If dragging a selected item and multiple items are selected, enable multi-drag
      if (selectedIds.has(draggedId) && selectedIds.size > 1) {
        setDraggingMultiple(true);
      } else {
        setDraggingMultiple(false);
      }
    },
    [isPageLocked, selectedIds],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id) {
        setDropTarget(null);
        return;
      }

      const overId = over.id as string;
      const overNode = findNodeById(tree, overId);

      if (!overNode) {
        setDropTarget(null);
        return;
      }

      // Determine drop position using the dragged item's current center position
      // compared to the target element's bounds
      const overRect = over.rect;

      // Get the current translated position of the dragged item
      // This accounts for the drag delta
      const activeRect = active.rect.current.translated;

      // Use the center Y of the dragged item
      const draggedCenterY = activeRect
        ? activeRect.top + activeRect.height / 2
        : overRect.top + overRect.height / 2;

      const relativeY = draggedCenterY - overRect.top;
      const threshold = overRect.height / 3;

      let position: "before" | "after" | "inside";

      if (relativeY < threshold) {
        position = "before";
      } else if (relativeY > overRect.height - threshold) {
        position = "after";
      } else {
        position = "inside";
      }

      setDropTarget({ targetId: overId, position });
    },
    [tree],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      const currentDropTarget = dropTarget;
      const wasMultiDrag = draggingMultiple;
      setDropTarget(null);
      setDraggingMultiple(false);

      if (!over || active.id === over.id || !currentDropTarget) {
        return;
      }

      const draggedId = active.id as string;
      const targetId = currentDropTarget.targetId;
      const position = currentDropTarget.position;

      const draggedNode = findNodeById(tree, draggedId);
      const targetNode = findNodeById(tree, targetId);

      if (!draggedNode || !targetNode) {
        return;
      }

      if (isPageLocked(draggedId) || isPageLocked(targetId)) {
        toast({
          variant: "destructive",
          title: "Move blocked",
          description: "Cannot move pages while AI edits are in progress.",
        });
        return;
      }

      // Prevent dropping a parent into its own children
      const isDescendantCheck = (
        parentId: string,
        childId: string,
      ): boolean => {
        const parent = findNodeById(tree, parentId);
        if (!parent?.children) return false;
        for (const child of parent.children) {
          if (child.id === childId || isDescendantCheck(child.id, childId)) {
            return true;
          }
        }
        return false;
      };

      // Determine target parent ID
      let targetParentId: string | null;
      if (position === "inside") {
        targetParentId = targetId;
      } else {
        targetParentId = targetNode.parent_id ?? null;
      }

      if (isPageLocked(targetParentId)) {
        toast({
          variant: "destructive",
          title: "Move blocked",
          description: "Cannot reorder children while the parent page is locked.",
        });
        return;
      }

      // Handle bulk move
      if (wasMultiDrag && selectedIds.size > 1) {
        const idsToMove = getSelectedIds();

        // Filter out any items that would create circular references
        const validIds = idsToMove.filter((id) => {
          if (isPageLocked(id)) {
            return false;
          }
          if (targetParentId && isDescendantCheck(id, targetParentId)) {
            return false;
          }
          return true;
        });

        if (validIds.length === 0) {
          toast({
            variant: "destructive",
            title: "Invalid move",
            description: "Cannot move pages into their own children",
          });
          return;
        }

        try {
          const result = await api.bulkMovePages(validIds, targetParentId);
          clearSelection();

          // Expand parent if dropping inside
          if (position === "inside") {
            setExpanded(targetId, true);
          }
      await refresh();

          if (result.failed && result.failed.length > 0) {
            toast({
              variant: "destructive",
              title: "Some moves failed",
              description: `${result.moved?.length || 0} moved, ${result.failed.length} failed`,
            });
          } else {
            toast({
              title: "Pages moved",
              description: `${validIds.length} pages moved successfully`,
            });
          }
        } catch (err) {
          console.error("Failed to bulk move pages:", err);
          toast({
            variant: "destructive",
            title: "Bulk move failed",
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        return;
      }

      // Single item move
      if (isDescendantCheck(draggedId, targetId)) {
        return;
      }

      // Build move params
      const moveParams: MovePageParams = {};

      if (position === "inside") {
        // Drop inside target - becomes child of target
        moveParams.target_parent_id = targetId;
        moveParams.target_project_id = targetNode.project_id;
        // First child - no after_sibling_id
      } else {
        // Drop before or after target - becomes sibling
        moveParams.target_parent_id = targetNode.parent_id;
        moveParams.target_project_id = targetNode.project_id;

        if (position === "after") {
          moveParams.after_sibling_id = targetId;
        } else {
          // before - find the previous sibling
          const siblings = findSiblings(tree, targetId);
          const prevSiblingId = getPreviousSiblingId(siblings, targetId);
          if (prevSiblingId) {
            moveParams.after_sibling_id = prevSiblingId;
          }
        }
      }

      try {
        await api.movePage(draggedId, moveParams);
        // Expand parent if dropping inside
          if (position === "inside") {
            setExpanded(targetId, true);
          }
          await refresh();
        toast({
          title: "Page moved",
          description: `"${draggedNode.title}" moved successfully`,
        });
      } catch (err) {
        console.error("Failed to move page:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        toast({
          variant: "destructive",
          title: "Move failed",
          description: errorMessage.includes("ROOT_LOCKED")
            ? "Cannot move project root pages"
            : errorMessage.includes("INVALID_MOVE")
              ? "Invalid move: check project boundaries"
              : errorMessage.includes("MAX_DEPTH")
                ? "Maximum nesting depth exceeded (6 levels)"
                : `Failed to move page: ${errorMessage}`,
        });
      }
    },
    [
      tree,
      dropTarget,
      draggingMultiple,
      selectedIds,
      isPageLocked,
      api,
      refresh,
      setExpanded,
      toast,
      clearSelection,
      getSelectedIds,
    ],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setDropTarget(null);
    setDraggingMultiple(false);
  }, []);

  // Separate workspace root pages and project roots
  const workspacePages = useMemo(
    () => tree.filter((node) => !node.project_id && !node.is_project_root),
    [tree],
  );
  const projectRoots = useMemo(
    () => tree.filter((node) => node.is_project_root),
    [tree],
  );
  const projectRootsById = useMemo(() => {
    const map = new Map<string, PageTreeNode>();
    for (const node of projectRoots) {
      if (node.project_id) {
        map.set(node.project_id, node);
      }
    }
    return map;
  }, [projectRoots]);

  const projectTopLevelsById = useMemo(() => {
    const map = new Map<string, PageTreeNode[]>();
    for (const node of tree) {
      if (node.project_id && !node.parent_id && !node.is_project_root) {
        const list = map.get(node.project_id);
        if (list) {
          list.push(node);
        } else {
          map.set(node.project_id, [node]);
        }
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.order_key.localeCompare(b.order_key));
    }
    return map;
  }, [tree]);

  const workspaceFlat = useMemo(
    () => (workspaceOpen ? flattenTree(workspacePages, expandedIds) : []),
    [workspaceOpen, workspacePages, expandedIds],
  );

  const projectSections = useMemo(() => {
    return visibleProjects.map((project) => {
      const root = projectRootsById.get(project.id);
      const topLevels = projectTopLevelsById.get(project.id) ?? [];
      const sourceNodes = root ? [root] : topLevels;
      const open = projectOpenMap[project.id] ?? false;
      const items = open ? flattenTree(sourceNodes, expandedIds) : [];
      const hasPages = sourceNodes.length > 0;
      return { project, root, open, items, hasPages };
    });
  }, [visibleProjects, projectRootsById, projectTopLevelsById, projectOpenMap, expandedIds]);

  const projectItems = useMemo(
    () => projectSections.flatMap((section) => section.items),
    [projectSections],
  );

  // Get the active node for drag overlay
  const activeNode = activeId ? findNodeById(tree, activeId) : null;

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <div className="space-y-2 pl-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-2">
        <Alert variant="destructive" className="text-xs">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error loading pages</AlertTitle>
          <AlertDescription className="mt-1">
            {error}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7 w-full text-xs"
              onClick={() => refresh()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ScrollArea className="h-full">
        <div
          ref={containerRef}
          className="space-y-4 p-2 outline-none"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          role="tree"
          aria-label="Page tree"
        >
          {/* Workspace Section */}
          <Collapsible open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
            <div className="flex items-center justify-between px-2">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70"
                >
                  <HardDrive className="h-3 w-3" />
                  Workspace
                  {workspaceOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <SortableContext
                items={workspaceFlat.map((f) => f.node.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-[1px]">
                  {workspaceOpen && workspacePages.length === 0 ? (
                    <p className="px-2 py-1 text-xs italic text-muted-foreground">
                      No pages yet
                    </p>
                  ) : (
                    workspaceFlat.map((item) => (
                      <SortableTreeItem
                        key={item.node.id}
                        node={item.node}
                        flatIndex={item.flatIndex}
                        level={item.level}
                        selectedId={selectedPageId}
                        onSelect={onSelectPage}
                        workspaceId={workspaceId}
                        onRefresh={refresh}
                        onPageDeleted={onPageDeleted}
                        isDropTarget={dropTarget?.targetId === item.node.id}
                        dropPosition={
                          dropTarget && dropTarget.targetId === item.node.id
                            ? dropTarget.position
                            : null
                        }
                        isFocused={focusedId === item.node.id}
                        dragDisabled={isPageLocked(item.node.id)}
                        writeLocked={isPageLocked(item.node.id)}
                      />
                    ))
                  )}
                </div>
              </SortableContext>
            </CollapsibleContent>
          </Collapsible>

          {/* Project Sections */}
          {visibleProjects.length === 0 ? (
            <div className="px-2">
              <p className="py-1 text-xs italic text-muted-foreground">No projects yet</p>
            </div>
          ) : (
            <SortableContext
              items={projectItems.map((f) => f.node.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {projectSections.map((section) => (
                  <Collapsible
                    key={section.project.id}
                    open={section.open}
                    onOpenChange={(open) =>
                      setProjectOpenMap((prev) => ({
                        ...prev,
                        [section.project.id]: open,
                      }))
                    }
                  >
                    <div className="flex items-center justify-between px-2 py-1">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex items-center gap-2 text-xs font-medium text-foreground"
                        >
                          {section.open ? (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor:
                                section.project.color || "var(--color-primary)",
                            }}
                          />
                          <span className="truncate">{section.project.name}</span>
                        </button>
                      </CollapsibleTrigger>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                        onClick={() =>
                          handleCreateProjectPage(
                            section.project.id,
                            section.project.name,
                          )
                        }
                        disabled={
                          !workspaceId ||
                          creatingProjectId === section.project.id ||
                          isPageLocked(section.root?.id ?? null)
                        }
                        aria-label={`New page in ${section.project.name}`}
                      >
                        {creatingProjectId === section.project.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <CollapsibleContent>
                      <div className="space-y-[1px]">
                        {!section.hasPages ? (
                          <p className="px-2 py-1 text-xs italic text-muted-foreground">
                            No pages yet
                          </p>
                        ) : (
                          section.items.map((item) => (
                            <SortableTreeItem
                              key={item.node.id}
                              node={item.node}
                              flatIndex={item.flatIndex}
                              level={item.level}
                              selectedId={selectedPageId}
                              onSelect={onSelectPage}
                              workspaceId={workspaceId}
                              onRefresh={refresh}
                              onPageDeleted={onPageDeleted}
                              isDropTarget={dropTarget?.targetId === item.node.id}
                              dropPosition={
                                dropTarget && dropTarget.targetId === item.node.id
                                  ? dropTarget.position
                                  : null
                              }
                              isFocused={focusedId === item.node.id}
                              dragDisabled={
                                item.node.is_project_root || isPageLocked(item.node.id)
                              }
                              writeLocked={isPageLocked(item.node.id)}
                            />
                          ))
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            </SortableContext>
          )}
        </div>
      </ScrollArea>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeNode && (
          <div className="rounded-md bg-background shadow-lg ring-1 ring-border/50">
            {draggingMultiple ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                  {selectedIds.size}
                </span>
                <span>pages</span>
              </div>
            ) : (
              <TreeItem
                node={activeNode}
                selectedId={null}
                onSelect={() => {}}
                workspaceId={workspaceId}
                isDragging
                dragDisabled
              />
            )}
          </div>
        )}
      </DragOverlay>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog
        open={showBulkDeleteDialog}
        onOpenChange={setShowBulkDeleteDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} pages?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the selected pages and all their subpages. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DndContext>
  );
}
