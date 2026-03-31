/**
 * Content Target Interface
 *
 * Defines the contract that content targets must implement
 * to be editable by the AI content editor.
 */

import type { TiptapDocument } from "../../utils/markdown-to-tiptap";
import type { EditMode, ContentSelection, ContentContext } from "./types";

/**
 * Content target - represents an editable piece of content
 */
export interface ContentTarget {
  /**
   * Unique target type identifier (e.g., "knowledge.page")
   * Format: namespace.entity
   */
  readonly targetType: string;

  /**
   * Human-readable label for this target type
   */
  readonly label: string;

  /**
   * Description of what this target represents
   */
  readonly description?: string;

  /**
   * Edit modes this target supports
   */
  readonly supportedModes: EditMode[];

  /**
   * Check if a specific target ID exists and is accessible
   */
  exists(targetId: string): Promise<boolean>;

  /**
   * Get the current content of a target
   * Returns Tiptap JSON format
   */
  getContent(targetId: string): Promise<TiptapDocument>;

  /**
   * Get content context for AI prompt building
   * Includes full content, selection, and surrounding context
   */
  getContentContext(
    targetId: string,
    selection?: ContentSelection
  ): Promise<ContentContext>;

  /**
   * Set the content of a target
   * Takes Tiptap JSON format
   */
  setContent(targetId: string, content: TiptapDocument): Promise<void>;

  /**
   * Apply a partial update to content (for selection mode)
   * Replaces content from `from` to `to` with new content
   */
  applySelectionUpdate(
    targetId: string,
    selection: ContentSelection,
    newContent: TiptapDocument
  ): Promise<void>;

  /**
   * Validate a selection is valid for this target
   */
  validateSelection?(targetId: string, selection: ContentSelection): Promise<boolean>;

  /**
   * Get metadata about the target (optional)
   */
  getMetadata?(targetId: string): Promise<Record<string, unknown>>;
}

/**
 * Target registration options
 */
export interface TargetRegistrationOptions {
  /** Override existing registration */
  override?: boolean;
}
