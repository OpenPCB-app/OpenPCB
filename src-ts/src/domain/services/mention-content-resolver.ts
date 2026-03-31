/**
 * Mention Content Resolver
 *
 * Resolves @mentions in message content to actual page content.
 * Used for injecting referenced documents into AI chat context.
 */

import { MentionRegistry } from "./mention-registry";
import {
  parseMentions,
  getUniqueEntityRefs,
} from "../utils/mention-parser";
import { tiptapToMarkdown } from "../utils/tiptap-to-markdown";

/**
 * Resolved mention content ready for injection
 */
export interface ResolvedMentionContent {
  entityType: string;
  entityId: string;
  displayText: string;
  content: string; // Markdown content
  exists: boolean;
}

/**
 * Limits for mention content resolution
 */
export const MENTION_LIMITS = {
  MAX_CHARS_PER_PAGE: 10000,
  MAX_TOTAL_CONTEXT_CHARS: 50000,
  MAX_PAGES_PER_MESSAGE: 10,
  RESOLUTION_TIMEOUT_MS: 5000,
};

/**
 * Type guard for KnowledgePageSnapshotData
 */
function isKnowledgePageSnapshotData(
  data: unknown
): data is { title: string; content: unknown; properties: Record<string, unknown> } {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return "title" in obj && "content" in obj;
}

/**
 * Type guard for EditorContent structure
 */
function isEditorContent(
  content: unknown
): content is { engine: string; version: number; data: unknown } {
  if (!content || typeof content !== "object") return false;
  const obj = content as Record<string, unknown>;
  return "engine" in obj && "data" in obj;
}

/**
 * Resolves mentions from message content and returns formatted markdown
 */
export class MentionContentResolver {
  private maxCharsPerPage: number;
  private maxTotalChars: number;

  constructor(
    maxCharsPerPage = MENTION_LIMITS.MAX_CHARS_PER_PAGE,
    maxTotalChars = MENTION_LIMITS.MAX_TOTAL_CONTEXT_CHARS
  ) {
    this.maxCharsPerPage = maxCharsPerPage;
    this.maxTotalChars = maxTotalChars;
  }

  /**
   * Resolve all mentions from message content
   * Returns array of resolved content with markdown
   */
  async resolveMessageMentions(
    messageContent: string,
    workspaceId: string
  ): Promise<ResolvedMentionContent[]> {
    const mentions = parseMentions(messageContent);
    if (mentions.length === 0) {
      return [];
    }

    // Deduplicate and limit
    const uniqueRefs = getUniqueEntityRefs(mentions).slice(
      0,
      MENTION_LIMITS.MAX_PAGES_PER_MESSAGE
    );

    // Resolve mentions in parallel for better performance
    const resolutionPromises = uniqueRefs.map((ref) =>
      this.resolveSingleMention(ref, workspaceId).catch((err) => {
        console.warn(
          `[MentionContentResolver] Failed to resolve ${ref.entityType}:${ref.entityId}:`,
          err
        );
        return null;
      })
    );

    const results = await Promise.all(resolutionPromises);
    return results.filter((r): r is ResolvedMentionContent => r !== null);
  }

  /**
   * Resolve a single mention to content
   */
  private async resolveSingleMention(
    ref: { entityType: string; entityId: string },
    workspaceId: string
  ): Promise<ResolvedMentionContent | null> {
    const registry = MentionRegistry.get();

    // First check if entity exists
    const entity = await registry.resolve(
      ref.entityType,
      ref.entityId,
      workspaceId
    );

    if (!entity) {
      // Entity was deleted
      return {
        entityType: ref.entityType,
        entityId: ref.entityId,
        displayText: "Deleted Document",
        content: "[This document has been deleted]",
        exists: false,
      };
    }

    // Get content based on entity type
    let content = "";
    if (ref.entityType === "knowledge-page") {
      content = await this.resolveKnowledgePageContent(ref.entityId);
    }
    // Future: Add other entity types here

    // Return entity even if content is empty (shows title at least)
    if (!content) {
      return {
        entityType: ref.entityType,
        entityId: ref.entityId,
        displayText: entity.displayText,
        content: "[Empty page]",
        exists: true,
      };
    }

    return {
      entityType: ref.entityType,
      entityId: ref.entityId,
      displayText: entity.displayText,
      content,
      exists: true,
    };
  }

  /**
   * Resolve Knowledge page content to markdown
   */
  private async resolveKnowledgePageContent(entityId: string): Promise<string> {
    const registry = MentionRegistry.get();

    try {
      const snapshot = await registry.createSnapshot("knowledge-page", entityId);
      if (!snapshot) return "";

      // Validate snapshot data structure
      if (!isKnowledgePageSnapshotData(snapshot.data)) {
        console.warn(
          `[MentionContentResolver] Invalid snapshot data structure for ${entityId}`
        );
        return "";
      }

      const pageData = snapshot.data;
      if (!pageData.content) return "";

      // Validate editor content structure
      if (!isEditorContent(pageData.content)) {
        console.warn(
          `[MentionContentResolver] Invalid editor content structure for ${entityId}`
        );
        return "";
      }

      // Convert TipTap JSON to markdown
      return tiptapToMarkdown(pageData.content.data, {
        maxChars: this.maxCharsPerPage,
        excludeImages: true, // Don't include base64 images in AI context
      });
    } catch (err) {
      console.warn(
        `[MentionContentResolver] Failed to get page content for ${entityId}:`,
        err
      );
      return "";
    }
  }

  /**
   * Format resolved mentions as a context section for AI
   * Enforces MAX_TOTAL_CONTEXT_CHARS limit
   */
  formatAsContextSection(resolved: ResolvedMentionContent[]): string {
    if (resolved.length === 0) return "";

    const header = "## Referenced Documents\n\nThe user has referenced the following documents in their message:\n\n";
    let totalChars = header.length;
    const includedSections: string[] = [];

    for (const r of resolved) {
      const typeLabel = this.getEntityTypeLabel(r.entityType);
      const sectionHeader = `### ${r.displayText} (${typeLabel})`;
      const section = `${sectionHeader}\n\n${r.content}`;
      const sectionWithSeparator = includedSections.length > 0
        ? `\n\n---\n\n${section}`
        : section;

      // Check if adding this section would exceed limit
      if (totalChars + sectionWithSeparator.length > this.maxTotalChars) {
        // Add truncation notice and stop
        const truncationNotice = `\n\n---\n\n*[Additional referenced documents omitted due to size limit]*`;
        if (totalChars + truncationNotice.length <= this.maxTotalChars) {
          includedSections.push(truncationNotice.replace(/^\n\n---\n\n/, ""));
        }
        break;
      }

      includedSections.push(section);
      totalChars += sectionWithSeparator.length;
    }

    if (includedSections.length === 0) return "";

    return `${header}${includedSections.join("\n\n---\n\n")}`;
  }

  /**
   * Get human-readable label for entity type
   */
  private getEntityTypeLabel(entityType: string): string {
    const labels: Record<string, string> = {
      "knowledge-page": "Knowledge Page",
      // Future: Add more entity types
    };
    return labels[entityType] || entityType;
  }
}
