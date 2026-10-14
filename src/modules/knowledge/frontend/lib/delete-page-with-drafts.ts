import type { PageTreeNode } from "../../shared/types";
import type { KnowledgeApi } from "../hooks/useKnowledgeApi";
import { getPageSaveCoordinator } from "./page-save-coordinator";

function descendantIds(tree: readonly PageTreeNode[], id: string): string[] {
  for (const node of tree) {
    if (node.id === id) {
      const collect = (item: PageTreeNode): string[] => [
        item.id,
        ...(item.children ?? []).flatMap(collect),
      ];
      return collect(node);
    }
    const found = descendantIds(node.children ?? [], id);
    if (found.length) return found;
  }
  return [];
}

export async function deletePageWithDrafts(
  api: KnowledgeApi,
  tree: readonly PageTreeNode[],
  id: string,
): Promise<void> {
  const ids = descendantIds(tree, id);
  const resume = getPageSaveCoordinator(api).suspendDeletion(
    ids.length ? ids : [id],
  );
  try {
    if (!(await api.deletePage(id)))
      throw new Error("Page deletion was not acknowledged");
  } catch (error) {
    resume();
    throw error;
  }
}
