/**
 * Chat Types - V2 Kernel
 *
 * Defines chat record structure for SQLite storage and API responses.
 */

import type { ProviderId } from "./provider.types";
import type { KernelMessage } from "./message.types";

/** Chat record version for migrations */
export const CHAT_RECORD_VERSION = "2.0.0";

/** Chat icon names */
export type ChatIconName =
  | "message-square"
  | "bot"
  | "terminal"
  | "book-open"
  | "sparkles"
  | "lightbulb";

/** Chat icon colors */
export type ChatIconColor =
  | "sky"
  | "violet"
  | "amber"
  | "emerald"
  | "rose"
  | "slate";

/** Chat category for filtering */
export type ChatCategory =
  | "default"
  | "brainstorming_node"
  | "knowledge_page"
  | "writer_document"
  | `module_${string}`;

/** Context reference used for scoped chats (e.g. page-scoped sidebars) */
export interface ChatContextRef {
  type: string;
  id: string;
}

/** Chat icon styling */
export interface ChatIcon {
  name: ChatIconName;
  color: ChatIconColor;
}

/** Chat configuration (provider/model/prompt) */
export interface ChatConfig {
  provider: ProviderId;
  model: string;
  systemPrompt: string | null;
}

/** Default chat configuration */
export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  provider: "openai",
  model: "gpt-4o-mini-2024-07-18",
  systemPrompt: null,
};

/** Full chat record (for storage) */
export interface ChatRecord {
  version: string;
  id: string; // UUID v7
  workspaceId: string; // UUID v7 (hardcoded for now)
  title: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  config: ChatConfig;
  messages: KernelMessage[];
  tags: string[];
  pinned: boolean;
  archived: boolean;
  icon: ChatIcon | null;
  folderId: string | null;
  projectId: string | null;
  category?: ChatCategory | null;
  contextRef?: ChatContextRef | null;
}

/** Chat metadata (for list view, no messages) */
export interface ChatMetadata {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  config: ChatConfig;
  messageCount: number;
  lastMessagePreview: string | null;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  icon: ChatIcon | null;
  folderId: string | null;
  projectId: string | null;
  category?: ChatCategory | null;
  contextRef?: ChatContextRef | null;
}

/** Create input for new chat */
export interface CreateChatInput {
  title?: string;
  config?: Partial<ChatConfig>;
  icon?: ChatIcon;
  category?: ChatCategory;
  contextRef?: ChatContextRef;
}

/** Update input for existing chat */
export interface UpdateChatInput {
  title?: string;
  config?: Partial<ChatConfig>;
  tags?: string[];
  pinned?: boolean;
  archived?: boolean;
  icon?: ChatIcon | null;
  folderId?: string | null;
  projectId?: string | null;
  category?: ChatCategory | null;
  contextRef?: ChatContextRef | null;
}

/** Chat list filter options */
export interface ChatListFilter {
  workspaceId?: string;
  includeArchived?: boolean;
  pinnedOnly?: boolean;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

/** Default chat icon */
export const DEFAULT_CHAT_ICON: ChatIcon = {
  name: "message-square",
  color: "sky",
};

/** Create a new chat record */
export function createChatRecord(
  id: string,
  workspaceId: string,
  input?: CreateChatInput,
): ChatRecord {
  const now = new Date().toISOString();

  return {
    version: CHAT_RECORD_VERSION,
    id,
    workspaceId,
    title: input?.title || "New Chat",
    createdAt: now,
    updatedAt: now,
    config: {
      ...DEFAULT_CHAT_CONFIG,
      ...input?.config,
    },
    messages: [],
    tags: [],
    pinned: false,
    archived: false,
    icon: input?.icon || DEFAULT_CHAT_ICON,
    folderId: null,
    projectId: null,
    category: input?.category ?? null,
    contextRef: input?.contextRef ?? null,
  };
}

/** Extract metadata from chat record */
export function toMetadata(chat: ChatRecord): ChatMetadata {
  const lastMessage = chat.messages[chat.messages.length - 1];
  let lastMessagePreview: string | null = null;

  if (lastMessage) {
    const textPart = lastMessage.parts.find((p) => p.type === "text");
    if (textPart && textPart.type === "text") {
      lastMessagePreview = textPart.text.slice(0, 100);
      if (textPart.text.length > 100) {
        lastMessagePreview += "...";
      }
    }
  }

  return {
    id: chat.id,
    workspaceId: chat.workspaceId,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    config: chat.config,
    messageCount: chat.messages.length,
    lastMessagePreview,
    tags: chat.tags,
    pinned: chat.pinned,
    archived: chat.archived,
    icon: chat.icon,
    folderId: chat.folderId ?? null,
    projectId: chat.projectId ?? null,
    category: chat.category ?? null,
    contextRef: chat.contextRef ?? null,
  };
}

/** Generate chat title from first user message */
export function generateChatTitle(messages: KernelMessage[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (!firstUserMessage) {
    return "New Chat";
  }

  const textPart = firstUserMessage.parts.find((p) => p.type === "text");
  if (!textPart || textPart.type !== "text") {
    return "New Chat";
  }

  // Take first 50 chars, trim to word boundary
  let title = textPart.text.slice(0, 50).trim();
  if (textPart.text.length > 50) {
    const lastSpace = title.lastIndexOf(" ");
    if (lastSpace > 20) {
      title = title.slice(0, lastSpace);
    }
    title += "...";
  }

  return title || "New Chat";
}
