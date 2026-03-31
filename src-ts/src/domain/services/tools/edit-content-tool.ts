import type { ToolDefinition } from "../../../infrastructure/ai-providers/engine";
import type { ToolSpec } from "@shared/types/tool-spec.types";
import type {
  ToolExecutionContext,
  ToolHandler,
} from "@shared/types/tool.types";
import type { ContentEditorService } from "../content-editor";
import type { ContentSelection, TargetRef } from "../content-editor/types";

export const editContentToolSpec: ToolSpec = {
  name: "edit_content",
  scope: "core",
  version: "1.0",
  description:
    "Edit content in a document or page. Call this tool ONCE per edit operation — do NOT make multiple calls for the same change.\n\nMODE SELECTION:\n- replace: Rewrite the ENTIRE document. Use when user asks to completely redo content.\n- append: Add new content AFTER existing content. Use when document already has content and user wants MORE added.\n- generate: Smart mode — replaces empty documents, appends to non-empty ones. PREFERRED for writing new content.\n- selection: Edit only the user's selected text. Use when there is an active text selection.\n\nIMPORTANT: For a single user request, make ONE tool call. Combine all content into a single call. Never split content across multiple replace/generate calls — each one overwrites the previous.",
  inputSchema: {
    type: "object",
    properties: {
      target_type: {
        type: "string",
        description: "Type of content to edit. Leave empty to use active context.",
        enum: ["knowledge.page", "brainstorming.node", "writer.document"],
      },
      target_id: {
        type: "string",
        description: "ID of the target to edit. Leave empty to use currently active target.",
      },
      mode: {
        type: "string",
        enum: ["replace", "append", "generate", "selection"],
        description:
          "Edit mode: replace (full rewrite), append (add after existing), generate (smart: replaces empty docs, appends to non-empty), selection (edit selected text only).",
      },
      content: {
        type: "string",
        description:
          "Content to apply. Provide ALL content in a single call.\n- replace/generate: Full document content\n- append: Only the NEW content to add (existing content is preserved automatically)\n- selection: Only the replacement for the selected text",
      },
      content_format: {
        type: "string",
        enum: ["markdown", "html"],
        description:
          "Format of the content field. 'html' preserves rich formatting (colors, fonts, sizes, alignment). 'markdown' for basic formatting only. Default: markdown.",
      },
      instruction: {
        type: "string",
        description: "Brief description of what was edited (shown to user in history)",
      },
      live_stream: {
        type: "boolean",
        description:
          "When true (writer.document only), perform an instruction-driven live streaming rewrite using the content editor pipeline.",
      },
    },
    required: ["mode"],
    anyOf: [
      { required: ["content"] },
      {
        required: ["instruction", "live_stream"],
        properties: {
          live_stream: { const: true },
        },
      },
    ],
  },
  guards: [],
};

export function createEditContentHandler(
  contentEditorService: ContentEditorService,
): ToolHandler {
  return {
    execute: async (args: Record<string, unknown>, context?: ToolExecutionContext) => {
      const activeContext = context?.activeContext as
        | {
            workspaceId: string;
            projectId?: string;
            activeTarget?: TargetRef;
            selection?: ContentSelection;
            knowledgeScope?: {
              rootPageId?: string;
              mentionedPageIds?: string[];
              grantMode?: "exact";
              grantLifetime?: "turn";
            };
          }
        | undefined;

      const toolCallArgs = args as {
        target_type?: string;
        target_id?: string;
        mode: "replace" | "append" | "selection" | "generate";
        content?: string;
        content_format?: "markdown" | "html";
        instruction?: string;
        selection?: ContentSelection;
        live_stream?: boolean;
        workspace_id?: string;
        project_id?: string;
      };

      const workspaceId =
        activeContext?.workspaceId ||
        (typeof toolCallArgs.workspace_id === "string" && toolCallArgs.workspace_id.length > 0
          ? toolCallArgs.workspace_id
          : undefined);
      const projectId =
        activeContext?.projectId ||
        (typeof toolCallArgs.project_id === "string" && toolCallArgs.project_id.length > 0
          ? toolCallArgs.project_id
          : undefined);

      if (!workspaceId) {
        return {
          success: false,
          message: "workspaceId required",
          error: { code: "MISSING_WORKSPACE", message: "workspaceId required" },
        };
      }

      const resolvedContext: {
        workspaceId: string;
        projectId?: string;
        activeTarget?: TargetRef;
        selection?: ContentSelection;
        knowledgeScope?: {
          rootPageId?: string;
          mentionedPageIds?: string[];
          grantMode?: "exact";
          grantLifetime?: "turn";
        };
      } = {
        workspaceId,
        projectId,
        activeTarget: activeContext?.activeTarget,
        selection: activeContext?.selection,
        knowledgeScope: activeContext?.knowledgeScope,
      };

      const chatSpec = {
        provider: context?.provider ?? "unknown",
        model: context?.model ?? "unknown",
        taskId: context?.taskId,
      };

      const result = await contentEditorService.handleToolCall(
        toolCallArgs,
        resolvedContext,
        chatSpec,
      );

      return result;
    },
  };
}

/** All known aliases for the edit_content tool (bare name + scoped name). */
export const EDIT_CONTENT_ALIASES = new Set(["edit_content", "core.edit_content"]);

/**
 * @deprecated Use `editContentToolSpec` + `createEditContentHandler`.
 */
export const EDIT_CONTENT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "edit_content",
    description:
      "Edit content in a document or page. Call this tool ONCE per edit operation — do NOT make multiple calls for the same change.\n\nMODE SELECTION:\n- replace: Rewrite the ENTIRE document. Use when user asks to completely redo content.\n- append: Add new content AFTER existing content. Use when document already has content and user wants MORE added.\n- generate: Smart mode — replaces empty documents, appends to non-empty ones. PREFERRED for writing new content.\n- selection: Edit only the user's selected text. Use when there is an active text selection.\n\nIMPORTANT: For a single user request, make ONE tool call. Combine all content into a single call. Never split content across multiple replace/generate calls — each one overwrites the previous.",
    parameters: {
      type: "object",
      properties: {
        target_type: {
          type: "string",
          description: "Type of content to edit. Leave empty to use active context.",
          enum: ["knowledge.page", "brainstorming.node", "writer.document"],
        },
        target_id: {
          type: "string",
          description: "ID of the target to edit. Leave empty to use currently active target.",
        },
        mode: {
          type: "string",
          enum: ["replace", "append", "generate", "selection"],
          description:
            "Edit mode: replace (full rewrite), append (add after existing), generate (smart: replaces empty docs, appends to non-empty), selection (edit selected text only).",
        },
        content: {
          type: "string",
          description:
            "Content to apply. Provide ALL content in a single call.\n- replace/generate: Full document content\n- append: Only the NEW content to add (existing content is preserved automatically)\n- selection: Only the replacement for the selected text",
        },
        content_format: {
          type: "string",
          enum: ["markdown", "html"],
          description:
            "Format of the content field. 'html' preserves rich formatting (colors, fonts, sizes, alignment). 'markdown' for basic formatting only. Default: markdown.",
        },
        instruction: {
          type: "string",
          description: "Brief description of what was edited (shown to user in history)",
        },
        live_stream: {
          type: "boolean",
          description:
            "When true (writer.document only), perform an instruction-driven live streaming rewrite using the content editor pipeline.",
        },
      },
      required: ["mode"],
      anyOf: [
        { required: ["content"] },
        {
          required: ["instruction", "live_stream"],
          properties: {
            live_stream: { const: true },
          },
        },
      ],
    },
  },
};
