import type { ToolSpec } from "@shared/types/tool-spec.types";
import type { ToolHandler } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";
import { requireWorkspaceContext } from "../tool-guards";
import { applyFieldSelection, fieldsInputSchema } from "./shared/field-selection";
import { applyCursorPagination, paginationInputSchema } from "./shared/pagination";
import type { MessageContent } from "../../../../db/schema/message";

export const listBookmarksSpec: ToolSpec = {
  name: "core.list_bookmarks",
  scope: "core",
  version: "1.0",
  description: "List bookmarked messages in the current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      ...paginationInputSchema,
      ...fieldsInputSchema,
    },
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

export function createListBookmarksHandler(db: DatabaseAccess): ToolHandler {
  return {
    execute: async (args: Record<string, unknown>) => {
      const workspaceId = args.workspace_id as string;
      const fields = args.fields as string[] | undefined;
      const cursor = args.cursor as string | undefined;
      const limit = args.limit as number | undefined;

      const bookmarks = await db.bookmarks.findByWorkspace(workspaceId);

      const transformed = bookmarks.map((b) => {
        const { message, ...rest } = b;
        let text = "";
        if (message?.content) {
          const content = message.content as MessageContent;
          if (content.type === "text" && content.text) {
            text = content.text;
          } else if (content.type === "multipart" && content.parts) {
            text = content.parts
              .filter((p) => p.type === "text")
              .map((p) => p.text ?? "")
              .join(" ");
          }
        }
        return {
          ...rest,
          messagePreview: text.substring(0, 200),
        };
      });

      const paginated = applyCursorPagination(transformed, { cursor, limit }, (item) => item.id);
      const items = applyFieldSelection(paginated.items, fields);

      return {
        success: true,
        data: {
          ...paginated,
          items,
        },
      };
    },
  };
}

export const listFavoritesSpec: ToolSpec = {
  name: "core.list_favorites",
  scope: "core",
  version: "1.0",
  description: "List favorite chats in the current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      ...fieldsInputSchema,
    },
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

export function createListFavoritesHandler(db: DatabaseAccess): ToolHandler {
  return {
    execute: async (args: Record<string, unknown>) => {
      const workspaceId = args.workspace_id as string;
      const fields = args.fields as string[] | undefined;

      const favorites = await db.favorites.findByWorkspace(workspaceId);
      const items = applyFieldSelection(favorites, fields);

      return {
        success: true,
        data: {
          items,
        },
      };
    },
  };
}
