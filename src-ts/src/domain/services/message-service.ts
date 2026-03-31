/**
 * MessageService - Create messages with AI task creation
 *
 * Coordinates ChatManager (message persistence) and TaskOrchestrator (task creation)
 * for the POST /api/chats/{chatId}/messages endpoint.
 *
 * See: TASK_SYSTEM_SPECIFICATION.md Section 6.1
 */

import { getChatManager, type IChatManager } from "./chat-manager";
import {
  getTaskOrchestrator,
  type TaskOrchestrator,
} from "./queue/task-orchestrator";
import { BranchService, type IBranchService } from "./branch-service";
import { DatabaseAccess } from "../../db";
import {
  NotFoundError,
  ValidationError,
  BusinessError,
} from "../../core/errors";
import type { Message, MessageContent } from "../../db/schema/message";
import { generateUUIDv7 } from "../../db/schema/base";

/**
 * Input for creating a message (and task)
 */
export interface CreateMessageInput {
  content: string;
  provider?: string;
  model?: string;
  priority?: number;
}

/**
 * Result of creating a message
 */
export interface CreateMessageResult {
  taskId: string;
  userMessageId: string;
  status: string;
  dependsOn?: string;
  queuePosition?: number;
}

export interface EditMessageResult {
  newMessageId: string;
  chatId: string;
  branchIndex: number;
  taskId: string;
}

export interface ResendMessageResult {
  taskId: string;
  messageId: string;
  status: string;
}

export interface RegenerateMessageResult {
  newMessageId: string;
  chatId: string;
  branchIndex: number;
  taskId: string;
}

/**
 * IMessageService interface
 */
export interface IMessageService {
  createMessage(
    chatId: string,
    input: CreateMessageInput,
  ): Promise<CreateMessageResult>;
  searchMessages(
    query: string,
    options?: { workspaceId?: string; chatId?: string; limit?: number },
  ): Promise<Message[]>;
  editMessage(messageId: string, newContent: string): Promise<EditMessageResult>;
  resendMessage(messageId: string): Promise<ResendMessageResult>;
  regenerateMessage(messageId: string): Promise<RegenerateMessageResult>;
}

/**
 * MessageService implementation
 *
 * Workflow:
 * 1. Validate chat exists
 * 2. Resolve provider/model (from input or chat defaults)
 * 3. Create user message via ChatManager
 * 4. Create MessageTask via TaskOrchestrator
 * 5. Return task info
 */
export class MessageService implements IMessageService {
  private db: DatabaseAccess;
  private chatManager: IChatManager;
  private orchestrator: TaskOrchestrator;
  private branchService: IBranchService;

  constructor() {
    this.db = DatabaseAccess.getInstance();
    this.chatManager = getChatManager();
    this.orchestrator = getTaskOrchestrator();
    this.branchService = new BranchService(this.db);
  }

  /**
   * Create user message and AI task
   *
   * @param chatId - Chat to add message to
   * @param input - Message content and optional provider/model override
   * @returns Task creation result
   * @throws NotFoundError if chat not found
   * @throws ValidationError if content empty
   * @throws BusinessError if provider/model not configured
   */
  async createMessage(
    chatId: string,
    input: CreateMessageInput,
  ): Promise<CreateMessageResult> {
    // 1. Validate input
    if (!input.content || input.content.trim().length === 0) {
      throw new ValidationError("Message content is required");
    }

    // 2. Get chat to resolve provider/model
    const chat = await this.chatManager.getChat(chatId);

    // Use input overrides or fall back to chat config defaults
    const provider = input.provider || chat.config.provider;
    const model = input.model || chat.config.model;

    if (!provider || !model) {
      throw new BusinessError(
        "Provider and model must be configured on chat or provided in request",
        { chatId, provider, model },
      );
    }

    // 3. Create user message via ChatManager
    const userMessage = await this.chatManager.createUserMessage(chatId, {
      content: input.content,
    });

    // 4. Create MessageTask via TaskOrchestrator
    const assistantMessageId = generateUUIDv7();
    const result = await this.orchestrator.createMessageTask({
      chatId,
      provider,
      model,
      userMessage: input.content,
      priority: input.priority,
      assistantMessageId,
    });

    // 5. Return result
    return {
      taskId: result.task.id,
      userMessageId: userMessage.id,
      status: result.task.status,
      dependsOn: result.task.dependsOn ?? undefined,
      queuePosition: result.queueStatus.queuedTasks,
    };
  }

  async searchMessages(
    query: string,
    options?: { workspaceId?: string; chatId?: string; limit?: number },
  ): Promise<Message[]> {
    return this.chatManager.searchMessages(query, options);
  }

  async editMessage(
    messageId: string,
    newContent: string,
  ): Promise<EditMessageResult> {
    const trimmedContent = newContent.trim();
    if (!trimmedContent) {
      throw new ValidationError("Message content is required");
    }

    const message = await this.db.messages.findById(messageId);
    if (!message) {
      throw new NotFoundError("Message", messageId);
    }
    if (message.role !== "user" && message.role !== "assistant") {
      throw new ValidationError("Only user or assistant messages can be edited");
    }

    const userParentMessageId = await this.resolveUserEditParentMessageId(message);
    const editedUserMessage = await this.createBranchedMessage({
      chatId: message.chatId,
      parentMessageId: userParentMessageId,
      role: "user",
      content: { type: "text", text: trimmedContent },
    });
    await this.branchService.activateBranch(editedUserMessage.id);

    const { provider, model } = await this.resolveChatProviderConfig(message.chatId);

    const assistantDraftMessage = await this.createBranchedMessage({
      chatId: message.chatId,
      parentMessageId: editedUserMessage.id,
      role: "assistant",
      content: { type: "text", text: "" },
      provider,
      model,
    });

    const result = await this.orchestrator.createMessageTask({
      chatId: message.chatId,
      provider,
      model,
      userMessage: trimmedContent,
      assistantMessageId: assistantDraftMessage.id,
    });

    await this.db.messages.update(assistantDraftMessage.id, {
      taskId: result.task.id,
      metadata: { incomplete: true },
    });
    await this.branchService.activateBranch(assistantDraftMessage.id);

    return {
      newMessageId: editedUserMessage.id,
      chatId: message.chatId,
      branchIndex: editedUserMessage.branchIndex,
      taskId: result.task.id,
    };
  }

  async resendMessage(messageId: string): Promise<ResendMessageResult> {
    const message = await this.db.messages.findById(messageId);
    if (!message) {
      throw new NotFoundError("Message", messageId);
    }
    if (message.role !== "assistant") {
      throw new ValidationError("Only assistant messages can be resent");
    }
    if (!message.taskId) {
      throw new ValidationError("Message has no associated task");
    }

    const task = await this.orchestrator.getTask(message.taskId);
    const retryableStatuses = new Set(["failed", "paused", "cancelled"]);
    if (!retryableStatuses.has(task.status)) {
      throw new ValidationError(`Cannot resend: task status is ${task.status}`);
    }

    await this.orchestrator.retryTask(message.taskId);

    return {
      taskId: message.taskId,
      messageId,
      status: "retrying",
    };
  }

  async regenerateMessage(messageId: string): Promise<RegenerateMessageResult> {
    const message = await this.db.messages.findById(messageId);
    if (!message) {
      throw new NotFoundError("Message", messageId);
    }
    if (message.role !== "assistant") {
      throw new ValidationError("Only assistant messages can be regenerated");
    }

    const { provider, model } = await this.resolveChatProviderConfig(message.chatId);

    let assistantParentMessageId: string | null = null;
    let promptText = "";

    if (message.parentMessageId) {
      const parentMessage = await this.db.messages.findById(message.parentMessageId);
      if (parentMessage && parentMessage.role === "user") {
        assistantParentMessageId = parentMessage.id;
        promptText = this.extractTextFromContent(parentMessage.content).trim();
      }
    }

    if (!assistantParentMessageId) {
      promptText = this.extractTextFromContent(message.content).trim();
      if (!promptText) {
        throw new ValidationError(
          "Cannot regenerate assistant message without a user prompt",
        );
      }

      const userBranch = await this.createBranchedMessage({
        chatId: message.chatId,
        parentMessageId: null,
        role: "user",
        content: { type: "text", text: promptText },
      });
      await this.branchService.activateBranch(userBranch.id);
      assistantParentMessageId = userBranch.id;
    }

    if (!promptText) {
      throw new ValidationError("Parent user message content is empty");
    }

    const assistantDraftMessage = await this.createBranchedMessage({
      chatId: message.chatId,
      parentMessageId: assistantParentMessageId,
      role: "assistant",
      content: { type: "text", text: "" },
      provider,
      model,
    });

    const result = await this.orchestrator.createMessageTask({
      chatId: message.chatId,
      provider,
      model,
      userMessage: promptText,
      assistantMessageId: assistantDraftMessage.id,
    });

    await this.db.messages.update(assistantDraftMessage.id, {
      taskId: result.task.id,
      metadata: { incomplete: true },
    });
    await this.branchService.activateBranch(assistantDraftMessage.id);

    return {
      newMessageId: assistantDraftMessage.id,
      chatId: message.chatId,
      branchIndex: assistantDraftMessage.branchIndex,
      taskId: result.task.id,
    };
  }

  private async resolveChatProviderConfig(chatId: string): Promise<{
    provider: string;
    model: string;
  }> {
    const chat = await this.chatManager.getChat(chatId);
    const provider = chat.config.provider;
    const model = chat.config.model;
    if (!provider || !model) {
      throw new BusinessError(
        "Provider and model must be configured on chat or provided in request",
        { chatId, provider, model },
      );
    }
    return { provider, model };
  }

  private async resolveUserEditParentMessageId(message: Message): Promise<string | null> {
    if (message.role === "user") {
      return message.parentMessageId ?? null;
    }

    if (!message.parentMessageId) {
      return null;
    }

    const parentMessage = await this.db.messages.findById(message.parentMessageId);
    if (!parentMessage) {
      return message.parentMessageId;
    }

    if (parentMessage.role === "user") {
      return parentMessage.parentMessageId ?? null;
    }

    return message.parentMessageId;
  }

  private async createBranchedMessage(input: {
    chatId: string;
    parentMessageId: string | null;
    role: "user" | "assistant";
    content: MessageContent;
    provider?: string | null;
    model?: string | null;
  }): Promise<Message> {
    let depth = 0;
    if (input.parentMessageId) {
      const parentMessage = await this.db.messages.findById(input.parentMessageId);
      if (!parentMessage) {
        throw new NotFoundError("Message", input.parentMessageId);
      }
      depth = parentMessage.depth + 1;
    }

    return this.db.messages.createBranch({
      chatId: input.chatId,
      parentMessageId: input.parentMessageId,
      role: input.role,
      content: input.content,
      taskId: null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      tokenCount: null,
      tokens: null,
      depth,
      isActive: false,
      generationParams: null,
      metadata: null,
      deletedAt: null,
    });
  }

  private extractTextFromContent(content: MessageContent): string {
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
}

// ─── Factory ────────────────────────────────────────────────────────────────

let messageServiceInstance: MessageService | null = null;

export function getMessageService(): MessageService {
  if (!messageServiceInstance) {
    messageServiceInstance = new MessageService();
  }
  return messageServiceInstance;
}

/**
 * Initialize message service (call after ChatManager and TaskOrchestrator are initialized)
 */
export function initializeMessageService(): MessageService {
  if (!messageServiceInstance) {
    messageServiceInstance = new MessageService();
  }
  return messageServiceInstance;
}
