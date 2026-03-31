import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PageTreeNode } from "../../shared/types";

type VisibleNode = PageTreeNode & { depth: number };

interface TreeState {
  /** The actual tree data */
  tree: PageTreeNode[];
  /** Workspace that the tree belongs to */
  workspaceId: string | null;
  /** Set of expanded node IDs */
  expandedIds: Set<string>;
  /** Currently focused node ID (for keyboard nav) */
  focusedId: string | null;
  /** Flattened visible nodes for keyboard navigation */
  visibleNodes: VisibleNode[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: string | null;
  /** Set of selected node IDs for multi-selection */
  selectedIds: Set<string>;
  /** Last selected node ID for range selection */
  lastSelectedId: string | null;
  /** Token to trigger tree refresh */
  refreshToken: number;
}

interface TreeActions {
  /** Set the tree data */
  setTree: (tree: PageTreeNode[]) => void;
  /** Set current workspace ID for the tree */
  setWorkspaceId: (workspaceId: string | null) => void;
  /** Set loading state */
  setIsLoading: (isLoading: boolean) => void;
  /** Set error state */
  setError: (error: string | null) => void;
  /** Trigger a tree refresh */
  requestRefresh: () => void;
  /** Toggle node expansion */
  toggleExpanded: (id: string) => void;
  /** Set node as expanded */
  setExpanded: (id: string, expanded: boolean) => void;
  /** Expand all ancestors of a node */
  expandAncestors: (nodeId: string) => void;
  /** Set focused node for keyboard navigation */
  setFocused: (id: string | null) => void;
  /** Update visible nodes list */
  updateVisibleNodes: () => void;
  /** Check if node is expanded */
  isExpanded: (id: string) => boolean;
  /** Clear all expansion state */
  reset: () => void;
  /** Toggle selection of a single node */
  toggleSelected: (id: string) => void;
  /** Select range of nodes from last selected to target */
  selectRange: (toId: string) => void;
  /** Select all visible nodes */
  selectAll: () => void;
  /** Clear all selection */
  clearSelection: () => void;
  /** Check if node is selected */
  isSelected: (id: string) => boolean;
  /** Get array of selected IDs */
  getSelectedIds: () => string[];
}

type TreeStore = TreeState & TreeActions;

/**
 * Find a node by ID in the tree
 */
function findNodeById(tree: PageTreeNode[], id: string): PageTreeNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find parent node of a given node ID
 */
function findParentNode(
  tree: PageTreeNode[],
  id: string,
  parent: PageTreeNode | null = null
): PageTreeNode | null {
  for (const node of tree) {
    if (node.id === id) return parent;
    if (node.children) {
      const found = findParentNode(node.children, id, node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get all ancestor IDs of a node
 */
function getAncestorIds(tree: PageTreeNode[], nodeId: string): string[] {
  const ancestors: string[] = [];
  let currentId = nodeId;

  while (true) {
    const parent = findParentNode(tree, currentId);
    if (!parent) break;
    ancestors.push(parent.id);
    currentId = parent.id;
  }

  return ancestors;
}

/**
 * Flatten tree to visible nodes based on expansion state
 */
function flattenVisibleNodes(
  tree: PageTreeNode[],
  expandedIds: Set<string>,
  depth = 0
): VisibleNode[] {
  const result: VisibleNode[] = [];

  for (const node of tree) {
    result.push({ ...node, depth });

    if (node.children && node.children.length > 0 && expandedIds.has(node.id)) {
      result.push(...flattenVisibleNodes(node.children, expandedIds, depth + 1));
    }
  }

  return result;
}

function isDescendant(
  tree: PageTreeNode[],
  ancestorId: string,
  nodeId: string
): boolean {
  const ancestor = findNodeById(tree, ancestorId);
  if (!ancestor?.children) return false;

  const stack = [...ancestor.children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.id === nodeId) return true;
    if (current.children) {
      stack.push(...current.children);
    }
  }

  return false;
}

export const useTreeStore = create<TreeStore>()(
  persist(
    (set, get) => ({
      tree: [],
      workspaceId: null,
      expandedIds: new Set<string>(),
      focusedId: null,
      visibleNodes: [],
      isLoading: false,
      error: null,
      selectedIds: new Set<string>(),
      lastSelectedId: null,
      refreshToken: 0,

      setTree: (tree) => {
        set({ tree });
        get().updateVisibleNodes();
      },

      setWorkspaceId: (workspaceId) => {
        set((state) => {
          if (state.workspaceId === workspaceId) return state;
          return {
            workspaceId,
            tree: [],
            expandedIds: new Set<string>(),
            focusedId: null,
            visibleNodes: [],
            isLoading: false,
            error: null,
            selectedIds: new Set<string>(),
            lastSelectedId: null,
            refreshToken: 0,
          };
        });
      },

      setIsLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      requestRefresh: () => set((state) => ({ refreshToken: state.refreshToken + 1 })),

      toggleExpanded: (id) => {
        set((state) => {
          const newExpanded = new Set(state.expandedIds);
          if (newExpanded.has(id)) {
            newExpanded.delete(id);
          } else {
            newExpanded.add(id);
          }
          return { expandedIds: newExpanded };
        });
        get().updateVisibleNodes();
      },

      setExpanded: (id, expanded) => {
        set((state) => {
          const newExpanded = new Set(state.expandedIds);
          if (expanded) {
            newExpanded.add(id);
          } else {
            newExpanded.delete(id);
          }
          return { expandedIds: newExpanded };
        });
        get().updateVisibleNodes();
      },

      expandAncestors: (nodeId) => {
        const { tree } = get();
        const ancestors = getAncestorIds(tree, nodeId);
        set((state) => {
          const newExpanded = new Set(state.expandedIds);
          ancestors.forEach((id) => newExpanded.add(id));
          return { expandedIds: newExpanded };
        });
        get().updateVisibleNodes();
      },

      setFocused: (id) => {
        set({ focusedId: id });
      },

      updateVisibleNodes: () => {
        const { tree, expandedIds } = get();
        const visible = flattenVisibleNodes(tree, expandedIds);
        set({ visibleNodes: visible });
      },

      isExpanded: (id) => {
        return get().expandedIds.has(id);
      },

      reset: () => {
        set({
          tree: [],
          workspaceId: null,
          expandedIds: new Set(),
          focusedId: null,
          visibleNodes: [],
          isLoading: false,
          error: null,
          selectedIds: new Set(),
          lastSelectedId: null,
          refreshToken: 0,
        });
      },

      // Selection actions
      toggleSelected: (id) => {
        set((state) => {
          const newSelected = new Set(state.selectedIds);
          if (newSelected.has(id)) {
            newSelected.delete(id);
          } else {
            newSelected.add(id);
          }
          return { selectedIds: newSelected, lastSelectedId: id };
        });
      },

      selectRange: (toId) => {
        const { visibleNodes, lastSelectedId, selectedIds } = get();
        if (!lastSelectedId) {
          // No previous selection, just select the target
          set({ selectedIds: new Set([toId]), lastSelectedId: toId });
          return;
        }

        const fromIdx = visibleNodes.findIndex((n) => n.id === lastSelectedId);
        const toIdx = visibleNodes.findIndex((n) => n.id === toId);

        if (fromIdx === -1 || toIdx === -1) return;

        const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const newSelected = new Set(selectedIds);

        for (let i = start; i <= end; i++) {
          const node = visibleNodes[i];
          if (node) {
            newSelected.add(node.id);
          }
        }

        set({ selectedIds: newSelected });
      },

      selectAll: () => {
        const { visibleNodes } = get();
        const allIds = new Set(visibleNodes.map((n) => n.id));
        set({ selectedIds: allIds });
      },

      clearSelection: () => {
        set({ selectedIds: new Set(), lastSelectedId: null });
      },

      isSelected: (id) => {
        return get().selectedIds.has(id);
      },

      getSelectedIds: () => {
        return Array.from(get().selectedIds);
      },
    }),
    {
      name: "knowledge:tree-state",
      partialize: (state) => ({
        // Only persist expanded IDs
        expandedIds: Array.from(state.expandedIds),
      }),
      merge: (persisted, current) => {
        const saved = persisted as { expandedIds?: string[] } | undefined;
        const expandedIds = Array.isArray(saved?.expandedIds)
          ? saved!.expandedIds
          : [];
        return {
          ...current,
          expandedIds: new Set(expandedIds),
        };
      },
    }
  )
);

// Utility exports
export {
  findNodeById,
  findParentNode,
  getAncestorIds,
  flattenVisibleNodes,
  isDescendant,
};
export type { TreeStore };
