import type { DatabaseAccess } from "../../db";
import type {
  ChatRecord,
  ChatMetadata,
  CreateChatInput,
  UpdateChatInput,
  KernelMessage,
} from "@shared/types";
import { ChatMapper } from "../mappers/chat-mapper";
import { NotFoundError } from "../../core/errors";
import type { Message, MessageMetadata } from "../../db/schema/message";
import type { Task } from "../../db/schema/task";

/**
 * ChatService interface
 *
 * All methods return ChatMetadata (lightweight) except getWithMessages() which returns ChatRecord.
 * This matches the Zod schema declarations (ChatResponseSchema uses ChatMetadataSchema).
 */
export interface ChatListOptions {
  folderId?: string | null;
  excludeCategories?: string[];
  projectId?: string | null;
  category?: string | null;
  contextType?: string;
  contextId?: string;
}

export interface IChatService {
  list(
    workspaceId: string,
    limit?: number,
    options?: ChatListOptions,
  ): Promise<ChatMetadata[]>;
  get(id: string): Promise<ChatMetadata>;
  getWithMessages(id: string): Promise<ChatRecord>;
  create(input: CreateChatInput, workspaceId: string): Promise<ChatMetadata>;
  update(id: string, input: UpdateChatInput): Promise<ChatMetadata>;
  delete(id: string): Promise<void>;
  bulkDelete(ids: string[]): Promise<number>;
}

/**
 * ChatService - Chat/Thread business logic
 * Uses ChatMapper for Thread↔Chat transformations
 */
export class ChatService implements IChatService {
  constructor(private db: DatabaseAccess) { }

  async list(
    workspaceId: string,
    limit = 50,
    options?: ChatListOptions,
  ): Promise<ChatMetadata[]> {
    const chats = await this.db.chats.findByWorkspace(
      workspaceId,
      limit,
      options,
    );
    return ChatMapper.chatsToMetadata(chats);
  }

  /**
   * Get chat by ID (returns ChatMetadata)
   * @throws NotFoundError if chat doesn't exist
   */
  async get(id: string): Promise<ChatMetadata> {
    const chat = await this.db.chats.findById(id);
    if (!chat) {
      throw new NotFoundError("Chat", id);
    }

    return ChatMapper.chatToMetadata(chat);
  }

  /**
   * Get chat by ID with all messages (returns ChatRecord)
   * Use this when you need the full conversation history.
   * @throws NotFoundError if chat doesn't exist
   */
  async getWithMessages(id: string): Promise<ChatRecord> {
    const chat = await this.db.chats.findById(id);
    if (!chat) {
      throw new NotFoundError("Chat", id);
    }

    const [messages, activePathMessages] = await Promise.all([
      this.db.messages.findByChat(id),
      this.db.messages.findActivePath(id),
    ]);

    const visibleMessages = activePathMessages.filter(
      (message) => message.role !== "tool",
    );
    const assistantMessageIds = visibleMessages
      .filter((message) => message.role === "assistant")
      .map((message) => message.id);
    const [tasks, toolEvents] =
      assistantMessageIds.length > 0
        ? await Promise.all([
            this.db.tasks.findByAssistantMessageIds(assistantMessageIds),
            this.db.taskToolEvents.listByAssistantMessageIds(assistantMessageIds),
          ])
        : [[], []];

    const branchCounts = this.buildBranchCountMap(messages);
    const latestTasks = this.buildLatestTaskByAssistantMap(tasks);
    const sourceById = new Map(visibleMessages.map((message) => [message.id, message]));

    const record = ChatMapper.chatToChatWithMessages(chat, visibleMessages, {
      tasks,
      toolEvents,
    });

    record.messages = record.messages.map((kernelMessage) =>
      this.enrichKernelMessage(
        kernelMessage,
        sourceById.get(kernelMessage.id),
        branchCounts,
        latestTasks,
      ),
    );

    return record;
  }

  /**
   * Create new chat (returns ChatMetadata)
   */
  async create(
    input: CreateChatInput,
    workspaceId: string,
  ): Promise<ChatMetadata> {
    const chat = await this.db.chats.create({
      workspaceId,
      title: input.title || "New Chat",
      model: input.config?.model,
      systemPrompt: input.config?.systemPrompt,
      iconName: input.icon?.name,
      iconColor: input.icon?.color,
      category: input.category || null,
      metadata: {
        provider: input.config?.provider,
        contextRef: input.contextRef ?? null,
      },
    });

    return ChatMapper.chatToMetadata(chat);
  }

  /**
   * Update chat (returns ChatMetadata)
   * @throws NotFoundError if chat doesn't exist
   */
  async update(id: string, input: UpdateChatInput): Promise<ChatMetadata> {
    const chat = await this.db.chats.findById(id);
    if (!chat) {
      throw new NotFoundError("Chat", id);
    }

    // Build update object, only include defined fields
    const updates: Record<string, unknown> = {};
    if (input.title !== undefined) updates.title = input.title;
    if (input.pinned !== undefined) updates.isPinned = input.pinned;
    if (input.archived !== undefined) updates.isArchived = input.archived;

    // Handle icon update
    if (input.icon !== undefined) {
      if (input.icon === null) {
        updates.iconName = null;
        updates.iconColor = null;
      } else {
        updates.iconName = input.icon.name;
        updates.iconColor = input.icon.color;
      }
    }

    // Handle config update
    if (input.config) {
      if (input.config.model !== undefined) {
        updates.model = input.config.model;
      }
      if (input.config.systemPrompt !== undefined) {
        updates.systemPrompt = input.config.systemPrompt;
      }
      if (input.config.provider !== undefined) {
        updates.provider = input.config.provider;

        // Update metadata.provider (source of truth for ChatMapper)
        const currentMetadata =
          (updates.metadata as Record<string, unknown>) ||
          ((chat.metadata as Record<string, unknown>) || {});
        updates.metadata = {
          ...currentMetadata,
          provider: input.config.provider,
        };
      }
    }

    if (input.folderId !== undefined) {
      updates.folderId = input.folderId;
    }

    if (input.projectId !== undefined) {
      updates.projectId = input.projectId;
    }

    if (input.category !== undefined) {
      updates.category = input.category;
    }

    if (input.contextRef !== undefined) {
      const currentMetadata =
        (updates.metadata as Record<string, unknown>) ||
        ((chat.metadata as Record<string, unknown>) || {});
      updates.metadata = {
        ...currentMetadata,
        contextRef: input.contextRef,
      };
    }

    const updated = await this.db.chats.update(id, updates);

    return ChatMapper.chatToMetadata(updated);
  }

  /**
   * Delete chat (soft delete)
   * @throws NotFoundError if chat doesn't exist
   */
  async delete(id: string): Promise<void> {
    const chat = await this.db.chats.findById(id);
    if (!chat) {
      throw new NotFoundError("Chat", id);
    }

    await this.db.chats.softDelete(id);
  }

  /**
   * Bulk delete chats (soft delete)
   * @returns Number of chats deleted
   */
  async bulkDelete(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    return await this.db.chats.bulkSoftDelete(ids);
  }

  private buildBranchCountMap(messages: Message[]): Map<string, number> {
    const siblingCounts = new Map<string, number>();
    for (const message of messages) {
      const parentKey = message.parentMessageId ?? "__root__";
      siblingCounts.set(parentKey, (siblingCounts.get(parentKey) ?? 0) + 1);
    }

    const branchCounts = new Map<string, number>();
    for (const message of messages) {
      const parentKey = message.parentMessageId ?? "__root__";
      branchCounts.set(message.id, siblingCounts.get(parentKey) ?? 1);
    }
    return branchCounts;
  }

  private buildLatestTaskByAssistantMap(tasks: Task[]): Map<string, Task> {
    const latestTaskByAssistant = new Map<string, Task>();
    for (const task of tasks) {
      if (!task.assistantMessageId) continue;
      const existing = latestTaskByAssistant.get(task.assistantMessageId);
      if (!existing || task.createdAt.getTime() > existing.createdAt.getTime()) {
        latestTaskByAssistant.set(task.assistantMessageId, task);
      }
    }
    return latestTaskByAssistant;
  }

  private sanitizeMessageMetadata(
    metadata: Message["metadata"],
  ): KernelMessage["metadata"] {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }

    const value = metadata as MessageMetadata;
    const sanitized: NonNullable<KernelMessage["metadata"]> = {};

    if (value.incomplete !== undefined) {
      sanitized.incomplete = Boolean(value.incomplete);
    }
    if (value.cancelled !== undefined) {
      sanitized.cancelled = Boolean(value.cancelled);
    }
    if (typeof value.error === "string" && value.error.length > 0) {
      sanitized.error = value.error;
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null;
  }

  private enrichKernelMessage(
    kernelMessage: KernelMessage,
    source: Message | undefined,
    branchCounts: Map<string, number>,
    latestTasks: Map<string, Task>,
  ): KernelMessage {
    if (!source) {
      return kernelMessage;
    }

    const latestTask = latestTasks.get(source.id);
    return {
      ...kernelMessage,
      parentMessageId: source.parentMessageId ?? null,
      branchIndex: source.branchIndex,
      branchCount: branchCounts.get(source.id) ?? 1,
      taskId: source.taskId ?? null,
      taskStatus: latestTask?.status ?? null,
      metadata: this.sanitizeMessageMetadata(source.metadata),
    };
  }
}
