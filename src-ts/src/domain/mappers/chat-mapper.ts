import type {
  Chat,
  Message,
  MessageContent,
  ContentPart,
} from "../../db/schema";
import type { Task } from "../../db/schema/task";
import type { TaskToolEvent } from "../../db/schema/task-tool-event";
import type {
  ChatRecord,
  ChatConfig,
  ChatIcon,
  ChatCategory,
  ChatMetadata,
} from "@shared/types";
import type { KernelMessage, MessagePart, MessageRole } from "@shared/types";
import { CHAT_RECORD_VERSION, DEFAULT_CHAT_CONFIG } from "@shared/types";
import { toISO } from "../../core/utils/time";

/**
 * ChatMapper - Centralized Chat ↔ ChatRecord/ChatMetadata transformations
 * Eliminates mapping duplications across controllers
 */
export class ChatMapper {
  /**
   * Convert Chat DB entity to ChatMetadata (for list/single views)
   * Uses denormalized fields from DB (messageCount, lastMessageAt)
   */
  static chatToMetadata(chat: Chat): ChatMetadata {
    const metadata = chat.metadata as Record<string, unknown> | null;

    const config: ChatConfig = {
      provider:
        (metadata?.provider as ChatConfig["provider"]) ||
        DEFAULT_CHAT_CONFIG.provider,
      model: chat.model || DEFAULT_CHAT_CONFIG.model,
      systemPrompt: chat.systemPrompt || null,
    };

    // Build icon from database columns
    let icon: ChatIcon | null = null;
    if (chat.iconName && chat.iconColor) {
      icon = {
        name: chat.iconName as ChatIcon["name"],
        color: chat.iconColor as ChatIcon["color"],
      };
    }

    return {
      id: chat.id,
      workspaceId: chat.workspaceId,
      title: chat.title || "New Chat",
      createdAt: toISO(chat.createdAt.getTime()),
      updatedAt: toISO(chat.updatedAt.getTime()),
      config,
      messageCount: chat.messageCount ?? 0,
      lastMessagePreview: null,
      tags: [],
      pinned: chat.isPinned ?? false,
      archived: chat.isArchived ?? false,
      icon,
      folderId: chat.folderId ?? null,
      projectId: chat.projectId ?? null,
      category: (chat.category as ChatCategory | null) ?? null,
      contextRef:
        (metadata?.contextRef as ChatMetadata["contextRef"] | undefined) ??
        null,
    };
  }

  /**
   * Convert array of Chats to ChatMetadata array
   */
  static chatsToMetadata(chats: Chat[]): ChatMetadata[] {
    return chats.map((chat) => this.chatToMetadata(chat));
  }

  /**
   * Convert Chat to ChatRecord (without messages)
   * @deprecated Use chatToMetadata() for API responses, chatToChatWithMessages() for full record
   */
  static chatToChat(chat: Chat): ChatRecord {
    const metadata = chat.metadata as Record<string, unknown> | null;

    const config: ChatConfig = {
      provider:
        (metadata?.provider as ChatConfig["provider"]) ||
        DEFAULT_CHAT_CONFIG.provider,
      model: chat.model || DEFAULT_CHAT_CONFIG.model,
      systemPrompt: chat.systemPrompt || null,
    };

    // Build icon from database columns
    let icon: ChatIcon | null = null;
    if (chat.iconName && chat.iconColor) {
      icon = {
        name: chat.iconName as ChatIcon["name"],
        color: chat.iconColor as ChatIcon["color"],
      };
    }

    return {
      version: CHAT_RECORD_VERSION,
      id: chat.id,
      workspaceId: chat.workspaceId,
      title: chat.title || "New Chat",
      createdAt: toISO(chat.createdAt.getTime()),
      updatedAt: toISO(chat.updatedAt.getTime()),
      config,
      messages: [],
      tags: [],
      pinned: chat.isPinned ?? false,
      archived: chat.isArchived ?? false,
      icon,
      folderId: chat.folderId ?? null,
      projectId: chat.projectId ?? null,
      category: (chat.category as ChatCategory | null) ?? null,
      contextRef:
        (metadata?.contextRef as ChatMetadata["contextRef"] | undefined) ??
        null,
    };
  }

  /**
   * Convert Chat + Messages to ChatRecord (with messages)
   */
  static chatToChatWithMessages(
    chat: Chat,
    messages: Message[],
    timeline?: {
      tasks?: Task[];
      toolEvents?: TaskToolEvent[];
    },
  ): ChatRecord {
    const tasksByAssistantMessage = this.groupTasksByAssistantMessageId(
      timeline?.tasks ?? [],
    );
    const toolEventsByAssistantMessage =
      this.groupToolEventsByAssistantMessageId(timeline?.toolEvents ?? []);

    return {
      ...this.chatToChat(chat),
      messages: messages.map((msg) =>
        this.messageToKernelMessage(
          msg,
          tasksByAssistantMessage,
          toolEventsByAssistantMessage,
        ),
      ),
    };
  }

  /**
   * Convert Message (DB) to KernelMessage (API)
   */
  static messageToKernelMessage(
    msg: Message,
    tasksByAssistantMessage: Map<string, Task[]> = new Map(),
    toolEventsByAssistantMessage: Map<string, TaskToolEvent[]> = new Map(),
  ): KernelMessage {
    const content = msg.content as MessageContent;
    const timelineParts =
      msg.role === "assistant"
        ? this.assembleAssistantTimelineParts(
            msg.id,
            content,
            tasksByAssistantMessage.get(msg.id) ?? [],
            toolEventsByAssistantMessage.get(msg.id) ?? [],
          )
        : null;

    return {
      id: msg.id,
      role: msg.role as MessageRole,
      parts: timelineParts ?? this.contentToMessageParts(content),
      createdAt: toISO(msg.createdAt.getTime()),
    };
  }

  /**
   * Convert MessageContent (DB format) to MessagePart[] (API format)
   */
  static contentToMessageParts(content: MessageContent): MessagePart[] {
    // Handle text type
    if (content.type === "text" && content.text) {
      return [{ type: "text", text: content.text }];
    }

    // Handle multipart type
    if (content.type === "multipart" && content.parts) {
      return content.parts.map((part: ContentPart): MessagePart => {
        switch (part.type) {
          case "text":
            return { type: "text", text: part.text || "" };
          case "reasoning":
            return { type: "reasoning", text: part.text || "" };
          case "image":
            return {
              type: "file",
              data: part.imageData,
              mediaType: "image/png",
              filename: part.altText,
            };
          case "file":
            return {
              type: "file",
              // Prefer fileId (new system) over fileReferenceId (deprecated)
              url: part.fileId || part.fileReferenceId,
              filename: part.altText,
            };
          case "code":
            return {
              type: "text",
              text: part.code
                ? `\`\`\`${part.language || ""}\n${part.code}\n\`\`\``
                : "",
            };
          default:
            return { type: "text", text: "" };
        }
      });
    }

    // Handle tool_call type
    if (content.type === "tool_call" && content.toolCalls) {
      return content.toolCalls.map((tc) => ({
        type: "tool-call" as const,
        toolCallId: tc.id,
        toolName: tc.name,
        args: this.isRecord(tc.arguments) ? tc.arguments : {},
      }));
    }

    // Handle tool_result type
    if (content.type === "tool_result" && content.toolCallId) {
      const parsed = this.parseToolResultPayload(content.toolResult);
      return [
        {
          type: "tool-result" as const,
          toolCallId: content.toolCallId,
          toolName: parsed.toolName,
          result: parsed.result,
          isError: content.isError ?? undefined,
        },
      ];
    }

    // Fallback: empty parts
    return [];
  }

  /**
   * Convert array of Chats to ChatRecords
   */
  static chatsToChats(chats: Chat[]): ChatRecord[] {
    return chats.map((chat) => this.chatToChat(chat));
  }

  private static assembleAssistantTimelineParts(
    assistantMessageId: string,
    content: MessageContent,
    tasks: Task[],
    toolEvents: TaskToolEvent[],
  ): MessagePart[] | null {
    if (tasks.length === 0 && toolEvents.length === 0) {
      return null;
    }

    const parts: MessagePart[] = [];
    const sortedTasks = [...tasks].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const eventsByTask = new Map<string, TaskToolEvent[]>();

    for (const event of toolEvents) {
      const list = eventsByTask.get(event.taskId) ?? [];
      list.push(event);
      eventsByTask.set(event.taskId, list);
    }

    for (const taskEvents of eventsByTask.values()) {
      taskEvents.sort((a, b) => {
        if (a.seq !== b.seq) return a.seq - b.seq;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
    }

    for (const task of sortedTasks) {
      const taskText = this.extractTaskText(task);
      if (taskText) {
        parts.push({ type: "text", text: taskText });
      }

      const taskEvents = eventsByTask.get(task.id) ?? [];
      for (const event of taskEvents) {
        if (event.kind === "tool-call") {
          parts.push({
            type: "tool-call",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: this.isRecord(event.args) ? event.args : {},
          });
          continue;
        }

        parts.push({
          type: "tool-result",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError ?? undefined,
        });
      }
    }

    // Tool-only turns can have no assistant text; keep tool timeline visible.
    if (parts.length === 0 && assistantMessageId) {
      return this.contentToMessageParts(content);
    }

    return this.compactTextParts(parts);
  }

  private static groupTasksByAssistantMessageId(tasks: Task[]): Map<string, Task[]> {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.assistantMessageId) continue;
      const bucket = grouped.get(task.assistantMessageId) ?? [];
      bucket.push(task);
      grouped.set(task.assistantMessageId, bucket);
    }
    return grouped;
  }

  private static groupToolEventsByAssistantMessageId(
    events: TaskToolEvent[],
  ): Map<string, TaskToolEvent[]> {
    const grouped = new Map<string, TaskToolEvent[]>();
    for (const event of events) {
      const bucket = grouped.get(event.assistantMessageId) ?? [];
      bucket.push(event);
      grouped.set(event.assistantMessageId, bucket);
    }
    return grouped;
  }

  private static extractTaskText(task: Task): string {
    const result = task.result as { data?: { content?: unknown } } | null;
    const content = result?.data?.content;
    return typeof content === "string" ? content : "";
  }

  private static compactTextParts(parts: MessagePart[]): MessagePart[] {
    const compacted: MessagePart[] = [];
    for (const part of parts) {
      const prev = compacted[compacted.length - 1];
      if (prev?.type === "text" && part.type === "text") {
        prev.text += part.text;
      } else {
        compacted.push(part);
      }
    }
    return compacted;
  }

  private static parseToolResultPayload(
    toolResult: unknown,
  ): { toolName: string; result: unknown } {
    if (this.isRecord(toolResult)) {
      const namedResult = toolResult as { toolName?: unknown; result?: unknown };
      if ("toolName" in namedResult && "result" in namedResult) {
        return {
          toolName:
            typeof namedResult.toolName === "string"
              ? namedResult.toolName
              : "tool",
          result: namedResult.result,
        };
      }
    }

    return {
      toolName: "tool",
      result: toolResult,
    };
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
