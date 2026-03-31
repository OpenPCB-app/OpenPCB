import { PageRepository } from "../db/repositories/page-repository";
import {
  firstOrderKey,
  orderKeyBetween,
  rebalanceOrderKeys,
} from "./order-key-generator";
import type {
  Page,
  PageTreeNode,
  EditorContent,
  PageProperties,
  CreatePageParams,
  MovePageParams,
  BulkDeleteResult,
  BulkMoveResult,
} from "../../shared/types";
import type { KnowledgePage } from "../db/schema";

function toPage(row: KnowledgePage): Page {
  return {
    ...row,
    is_project_root: row.is_project_root ?? false,
    properties_json: (row.properties_json ?? {}) as PageProperties,
    content_json: row.content_json as EditorContent,
    revision: row.revision ?? 1,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export class PageContentConflictError extends Error {
  readonly code = "CONTENT_CONFLICT";
  readonly page: Page;

  constructor(page: Page) {
    super("CONTENT_CONFLICT");
    this.name = "PageContentConflictError";
    this.page = page;
  }
}

export class PageService {
  private static readonly MAX_DEPTH = 6;

  constructor(private repo: PageRepository) {}

  async createPage(params: CreatePageParams): Promise<Page> {
    if (params.parent_id) {
      const parentDepth = await this.calculateDepth(params.parent_id);
      if (parentDepth >= PageService.MAX_DEPTH) {
        throw new Error("MAX_DEPTH");
      }
    }

    const siblings = await this.repo.getSiblings(
      params.parent_id ?? null,
      params.project_id ?? null,
      params.workspace_id,
    );

    let orderKey: string;

    if (params.after_sibling_id) {
      const afterIdx = siblings.findIndex(
        (s) => s.id === params.after_sibling_id,
      );
      const before = afterIdx >= 0 ? siblings[afterIdx]!.order_key : null;
      const after =
        afterIdx + 1 < siblings.length
          ? siblings[afterIdx + 1]!.order_key
          : null;

      const newKey = orderKeyBetween(before, after);
      if (newKey) {
        orderKey = newKey;
      } else {
        const newKeys = rebalanceOrderKeys(siblings.length + 1);
        await this.rebalanceSiblings(siblings, newKeys);
        orderKey = newKeys[afterIdx + 1] ?? firstOrderKey();
      }
    } else {
      const lastKey =
        siblings.length > 0 ? siblings[siblings.length - 1]!.order_key : null;
      const newKey = orderKeyBetween(lastKey, null);
      orderKey = newKey ?? firstOrderKey();
    }

    const row = await this.repo.create({
      workspace_id: params.workspace_id,
      project_id: params.project_id ?? null,
      parent_id: params.parent_id ?? null,
      title: params.title,
      order_key: orderKey,
      content_json: {
        engine: "tiptap",
        version: 1,
        data: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });

    return toPage(row);
  }

  async getPage(pageId: string): Promise<Page | null> {
    const row = await this.repo.findById(pageId);
    return row ? toPage(row) : null;
  }

  async updatePageMeta(
    pageId: string,
    updates: {
      title?: string;
      icon?: string;
      properties_json?: PageProperties;
    },
  ): Promise<Page> {
    const row = await this.repo.updateMeta(pageId, updates);
    return toPage(row);
  }

  async updatePageContent(
    pageId: string,
    content: EditorContent,
    expectedUpdatedAt?: Date,
  ): Promise<Page> {
    const row = await this.repo.updateContent(pageId, content, expectedUpdatedAt);
    if (row) {
      return toPage(row);
    }

    const current = await this.repo.findById(pageId);
    if (current) {
      if (expectedUpdatedAt) {
        throw new PageContentConflictError(toPage(current));
      }
      throw new Error("PAGE_NOT_FOUND");
    }

    const deleted = await this.repo.findByIdIncludeDeleted(pageId);
    if (deleted) {
      throw new Error("PAGE_DELETED");
    }

    throw new Error("PAGE_NOT_FOUND");
  }

  async movePage(pageId: string, target: MovePageParams): Promise<Page> {
    const page = await this.repo.findById(pageId);
    if (!page) {
      throw new Error("PAGE_NOT_FOUND");
    }

    if (page.is_project_root) {
      throw new Error("ROOT_LOCKED");
    }

    const targetProjectId = target.target_project_id ?? page.project_id;
    const targetParentId = target.target_parent_id ?? null;

    if (targetParentId === pageId) {
      throw new Error("CIRCULAR_REFERENCE");
    }

    if (targetParentId) {
      const createsCycle = await this.repo.isAncestor(pageId, targetParentId);
      if (createsCycle) {
        throw new Error("CIRCULAR_REFERENCE");
      }
    }

    if (
      targetProjectId !== undefined &&
      page.project_id !== null &&
      targetProjectId !== page.project_id
    ) {
      throw new Error("INVALID_MOVE");
    }

    // Check depth limit (target depth + subtree depth)
    if (targetParentId) {
      const targetDepth = await this.calculateDepth(targetParentId);
      const subtreeDepth = await this.calculateSubtreeDepth(pageId);
      if (targetDepth + subtreeDepth > PageService.MAX_DEPTH) {
        throw new Error("MAX_DEPTH");
      }
    } else {
      const subtreeDepth = await this.calculateSubtreeDepth(pageId);
      if (subtreeDepth > PageService.MAX_DEPTH) {
        throw new Error("MAX_DEPTH");
      }
    }

    const siblings = (
      await this.repo.getSiblings(
        targetParentId,
        targetProjectId,
        page.workspace_id,
      )
    ).filter((s) => s.id !== pageId);

    let orderKey: string;

    if (target.after_sibling_id) {
      const afterIdx = siblings.findIndex(
        (s) => s.id === target.after_sibling_id,
      );
      const before = afterIdx >= 0 ? siblings[afterIdx]!.order_key : null;
      const after =
        afterIdx + 1 < siblings.length
          ? siblings[afterIdx + 1]!.order_key
          : null;

      const newKey = orderKeyBetween(before, after);
      if (newKey) {
        orderKey = newKey;
      } else {
        const newKeys = rebalanceOrderKeys(siblings.length + 1);
        await this.rebalanceSiblings(siblings, newKeys);
        orderKey = newKeys[afterIdx + 1] ?? firstOrderKey();
      }
    } else {
      const firstKey = siblings[0]?.order_key ?? null;
      const newKey = orderKeyBetween(null, firstKey);
      orderKey = newKey ?? firstOrderKey();
    }

    const row = await this.repo.move(pageId, {
      parent_id: targetParentId,
      project_id: targetProjectId,
      order_key: orderKey,
    });

    return toPage(row);
  }

  async softDeletePage(pageId: string): Promise<void> {
    const page = await this.repo.findById(pageId);
    if (!page) {
      throw new Error("PAGE_NOT_FOUND");
    }

    if (page.is_project_root) {
      throw new Error("ROOT_LOCKED");
    }

    await this.repo.softDelete(pageId);
    await this.repo.softDeleteChildren(pageId);
  }

  async restorePage(pageId: string): Promise<Page> {
    const page = await this.repo.findByIdIncludeDeleted(pageId);
    if (!page) {
      throw new Error("PAGE_NOT_FOUND");
    }

    const row = await this.repo.restore(pageId);
    return toPage(row);
  }

  async ensureProjectRoot(params: {
    workspace_id: string;
    project_id: string;
    title: string;
  }): Promise<Page> {
    const existing = await this.repo.findProjectRoot(
      params.project_id,
      params.workspace_id,
    );
    if (existing) {
      return toPage(existing);
    }

    const row = await this.repo.create({
      workspace_id: params.workspace_id,
      project_id: params.project_id,
      parent_id: null,
      is_project_root: true,
      title: params.title,
      order_key: firstOrderKey(),
      content_json: {
        engine: "tiptap",
        version: 1,
        data: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });

    return toPage(row);
  }

  async getWorkspaceTree(workspaceId: string): Promise<PageTreeNode[]> {
    return this.repo.buildTree(null, undefined, workspaceId);
  }

  async getProjectTree(
    projectId: string,
    workspaceId: string,
  ): Promise<PageTreeNode[]> {
    return this.repo.buildTree(null, projectId, workspaceId);
  }

  async getBreadcrumb(pageId: string): Promise<string[]> {
    return this.repo.getBreadcrumb(pageId);
  }

  private async calculateDepth(pageId: string): Promise<number> {
    let depth = 0;
    let currentId: string | null = pageId;

    while (currentId && depth < PageService.MAX_DEPTH + 1) {
      const page = await this.repo.findById(currentId);
      if (!page) break;
      currentId = page.parent_id;
      depth++;
    }

    return depth;
  }

  private async calculateSubtreeDepth(pageId: string): Promise<number> {
    const page = await this.repo.findById(pageId);
    if (!page) {
      return 1;
    }

    const children = await this.repo.findByParent(
      pageId,
      page.project_id,
      page.workspace_id,
    );
    if (children.length === 0) {
      return 1;
    }

    let maxChildDepth = 0;
    for (const child of children) {
      const childDepth = await this.calculateSubtreeDepth(child.id);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }

    return maxChildDepth + 1;
  }

  private async rebalanceSiblings(
    siblings: Array<{ id: string; order_key: string }>,
    newKeys: string[],
  ): Promise<void> {
    const updates = siblings.map((s, i) => ({
      id: s.id,
      order_key: newKeys[i] ?? s.order_key,
    }));
    await this.repo.updateSiblingOrderKeys(updates);
  }

  /**
   * Filter page IDs to only include top-level pages
   * (removes children of other pages in the list to avoid double-delete)
   */
  private async filterTopLevelPages(pageIds: string[]): Promise<string[]> {
    const idSet = new Set(pageIds);
    const topLevel: string[] = [];

    for (const id of pageIds) {
      const page = await this.repo.findById(id);
      if (!page) continue;

      // Check if any ancestor is in the list
      let ancestorInList = false;
      let currentId = page.parent_id;
      while (currentId) {
        if (idSet.has(currentId)) {
          ancestorInList = true;
          break;
        }
        const parent = await this.repo.findById(currentId);
        currentId = parent?.parent_id ?? null;
      }

      if (!ancestorInList) {
        topLevel.push(id);
      }
    }

    return topLevel;
  }

  /**
   * Bulk delete pages - only deletes top-level pages (children cascade)
   */
  async bulkDeletePages(pageIds: string[]): Promise<BulkDeleteResult> {
    const deleted: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    // Filter to top-level only to avoid double-delete
    const topLevelIds = await this.filterTopLevelPages(pageIds);

    for (const id of topLevelIds) {
      try {
        await this.softDeletePage(id);
        deleted.push(id);
      } catch (e) {
        failed.push({
          id,
          reason: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }

    return { deleted, failed };
  }

  /**
   * Bulk move pages to a new parent
   */
  async bulkMovePages(
    pageIds: string[],
    targetParentId: string | null,
  ): Promise<BulkMoveResult> {
    const moved: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    let afterSiblingId: string | undefined;

    for (const id of pageIds) {
      try {
        await this.movePage(id, {
          target_parent_id: targetParentId,
          after_sibling_id: afterSiblingId,
        });
        moved.push(id);
        // Set after_sibling_id for next move to maintain order
        afterSiblingId = id;
      } catch (e) {
        failed.push({
          id,
          reason: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }

    return { moved, failed };
  }
}
