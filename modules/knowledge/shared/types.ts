/**
 * Knowledge Module - Shared Types
 *
 * Type definitions shared between React frontend and TypeScript backend.
 */

// =============================================================================
// Page Properties
// =============================================================================

export type PropertyType =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "select"
  | "multi-select"
  | "url";

export interface PropertyConfig {
  /** Options for select/multi-select types */
  options?: string[];
  /** Format for number (number, currency, percent) or date (date, datetime) */
  format?: string;
}

export interface PageProperty {
  /** Stable ULID identifier */
  id: string;
  /** User-visible label */
  name: string;
  /** Property type */
  type: PropertyType;
  /** Type-specific value */
  value: unknown;
  /** Type-specific configuration */
  config?: PropertyConfig;
}

export interface PageProperties {
  [propertyId: string]: PageProperty;
}

// =============================================================================
// Editor Content
// =============================================================================

export interface EditorContent {
  /** Editor engine identifier */
  engine: "tiptap";
  /** Content schema version */
  version: number;
  /** Editor-native JSON content */
  data: unknown;
}

// =============================================================================
// Page Entity
// =============================================================================

export interface Page {
  id: string;
  workspace_id: string;
  project_id: string | null;
  parent_id: string | null;
  is_project_root: boolean;
  order_key: string;
  title: string;
  icon: string | null;
  properties_json: PageProperties;
  content_engine: string;
  content_version: number;
  content_json: EditorContent;
  revision: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

// =============================================================================
// Tree Node
// =============================================================================

export interface PageTreeNode {
  id: string;
  title: string;
  icon: string | null;
  parent_id: string | null;
  project_id: string | null;
  is_project_root: boolean;
  order_key: string;
  children?: PageTreeNode[];
}

// =============================================================================
// Search Result
// =============================================================================

export interface PageSearchResult {
  id: string;
  title: string;
  icon: string | null;
  project_id: string | null;
  parent_id: string | null;
  updated_at: Date;
  breadcrumb?: string[];
}

// =============================================================================
// API Params
// =============================================================================

export interface CreatePageParams {
  workspace_id: string;
  project_id?: string;
  parent_id?: string;
  title: string;
  after_sibling_id?: string;
}

export interface UpdatePageMetaParams {
  title?: string;
  icon?: string;
  properties_json?: PageProperties;
}

export type UpdatePageContentParams = EditorContent;

export interface MovePageParams {
  target_parent_id?: string | null;
  target_project_id?: string | null;
  after_sibling_id?: string;
}

export interface SearchPagesParams {
  workspace_id: string;
  query: string;
  scope?: "all" | "workspace" | "projects";
}

export interface PageUpdateEvent {
  type: "content_updated" | "meta_updated" | "moved" | "deleted" | "restored";
  pageId: string;
  workspaceId: string;
  updatedAt: string;
  revision: number;
  source: "user" | "ai" | "system";
  requestId?: string;
}

// =============================================================================
// API Responses
// =============================================================================

export interface PageResponse {
  page: Page;
}

export interface PageTreeResponse {
  pages: PageTreeNode[];
}

export interface SearchResponse {
  results: PageSearchResult[];
}

// =============================================================================
// Error Codes
// =============================================================================

export type KnowledgeErrorCode =
  | "PAGE_NOT_FOUND"
  | "PAGE_DELETED"
  | "ROOT_LOCKED"
  | "INVALID_MOVE"
  | "INVALID_CONTENT"
  | "CONTENT_CONFLICT"
  | "CIRCULAR_REFERENCE"
  | "CONTENT_INVALID"
  | "IMAGE_TOO_LARGE"
  | "INVALID_PROPERTY_TYPE"
  | "EDITOR_ENGINE_ERROR"
  | "MAX_DEPTH";

// =============================================================================
// Bulk Operations
// =============================================================================

export interface BulkDeleteResult {
  deleted: string[];
  failed: Array<{ id: string; reason: string }>;
}

export interface BulkMoveResult {
  moved: string[];
  failed: Array<{ id: string; reason: string }>;
}
