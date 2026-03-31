import type { UIMessage, FileUIPart, ChatStatus } from "ai";

export type TextPart = { type: "text"; text: string };
export type ReasoningPart = { type: "reasoning"; text: string };
export type ToolCallPart = {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    args: unknown;
};
export type ToolResultPart = {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError?: boolean;
};
export type ExtractedMessageParts = {
    textParts: TextPart[];
    imageParts: FileUIPart[];
    reasoningParts: ReasoningPart[];
    toolCallParts: ToolCallPart[];
    toolResultParts: ToolResultPart[];
};

/**
 * Extract different types of parts from a message
 */
export function extractMessageParts(
    message: UIMessage
): ExtractedMessageParts {
    const messageParts = message.parts ?? [];

    const textParts = messageParts.filter(
        (part): part is TextPart => part.type === "text"
    );

    const imageParts = messageParts
        .filter(
            (part): part is FileUIPart =>
                part.type === "file" && Boolean(part.mediaType?.startsWith("image/"))
        )
        .map((part) => {
            const url = part.url || (part as FileUIPart & { data?: string }).data;
            return url ? { ...part, url } : null;
        })
        .filter((part): part is FileUIPart => Boolean(part));

    const reasoningParts = messageParts.filter(
        (part): part is ReasoningPart => part.type === "reasoning"
    );

    const toolCallParts = messageParts.filter(
        (part) => (part as { type?: string }).type === "tool-call"
    ) as unknown as ToolCallPart[];

    const toolResultParts = messageParts.filter(
        (part) => (part as { type?: string }).type === "tool-result"
    ) as unknown as ToolResultPart[];

    return {
        textParts,
        imageParts,
        reasoningParts,
        toolCallParts,
        toolResultParts,
    };
}

/**
 * Get all text content from a message as a single string
 */
export function getMessageText(message: UIMessage): string {
    const { textParts } = extractMessageParts(message);
    return textParts.map((part) => part.text).join("");
}

/**
 * Determine if a message at a given index is currently streaming
 */
export function isMessageStreaming(
    messageIndex: number,
    totalMessages: number,
    status?: ChatStatus
): boolean {
    const isLastMessage = messageIndex === totalMessages - 1;
    return isLastMessage && status === "streaming";
}

/**
 * Generate a message ID if not provided
 */
export function getMessageId(message: UIMessage, index: number): string {
    return message.id || `message-${index}`;
}
