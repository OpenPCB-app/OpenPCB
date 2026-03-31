import type { ToolSpec } from "@shared/types/tool-spec.types";
import type { ToolHandler } from "@shared/types/tool.types";
import { requireWorkspaceContext } from "../tool-guards";
import {
  paginationInputSchema,
  applyCursorPagination,
} from "./shared/pagination";
import { fieldsInputSchema, applyFieldSelection } from "./shared/field-selection";
import type { DatabaseAccess } from "../../../../db";

const DEFAULT_FILE_FIELDS = [
  "id",
  "originalName",
  "mimeType",
  "sizeBytes",
  "tags",
  "createdAt",
  "projectId",
  "workspaceId",
  "status",
];

export const listFilesToolSpec: ToolSpec = {
  name: "core.list_files",
  scope: "core",
  version: "1.0",
  description: "List files in a workspace with optional filtering and pagination.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description: "Filter by project ID",
      },
      mime_type: {
        type: "string",
        description: "Filter by MIME type (e.g., 'text/plain', 'image/png')",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Filter by tags (matches if file has ANY of the tags)",
      },
      ...paginationInputSchema,
      ...fieldsInputSchema,
    },
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

export function createListFilesHandler(db: DatabaseAccess): ToolHandler {
  return {
    execute: async (args) => {
      const workspaceId = args.workspace_id as string;
      const projectId = args.project_id as string | undefined;
      const mimeType = args.mime_type as string | undefined;
      const tags = args.tags as string[] | undefined;
      const cursor = args.cursor as string | undefined;
      const limit = args.limit as number | undefined;
      const fields = (args.fields as string[] | undefined) ?? DEFAULT_FILE_FIELDS;

      const files = await db.fileRecords.query({
        workspaceId,
        projectId,
        mimeType,
        tags,
        status: "active",
      });

      const paginated = applyCursorPagination(files, { cursor, limit }, (f) => f.id);

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
