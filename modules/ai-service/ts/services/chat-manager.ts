/**
 * ChatManager - AI Task Management System Chat Operations
 *
 * Manages chat threads and messages with specific support for AI task execution:
 * - Load complete chat history for AI context
 * - Create user/assistant messages with task linkage
 * - Update chat provider/model configuration
 *
 * CRITICAL: When creating a MessageTask, the system MUST load all previous
 * messages in that chat and include them in the provider request.
 *
 * See: TASK_SYSTEM_SPECIFICATION.md Section 5.2
 */

import type { DatabaseAccess } from "../../db";
import type { ChatMetadata } from "@shared/types";
import type {
  Message,
  MessageContent,
  MessageTokens,
  MessageMetadata,
} from "../../db/schema/message";
import { chat as chatTable } from "../../db/schema/chat";
import { message as messageTable } from "../../db/schema/message";
import type { TaskToolEvent } from "../../db/schema/task-tool-event";
import { generateUUIDv7 } from "../../db/schema/base";
import { ChatMapper } from "../mappers/chat-mapper";
import { NotFoundError, BusinessError } from "../../core/errors";
import { eq } from "drizzle-orm";
import type { IFolderService } from "./folder-service";
import { MentionRegistry } from "./mention-registry";
import { parseMentions } from "../utils/mention-parser";
import {
  MentionContentResolver,
  type ResolvedMentionContent,
} from "./mention-content-resolver";

/**
 * Message format for AI provider context
 */
export interface ContextMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
}

/**
 * Input for creating a user message
 * Content can be a simple string or a MessageContent object (for multipart messages with files)
 */
export interface CreateUserMessageInput {
  content: string | MessageContent;
  parentMessageId?: string;
}

/**
 * Input for creating an assistant message
 */
export interface CreateAssistantMessageInput {
  id?: string;
  content: string;
  taskId: string;
  provider: string;
  model: string;
  tokens?: MessageTokens;
  metadata?: MessageMetadata;
  parentMessageId?: string;
}

/**
 * Chat creation input with provider info
 */
export interface CreateChatInput {
  title?: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  projectId?: string;
  folderId?: string;
}

/**
 * Chat update input
 */
export interface UpdateChatInput {
  title?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  projectId?: string | null;
  folderId?: string | null;
}

/**
 * Chat filter options
 */
export interface ChatFilter {
  workspaceId: string;
  limit?: number;
  archived?: boolean;
  pinned?: boolean;
}

export interface ForkResult {
  chatId: string;
  title: string;
  messageCount: number;
}

/**
 * IChatManager interface following spec Section 5.2
 */
export interface IChatManager {
  // Chat operations
  createChat(
    workspaceId: string,
    input: CreateChatInput,
  ): Promise<ChatMetadata>;
  getChat(chatId: string): Promise<ChatMetadata>;
  updateChat(chatId: string, updates: UpdateChatInput): Promise<void>;
  listChats(filters: ChatFilter): Promise<ChatMetadata[]>;
  forkChat(chatId: string, fromMessageId: string): Promise<ForkResult>;

  // Message operations
  createUserMessage(
    chatId: string,
    input: CreateUserMessageInput,
  ): Promise<Message>;
  createAssistantMessage(
    chatId: string,
    input: CreateAssistantMessageInput,
  ): Promise<Message>;
  getMessages(chatId: string): Promise<Message[]>;

  // Chat context loading (CRITICAL for AI tasks)
  loadChatContext(chatId: string): Promise<ContextMessage[]>;

  // Search messages via FTS5
  searchMessages(
    query: string,
    options?: { workspaceId?: string; chatId?: string; limit?: number },
  ): Promise<Message[]>;

  // Update assistant message with partial content
  updateAssistantMessage(
    messageId: string,
    updates: {
      content?: string;
      tokens?: MessageTokens;
      metadata?: MessageMetadata;
    },
  ): Promise<void>;
}

/**
 * ChatManager implementation
 */
export class ChatManager implements IChatManager {
  private folderService: IFolderService | null = null;
  private mentionContentResolver: MentionContentResolver;

  constructor(private readonly db: DatabaseAccess) {
    this.mentionContentResolver = new MentionContentResolver();
  }

  setFolderService(folderService: IFolderService): void {
    this.folderService = folderService;
  }

  // ─── Chat Operations ───────────────────────────────────────────────────

  /**
   * Create a new chat with provider configuration
   */
  async createChat(
    workspaceId: string,
    input: CreateChatInput,
  ): Promise<ChatMetadata> {
    let folderId = input.folderId ?? null;

    if (folderId && this.folderService) {
      folderId = await this.folderService.autoFixChatFolderAssignment(
        workspaceId,
        input.projectId ?? null,
        folderId,
      );
    }

    const chat = await this.db.chats.create({
      workspaceId,
      title: input.title || "New Chat",
      provider: input.provider,
      model: input.model,
      systemPrompt: input.systemPrompt,
      projectId: input.projectId ?? null,
      folderId,
      metadata: {
        provider: input.provider,
      },
    });

    return ChatMapper.chatToMetadata(chat);
  }

  /**
   * Get chat metadata by ID
   */
  async getChat(chatId: string): Promise<ChatMetadata> {
    const chat = await this.db.chats.findById(chatId);
    if (!chat) {
      throw new NotFoundError("Chat", chatId);
    }
    return ChatMapper.chatToMetadata(chat);
  }

  /**
   * Update chat configuration
   */
  async updateChat(chatId: string, updates: UpdateChatInput): Promise<void> {
    const chat = await this.db.chats.findById(chatId);
    if (!chat) {
      throw new NotFoundError("Chat", chatId);
    }

    const dbUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.provider !== undefined) dbUpdates.provider = updates.provider;
    if (updates.model !== undefined) dbUpdates.model = updates.model;
    if (updates.systemPrompt !== undefined)
      dbUpdates.systemPrompt = updates.systemPrompt;

    if (updates.projectId !== undefined) {
      dbUpdates.projectId = updates.projectId;
    }

    if (updates.folderId !== undefined) {
      const effectiveProjectId =
        updates.projectId !== undefined ? updates.projectId : chat.projectId;

      if (updates.folderId && this.folderService) {
        dbUpdates.folderId =
          await this.folderService.autoFixChatFolderAssignment(
            chat.workspaceId,
            effectiveProjectId,
            updates.folderId,
          );
      } else {
        dbUpdates.folderId = updates.folderId;
      }
    }

    // Also update metadata.provider for backward compatibility
    if (updates.provider !== undefined) {
      dbUpdates.metadata = {
        ...chat.metadata,
        provider: updates.provider,
      };
    }

    await this.db.chats.update(chatId, dbUpdates);
  }

  /**
   * List chats with optional filters
   */
  async listChats(filters: ChatFilter): Promise<ChatMetadata[]> {
    const chats = await this.db.chats.findByWorkspace(
      filters.workspaceId,
      filters.limit || 50,
    );

    // Apply additional filters
    let filtered = chats;
    if (filters.archived !== undefined) {
      filtered = filtered.filter((c) => c.isArchived === filters.archived);
    }
    if (filters.pinned !== undefined) {
      filtered = filtered.filter((c) => c.isPinned === filters.pinned);
    }

    return ChatMapper.chatsToMetadata(filtered);
  }

  async forkChat(chatId: string, fromMessageId: string): Promise<ForkResult> {
    const sourceChat = await this.db.chats.findById(chatId);
    if (!sourceChat || sourceChat.deletedAt || sourceChat.isArchived) {
      throw new NotFoundError("Chat");
    }

    const sourceMessage = await this.db.messages.findById(fromMessageId);
    if (!sourceMessage || sourceMessage.deletedAt) {
      throw new NotFoundError("Message");
    }
    if (sourceMessage.chatId !== chatId) {
      throw new BusinessError("Message not in this chat");
    }
    if (sourceMessage.role === "system") {
      throw new BusinessError("Cannot fork from system message");
    }

    const activePath = await this.db.messages.findActivePath(chatId);
    const targetIndex = activePath.findIndex((msg) => msg.id === fromMessageId);
    if (targetIndex < 0) {
      throw new BusinessError("Message not in this chat");
    }

    const messagesToFork = activePath.slice(0, targetIndex + 1);
    const forkTitle = `Fork of ${sourceChat.title || "New Chat"}`;

    return this.db.transaction(async (tx) => {
      const newChatId = generateUUIDv7();
      const now = new Date();

      await tx.query("ChatManager.forkChat.insertChat", async (client) => {
        await client.insert(chatTable).values({
          id: newChatId,
          workspaceId: sourceChat.workspaceId,
          projectId: sourceChat.projectId,
          folderId: sourceChat.folderId,
          title: forkTitle,
          summary: null,
          provider: sourceChat.provider,
          model: sourceChat.model,
          systemPrompt: sourceChat.systemPrompt,
          isPinned: false,
          isArchived: false,
          sortOrder: null,
          iconName: sourceChat.iconName,
          iconColor: sourceChat.iconColor,
          category: sourceChat.category,
          messageCount: 0,
          lastMessageAt: null,
          metadata: sourceChat.metadata,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      });

      const oldToNewMessageId = new Map<string, string>();
      for (const original of messagesToFork) {
        oldToNewMessageId.set(original.id, generateUUIDv7());
      }

      for (let i = 0; i < messagesToFork.length; i += 1) {
        const original = messagesToFork[i]!;
        const newMessageId = oldToNewMessageId.get(original.id)!;
        const parentMessageId =
          i === 0
            ? null
            : original.parentMessageId
              ? (oldToNewMessageId.get(original.parentMessageId) ?? null)
              : null;
        const sanitizedMetadata = this.sanitizeForkMetadata(
          (original.metadata as MessageMetadata | null) ?? null,
        );

        await tx.query("ChatManager.forkChat.insertMessage", async (client) => {
          await client.insert(messageTable).values({
            id: newMessageId,
            chatId: newChatId,
            parentMessageId,
            role: original.role,
            content: original.content,
            taskId: null,
            provider: original.provider,
            model: original.model,
            tokenCount: original.tokenCount,
            tokens: original.tokens,
            branchIndex: 0,
            depth: i,
            isActive: true,
            generationParams: original.generationParams,
            metadata: sanitizedMetadata,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
        });
      }

      if (messagesToFork.length > 0) {
        await tx.query("ChatManager.forkChat.updateChatStats", async (client) => {
          await client
            .update(chatTable)
            .set({
              messageCount: messagesToFork.length,
              lastMessageAt: now,
              updatedAt: now,
            })
            .where(eq(chatTable.id, newChatId));
        });
      }

      return {
        chatId: newChatId,
        title: forkTitle,
        messageCount: messagesToFork.length,
      };
    });
  }

  // ─── Message Operations ────────────────────────────────────────────────

  /**
   * Create a user message in a chat
   *
   * User messages are created directly (no task association).
   */
  async createUserMessage(
    chatId: string,
    input: CreateUserMessageInput,
  ): Promise<Message> {
    // Verify chat exists
    const chat = await this.db.chats.findById(chatId);
    if (!chat) {
      throw new NotFoundError("Chat", chatId);
    }

    // Determine depth and parent
    let depth = 0;
    if (input.parentMessageId) {
      const parent = await this.db.messages.findById(input.parentMessageId);
      if (parent) {
        depth = parent.depth + 1;
      }
    } else {
      // Find current max depth in active path
      const messages = await this.db.messages.findActivePath(chatId);
      if (messages.length > 0) {
        depth = Math.max(...messages.map((m) => m.depth)) + 1;
      }
    }

    const message = await this.db.messages.create({
      chatId,
      role: "user",
      content:
        typeof input.content === "string"
          ? ({ type: "text", text: input.content } as MessageContent)
          : input.content,
      parentMessageId: input.parentMessageId ?? null,
      depth,
      isActive: true,
    });

    await this.db.chats.incrementMessageCount(chatId);
    await this.db.chats.updateLastMessage(chatId);

    const textContent =
      typeof input.content === "string"
        ? input.content
        : input.content.type === "text"
          ? input.content.text
          : "";

    if (textContent) {
      await this.processMentions(message.id, textContent);
    }

    return message;
  }

  private async processMentions(
    messageId: string,
    content: string,
  ): Promise<void> {
    const mentions = parseMentions(content);
    if (mentions.length === 0) return;

    const registry = MentionRegistry.get();
    const mentionRecords: Array<{
      messageId: string;
      entityType: string;
      entityId: string;
      displayText: string;
      snapshotData: Record<string, unknown>;
      snapshotCreatedAt: string;
      entityVersion: string;
      position: number;
    }> = [];

    for (const mention of mentions) {
      try {
        const snapshot = await registry.createSnapshot(
          mention.entityType,
          mention.entityId,
        );

        // Skip if entity no longer exists (snapshot is null)
        if (!snapshot) {
          console.warn(
            `[ChatManager] Entity not found for mention ${mention.entityType}:${mention.entityId}, skipping`,
          );
          continue;
        }

        mentionRecords.push({
          messageId,
          entityType: mention.entityType,
          entityId: mention.entityId,
          displayText: mention.displayText,
          snapshotData: snapshot.data,
          snapshotCreatedAt: snapshot.snapshotCreatedAt,
          entityVersion: snapshot.entityVersion,
          position: mention.position,
        });
      } catch (err) {
        console.warn(
          `[ChatManager] Failed to create snapshot for mention ${mention.entityType}:${mention.entityId}:`,
          err,
        );
      }
    }

    if (mentionRecords.length > 0) {
      await this.db.mentions.createMany(mentionRecords);
    }
  }

  /**
   * Create an assistant message in a chat
   *
   * Assistant messages MUST have an associated taskId (generated by MessageTask).
   */
  async createAssistantMessage(
    chatId: string,
    input: CreateAssistantMessageInput,
  ): Promise<Message> {
    // Verify chat exists
    const chat = await this.db.chats.findById(chatId);
    if (!chat) {
      throw new NotFoundError("Chat", chatId);
    }

    if (!input.taskId) {
      throw new BusinessError(
        "Assistant messages must have an associated taskId",
      );
    }

    // Determine depth and parent
    let depth = 0;
    if (input.parentMessageId) {
      const parent = await this.db.messages.findById(input.parentMessageId);
      if (parent) {
        depth = parent.depth + 1;
      }
    } else {
      // Find current max depth in active path
      const messages = await this.db.messages.findActivePath(chatId);
      if (messages.length > 0) {
        depth = Math.max(...messages.map((m) => m.depth)) + 1;
      }
    }

    const message = await this.db.messages.create({
      id: input.id,
      chatId,
      role: "assistant",
      content: { type: "text", text: input.content } as MessageContent,
      taskId: input.taskId,
      provider: input.provider,
      model: input.model,
      tokens: input.tokens ?? null,
      metadata: input.metadata ?? null,
      parentMessageId: input.parentMessageId ?? null,
      depth,
      isActive: true,
    });

    // Update chat metadata
    await this.db.chats.incrementMessageCount(chatId);
    await this.db.chats.updateLastMessage(chatId);

    // Update chat's last used provider/model
    await this.db.chats.update(chatId, {
      provider: input.provider,
      model: input.model,
      metadata: {
        ...chat.metadata,
        provider: input.provider,
      },
    });

    return message;
  }

  /**
   * Get all messages for a chat (ordered by creation time)
   */
  async getMessages(chatId: string): Promise<Message[]> {
    const chat = await this.db.chats.findById(chatId);
    if (!chat) {
      throw new NotFoundError("Chat", chatId);
    }

    return this.db.messages.findByChat(chatId);
  }

  // ─── Context Loading (Critical for AI Tasks) ───────────────────────────

  /**
   * Load complete chat context for AI provider
   *
   * CRITICAL: This method loads ALL messages in the active conversation path
   * and formats them for inclusion in AI provider requests.
   *
   * The returned messages are ordered chronologically and include:
   * - System prompt (if configured)
   * - Referenced documents (from @mentions in user messages)
   * - All user messages
   * - All assistant responses
   *
   * This ensures proper conversation context for the AI provider.
   */
  async loadChatContext(chatId: string): Promise<ContextMessage[]> {
    // Get chat for system prompt and workspace
    const chat = await this.db.chats.findById(chatId);
    if (!chat) {
      throw new NotFoundError("Chat", chatId);
    }

    // Load active conversation path (in order)
    const messages = await this.db.messages.findActivePath(chatId);

    // Build context array
    const context: ContextMessage[] = [];

    // Add system prompt with project context if configured
    const enableProjectContext =
      process.env.ENABLE_PROJECT_CONTEXT !== "false";
    let systemPrompt = chat.systemPrompt?.trim() ?? "";

    if (enableProjectContext && chat.projectId) {
      const project = await this.db.projects.findById(chat.projectId);
      const projectPrompt = project?.aiConfig?.systemPrompt?.trim();
      const projectPromptMode = project?.aiConfig?.systemPromptMode ?? "append";

      if (projectPrompt) {
        if (projectPromptMode === "replace") {
          systemPrompt = projectPrompt;
        } else {
          systemPrompt = systemPrompt
            ? `${projectPrompt}\n\n${systemPrompt}`
            : projectPrompt;
        }
      }
    }

    if (systemPrompt) {
      context.push({
        role: "system",
        content: systemPrompt,
      });
    }

    // Resolve @mentions from user messages and inject as context
    const mentionContext = await this.resolveMentionContext(
      messages,
      chat.workspaceId,
    );
    if (mentionContext) {
      context.push({
        role: "system",
        content: mentionContext,
      });
    }

    // Add all messages in order
    const assistantMessageIds = messages
      .filter((msg) => msg.role === "assistant")
      .map((msg) => msg.id);
    const toolEvents =
      assistantMessageIds.length > 0
        ? await this.db.taskToolEvents.listByAssistantMessageIds(
            assistantMessageIds,
          )
        : [];
    const toolResultsByAssistant = this.groupToolResultsByAssistantMessage(
      toolEvents,
    );

    for (const msg of messages) {
      // Extract text content from message
      const content = msg.content as MessageContent;
      const textContent = this.extractTextContent(content);

      if (textContent) {
        if (msg.role !== "tool") {
          context.push({
            role: msg.role as "user" | "assistant" | "system",
            content: textContent,
          });
        }
      }

      if (msg.role === "assistant") {
        const toolResults = toolResultsByAssistant.get(msg.id) ?? [];
        for (const toolResult of toolResults) {
          context.push({
            role: "tool",
            content: this.formatToolEventResultContent(toolResult),
            tool_call_id: toolResult.toolCallId,
          });
        }
      }
    }

    return context;
  }

  /**
   * Resolve @mentions from messages and return formatted context section
   */
  private async resolveMentionContext(
    messages: Message[],
    workspaceId: string,
  ): Promise<string | null> {
    const resolver = this.mentionContentResolver;
    const allResolved: ResolvedMentionContent[] = [];

    // Collect mentions from all user messages
    for (const msg of messages) {
      if (msg.role === "user") {
        const textContent = this.extractTextContent(
          msg.content as MessageContent,
        );
        if (textContent) {
          try {
            const resolved = await resolver.resolveMessageMentions(
              textContent,
              workspaceId,
            );
            allResolved.push(...resolved);
          } catch (err) {
            console.warn(
              `[ChatManager] Failed to resolve mentions in message ${msg.id}:`,
              err,
            );
          }
        }
      }
    }

    if (allResolved.length === 0) {
      return null;
    }

    // Deduplicate by entityType:entityId
    const uniqueResolved = this.deduplicateMentions(allResolved);
    return resolver.formatAsContextSection(uniqueResolved);
  }

  /**
   * Deduplicate resolved mentions by entity key
   */
  private deduplicateMentions(
    mentions: ResolvedMentionContent[],
  ): ResolvedMentionContent[] {
    const seen = new Set<string>();
    return mentions.filter((m) => {
      const key = `${m.entityType}:${m.entityId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Update assistant message (for partial content during streaming)
   */
  async updateAssistantMessage(
    messageId: string,
    updates: {
      content?: string;
      tokens?: MessageTokens;
      metadata?: MessageMetadata;
    },
  ): Promise<void> {
    const message = await this.db.messages.findById(messageId);
    if (!message) {
      throw new NotFoundError("Message", messageId);
    }

    const dbUpdates: Record<string, unknown> = {};

    if (updates.content !== undefined) {
      dbUpdates.content = {
        type: "text",
        text: updates.content,
      } as MessageContent;
    }
    if (updates.tokens !== undefined) {
      dbUpdates.tokens = updates.tokens;
    }
    if (updates.metadata !== undefined) {
      dbUpdates.metadata = {
        ...((message.metadata as MessageMetadata) || {}),
        ...updates.metadata,
      };
    }

    await this.db.messages.update(messageId, dbUpdates);
  }

  async searchMessages(
    query: string,
    options?: { workspaceId?: string; chatId?: string; limit?: number },
  ): Promise<Message[]> {
    return this.db.messages.search(query, options);
  }

  // ─── Helper Methods ────────────────────────────────────────────────────

  private extractTextContent(content: MessageContent): string | null {
    if (!content) return null;

    if (content.type === "text" && content.text) {
      return content.text;
    }

    if (content.type === "multipart" && content.parts) {
      const textParts = content.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .filter(Boolean);
      return textParts.join("\n") || null;
    }

    if (content.type === "tool_result") {
      return this.formatToolResultContent(content);
    }

    return null;
  }

  private formatToolResultContent(content: MessageContent): string | null {
    if (content.type !== "tool_result") {
      return null;
    }

    const resultText = this.safeStringify(content.toolResult);
    const status = content.isError ? "Tool error" : "Tool result";
    const callSuffix = content.toolCallId ? ` (${content.toolCallId})` : "";
    return `${status}${callSuffix}: ${resultText}`;
  }

  private groupToolResultsByAssistantMessage(
    events: TaskToolEvent[],
  ): Map<
    string,
    Array<{
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
      seq: number;
    }>
  > {
    const grouped = new Map<
      string,
      Array<{
        toolCallId: string;
        toolName: string;
        result: unknown;
        isError: boolean;
        seq: number;
      }>
    >();

    for (const event of events) {
      if (event.kind !== "tool-result") {
        continue;
      }
      const bucket = grouped.get(event.assistantMessageId) ?? [];
      bucket.push({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError === true,
        seq: event.seq,
      });
      grouped.set(event.assistantMessageId, bucket);
    }

    for (const [, bucket] of grouped) {
      bucket.sort((a, b) => a.seq - b.seq);
    }

    return grouped;
  }

  private formatToolEventResultContent(input: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
  }): string {
    const status = input.isError ? "Tool error" : "Tool result";
    const name = input.toolName ? ` ${input.toolName}` : "";
    const callSuffix = input.toolCallId ? ` (${input.toolCallId})` : "";
    return `${status}${name}${callSuffix}: ${this.safeStringify(input.result)}`;
  }

  private safeStringify(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private sanitizeForkMetadata(
    metadata: MessageMetadata | null,
  ): MessageMetadata | null {
    if (!metadata) {
      return null;
    }

    const sanitized = this.stripTaskMetadata(metadata);
    if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== "object") {
      return null;
    }

    return sanitized as MessageMetadata;
  }

  private stripTaskMetadata(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.stripTaskMetadata(item));
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (key.toLowerCase().includes("task")) {
        continue;
      }
      result[key] = this.stripTaskMetadata(nested);
    }
    return result;
  }
}

/**
 * Create ChatManager singleton
 */
let chatManagerInstance: ChatManager | null = null;

export function initializeChatManager(db: DatabaseAccess): ChatManager {
  if (!chatManagerInstance) {
    chatManagerInstance = new ChatManager(db);
  }
  return chatManagerInstance;
}

export function getChatManager(): ChatManager {
  if (!chatManagerInstance) {
    throw new Error(
      "ChatManager not initialized. Call initializeChatManager() first.",
    );
  }
  return chatManagerInstance;
}
