import type { DatabaseAccess } from "../../../db";
import type { MessageContent } from "../../../db/schema/message";
import type {
    MessageTaskResultData,
    Task as DbTask,
} from "../../../db/schema/task";
import type { ChatManager } from "../chat-manager";

function extractMessageText(content: MessageContent): string {
    if (content.type === "text") {
        return content.text ?? "";
    }

    if (content.type === "multipart" && Array.isArray(content.parts)) {
        return content.parts
            .filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => part.text)
            .join("");
    }

    return "";
}

function getTaskResultContent(task: DbTask): string {
    const result = task.result as MessageTaskResultData | null;
    const resultData = result?.data as { content?: string } | undefined;
    let content = resultData?.content ?? "";

    if (!content && task.status === "failed" && task.error?.message) {
        content = `Task failed: ${task.error.message}`;
    }

    return content;
}

function getAssistantMetadata(task: DbTask): Record<string, unknown> | undefined {
    if (task.status === "cancelled") {
        return { incomplete: true, cancelled: true };
    }

    if (task.status === "failed") {
        return { error: task.error?.message || "Task failed", incomplete: true };
    }

    return undefined;
}

export async function persistAssistantMessageForTask(
    db: DatabaseAccess,
    chatManager: ChatManager,
    task: DbTask,
): Promise<void> {
    if (task.type !== "message" || !task.chatId) {
        return;
    }

    const assistantMessageId = task.assistantMessageId;
    if (!assistantMessageId) {
        return;
    }

    const result = task.result as MessageTaskResultData | null;
    const content = getTaskResultContent(task);
    const metadata = getAssistantMetadata(task);
    const existingById = await db.messages.findById(assistantMessageId);

    if (existingById) {
        const existingContent = extractMessageText(existingById.content as MessageContent);
        const mergedContent = content ? `${existingContent}${content}` : existingContent;

        if (mergedContent !== existingContent || result?.tokensUsed || metadata) {
            await chatManager.updateAssistantMessage(assistantMessageId, {
                ...(mergedContent !== existingContent ? { content: mergedContent } : {}),
                ...(result?.tokensUsed ? { tokens: result.tokensUsed } : {}),
                ...(metadata ? { metadata } : {}),
            });
        }
        return;
    }

    if (!content) {
        return;
    }

    await chatManager.createAssistantMessage(task.chatId, {
        id: assistantMessageId,
        content,
        taskId: task.id,
        provider: task.provider,
        model: task.model,
        tokens: result?.tokensUsed,
        metadata,
    });
}
