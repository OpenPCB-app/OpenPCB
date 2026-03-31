import type { ToolSpec } from "@shared/types/tool-spec.types";
import type { ToolHandler } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";
import { chat, file as fileTable, message } from "../../../../db/schema";
import { requireWorkspaceContext } from "../tool-guards";
import { applyCursorPagination, paginationInputSchema } from "./shared/pagination";
import { applyFieldSelection, fieldsInputSchema } from "./shared/field-selection";

type EntityType = "chats" | "messages" | "files";

interface SearchArgs {
  workspace_id: string;
  query: string;
  entity_type?: EntityType;
  project_id?: string;
  cursor?: string;
  limit?: number;
  fields?: string[];
}

interface SearchResultItem {
  type: "chat" | "message" | "file";
  id: string;
  titleOrPreview: string;
  matchField: "title" | "content" | "originalName";
  workspaceId: string;
  projectId: string | null;
  chatId?: string;
  createdAt: string;
}

interface RankedSearchResultItem extends SearchResultItem {
  _cursor: string;
  _relevance: number;
  _createdAtMs: number;
}

const QUERY_FETCH_LIMIT = 500;

export const searchToolSpec: ToolSpec = {
  name: "core.search",
  scope: "core",
  version: "1.0",
  description:
    "Search chats, messages, and files in the current workspace with entity filtering and cursor pagination.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query string.",
      },
      entity_type: {
        type: "string",
        enum: ["chats", "messages", "files"],
        description: "Limit search to one entity type.",
      },
      project_id: {
        type: "string",
        description: "Optional project scope filter.",
      },
      ...paginationInputSchema,
      ...fieldsInputSchema,
    },
    required: ["query"],
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function relevanceScore(value: string, query: string): number | null {
  const normalizedValue = normalize(value);
  if (!normalizedValue || !query) {
    return null;
  }

  if (normalizedValue === query) {
    return 0;
  }
  if (normalizedValue.startsWith(query)) {
    return 1;
  }
  if (normalizedValue.includes(query)) {
    return 2;
  }
  return null;
}

function extractMessagePreview(content: unknown): string {
  if (!content || typeof content !== "object") {
    return "";
  }

  const record = content as Record<string, unknown>;
  if (record.type === "text") {
    return asString(record.text);
  }

  if (record.type === "multipart" && Array.isArray(record.parts)) {
    for (const part of record.parts) {
      if (part && typeof part === "object") {
        const maybeText = (part as Record<string, unknown>).text;
        if (typeof maybeText === "string" && maybeText.trim().length > 0) {
          return maybeText;
        }
      }
    }
  }

  return "";
}

export function createSearchHandler(db: DatabaseAccess): ToolHandler {
  return {
    execute: async (rawArgs: Record<string, unknown>) => {
      const args = rawArgs as unknown as SearchArgs;
      const workspaceId = args.workspace_id;
      const projectId = args.project_id;
      const entityType = args.entity_type;
      const query = normalize(args.query);
      const cursor = args.cursor;
      const limit = args.limit;
      const fields = args.fields;

      if (!query) {
        return {
          success: true,
          data: {
            items: [],
            nextCursor: null,
            hasMore: false,
            totalCount: 0,
          },
        };
      }

      const drizzleDb = db.getDb();
      const rankedResults: RankedSearchResultItem[] = [];

      const chatRows = await drizzleDb
        .select({
          id: chat.id,
          workspaceId: chat.workspaceId,
          projectId: chat.projectId,
          title: chat.title,
          createdAt: chat.createdAt,
          deletedAt: chat.deletedAt,
        })
        .from(chat)
        .limit(QUERY_FETCH_LIMIT);

      const scopedChats = chatRows.filter(
        (row) =>
          row.deletedAt === null &&
          row.workspaceId === workspaceId &&
          (projectId ? row.projectId === projectId : true),
      );

      const scopedChatIds = new Set(scopedChats.map((row) => row.id));
      const chatProjectById = new Map(scopedChats.map((row) => [row.id, row.projectId]));

      if (!entityType || entityType === "chats") {
        for (const row of scopedChats) {
          const title = asString(row.title);
          const score = relevanceScore(title, query);
          if (score === null) {
            continue;
          }

          rankedResults.push({
            type: "chat",
            id: row.id,
            titleOrPreview: title,
            matchField: "title",
            workspaceId: row.workspaceId,
            projectId: row.projectId,
            createdAt: row.createdAt.toISOString(),
            _relevance: score,
            _createdAtMs: row.createdAt.getTime(),
            _cursor: `chat:${row.id}`,
          });
        }
      }

      if (!entityType || entityType === "messages") {
        const messageRows = await drizzleDb
          .select({
            id: message.id,
            chatId: message.chatId,
            content: message.content,
            createdAt: message.createdAt,
            deletedAt: message.deletedAt,
          })
          .from(message)
          .limit(QUERY_FETCH_LIMIT);

        for (const row of messageRows) {
          if (row.deletedAt !== null || !scopedChatIds.has(row.chatId)) {
            continue;
          }

          const preview = extractMessagePreview(row.content);
          const score = relevanceScore(preview, query);
          if (score === null) {
            continue;
          }

          rankedResults.push({
            type: "message",
            id: row.id,
            titleOrPreview: preview,
            matchField: "content",
            workspaceId,
            projectId: chatProjectById.get(row.chatId) ?? null,
            chatId: row.chatId,
            createdAt: row.createdAt.toISOString(),
            _relevance: score,
            _createdAtMs: row.createdAt.getTime(),
            _cursor: `message:${row.id}`,
          });
        }
      }

      if (!entityType || entityType === "files") {
        const fileRows = await drizzleDb
          .select({
            id: fileTable.id,
            workspaceId: fileTable.workspaceId,
            projectId: fileTable.projectId,
            originalName: fileTable.originalName,
            status: fileTable.status,
            createdAt: fileTable.createdAt,
            deletedAt: fileTable.deletedAt,
          })
          .from(fileTable)
          .limit(QUERY_FETCH_LIMIT);

        for (const row of fileRows) {
          if (
            row.deletedAt !== null ||
            row.workspaceId !== workspaceId ||
            row.status !== "active" ||
            (projectId ? row.projectId !== projectId : false)
          ) {
            continue;
          }

          const score = relevanceScore(row.originalName, query);
          if (score === null) {
            continue;
          }

          rankedResults.push({
            type: "file",
            id: row.id,
            titleOrPreview: row.originalName,
            matchField: "originalName",
            workspaceId: row.workspaceId,
            projectId: row.projectId,
            createdAt: row.createdAt.toISOString(),
            _relevance: score,
            _createdAtMs: row.createdAt.getTime(),
            _cursor: `file:${row.id}`,
          });
        }
      }

      rankedResults.sort((a, b) => {
        if (a._relevance !== b._relevance) {
          return a._relevance - b._relevance;
        }
        if (a._createdAtMs !== b._createdAtMs) {
          return b._createdAtMs - a._createdAtMs;
        }
        return a._cursor.localeCompare(b._cursor);
      });

      const paginated = applyCursorPagination(rankedResults, { cursor, limit }, (item) => item._cursor);

      const visibleItems: SearchResultItem[] = paginated.items.map((item) => ({
        type: item.type,
        id: item.id,
        titleOrPreview: item.titleOrPreview,
        matchField: item.matchField,
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        chatId: item.chatId,
        createdAt: item.createdAt,
      }));

      return {
        success: true,
        data: {
          items: applyFieldSelection(visibleItems, fields),
          nextCursor: paginated.nextCursor,
          hasMore: paginated.hasMore,
          totalCount: rankedResults.length,
        },
      };
    },
  };
}
