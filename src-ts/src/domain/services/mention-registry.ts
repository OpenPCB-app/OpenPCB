import type {
  MentionProvider,
  MentionEntity,
  MentionSearchContext,
  MentionSnapshot,
  MentionStalenessInfo,
} from "@shared/types/mention";

export class MentionRegistry {
  private static instance: MentionRegistry | null = null;
  private providers: Map<string, MentionProvider> = new Map();

  private constructor() {}

  static init(): MentionRegistry {
    if (!MentionRegistry.instance) {
      MentionRegistry.instance = new MentionRegistry();
    }
    return MentionRegistry.instance;
  }

  static get(): MentionRegistry {
    if (!MentionRegistry.instance) {
      throw new Error("MentionRegistry not initialized. Call init() first.");
    }
    return MentionRegistry.instance;
  }

  static reset(): void {
    MentionRegistry.instance = null;
  }

  register(provider: MentionProvider): void {
    if (this.providers.has(provider.entityType)) {
      console.warn(
        `MentionProvider for "${provider.entityType}" already registered. Overwriting.`,
      );
    }
    this.providers.set(provider.entityType, provider);
  }

  unregister(entityType: string): boolean {
    return this.providers.delete(entityType);
  }

  getEntityTypes(): string[] {
    return Array.from(this.providers.keys());
  }

  getProvider(entityType: string): MentionProvider | undefined {
    return this.providers.get(entityType);
  }

  async search(
    context: MentionSearchContext,
    entityTypes?: string[],
  ): Promise<MentionEntity[]> {
    const typesToSearch = entityTypes ?? Array.from(this.providers.keys());
    const requestLimit = context.limit ?? 10;

    const searchPromises = typesToSearch
      .map((type) => this.providers.get(type))
      .filter((provider): provider is MentionProvider => provider !== undefined)
      .map(async (provider) => {
        try {
          return await provider.search({
            ...context,
            limit: requestLimit,
          });
        } catch (err) {
          console.error(
            `Mention search failed for ${provider.entityType}:`,
            err,
          );
          return [];
        }
      });

    const results = await Promise.all(searchPromises);
    const flattened = results.flat();

    // Sort by relevance: prefix matches first, then alphabetically
    const queryLower = context.query.toLowerCase();
    flattened.sort((a, b) => {
      const aText = a.displayText.toLowerCase();
      const bText = b.displayText.toLowerCase();
      const aStarts = aText.startsWith(queryLower);
      const bStarts = bText.startsWith(queryLower);

      // Prefix matches first
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      // Exact matches before partial
      const aExact = aText === queryLower;
      const bExact = bText === queryLower;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      // Then alphabetically
      return aText.localeCompare(bText);
    });

    return flattened.slice(0, requestLimit);
  }

  /**
   * Resolve an entity by type and ID.
   * Returns null if provider not found or entity doesn't exist (soft fail for lookups).
   */
  async resolve(
    entityType: string,
    entityId: string,
    workspaceId: string,
  ): Promise<MentionEntity | null> {
    const provider = this.providers.get(entityType);
    if (!provider) {
      console.warn(`No mention provider for entity type: ${entityType}`);
      return null;
    }
    return provider.resolve(entityId, workspaceId);
  }

  /**
   * Create a snapshot for an entity (used when saving mentions).
   * Throws if provider not found (hard fail for data integrity).
   * Returns null if entity doesn't exist (allows graceful handling).
   */
  async createSnapshot(
    entityType: string,
    entityId: string,
  ): Promise<MentionSnapshot | null> {
    const provider = this.providers.get(entityType);
    if (!provider) {
      throw new Error(`No mention provider for entity type: ${entityType}`);
    }
    try {
      return await provider.createSnapshot(entityId);
    } catch (err) {
      // Entity may have been deleted between mention creation and snapshot
      console.warn(
        `Failed to create snapshot for ${entityType}:${entityId}:`,
        err
      );
      return null;
    }
  }

  /**
   * Check if a mentioned entity has changed since the snapshot was created.
   *
   * Semantics:
   * - Unknown provider: isStale=true (we can't verify, assume stale)
   * - Entity deleted: isStale=true, exists=false (definitely out of date)
   * - Entity modified: isStale=true if updatedAt > snapshotCreatedAt
   * - Entity unchanged: isStale=false
   */
  async checkStaleness(
    entityType: string,
    entityId: string,
    snapshotCreatedAt: string,
  ): Promise<MentionStalenessInfo> {
    const provider = this.providers.get(entityType);
    if (!provider) {
      return {
        isStale: true, // Unknown provider - assume stale for safety
        exists: false,
        snapshotVersion: snapshotCreatedAt,
        message: "Unknown entity type - cannot verify",
      };
    }

    if (provider.checkStaleness) {
      return provider.checkStaleness(entityId, snapshotCreatedAt);
    }

    const entity = await provider.resolve(entityId, "");
    if (!entity) {
      return {
        isStale: true, // Deleted entities are considered stale
        exists: false,
        snapshotVersion: snapshotCreatedAt,
        message: "Entity has been deleted",
      };
    }

    const snapshotTime = new Date(snapshotCreatedAt).getTime();
    const entityTime = new Date(entity.updatedAt).getTime();
    const isStale = entityTime > snapshotTime;

    return {
      isStale,
      exists: true,
      currentVersion: entity.updatedAt,
      snapshotVersion: snapshotCreatedAt,
      message: isStale ? "Entity has been modified since mention" : undefined,
    };
  }

  async getNavigationPath(
    entityType: string,
    entityId: string,
  ): Promise<string | null> {
    const provider = this.providers.get(entityType);
    if (!provider) {
      return null;
    }
    return provider.getNavigationPath(entityId);
  }
}
