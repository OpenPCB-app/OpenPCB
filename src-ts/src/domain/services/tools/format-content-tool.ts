/**
 * Format Content Tool
 *
 * Applies formatting/style changes to documents WITHOUT changing text content.
 * Two modes: HTML (full document with style changes) and operations (targeted style ops).
 */

import type { ToolSpec } from "@shared/types/tool-spec.types";
import type { ToolHandler, ToolExecutionContext } from "@shared/types/tool.types";
import type { ContentTarget } from "../content-editor/content-target.interface";
import type { ContentTargetRegistry } from "../content-editor/content-target-registry";
import type { ContentEditSnapshotRepository } from "../../../db/repositories/content-edit-snapshot";
import type { TargetRef } from "../content-editor/types";
import type { TiptapDocument } from "../../utils/markdown-to-tiptap";
import { htmlToTiptap } from "../../utils/html-to-tiptap";
import { extractText } from "../content-editor/output-parser";
import { applyFormatOperations, type FormatOperation, type FormatTarget, type BlockStyles, type TextStyles, type ConvertTo } from "../content-editor/format-operations";
import { generateUUIDv7 } from "../../../db/schema/base";
import { nowISO } from "../../../core/utils/time";

export const formatContentToolSpec: ToolSpec = {
  name: "core.format_content",
  scope: "core",
  version: "1.0",
  description:
    "Apply formatting/style changes to a document WITHOUT changing text. Two modes:\n" +
    "- mode='html': Provide full document HTML with formatting changes. Text verified unchanged.\n" +
    "- mode='operations': Provide targeted style operations. Inherently content-safe.\n\n" +
    "Use for: colors, fonts, sizes, alignment, line height, highlighting, block type conversion.\n" +
    "Use edit_content instead when text content needs to change.",
  inputSchema: {
    type: "object",
    properties: {
      target_type: {
        type: "string",
        description: "Type of content to format. Leave empty to use active context.",
        enum: ["knowledge.page", "brainstorming.node", "writer.document"],
      },
      target_id: {
        type: "string",
        description: "ID of the target. Leave empty to use currently active target.",
      },
      mode: {
        type: "string",
        enum: ["html", "operations"],
        description: "html: full document with style changes. operations: targeted style ops.",
      },
      content: {
        type: "string",
        description: "Full document HTML with ONLY formatting changes (mode=html). Text must be identical to original.",
      },
      operations: {
        type: "array",
        description: "Array of targeted formatting operations (mode=operations).",
        items: {
          type: "object",
          properties: {
            target: {
              type: "object",
              description: "Which blocks to target.",
              properties: {
                blockType: {
                  type: "string",
                  enum: ["all", "heading", "paragraph", "blockquote", "codeBlock", "listItem", "callout"],
                },
                level: { type: "number", description: "Heading level (1-3)" },
                blockIndex: { type: "number", description: "0-based block index" },
                blockRange: { type: "array", items: { type: "number" }, description: "[start, end] block range" },
                textContains: { type: "string", description: "Match blocks containing this text" },
              },
            },
            blockStyles: {
              type: "object",
              properties: {
                textAlign: { type: "string", enum: ["left", "center", "right", "justify"] },
                lineHeight: { type: "string", enum: ["1", "1.15", "1.5", "2"] },
              },
            },
            textStyles: {
              type: "object",
              description: "Applied to all text in matched blocks (or only textMatch text).",
              properties: {
                color: { type: "string", description: "Hex color like #dc2626, or null to remove" },
                backgroundColor: { type: "string", description: "Highlight color, or null to remove" },
                fontFamily: { type: "string" },
                fontSize: { type: "string", description: "e.g. 16px" },
                bold: { type: "boolean" },
                italic: { type: "boolean" },
                underline: { type: "boolean" },
                strikethrough: { type: "boolean" },
              },
            },
            textMatch: {
              type: "string",
              description: "Only style text matching this exact substring within targeted blocks",
            },
            convertTo: {
              type: "object",
              description: "Convert block type.",
              properties: {
                type: { type: "string", enum: ["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "callout"] },
                level: { type: "number" },
                calloutType: { type: "string", enum: ["info", "warning", "error", "success"] },
              },
            },
          },
        },
      },
      instruction: {
        type: "string",
        description: "Description of formatting changes (shown in history)",
      },
    },
    required: ["mode"],
  },
  guards: [],
};

function resolveKnowledgeScope(activeContext?: {
  activeTarget?: TargetRef;
  knowledgeScope?: { rootPageId?: string; mentionedPageIds?: string[] };
}): {
  isScoped: boolean;
  rootPageId: string | null;
  mentionedPageIds: Set<string>;
} {
  const explicitRoot =
    typeof activeContext?.knowledgeScope?.rootPageId === "string" &&
    activeContext.knowledgeScope.rootPageId.length > 0
      ? activeContext.knowledgeScope.rootPageId
      : null;
  const activeRoot =
    activeContext?.activeTarget?.targetType === "knowledge.page" &&
    typeof activeContext.activeTarget.targetId === "string" &&
    activeContext.activeTarget.targetId.length > 0
      ? activeContext.activeTarget.targetId
      : null;
  const rootPageId = explicitRoot ?? activeRoot;
  const mentionedPageIds = new Set(
    (activeContext?.knowledgeScope?.mentionedPageIds ?? []).filter(
      (pageId): pageId is string =>
        typeof pageId === "string" && pageId.length > 0,
    ),
  );

  return {
    isScoped: rootPageId !== null,
    rootPageId,
    mentionedPageIds,
  };
}

async function isKnowledgeTargetAllowedByScope(
  targetRef: TargetRef,
  target: ContentTarget,
  activeContext?: {
    activeTarget?: TargetRef;
    knowledgeScope?: { rootPageId?: string; mentionedPageIds?: string[] };
  },
): Promise<boolean> {
  if (targetRef.targetType !== "knowledge.page") {
    return true;
  }

  const scope = resolveKnowledgeScope(activeContext);
  if (!scope.isScoped) {
    return true;
  }

  if (scope.rootPageId === targetRef.targetId) {
    return true;
  }

  if (scope.mentionedPageIds.has(targetRef.targetId)) {
    return true;
  }

  if (!scope.rootPageId || !target.getMetadata) {
    return false;
  }

  const visited = new Set<string>();
  let currentId: string | null = targetRef.targetId;
  while (currentId) {
    if (visited.has(currentId)) {
      return false;
    }
    visited.add(currentId);

    let metadata: Record<string, unknown>;
    try {
      metadata = await target.getMetadata(currentId);
    } catch {
      return false;
    }

    const parentId =
      typeof metadata.parentId === "string" && metadata.parentId.length > 0
        ? metadata.parentId
        : null;
    if (!parentId) {
      return false;
    }
    if (parentId === scope.rootPageId) {
      return true;
    }
    currentId = parentId;
  }

  return false;
}

export function createFormatContentHandler(
  targetRegistry: ContentTargetRegistry,
  snapshotRepo: ContentEditSnapshotRepository,
): ToolHandler {
  return {
    execute: async (args: Record<string, unknown>, context?: ToolExecutionContext) => {
      const activeContext = context?.activeContext as
        | {
            workspaceId: string;
            projectId?: string;
            activeTarget?: TargetRef;
            knowledgeScope?: {
              rootPageId?: string;
              mentionedPageIds?: string[];
              grantMode?: "exact";
              grantLifetime?: "turn";
            };
          }
        | undefined;

      const mode = args.mode as string;
      const content = typeof args.content === "string" ? args.content : undefined;
      const operations = Array.isArray(args.operations) ? args.operations as FormatOperation[] : undefined;
      const instruction = typeof args.instruction === "string" ? args.instruction : "Format content";

      const workspaceId = activeContext?.workspaceId ||
        (typeof args.workspace_id === "string" ? args.workspace_id : undefined);

      if (!workspaceId) {
        return {
          success: false,
          message: "workspaceId required",
          error: { code: "MISSING_WORKSPACE", message: "workspaceId required" },
        };
      }

      const targetRef: TargetRef | undefined =
        args.target_type && args.target_id
          ? { targetType: args.target_type as string, targetId: args.target_id as string }
          : activeContext?.activeTarget;

      if (!targetRef) {
        return {
          success: false,
          message: "No target specified and no active context",
          error: { code: "NO_TARGET", message: "Cannot determine format target" },
        };
      }

      let target: ContentTarget;
      try {
        target = await targetRegistry.resolve(targetRef);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to resolve target";
        return { success: false, message, error: { code: "TARGET_RESOLVE_FAILED", message } };
      }

      if (target.getMetadata) {
        try {
          const metadata = await target.getMetadata(targetRef.targetId);
          const targetWorkspaceId =
            typeof metadata.workspaceId === "string" ? metadata.workspaceId : undefined;
          if (targetWorkspaceId && targetWorkspaceId !== workspaceId) {
            return {
              success: false,
              message: "Active target belongs to a different workspace",
              error: {
                code: "WORKSPACE_MISMATCH",
                message: "Active target belongs to a different workspace",
              },
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to read target metadata";
          return {
            success: false,
            message,
            error: { code: "TARGET_METADATA_FAILED", message },
          };
        }
      }

      const scopeAllowed = await isKnowledgeTargetAllowedByScope(
        targetRef,
        target,
        activeContext,
      );
      if (!scopeAllowed) {
        return {
          success: false,
          message: "Requested page is outside the active page scope",
          error: {
            code: "PAGE_ACCESS_DENIED",
            message: "Requested page is outside the active page scope",
          },
        };
      }

      const editId = generateUUIDv7();

      try {
        const currentContent = await target.getContent(targetRef.targetId);

        if (mode === "html") {
          return await handleHtmlMode(
            target, targetRef, currentContent, content, editId, instruction,
            workspaceId, snapshotRepo, context,
          );
        }

        if (mode === "operations") {
          return await handleOperationsMode(
            target, targetRef, currentContent, operations, editId, instruction,
            workspaceId, snapshotRepo, context,
          );
        }

        return {
          success: false,
          message: `Invalid mode: ${mode}. Must be 'html' or 'operations'.`,
          error: { code: "INVALID_MODE", message: `Invalid mode: ${mode}` },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Format failed";
        return {
          success: false,
          message,
          editId,
          error: { code: "FORMAT_FAILED", message },
        };
      }
    },
  };
}

async function handleHtmlMode(
  target: ContentTarget,
  targetRef: TargetRef,
  currentContent: TiptapDocument,
  htmlContent: string | undefined,
  editId: string,
  instruction: string,
  workspaceId: string,
  snapshotRepo: ContentEditSnapshotRepository,
  context?: ToolExecutionContext,
): Promise<Record<string, unknown>> {
  if (!htmlContent) {
    return {
      success: false,
      message: "content required for mode=html",
      error: { code: "MISSING_CONTENT", message: "content required for mode=html" },
    };
  }

  // Parse HTML to TipTap
  const newTiptap = htmlToTiptap(htmlContent);

  // Content verification: extract plaintext from both
  const oldText = normalizeText(extractText(currentContent));
  const newText = normalizeText(extractText(newTiptap));

  if (oldText !== newText) {
    return {
      success: false,
      message: "Text was modified. format_content can only change styles. Use edit_content to modify text.",
      error: {
        code: "CONTENT_CHANGED",
        message: "Text content differs between original and formatted version.",
      },
    };
  }

  // Create snapshot
  await snapshotRepo.createSnapshot({
    editId,
    targetType: targetRef.targetType,
    targetId: targetRef.targetId,
    contentBefore: currentContent,
    mode: "replace",
    selectionInfo: null,
    instruction: `[format] ${instruction}`,
    provider: context?.provider ?? "format_content",
    model: context?.model ?? "format_content",
    workspaceId,
  });
  await snapshotRepo.markActive(editId);

  // Apply
  await target.setContent(targetRef.targetId, newTiptap);

  const contentAfter = await target.getContent(targetRef.targetId);
  await snapshotRepo.completeEdit(editId, { contentAfter });

  return {
    success: true,
    message: "Formatting applied successfully",
    editId,
  };
}

async function handleOperationsMode(
  target: ContentTarget,
  targetRef: TargetRef,
  currentContent: TiptapDocument,
  operations: FormatOperation[] | undefined,
  editId: string,
  instruction: string,
  workspaceId: string,
  snapshotRepo: ContentEditSnapshotRepository,
  context?: ToolExecutionContext,
): Promise<Record<string, unknown>> {
  if (!operations || operations.length === 0) {
    return {
      success: false,
      message: "operations required for mode=operations",
      error: { code: "MISSING_OPERATIONS", message: "operations required for mode=operations" },
    };
  }

  // Apply format operations — text inherently preserved
  const newContent = applyFormatOperations(currentContent, operations);

  // Create snapshot
  await snapshotRepo.createSnapshot({
    editId,
    targetType: targetRef.targetType,
    targetId: targetRef.targetId,
    contentBefore: currentContent,
    mode: "replace",
    selectionInfo: null,
    instruction: `[format-ops] ${instruction}`,
    provider: context?.provider ?? "format_content",
    model: context?.model ?? "format_content",
    workspaceId,
  });
  await snapshotRepo.markActive(editId);

  // Apply
  await target.setContent(targetRef.targetId, newContent);

  const contentAfter = await target.getContent(targetRef.targetId);
  await snapshotRepo.completeEdit(editId, { contentAfter });

  return {
    success: true,
    message: "Formatting operations applied successfully",
    editId,
    operationsApplied: operations.length,
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
