import type { ToolSpec } from "../../../../src-ts/shared/types/tool-spec.types";
import type { ToolHandler, ToolExecutionContext } from "../../../../src-ts/shared/types/tool.types";
import { requireWorkspaceContext } from "../../../../src-ts/src/domain/services/tools/tool-guards";
import type { SearchService } from "../services/search-service";
import { getKnowledgePageScope, isPageAllowedByScope } from "./page-access-scope";

export const searchPagesToolSpec: ToolSpec = {
  name: "knowledge.search_pages",
  scope: "module",
  version: "1.0",
  description: "Search Knowledge pages by title. Returns matching pages with breadcrumb paths. Use to find related or referenced pages.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (minimum 2 characters).",
        minLength: 2,
      },
      limit: {
        type: "number",
        description: "Maximum results to return. Default: 10, max: 50.",
        minimum: 1,
        maximum: 50,
      },
    },
    required: ["query"],
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

interface ActiveTargetContext {
  targetType?: unknown;
  targetId?: unknown;
}

interface ToolActiveContext {
  workspaceId?: unknown;
  activeTarget?: ActiveTargetContext;
}

interface SearchPagesArgs {
  workspace_id?: unknown;
  query?: unknown;
  limit?: unknown;
}

interface SearchPageResult {
  id: string;
  title: string;
  icon: string | null;
  breadcrumb: string[];
  updated_at: string | null;
}

function getWorkspaceId(args: SearchPagesArgs, context?: ToolExecutionContext): string | null {
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

function asError(code: string, message: string) {
  return {
    success: false,
    error: { code, message },
  };
}

export function createSearchPagesToolHandler(searchService: SearchService): ToolHandler {
  const scopeRepo = searchService.getScopeRepository();

  return {
    execute: async (rawArgs: Record<string, unknown>, context?: ToolExecutionContext) => {
      const args = rawArgs as SearchPagesArgs;

      const workspaceId = getWorkspaceId(args, context);
      if (!workspaceId) {
        return asError("MISSING_WORKSPACE", "workspace_id required");
      }

      // Validate query
      if (typeof args.query !== "string" || args.query.trim().length < 2) {
        return asError("INVALID_QUERY", "query must be a string with at least 2 characters");
      }

      const query = args.query.trim();

      // Validate limit
      let limit = 10;
      if (args.limit !== undefined && args.limit !== null) {
        if (typeof args.limit !== "number" || !Number.isFinite(args.limit)) {
          return asError("INVALID_LIMIT", "limit must be a number");
        }
        limit = Math.max(1, Math.min(50, Math.floor(args.limit)));
      }

      try {
        // SearchService.searchByTitle returns PageSearchResult[] with enriched breadcrumbs
        const results = await searchService.searchByTitle(workspaceId, query, "all", limit);
        const scope = getKnowledgePageScope(context);
        const allowedCache = new Map<string, Promise<boolean>>();
        const isAllowed = (pageId: string): Promise<boolean> => {
          const cached = allowedCache.get(pageId);
          if (cached) return cached;
          const result = isPageAllowedByScope(pageId, scope, scopeRepo);
          allowedCache.set(pageId, result);
          return result;
        };

        const pages: SearchPageResult[] = [];
        for (const result of results) {
          if (!(await isAllowed(result.id))) {
            continue;
          }
          pages.push({
            id: result.id,
            title: result.title,
            icon: result.icon,
            breadcrumb: result.breadcrumb ?? [],
            updated_at: toIsoString(result.updated_at),
          });
        }

        return {
          success: true,
          results: pages,
          count: pages.length,
          query,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Search failed";
        return asError("SEARCH_FAILED", message);
      }
    },
  };
}
