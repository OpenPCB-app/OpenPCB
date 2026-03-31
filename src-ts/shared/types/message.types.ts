/**
 * Message Types - V2 Kernel
 *
 * Kernel-native message format. Compatible with AI SDK UIMessage for frontend rendering.
 * These types define the wire format for storage and API communication.
 */

/** Message roles */
export type MessageRole = "user" | "assistant" | "system" | "tool";

/** Text message part */
export interface TextPart {
  type: "text";
  text: string;
}

/** File/image attachment part */
export interface FilePart {
  type: "file";
  url?: string; // HTTP URL
  data?: string; // Base64 inline data
  mediaType?: string; // MIME type (e.g., "image/jpeg")
  filename?: string;
}

/** Reasoning/thinking part (for reasoning models) */
export interface ReasoningPart {
  type: "reasoning";
  text: string;
}

/** Tool call part (future) */
export interface ToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** Tool result part (future) */
export interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

/** Union of all message part types */
export type MessagePart =
  | TextPart
  | FilePart
  | ReasoningPart
  | ToolCallPart
  | ToolResultPart;

/** Kernel message format (storage/wire format) */
export interface KernelMessage {
  id: string; // UUID v7
  role: MessageRole;
  parts: MessagePart[];
  createdAt: string; // ISO 8601
  parentMessageId?: string | null;
  branchIndex?: number;
  branchCount?: number;
  taskId?: string | null;
  taskStatus?: string | null;
  metadata?: {
    incomplete?: boolean;
    cancelled?: boolean;
    error?: string;
  } | null;
}

/** Message for sending to AI provider (simplified) */
export interface ProviderMessage {
  role: MessageRole;
  content: string | ProviderContentPart[];
  tool_call_id?: string;
}

/** Provider content part (multimodal) */
export type ProviderContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string }; // Base64 or URL

/** Extract text content from message parts */
export function extractTextContent(parts: MessagePart[]): string {
  return parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/** Extract reasoning content from message parts */
export function extractReasoningContent(parts: MessagePart[]): string | undefined {
  const reasoningParts = parts.filter((p): p is ReasoningPart => p.type === "reasoning");
  if (reasoningParts.length === 0) return undefined;
  return reasoningParts.map((p) => p.text).join("\n");
}

/** Check if message contains images */
export function hasImages(parts: MessagePart[]): boolean {
  return parts.some(
    (p): p is FilePart => p.type === "file" && p.mediaType?.startsWith("image/") === true,
  );
}

/** Extract image parts from message */
export function extractImages(parts: MessagePart[]): FilePart[] {
  return parts.filter(
    (p): p is FilePart => p.type === "file" && p.mediaType?.startsWith("image/") === true,
  );
}

/** Convert kernel message to provider format */
export function toProviderMessage(message: KernelMessage): ProviderMessage | null {
  const toolResultPart = message.parts.find((p): p is ToolResultPart => p.type === "tool-result");
  if (toolResultPart) {
    return {
      role: "tool",
      tool_call_id: toolResultPart.toolCallId,
      content:
        typeof toolResultPart.result === "string"
          ? toolResultPart.result
          : JSON.stringify(toolResultPart.result),
    };
  }

  const textParts = message.parts.filter((p): p is TextPart => p.type === "text");
  const imageParts = extractImages(message.parts);

  // Filter out reasoning parts (not sent to provider)
  if (textParts.length === 0 && imageParts.length === 0) {
    return null;
  }

  // Text-only message
  if (imageParts.length === 0) {
    return {
      role: message.role,
      content: textParts.map((p) => p.text).join("\n"),
    };
  }

  // Multimodal message (images must be user role)
  const contentParts: ProviderContentPart[] = [
    ...textParts.map((p) => ({ type: "text" as const, text: p.text })),
    ...imageParts.map((p) => ({
      type: "image" as const,
      image: p.data || p.url || "",
    })),
  ];

  return {
    role: "user", // Multimodal messages must be user role
    content: contentParts,
  };
}

/** Create a text-only message */
export function createTextMessage(
  id: string,
  role: MessageRole,
  text: string,
  createdAt?: string,
): KernelMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
    createdAt: createdAt || new Date().toISOString(),
  };
}

/** Create an assistant message with optional reasoning */
export function createAssistantMessage(
  id: string,
  text: string,
  reasoning?: string,
  createdAt?: string,
): KernelMessage {
  const parts: MessagePart[] = [];

  if (reasoning) {
    parts.push({ type: "reasoning", text: reasoning });
  }

  parts.push({ type: "text", text });

  return {
    id,
    role: "assistant",
    parts,
    createdAt: createdAt || new Date().toISOString(),
  };
}
