/**
 * Shared edit lifecycle tracking utilities for module chat hooks.
 *
 * Extracted from Writer's useWriterDocumentChat to enable reuse
 * across Knowledge, Writer, and future modules that track
 * edit_content / format_content tool calls.
 */

export const EDIT_CONTENT_TOOL_NAMES = new Set([
  "edit_content", "core.edit_content",
  "format_content", "core.format_content",
]);

export type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  occurrenceKey: string;
};

export type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  occurrenceKey: string;
};

export type EditLifecycleStatus = "started" | "completed" | "failed";

export interface EditLifecycleEvent {
  chatId: string;
  documentId: string;
  toolCallId: string;
  toolName: string;
  status: EditLifecycleStatus;
  editId?: string;
  result?: unknown;
}

export interface EditAppliedEvent {
  chatId: string;
  documentId: string;
  toolCallId: string;
  editId?: string;
  result: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function collectEditToolCalls(messages: Array<{ parts?: unknown[] }>): ToolCallPart[] {
  const calls: ToolCallPart[] = [];
  const callOccurrencesByCallId = new Map<string, number>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!isRecord(part) || part.type !== "tool-call") {
        continue;
      }

      const toolCallId =
        typeof part.toolCallId === "string" ? part.toolCallId : null;
      const toolName =
        typeof part.toolName === "string" ? part.toolName : null;
      if (!toolCallId || !toolName) {
        continue;
      }

      if (!EDIT_CONTENT_TOOL_NAMES.has(toolName)) {
        continue;
      }

      const occurrence = callOccurrencesByCallId.get(toolCallId) ?? 0;
      callOccurrencesByCallId.set(toolCallId, occurrence + 1);

      calls.push({
        type: "tool-call",
        toolCallId,
        toolName,
        args: part.args,
        occurrenceKey: `${toolCallId}#${occurrence}`,
      });
    }
  }
  return calls;
}

export function collectEditToolResults(
  messages: Array<{ parts?: unknown[] }>,
): ToolResultPart[] {
  const results: ToolResultPart[] = [];
  const resultOccurrencesByCallId = new Map<string, number>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!isRecord(part) || part.type !== "tool-result") {
        continue;
      }

      const toolCallId =
        typeof part.toolCallId === "string" ? part.toolCallId : null;
      const toolName =
        typeof part.toolName === "string" ? part.toolName : null;
      if (!toolCallId || !toolName) {
        continue;
      }

      if (!EDIT_CONTENT_TOOL_NAMES.has(toolName)) {
        continue;
      }

      const occurrence = resultOccurrencesByCallId.get(toolCallId) ?? 0;
      resultOccurrencesByCallId.set(toolCallId, occurrence + 1);

      results.push({
        type: "tool-result",
        toolCallId,
        toolName,
        result: part.result,
        isError: typeof part.isError === "boolean" ? part.isError : undefined,
        occurrenceKey: `${toolCallId}#${occurrence}`,
      });
    }
  }
  return results;
}

export function isSuccessfulEditToolResult(part: ToolResultPart): boolean {
  if (part.isError) {
    return false;
  }

  if (isRecord(part.result) && typeof part.result.success === "boolean") {
    return part.result.success;
  }

  return true;
}

export function getEditId(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  return typeof result.editId === "string" ? result.editId : undefined;
}
