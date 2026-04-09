import type { MentionReference } from "@shared/types";

/**
 * Safe mention pattern using matchAll to avoid ReDoS vulnerability.
 * Pattern matches: @[entity-type:entity-id|Display Text]
 */
const MENTION_PATTERN_SOURCE = /@\[([a-z-]+):([a-zA-Z0-9-]+)\|([^\]]+)\]/;

/**
 * Parse mentions from text safely using matchAll (avoids ReDoS).
 * Returns array of MentionReference objects.
 */
export function parseMentions(text: string): MentionReference[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  const regex = new RegExp(MENTION_PATTERN_SOURCE.source, "g");
  const matches = [...text.matchAll(regex)];

  // Safety limit to prevent DoS
  const MAX_MENTIONS = 100;
  const limitedMatches = matches.slice(0, MAX_MENTIONS);

  return limitedMatches
    .map((match) => {
      const entityType = match[1];
      const entityId = match[2];
      const displayText = match[3];

      if (!entityType || !entityId || !displayText) {
        return null;
      }

      return {
        entityType,
        entityId,
        displayText,
        raw: match[0],
        position: match.index ?? 0,
      };
    })
    .filter((m): m is MentionReference => m !== null);
}

/**
 * Check if text contains any mentions.
 */
export function hasMentions(text: string): boolean {
  if (!text || typeof text !== "string") {
    return false;
  }
  return MENTION_PATTERN_SOURCE.test(text);
}

/**
 * Sanitize display text for mention syntax.
 * Removes characters that could break the syntax or cause injection.
 */
export function sanitizeDisplayText(displayText: string): string {
  if (!displayText || typeof displayText !== "string") {
    return "";
  }

  return displayText
    .replace(/[\|\]\[\n\r\t@]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim()
    .slice(0, 200); // Limit length
}

/**
 * Create mention syntax string.
 */
export function createMentionSyntax(
  entityType: string,
  entityId: string,
  displayText: string
): string {
  const sanitized = sanitizeDisplayText(displayText);
  if (!sanitized) {
    return "";
  }
  return `@[${entityType}:${entityId}|${sanitized}]`;
}

/**
 * Strip mentions and replace with just the display text.
 */
export function stripMentions(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }

  const regex = new RegExp(MENTION_PATTERN_SOURCE.source, "g");
  return text.replace(regex, "@$3");
}
