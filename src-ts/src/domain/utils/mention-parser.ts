import type { MentionReference } from "@shared/types/mention";

/**
 * Safe mention pattern - non-global for use with matchAll.
 * Pattern matches: @[entity-type:entity-id|Display Text]
 */
const MENTION_PATTERN_SOURCE = /@\[([a-z-]+):([a-zA-Z0-9-]+)\|([^\]]+)\]/;

/** Maximum mentions to parse to prevent DoS */
const MAX_MENTIONS = 100;

/**
 * Parse mentions from content safely using matchAll (avoids ReDoS).
 */
export function parseMentions(content: string): MentionReference[] {
  if (!content || typeof content !== "string") {
    return [];
  }

  const regex = new RegExp(MENTION_PATTERN_SOURCE.source, "g");
  const matches = [...content.matchAll(regex)];

  // Safety limit
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
 * Sanitize display text for mention syntax.
 * Removes characters that could break the syntax or cause injection.
 */
function sanitizeDisplayText(displayText: string): string {
  if (!displayText || typeof displayText !== "string") {
    return "";
  }

  return displayText
    .replace(/[\|\]\[\n\r\t@]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim()
    .slice(0, 200);
}

export function createMentionSyntax(
  entityType: string,
  entityId: string,
  displayText: string,
): string {
  const sanitized = sanitizeDisplayText(displayText);
  if (!sanitized) {
    return "";
  }
  return `@[${entityType}:${entityId}|${sanitized}]`;
}

export function hasMentions(content: string): boolean {
  if (!content || typeof content !== "string") {
    return false;
  }
  return MENTION_PATTERN_SOURCE.test(content);
}

export function stripMentions(content: string): string {
  if (!content || typeof content !== "string") {
    return "";
  }
  const regex = new RegExp(MENTION_PATTERN_SOURCE.source, "g");
  return content.replace(regex, "@$3");
}

export function getUniqueEntityRefs(
  mentions: MentionReference[],
): Array<{ entityType: string; entityId: string }> {
  const seen = new Set<string>();
  const unique: Array<{ entityType: string; entityId: string }> = [];

  for (const mention of mentions) {
    const key = `${mention.entityType}:${mention.entityId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({
        entityType: mention.entityType,
        entityId: mention.entityId,
      });
    }
  }

  return unique;
}
