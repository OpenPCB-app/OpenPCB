import { eq, and, isNull, asc, desc, like, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import {
  knowledge_page,
  type KnowledgePage,
  type NewKnowledgePage,
} from "../schema";
import type {
  PageProperties,
  EditorContent,
  PageTreeNode,
  PageSearchResult,
} from "../../../shared/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = BunSQLiteDatabase<any>;

export class PageRepository {
  constructor(private db: DbInstance) {}

  async create(data: NewKnowledgePage): Promise<KnowledgePage> {
    const [page] = await this.db
      .insert(knowledge_page)
      .values(data)
      .returning();
    return page!;
  }

  async findById(id: string): Promise<KnowledgePage | null> {
    const [page] = await this.db
      .select()
      .from(knowledge_page)
      .where(and(eq(knowledge_page.id, id), isNull(knowledge_page.deleted_at)));
    return page ?? null;
  }

  async findByIdIncludeDeleted(id: string): Promise<KnowledgePage | null> {
    const [page] = await this.db
      .select()
      .from(knowledge_page)
      .where(eq(knowledge_page.id, id));
    return page ?? null;
  }

  async findRootPages(workspaceId: string): Promise<KnowledgePage[]> {
    return this.db
      .select()
      .from(knowledge_page)
      .where(
        and(
          eq(knowledge_page.workspace_id, workspaceId),
          isNull(knowledge_page.parent_id),
          isNull(knowledge_page.deleted_at),
        ),
      )
      .orderBy(asc(knowledge_page.order_key));
  }

  async findChildPages(
    parentId: string,
    workspaceId: string,
  ): Promise<KnowledgePage[]> {
    return this.db
      .select()
      .from(knowledge_page)
      .where(
        and(
          eq(knowledge_page.workspace_id, workspaceId),
          eq(knowledge_page.parent_id, parentId),
          isNull(knowledge_page.deleted_at),
        ),
      )
      .orderBy(asc(knowledge_page.order_key));
  }

  async findByParent(
    parentId: string | null,
    projectId: string | null,
    workspaceId: string,
  ): Promise<KnowledgePage[]> {
    const conditions = [
      eq(knowledge_page.workspace_id, workspaceId),
      isNull(knowledge_page.deleted_at),
    ];

    if (parentId) {
      conditions.push(eq(knowledge_page.parent_id, parentId));
    } else {
      conditions.push(isNull(knowledge_page.parent_id));
    }

    if (projectId) {
      conditions.push(eq(knowledge_page.project_id, projectId));
    } else {
      conditions.push(isNull(knowledge_page.project_id));
    }

    return this.db
      .select()
      .from(knowledge_page)
      .where(and(...conditions))
      .orderBy(asc(knowledge_page.order_key));
  }

  async findProjectRoot(
    projectId: string,
    workspaceId: string,
  ): Promise<KnowledgePage | null> {
    const [page] = await this.db
      .select()
      .from(knowledge_page)
      .where(
        and(
          eq(knowledge_page.workspace_id, workspaceId),
          eq(knowledge_page.project_id, projectId),
          eq(knowledge_page.is_project_root, true),
          isNull(knowledge_page.deleted_at),
        ),
      );
    return page ?? null;
  }

  async updateMeta(
    id: string,
    updates: {
      title?: string;
      icon?: string;
      properties_json?: PageProperties;
    },
  ): Promise<KnowledgePage> {
    const [page] = await this.db
      .update(knowledge_page)
      .set({
        ...updates,
        revision: sql`${knowledge_page.revision} + 1`,
        updated_at: new Date(),
      })
      .where(eq(knowledge_page.id, id))
      .returning();
    return page!;
  }

  async updateContent(
    id: string,
    content: EditorContent,
    expectedUpdatedAt?: Date,
  ): Promise<KnowledgePage | null> {
    const conditions = [
      eq(knowledge_page.id, id),
      isNull(knowledge_page.deleted_at),
    ];

    if (expectedUpdatedAt) {
      conditions.push(eq(knowledge_page.updated_at, expectedUpdatedAt));
    }

    const [page] = await this.db
      .update(knowledge_page)
      .set({
        content_json: content,
        content_engine: content.engine,
        content_version: content.version,
        revision: sql`${knowledge_page.revision} + 1`,
        updated_at: new Date(),
      })
      .where(and(...conditions))
      .returning();

    return page ?? null;
  }

  async move(
    id: string,
    params: {
      parent_id?: string | null;
      project_id?: string | null;
      order_key: string;
    },
  ): Promise<KnowledgePage> {
    const updateData: Record<string, unknown> = {
      order_key: params.order_key,
      updated_at: new Date(),
    };

    if (params.parent_id !== undefined) {
      updateData.parent_id = params.parent_id;
    }

    if (params.project_id !== undefined) {
      updateData.project_id = params.project_id;
    }

    const [page] = await this.db
      .update(knowledge_page)
      .set(updateData)
      .where(eq(knowledge_page.id, id))
      .returning();
    return page!;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(knowledge_page)
      .set({ deleted_at: new Date() })
      .where(eq(knowledge_page.id, id));
  }

  async softDeleteChildren(parentId: string): Promise<void> {
    const children = await this.db
      .select({ id: knowledge_page.id })
      .from(knowledge_page)
      .where(
        and(
          eq(knowledge_page.parent_id, parentId),
          isNull(knowledge_page.deleted_at),
        ),
      );

    for (const child of children) {
      await this.softDelete(child.id);
      await this.softDeleteChildren(child.id);
    }
  }

  async detachProjectPages(
    workspaceId: string,
    projectId: string,
  ): Promise<void> {
    const now = new Date();
    const root = await this.findProjectRoot(projectId, workspaceId);

    await this.db
      .update(knowledge_page)
      .set({
        project_id: null,
        updated_at: now,
      })
      .where(
        and(
          eq(knowledge_page.workspace_id, workspaceId),
          eq(knowledge_page.project_id, projectId),
          isNull(knowledge_page.deleted_at),
          root ? sql`${knowledge_page.id} != ${root.id}` : sql`1 = 1`,
        ),
      );

    if (!root) {
      return;
    }

    await this.db
      .update(knowledge_page)
      .set({
        parent_id: null,
        updated_at: now,
      })
      .where(
        and(
          eq(knowledge_page.parent_id, root.id),
          isNull(knowledge_page.deleted_at),
        ),
      );

    await this.db
      .update(knowledge_page)
      .set({
        deleted_at: now,
        updated_at: now,
      })
      .where(eq(knowledge_page.id, root.id));
  }

  async restore(id: string): Promise<KnowledgePage> {
    const [page] = await this.db
      .update(knowledge_page)
      .set({ deleted_at: null, updated_at: new Date() })
      .where(eq(knowledge_page.id, id))
      .returning();
    return page!;
  }

  async searchByTitle(
    workspaceId: string,
    query: string,
    scope: "all" | "workspace" | "projects" = "all",
    limit = 20,
  ): Promise<PageSearchResult[]> {
    const conditions = [
      eq(knowledge_page.workspace_id, workspaceId),
      like(knowledge_page.title, `%${query}%`),
      isNull(knowledge_page.deleted_at),
    ];

    if (scope === "workspace") {
      conditions.push(isNull(knowledge_page.project_id));
    } else if (scope === "projects") {
      conditions.push(sql`${knowledge_page.project_id} IS NOT NULL`);
    }

    const results = await this.db
      .select({
        id: knowledge_page.id,
        title: knowledge_page.title,
        icon: knowledge_page.icon,
        project_id: knowledge_page.project_id,
        parent_id: knowledge_page.parent_id,
        updated_at: knowledge_page.updated_at,
      })
      .from(knowledge_page)
      .where(and(...conditions))
      .orderBy(asc(knowledge_page.project_id), desc(knowledge_page.updated_at))
      .limit(limit);

    return results.map((r) => ({
      ...r,
      updated_at: new Date(r.updated_at),
    }));
  }

  async getSiblings(
    parentId: string | null,
    projectId: string | null,
    workspaceId: string,
  ): Promise<Array<{ id: string; order_key: string }>> {
    const conditions = [
      eq(knowledge_page.workspace_id, workspaceId),
      isNull(knowledge_page.deleted_at),
    ];

    if (parentId) {
      conditions.push(eq(knowledge_page.parent_id, parentId));
    } else {
      conditions.push(isNull(knowledge_page.parent_id));
    }

    if (projectId) {
      conditions.push(eq(knowledge_page.project_id, projectId));
    } else {
      conditions.push(isNull(knowledge_page.project_id));
    }

    return this.db
      .select({ id: knowledge_page.id, order_key: knowledge_page.order_key })
      .from(knowledge_page)
      .where(and(...conditions))
      .orderBy(asc(knowledge_page.order_key));
  }

  async updateSiblingOrderKeys(
    siblings: Array<{ id: string; order_key: string }>,
  ): Promise<void> {
    for (const sibling of siblings) {
      await this.db
        .update(knowledge_page)
        .set({ order_key: sibling.order_key })
        .where(eq(knowledge_page.id, sibling.id));
    }
  }

  async buildTree(
    parentId: string | null,
    projectId: string | null | undefined,
    workspaceId: string,
  ): Promise<PageTreeNode[]> {
    const conditions = [
      eq(knowledge_page.workspace_id, workspaceId),
      isNull(knowledge_page.deleted_at),
    ];

    if (projectId === undefined) {
      // No project filter, include workspace + project pages
    } else if (projectId) {
      conditions.push(eq(knowledge_page.project_id, projectId));
    } else {
      conditions.push(isNull(knowledge_page.project_id));
    }

    const pages = await this.db
      .select()
      .from(knowledge_page)
      .where(and(...conditions));

    const byParent = new Map<string | null, KnowledgePage[]>();
    for (const page of pages) {
      const key = page.parent_id ?? null;
      const list = byParent.get(key);
      if (list) {
        list.push(page);
      } else {
        byParent.set(key, [page]);
      }
    }

    for (const list of byParent.values()) {
      list.sort((a, b) => a.order_key.localeCompare(b.order_key));
    }

    const buildSubtree = (
      currentParentId: string | null,
      path: Set<string>,
    ): PageTreeNode[] => {
      const children = byParent.get(currentParentId ?? null) ?? [];
      const nodes: PageTreeNode[] = [];

      for (const page of children) {
        if (path.has(page.id)) continue;
        path.add(page.id);
        const childNodes = buildSubtree(page.id, path);
        path.delete(page.id);

        nodes.push({
          id: page.id,
          title: page.title,
          icon: page.icon,
          parent_id: page.parent_id,
          project_id: page.project_id,
          is_project_root: page.is_project_root ?? false,
          order_key: page.order_key,
          children: childNodes.length > 0 ? childNodes : undefined,
        });
      }

      return nodes;
    };

    return buildSubtree(parentId ?? null, new Set());
  }

  async getBreadcrumb(pageId: string): Promise<string[]> {
    const breadcrumb: string[] = [];
    let currentId: string | null = pageId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const page = await this.findById(currentId);
      if (!page) break;
      breadcrumb.unshift(page.title);
      currentId = page.parent_id;
    }

    return breadcrumb;
  }

  async isAncestor(ancestorId: string, nodeId: string): Promise<boolean> {
    let currentId: string | null = nodeId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === ancestorId) return true;
      if (visited.has(currentId)) return true;
      visited.add(currentId);

      const page = await this.findByIdIncludeDeleted(currentId);
      if (!page) return false;
      currentId = page.parent_id;
    }

    return false;
  }
}
