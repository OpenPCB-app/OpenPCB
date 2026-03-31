import { useCallback, useEffect, useRef } from "react";
import { useTreeStore, findNodeById } from "../stores/tree-store";
import type { PageTreeNode } from "../../shared/types";

interface UseTreeKeyboardNavOptions {
  tree: PageTreeNode[];
  onSelectPage: (id: string) => void;
  selectedPageId: string | null;
  /** Callback when Delete key pressed with selection */
  onBulkDelete?: () => void;
}

/**
 * Hook for tree keyboard navigation
 *
 * Supports:
 * - Arrow Up/Down: Move focus between visible nodes
 * - Arrow Left: Collapse node or move to parent
 * - Arrow Right: Expand node or move to first child
 * - Enter/Space: Select focused node
 * - Home: Focus first node
 * - End: Focus last node
 * - Ctrl/Cmd+A: Select all visible pages
 * - Delete/Backspace: Bulk delete selected (triggers onBulkDelete)
 * - Escape: Clear selection
 */
export function useTreeKeyboardNav({
  tree,
  onSelectPage,
  selectedPageId,
  onBulkDelete,
}: UseTreeKeyboardNavOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    focusedId,
    setFocused,
    expandedIds,
    isExpanded,
    setExpanded,
    selectedIds,
    selectAll,
    clearSelection,
  } = useTreeStore();

  // Get visible nodes based on current expansion state
  const getVisibleNodes = useCallback((): PageTreeNode[] => {
    const result: PageTreeNode[] = [];

    const traverse = (nodes: PageTreeNode[]) => {
      for (const node of nodes) {
        result.push(node);
        if (node.children && node.children.length > 0 && expandedIds.has(node.id)) {
          traverse(node.children);
        }
      }
    };

    traverse(tree);
    return result;
  }, [tree, expandedIds]);

  // Find parent of a node
  const findParentId = useCallback(
    (nodeId: string): string | null => {
      const node = findNodeById(tree, nodeId);
      return node?.parent_id ?? null;
    },
    [tree]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const visibleNodes = getVisibleNodes();
      if (visibleNodes.length === 0) return;

      // Find current focus index
      const currentIndex = focusedId
        ? visibleNodes.findIndex((n) => n.id === focusedId)
        : -1;

      const focusNode = (index: number) => {
        const node = visibleNodes[index];
        if (index >= 0 && index < visibleNodes.length && node) {
          setFocused(node.id);
          // Scroll into view if needed
          const element = containerRef.current?.querySelector(
            `[data-node-id="${node.id}"]`
          );
          element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (currentIndex === -1) {
            focusNode(0);
          } else if (currentIndex < visibleNodes.length - 1) {
            focusNode(currentIndex + 1);
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (currentIndex === -1) {
            focusNode(visibleNodes.length - 1);
          } else if (currentIndex > 0) {
            focusNode(currentIndex - 1);
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (focusedId) {
            const node = findNodeById(tree, focusedId);
            const children = node?.children;
            if (children && children.length > 0) {
              if (!isExpanded(focusedId)) {
                // Expand if collapsed
                setExpanded(focusedId, true);
              } else {
                // Move to first child if already expanded
                const firstChild = children[0];
                if (firstChild) {
                  const childIndex = visibleNodes.findIndex(
                    (n) => n.id === firstChild.id
                  );
                  if (childIndex !== -1) {
                    focusNode(childIndex);
                  }
                }
              }
            }
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (focusedId) {
            if (isExpanded(focusedId)) {
              // Collapse if expanded
              setExpanded(focusedId, false);
            } else {
              // Move to parent if collapsed
              const parentId = findParentId(focusedId);
              if (parentId) {
                const parentIndex = visibleNodes.findIndex(
                  (n) => n.id === parentId
                );
                if (parentIndex !== -1) {
                  focusNode(parentIndex);
                }
              }
            }
          }
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedId) {
            onSelectPage(focusedId);
          }
          break;

        case "Home":
          e.preventDefault();
          focusNode(0);
          break;

        case "End":
          e.preventDefault();
          focusNode(visibleNodes.length - 1);
          break;

        case "a":
          // Ctrl/Cmd+A: Select all
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            selectAll();
          }
          break;

        case "Delete":
        case "Backspace":
          // Delete selected items (triggers confirmation dialog)
          if (selectedIds.size > 0) {
            e.preventDefault();
            onBulkDelete?.();
          }
          break;

        case "Escape":
          // Clear selection
          if (selectedIds.size > 0) {
            e.preventDefault();
            clearSelection();
          }
          break;

        default:
          break;
      }
    },
    [
      focusedId,
      getVisibleNodes,
      setFocused,
      isExpanded,
      setExpanded,
      findParentId,
      onSelectPage,
      tree,
      selectedIds,
      selectAll,
      clearSelection,
      onBulkDelete,
    ]
  );

  // Initialize focus to selected page
  useEffect(() => {
    if (selectedPageId && !focusedId) {
      setFocused(selectedPageId);
    }
  }, [selectedPageId, focusedId, setFocused]);

  return {
    containerRef,
    focusedId,
    handleKeyDown,
  };
}
