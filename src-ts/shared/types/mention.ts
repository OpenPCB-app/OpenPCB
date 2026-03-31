/**
 * Mention System Types
 *
 * Types for the @mention system enabling entity references in chat messages.
 * Supports snapshot preservation, staleness detection, and module extensibility.
 *
 * See: docs/specs/MENTION_SYSTEM_SPECIFICATION.md
 */

// =============================================================================
// Mention Entity
// =============================================================================

/**
 * A mentionable entity returned by search or resolution
 */
export interface MentionEntity {
  /** Unique entity identifier */
  id: string;

  /** Entity type (e.g., "knowledge-page", "file") */
  entityType: string;

  /** Display text for the mention */
  displayText: string;

  /** Optional icon (emoji or icon name) */
  icon?: string;

  /** Optional description/subtitle */
  description?: string;

  /** Workspace the entity belongs to */
  workspaceId: string;

  /** Navigation path/URL for the entity */
  navigationPath: string;

  /** Last updated timestamp (ISO 8601) */
  updatedAt: string;
}

// =============================================================================
// Mention Reference (in message content)
// =============================================================================

/**
 * Parsed mention reference from message content
 * Extracted from @[entityType:entityId|displayText] syntax
 */
export interface MentionReference {
  /** Entity type */
  entityType: string;

  /** Entity ID */
  entityId: string;

  /** Display text */
  displayText: string;

  /** Raw match string (for replacement) */
  raw: string;

  /** Position in content (character offset) */
  position: number;
}

// =============================================================================
// Mention Snapshot
// =============================================================================

/**
 * Snapshot of an entity at mention time
 * Content structure is entity-type specific
 */
export interface MentionSnapshot {
  /** Entity ID */
  entityId: string;

  /** Entity type */
  entityType: string;

  /** Display text at snapshot time */
  displayText: string;

  /** Icon at snapshot time */
  icon?: string;

  /** Entity version (typically updatedAt timestamp) */
  entityVersion: string;

  /** Snapshot creation timestamp */
  snapshotCreatedAt: string;

  /** Entity-specific snapshot data */
  data: Record<string, unknown>;
}

/**
 * Knowledge page snapshot data
 */
export interface KnowledgePageSnapshotData {
  title: string;
  icon?: string;
  content: unknown;
  properties: Record<string, unknown>;
}

// =============================================================================
// Mention Record (stored in database)
// =============================================================================

/**
 * Stored mention record linking message to entity snapshot
 */
export interface MentionRecord {
  id: string;
  messageId: string;
  entityType: string;
  entityId: string;
  displayText: string;
  snapshotData: MentionSnapshot["data"];
  snapshotCreatedAt: string;
  entityVersion: string;
  createdAt: string;
}

// =============================================================================
// Search Context
// =============================================================================

/**
 * Context provided when searching for mentionable entities
 */
export interface MentionSearchContext {
  /** Search query string */
  query: string;

  /** Workspace ID to scope search */
  workspaceId: string;

  /** Chat ID where mention is being made (optional for new chats) */
  chatId?: string;

  /** Maximum results to return */
  limit?: number;

  /** Module-specific filters */
  filters?: Record<string, unknown>;
}

// =============================================================================
// Staleness Info
// =============================================================================

/**
 * Staleness status for a mention
 */
export interface MentionStalenessInfo {
  /** Whether the entity has changed since snapshot */
  isStale: boolean;

  /** Whether the entity still exists */
  exists: boolean;

  /** Current entity version (if exists) */
  currentVersion?: string;

  /** Snapshot version */
  snapshotVersion: string;

  /** Human-readable staleness message */
  message?: string;
}

// =============================================================================
// Mention Provider Interface
// =============================================================================

/**
 * Interface that modules must implement to provide mentionable entities
 */
export interface MentionProvider {
  /** Unique entity type identifier */
  readonly entityType: string;

  /** Human-readable display name */
  readonly displayName: string;

  /** Default icon for this entity type */
  readonly defaultIcon?: string;

  /**
   * Search for mentionable entities
   * @param context Search context with query and scope
   * @returns Matching entities (sorted by relevance)
   */
  search(context: MentionSearchContext): Promise<MentionEntity[]>;

  /**
   * Resolve a single entity by ID
   * @param entityId Entity identifier
   * @param workspaceId Workspace scope
   * @returns Entity if found, null otherwise
   */
  resolve(entityId: string, workspaceId: string): Promise<MentionEntity | null>;

  /**
   * Create a snapshot of the entity's current state
   * @param entityId Entity identifier
   * @returns Snapshot data for storage
   */
  createSnapshot(entityId: string): Promise<MentionSnapshot>;

  /**
   * Check if entity has changed since snapshot (optional)
   * Default: timestamp comparison
   * Override for hash-based comparison if needed
   *
   * @param entityId Entity identifier
   * @param snapshotCreatedAt When snapshot was created
   * @returns Staleness info
   */
  checkStaleness?(
    entityId: string,
    snapshotCreatedAt: string,
  ): Promise<MentionStalenessInfo>;

  /**
   * Get navigation path for an entity
   * @param entityId Entity identifier
   * @returns Navigation path or null if entity doesn't exist
   */
  getNavigationPath(entityId: string): Promise<string | null>;
}

// =============================================================================
// Module Context Extension
// =============================================================================

/**
 * Mention registration interface added to ModuleContext
 */
export interface MentionRegistration {
  /**
   * Register a mention provider for this module
   * @param provider The mention provider implementation
   */
  register(provider: MentionProvider): void;
}

// =============================================================================
// API Types
// =============================================================================

/**
 * Request body for mention search
 */
export interface MentionSearchRequest {
  query: string;
  workspaceId: string;
  chatId?: string;  // Optional for new chats
  limit?: number;
  entityTypes?: string[];
  filters?: Record<string, unknown>;
}

/**
 * Response for mention search
 */
export interface MentionSearchResponse {
  results: MentionEntity[];
  hasMore: boolean;
}

/**
 * Request body for batch staleness check
 */
export interface MentionStalenessRequest {
  mentions: Array<{
    entityType: string;
    entityId: string;
    snapshotCreatedAt: string;
  }>;
}

/**
 * Response for batch staleness check
 */
export interface MentionStalenessResponse {
  results: Record<string, MentionStalenessInfo>;
}

/**
 * Request body for resolving a mention
 */
export interface MentionResolveRequest {
  entityType: string;
  entityId: string;
  workspaceId: string;
}

/**
 * Response for resolving a mention
 */
export interface MentionResolveResponse {
  entity: MentionEntity | null;
}

/**
 * Response for getting available entity types
 */
export interface MentionTypesResponse {
  types: string[];
}

/**
 * Response for navigation path
 */
export interface MentionNavigateResponse {
  path: string | null;
}
