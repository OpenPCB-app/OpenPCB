import type { ToolSpec } from "../../../../src-ts/shared/types/tool-spec.types";
import type { ToolExecutionContext, ToolHandler } from "../../../../src-ts/shared/types/tool.types";
import { requireWorkspaceContext } from "../../../../src-ts/src/domain/services/tools/tool-guards";
import type { PageService } from "../services/page-service";
import type { CreatePageParams } from "../../shared/types";
import {
  markdownToTiptap,
  optimizeTiptapDoc,
} from "../../../../src-ts/src/domain/utils/markdown-to-tiptap";
import {
  getKnowledgePageScope,
  isPageAllowedByScope,
  resolvePageIdWithScopeDefault,
} from "./page-access-scope";

export const createPageToolSpec: ToolSpec = {
  name: "knowledge.create_page",
  scope: "module",
  version: "1.0",
  description: "Create a knowledge page and optionally apply markdown content.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Page title.",
      },
      content_markdown: {
        type: "string",
        description: "Optional markdown content to populate the page.",
      },
    },
    required: ["title"],
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

export function createCreatePageToolHandler(
  pageService: PageService,
  scopeRepo: { isAncestor(ancestorId: string, nodeId: string): Promise<boolean> },
): ToolHandler {
  return {
    execute: async (args, context?: ToolExecutionContext) => {
      const workspaceId = args.workspace_id;
      const title = args.title;

      if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
        throw new Error("workspace_id required");
      }
      if (typeof title !== "string" || title.trim() === "") {
        throw new Error("title required");
      }

      const toOptionalString = (
        value: unknown,
        field: string,
      ): string | undefined => {
        if (value === undefined || value === null) return undefined;
        if (typeof value !== "string") {
          throw new Error(`${field} must be a string`);
        }
        return value;
      };

      const params: CreatePageParams = {
        workspace_id: workspaceId,
        title,
        project_id: toOptionalString(args.project_id, "project_id"),
        parent_id: toOptionalString(args.parent_id, "parent_id"),
        after_sibling_id: toOptionalString(
          args.after_sibling_id,
          "after_sibling_id",
        ),
      };

      const scope = getKnowledgePageScope(context);
      const resolvedParentId = resolvePageIdWithScopeDefault(params.parent_id, scope);

      if (scope.isScoped && !resolvedParentId) {
        return {
          success: false,
          error: {
            code: "NO_TARGET_PAGE",
            message: "parent_id required when no active page context is available",
          },
        };
      }

      if (resolvedParentId) {
        const parentAllowed = await isPageAllowedByScope(
          resolvedParentId,
          scope,
          scopeRepo,
        );
        if (!parentAllowed) {
          return {
            success: false,
            error: {
              code: "PAGE_ACCESS_DENIED",
              message: "Requested parent page is outside the active page scope",
            },
          };
        }
      }

      params.parent_id = resolvedParentId ?? undefined;

      const page = await pageService.createPage(params);

      const contentMarkdown = args.content_markdown;
      if (contentMarkdown !== undefined && contentMarkdown !== null) {
        if (typeof contentMarkdown !== "string") {
          throw new Error("content_markdown must be a string");
        }
        const tiptap = optimizeTiptapDoc(markdownToTiptap(contentMarkdown));
        const updated = await pageService.updatePageContent(page.id, {
          engine: "tiptap",
          version: 1,
          data: tiptap,
        });
        return { page: updated };
      }

      return { page };
    },
  };
}
