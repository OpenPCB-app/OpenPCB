import type { ToolSpec } from "../../../../src-ts/shared/types/tool-spec.types";
import type { ToolHandler, ToolExecutionContext } from "../../../../src-ts/shared/types/tool.types";
import { requireWorkspaceContext } from "../../../../src-ts/src/domain/services/tools/tool-guards";
import { tiptapToMarkdown } from "../../../../src-ts/src/domain/utils/tiptap-to-markdown";
import type { KnowledgePageTarget } from "../adapters/knowledge-page-target";
import type { PageRepository } from "../db/repositories/page-repository";
import {
  getKnowledgePageScope,
  isPageAllowedByScope,
  resolvePageIdWithScopeDefault,
} from "./page-access-scope";

interface ToolActiveContext {
  workspaceId?: unknown;
}

interface HeadingOutline {
  level: number;
  text: string;
}

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
}

export const pageInfoToolSpec: ToolSpec = {
  name: "knowledge.page_info",
  scope: "module",
  version: "1.0",
  description:
    "Get metadata about the current Knowledge page: title, word count, icon, properties, breadcrumb, outline. Use to understand page state before editing.",
  inputSchema: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "Page ID to inspect. Defaults to active page in knowledge context.",
      },
    },
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

function extractHeadings(content: unknown): HeadingOutline[] {
  if (!content || typeof content !== "object") return [];
  const doc = content as { type?: string; content?: TiptapNode[] };
  if (doc.type !== "doc" || !doc.content) return [];

  const headings: HeadingOutline[] = [];
  for (const node of doc.content) {
    if (node.type === "heading") {
      const level = (node.attrs?.level as number) || 1;
      const text = extractText(node);
      if (text) headings.push({ level, text });
    }
  }
  return headings;
}

function extractText(node: TiptapNode): string {
  if (node.type === "text") return node.text || "";
  if (!node.content) return "";
  return node.content.map(extractText).join("");
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function formatPropertyValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return "N/A";
  switch (type) {
    case "checkbox":
      return value ? "Yes" : "No";
    case "multi-select":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "date":
      try {
        return new Date(value as string).toLocaleDateString();
      } catch {
        return String(value);
      }
    default:
      return String(value);
  }
}

function formatProperties(
  propsJson: Record<string, { name: string; type: string; value: unknown }> | null,
): Array<{ name: string; type: string; value: string }> {
  if (!propsJson || Object.keys(propsJson).length === 0) return [];
  return Object.values(propsJson).map((prop) => ({
    name: prop.name,
    type: prop.type,
    value: formatPropertyValue(prop.value, prop.type),
  }));
}

type InfoTarget = Pick<KnowledgePageTarget, "exists" | "getContent" | "getContentContext" | "getMetadata">;

interface ScopeRepo {
  isAncestor(ancestorId: string, nodeId: string): Promise<boolean>;
}

export function createPageInfoToolHandler(target: InfoTarget, pageRepo: PageRepository): ToolHandler {
  return {
    execute: async (rawArgs: Record<string, unknown>, context?: ToolExecutionContext) => {
      const args = rawArgs as { page_id?: unknown };
      const activeContext = context?.activeContext as ToolActiveContext | undefined;

      const workspaceId =
        typeof activeContext?.workspaceId === "string" && activeContext.workspaceId.trim().length > 0
          ? activeContext.workspaceId
          : null;

      if (!workspaceId) {
        return { success: false, error: { code: "MISSING_WORKSPACE", message: "workspace_id required" } };
      }

      const scope = getKnowledgePageScope(context);
      const targetId = resolvePageIdWithScopeDefault(args.page_id, scope);
      if (!targetId) {
        return {
          success: false,
          error: {
            code: "NO_TARGET_PAGE",
            message: "page_id required when no active page context is available",
          },
        };
      }

      const scopeAllowed = await isPageAllowedByScope(
        targetId,
        scope,
        pageRepo as unknown as ScopeRepo,
      );
      if (!scopeAllowed) {
        return {
          success: false,
          error: {
            code: "PAGE_ACCESS_DENIED",
            message: "Requested page is outside the active page scope",
          },
        };
      }

      try {
        const exists = await target.exists(targetId);
        if (!exists) {
          return { success: false, error: { code: "PAGE_NOT_FOUND", message: `Page not found: ${targetId}` } };
        }

        const metadata = (await target.getMetadata?.(targetId)) ?? {};
        const pageWorkspaceId = typeof metadata.workspaceId === "string" ? metadata.workspaceId : workspaceId;
        if (pageWorkspaceId !== workspaceId) {
          return {
            success: false,
            error: { code: "WORKSPACE_MISMATCH", message: "Page does not belong to the current workspace" },
          };
        }

        // Get full page for properties and hierarchy
        const fullPage = await pageRepo.findById(targetId);
        const breadcrumb = await pageRepo.getBreadcrumb(targetId);

        const tiptapContent = await target.getContent(targetId);
        const markdown = tiptapToMarkdown(tiptapContent, { excludeImages: true, includeCodeBlocks: true });
        const charCount = markdown.length;
        const wordCount = countWords(markdown);
        const isEmpty = charCount === 0;
        const outline = extractHeadings(tiptapContent);

        const properties = formatProperties(fullPage?.properties_json ?? null);

        return {
          success: true,
          id: targetId,
          title: typeof metadata.title === "string" ? metadata.title : null,
          isEmpty,
          charCount,
          wordCount,
          updatedAt: toIsoString(metadata.updatedAt),
          outline,
          icon: typeof metadata.icon === "string" ? metadata.icon : null,
          properties,
          parent_id: fullPage?.parent_id ?? null,
          breadcrumb,
          project_id: fullPage?.project_id ?? null,
          is_project_root: fullPage?.is_project_root ?? false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to read page info";
        return { success: false, error: { code: "READ_FAILED", message } };
      }
    },
  };
}
