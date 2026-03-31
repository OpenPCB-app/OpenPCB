import type { ToolSpec } from "../../../../src-ts/shared/types/tool-spec.types";
import type { ToolHandler, ToolExecutionContext } from "../../../../src-ts/shared/types/tool.types";
import { requireWorkspaceContext } from "../../../../src-ts/src/domain/services/tools/tool-guards";
import { tiptapToMarkdown } from "../../../../src-ts/src/domain/utils/tiptap-to-markdown";
import type { KnowledgePage } from "../db/schema";
import {
  getKnowledgePageScope,
  isPageAllowedByScope,
  resolvePageIdWithScopeDefault,
} from "./page-access-scope";

interface ToolActiveContext {
  workspaceId?: unknown;
}

interface ListChildPagesArgs {
  workspace_id?: unknown;
  page_id?: unknown;
  include_content_preview?: unknown;
}

interface ChildPageResult {
  id: string;
  title: string;
  icon: string | null;
  has_children: boolean;
  child_count: number;
  updated_at: string | null;
  content_preview?: string;
}

interface ListChildPagesResult {
  success: boolean;
  pages?: ChildPageResult[];
  count?: number;
  parent_page_id?: string | null;
  error?: { code: string; message: string };
}

export const listChildPagesToolSpec: ToolSpec = {
  name: "knowledge.list_child_pages",
  scope: "module",
  version: "1.0",
  description: "List child pages of a given page. In page chat context, defaults to children of the active page.",
  inputSchema: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "Parent page ID. Defaults to active page in knowledge context.",
      },
      include_content_preview: {
        type: "boolean",
        description: "Include first 200 chars of each page's content as markdown preview. Default: false.",
      },
    },
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

interface ListPagesRepo {
  findRootPages(workspaceId: string): Promise<KnowledgePage[]>;
  findChildPages(parentId: string, workspaceId: string): Promise<KnowledgePage[]>;
  findById(id: string): Promise<KnowledgePage | null>;
  isAncestor(ancestorId: string, nodeId: string): Promise<boolean>;
}

function getWorkspaceId(args: ListChildPagesArgs, context?: ToolExecutionContext): string | null {
  if (typeof args.workspace_id === "string" && args.workspace_id.trim().length > 0) {
    return args.workspace_id;
  }

  const activeContext = context?.activeContext as ToolActiveContext | undefined;
  if (
    typeof activeContext?.workspaceId === "string" &&
    activeContext.workspaceId.trim().length > 0
  ) {
    return activeContext.workspaceId;
  }

  return null;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function getContentPreview(page: KnowledgePage): string {
  const data = page.content_json?.data;
  if (!data) return "";
  const markdown = tiptapToMarkdown(data, { excludeImages: true, maxChars: 250 });
  return markdown.slice(0, 200);
}

function asError(code: string, message: string): ListChildPagesResult {
  return {
    success: false,
    error: { code, message },
  };
}

export function createListChildPagesToolHandler(pageRepo: ListPagesRepo): ToolHandler {
  return {
    execute: async (rawArgs: Record<string, unknown>, context?: ToolExecutionContext) => {
      const args = rawArgs as ListChildPagesArgs;

      const workspaceId = getWorkspaceId(args, context);
      if (!workspaceId) {
        return asError("MISSING_WORKSPACE", "workspace_id required");
      }

      const scope = getKnowledgePageScope(context);
      const pageId = resolvePageIdWithScopeDefault(args.page_id, scope);
      if (scope.isScoped && !pageId) {
        return asError(
          "NO_TARGET_PAGE",
          "page_id required when no active page context is available",
        );
      }

      const includePreview = args.include_content_preview === true;
      const allowedCache = new Map<string, Promise<boolean>>();
      const isAllowedPage = (candidateId: string): Promise<boolean> => {
        const cached = allowedCache.get(candidateId);
        if (cached) return cached;
        const result = isPageAllowedByScope(candidateId, scope, pageRepo);
        allowedCache.set(candidateId, result);
        return result;
      };

      try {
        // If page_id is provided, verify it exists
        if (pageId) {
          const parentPage = await pageRepo.findById(pageId);
          if (!parentPage) {
            return asError("PAGE_NOT_FOUND", `Parent page not found: ${pageId}`);
          }
          if (parentPage.workspace_id !== workspaceId) {
            return asError("WORKSPACE_MISMATCH", "Parent page does not belong to the current workspace");
          }

          const parentAllowed = await isAllowedPage(pageId);
          if (!parentAllowed) {
            return asError(
              "PAGE_ACCESS_DENIED",
              "Requested page is outside the active page scope",
            );
          }
        }

        // Fetch children
        const pages = pageId
          ? await pageRepo.findChildPages(pageId, workspaceId)
          : await pageRepo.findRootPages(workspaceId);

        // Build results with child counts
        const results: ChildPageResult[] = [];
        for (const page of pages) {
          if (!(await isAllowedPage(page.id))) {
            continue;
          }
          const children = await pageRepo.findChildPages(page.id, workspaceId);
          const allowedChildren = scope.isScoped
            ? await Promise.all(
                children.map(async (child) =>
                  (await isAllowedPage(child.id)) ? child : null,
                ),
              )
            : children;
          const filteredChildren = allowedChildren.filter(
            (child): child is KnowledgePage => child !== null,
          );
          const result: ChildPageResult = {
            id: page.id,
            title: page.title,
            icon: page.icon,
            has_children: filteredChildren.length > 0,
            child_count: filteredChildren.length,
            updated_at: toIsoString(page.updated_at),
          };

          if (includePreview) {
            result.content_preview = getContentPreview(page);
          }

          results.push(result);
        }

        return {
          success: true,
          pages: results,
          count: results.length,
          parent_page_id: pageId,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to list child pages";
        return asError("LIST_FAILED", message);
      }
    },
  };
}
