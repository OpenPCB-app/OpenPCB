import type { ToolSpec } from "@shared/types/tool-spec.types";
import type { ToolHandler } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";
import { requireWorkspaceContext } from "../tool-guards";
import { applyCursorPagination } from "./shared/pagination";
import { applyFieldSelection } from "./shared/field-selection";

export const listChatsToolSpec: ToolSpec = {
  name: "core.list_chats",
  scope: "core",
  version: "1.0",
  description: "List chats in a workspace with optional filters and pagination.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      folder_id: { type: "string" },
      is_pinned: { type: "boolean" },
      is_archived: { type: "boolean" },
      category: { type: "string" },
      cursor: { type: "string" },
      limit: { type: "number" },
      fields: { type: "array", items: { type: "string" } },
    },
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

export function createListChatsHandler(db: DatabaseAccess): ToolHandler {
  return {
    execute: async (args: Record<string, unknown>) => {
      const workspace_id = args.workspace_id as string | undefined;
      const project_id = args.project_id as string | undefined;
      const folder_id = args.folder_id as string | undefined;
      const is_pinned = args.is_pinned as boolean | undefined;
      const is_archived = args.is_archived as boolean | undefined;
      const category = args.category as string | undefined;
      const cursor = args.cursor as string | undefined;
      const limit = (args.limit as number | undefined) ?? 20;
      const fields = args.fields as string[] | undefined;

      if (!workspace_id) {
        return {
          success: false,
          message: "workspace_id is required",
          error: { code: "VALIDATION_FAILED", message: "workspace_id is required" },
        };
      }

      const chats = await db.chats.findByWorkspace(workspace_id, undefined, {
        projectId: project_id,
        folderId: folder_id,
      });

      let filteredChats = chats;

      if (is_pinned !== undefined) {
        filteredChats = filteredChats.filter((c) => c.isPinned === is_pinned);
      }

      if (is_archived !== undefined) {
        filteredChats = filteredChats.filter((c) => c.isArchived === is_archived);
      }

      if (category !== undefined) {
        filteredChats = filteredChats.filter((c) => c.category === category);
      }

      const paginated = applyCursorPagination(
        filteredChats,
        { cursor, limit },
        (c) => c.id
      );

      const items = applyFieldSelection(paginated.items, fields);

      return {
        success: true,
        data: {
          items,
          nextCursor: paginated.nextCursor,
          hasMore: paginated.hasMore,
        },
      };
    },
  };
}

