import type { ToolSpec } from "../../../../src-ts/shared/types/tool-spec.types";
import type { ToolHandler, ToolExecutionContext } from "../../../../src-ts/shared/types/tool.types";
import { requireWorkspaceContext } from "../../../../src-ts/src/domain/services/tools/tool-guards";
import type { ContentContext } from "../../../../src-ts/src/domain/services/content-editor/types";
import { tiptapToMarkdown } from "../../../../src-ts/src/domain/utils/tiptap-to-markdown";
import { tiptapToHTML } from "../../../../src-ts/src/domain/utils/tiptap-to-html";
import type { KnowledgePageTarget } from "../adapters/knowledge-page-target";
import {
  getKnowledgePageScope,
  isPageAllowedByScope,
  resolvePageIdWithScopeDefault,
} from "./page-access-scope";

const DEFAULT_MAX_CHARS = 12000;
const MIN_MAX_CHARS = 200;
const MAX_MAX_CHARS = 50000;

interface ToolActiveContext {
  workspaceId?: unknown;
}

interface ReadPageArgs {
  workspace_id?: unknown;
  page_id?: unknown;
  max_chars?: unknown;
  format?: unknown;
}

interface KnowledgePageSnapshot {
  id: string;
  title: string | null;
  icon: string | null;
  workspace_id: string;
  updated_at: string | null;
}

interface ReadPageResult {
  success: boolean;
  page?: KnowledgePageSnapshot;
  content_markdown?: string;
  content_html?: string;
  content_format?: "markdown" | "html";
  total_chars?: number;
  returned_chars?: number;
  truncated?: boolean;
  error?: { code: string; message: string };
}

export const readPageToolSpec: ToolSpec = {
  name: "knowledge.read_page",
  scope: "module",
  version: "1.0",
  description:
    "Read content of the current or specified Knowledge page.",
  inputSchema: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "Page ID to read. Defaults to active page in knowledge context.",
      },
      max_chars: {
        type: "number",
        description:
          "Maximum number of characters to return. Defaults to 12000.",
        minimum: MIN_MAX_CHARS,
        maximum: MAX_MAX_CHARS,
      },
      format: {
        type: "string",
        enum: ["markdown", "html"],
        description:
          "Content format. 'html' includes rich formatting (colors, fonts, alignment). Default: html.",
      },
    },
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

function getWorkspaceId(args: ReadPageArgs, context?: ToolExecutionContext): string | null {
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

function normalizeMaxChars(raw: unknown): number | null {
  if (raw === undefined || raw === null) {
    return DEFAULT_MAX_CHARS;
  }

  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }

  const rounded = Math.floor(raw);
  if (rounded < MIN_MAX_CHARS || rounded > MAX_MAX_CHARS) {
    return null;
  }

  return rounded;
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

function buildContent(context: ContentContext, format: "markdown" | "html"): string {
  if (format === "html") {
    return tiptapToHTML(context.fullContent, {
      excludeImages: true,
      includeStyles: true,
    });
  }
  return tiptapToMarkdown(context.fullContent, {
    excludeImages: true,
    includeCodeBlocks: true,
  });
}

function truncateContent(content: string, maxChars: number): {
  content: string;
  totalChars: number;
  returnedChars: number;
  truncated: boolean;
} {
  const totalChars = content.length;
  const truncated = totalChars > maxChars;
  const returned = truncated ? content.slice(0, maxChars) : content;

  return {
    content: returned,
    totalChars,
    returnedChars: returned.length,
    truncated,
  };
}

function asError(code: string, message: string): ReadPageResult {
  return {
    success: false,
    error: { code, message },
  };
}

type ReadTarget = Pick<KnowledgePageTarget, "exists" | "getContentContext" | "getMetadata">;

interface ScopeRepo {
  isAncestor(ancestorId: string, nodeId: string): Promise<boolean>;
}

export function createReadPageToolHandler(target: ReadTarget, scopeRepo: ScopeRepo): ToolHandler {
  return {
    execute: async (rawArgs: Record<string, unknown>, context?: ToolExecutionContext) => {
      const args = rawArgs as ReadPageArgs;

      const workspaceId = getWorkspaceId(args, context);
      if (!workspaceId) {
        return asError("MISSING_WORKSPACE", "workspace_id required");
      }

      const maxChars = normalizeMaxChars(args.max_chars);
      if (maxChars === null) {
        return asError(
          "INVALID_MAX_CHARS",
          `max_chars must be an integer between ${MIN_MAX_CHARS} and ${MAX_MAX_CHARS}`,
        );
      }

      const scope = getKnowledgePageScope(context);
      const targetId = resolvePageIdWithScopeDefault(args.page_id, scope);
      if (!targetId) {
        return asError("NO_TARGET_PAGE", "page_id required when no active page context is available");
      }

      const allowed = await isPageAllowedByScope(targetId, scope, scopeRepo);
      if (!allowed) {
        return asError(
          "PAGE_ACCESS_DENIED",
          "Requested page is outside the active page scope",
        );
      }

      try {
        const exists = await target.exists(targetId);
        if (!exists) {
          return asError("PAGE_NOT_FOUND", `Page not found: ${targetId}`);
        }

        const metadata = (await target.getMetadata?.(targetId)) ?? {};
        const pageWorkspaceId =
          typeof metadata.workspaceId === "string" ? metadata.workspaceId : workspaceId;

        if (pageWorkspaceId !== workspaceId) {
          return asError(
            "WORKSPACE_MISMATCH",
            "Active page does not belong to the current workspace",
          );
        }

        const format = (args.format === "markdown" ? "markdown" : "html") as "markdown" | "html";
        const contentContext = await target.getContentContext(targetId);
        const content = buildContent(contentContext, format);
        const truncated = truncateContent(content, maxChars);

        const result: ReadPageResult = {
          success: true,
          page: {
            id: targetId,
            title: typeof metadata.title === "string" ? metadata.title : null,
            icon: typeof metadata.icon === "string" ? metadata.icon : null,
            workspace_id: pageWorkspaceId,
            updated_at: toIsoString(metadata.updatedAt),
          },
          total_chars: truncated.totalChars,
          returned_chars: truncated.returnedChars,
          truncated: truncated.truncated,
        };

        if (format === "html") {
          result.content_html = truncated.content;
          result.content_format = "html";
        } else {
          result.content_markdown = truncated.content;
          result.content_format = "markdown";
        }

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to read page";
        return asError("READ_FAILED", message);
      }
    },
  };
}
