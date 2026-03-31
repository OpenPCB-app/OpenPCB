import type {
  MentionProvider,
  MentionEntity,
  MentionSearchContext,
  MentionSnapshot,
  KnowledgePageSnapshotData,
} from "@shared/types/mention";
import type { PageRepository } from "../db/repositories/page-repository";

export class KnowledgePageMentionProvider implements MentionProvider {
  readonly entityType = "knowledge-page";
  readonly displayName = "Knowledge Page";
  readonly defaultIcon = "📄";

  constructor(private pageRepo: PageRepository) {}

  async search(context: MentionSearchContext): Promise<MentionEntity[]> {
    // Empty query = show recent pages (limit 2 for quick suggestions)
    const limit = context.query === "" ? 2 : (context.limit ?? 10);

    const pages = await this.pageRepo.searchByTitle(
      context.workspaceId,
      context.query,
      "all",
      limit,
    );

    return pages.map((page) => ({
      id: page.id,
      entityType: this.entityType,
      displayText: page.title,
      icon: page.icon ?? this.defaultIcon,
      description: page.parent_id ? "Subpage" : "Root page",
      workspaceId: context.workspaceId,
      navigationPath: `/knowledge/${page.id}`,
      updatedAt: page.updated_at.toISOString(),
    }));
  }

  async resolve(
    entityId: string,
    _workspaceId: string,
  ): Promise<MentionEntity | null> {
    const page = await this.pageRepo.findById(entityId);

    if (!page) {
      return null;
    }

    return {
      id: page.id,
      entityType: this.entityType,
      displayText: page.title,
      icon: page.icon ?? this.defaultIcon,
      workspaceId: page.workspace_id,
      navigationPath: `/knowledge/${page.id}`,
      updatedAt: new Date(page.updated_at).toISOString(),
    };
  }

  async createSnapshot(entityId: string): Promise<MentionSnapshot> {
    const page = await this.pageRepo.findById(entityId);

    if (!page) {
      throw new Error(`Page not found: ${entityId}`);
    }

    const now = new Date().toISOString();

    // Safe JSON parsing for properties
    let properties: Record<string, unknown> = {};
    try {
      properties =
        typeof page.properties_json === "string"
          ? JSON.parse(page.properties_json)
          : (page.properties_json as Record<string, unknown>) ?? {};
    } catch {
      // Log and use empty object if parsing fails
      console.warn(`Failed to parse properties_json for page ${entityId}`);
      properties = {};
    }

    const snapshotData: KnowledgePageSnapshotData = {
      title: page.title,
      icon: page.icon ?? undefined,
      content: page.content_json,
      properties,
    };

    return {
      entityId: page.id,
      entityType: this.entityType,
      displayText: page.title,
      icon: page.icon ?? this.defaultIcon,
      entityVersion: new Date(page.updated_at).toISOString(),
      snapshotCreatedAt: now,
      data: snapshotData as unknown as Record<string, unknown>,
    };
  }

  async getNavigationPath(entityId: string): Promise<string | null> {
    const page = await this.pageRepo.findById(entityId);
    if (!page) {
      return null;
    }
    return `/knowledge/${page.id}`;
  }
}
