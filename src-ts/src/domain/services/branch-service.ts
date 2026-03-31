import type { DatabaseAccess } from "../../db";
import type { Message, MessageContent } from "../../db/schema/message";
import { NotFoundError, ValidationError } from "../../core/errors";
import type {
  BranchNode,
  BranchTreeResponse,
  CreateBranchInput,
  CreateBranchResponse,
  ActivateBranchResponse,
  ArchiveBranchResponse,
  AlternateBranchesResponse,
} from "@shared/types/branch.types";

export interface IBranchService {
  getBranchTree(chatId: string): Promise<BranchTreeResponse>;
  getAlternateBranches(messageId: string): Promise<AlternateBranchesResponse>;
  createBranch(
    parentMessageId: string,
    input: CreateBranchInput,
  ): Promise<CreateBranchResponse>;
  activateBranch(messageId: string): Promise<ActivateBranchResponse>;
  archiveBranch(messageId: string): Promise<ArchiveBranchResponse>;
  cleanupInactiveBranches(retentionDays?: number): Promise<{
    softDeleted: number;
    hardDeleted: number;
  }>;
}

export class BranchService implements IBranchService {
  constructor(private db: DatabaseAccess) {}

  async getBranchTree(chatId: string): Promise<BranchTreeResponse> {
    const chat = await this.db.chats.findById(chatId);
    if (!chat) {
      throw new NotFoundError("Chat", chatId);
    }

    const messages = await this.db.messages.findByChat(chatId);
    const tree = this.buildTree(messages);

    return {
      chatId,
      branches: tree,
      totalNodes: messages.length,
    };
  }

  async getAlternateBranches(
    messageId: string,
  ): Promise<AlternateBranchesResponse> {
    const message = await this.db.messages.findById(messageId);
    if (!message) {
      throw new NotFoundError("Message", messageId);
    }

    if (!message.parentMessageId) {
      const allMessages = await this.db.messages.findByChat(message.chatId);
      const rootMessages = allMessages.filter((m) => !m.parentMessageId);

      return {
        parentMessageId: null,
        branches: rootMessages.map((m) => ({
          messageId: m.id,
          branchIndex: m.branchIndex,
          isActive: m.isActive,
          preview: this.getPreview(m),
          role: m.role,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }

    const siblings = await this.db.messages.findBranches(
      message.parentMessageId,
    );

    return {
      parentMessageId: message.parentMessageId,
      branches: siblings.map((m) => ({
        messageId: m.id,
        branchIndex: m.branchIndex,
        isActive: m.isActive,
        preview: this.getPreview(m),
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async createBranch(
    parentMessageId: string,
    input: CreateBranchInput,
  ): Promise<CreateBranchResponse> {
    const parent = await this.db.messages.findById(parentMessageId);
    if (!parent) {
      throw new NotFoundError("Message", parentMessageId);
    }

    const content = this.validateMessageContent(input.content);
    const newMessage = await this.db.messages.createBranch({
      chatId: parent.chatId,
      parentMessageId,
      role: input.role ?? "user",
      content,
      provider: input.provider ?? null,
      model: input.model ?? null,
      depth: parent.depth + 1,
      isActive: false,
    });

    return {
      message: {
        id: newMessage.id,
        chatId: newMessage.chatId,
        branchIndex: newMessage.branchIndex,
        depth: newMessage.depth,
        isActive: newMessage.isActive,
      },
    };
  }

  private validateMessageContent(content: unknown): MessageContent {
    if (!content || typeof content !== "object") {
      throw new ValidationError("Invalid message content");
    }
    const c = content as Record<string, unknown>;
    if (!c.type || typeof c.type !== "string") {
      throw new ValidationError("Message content must have a type");
    }
    return content as MessageContent;
  }

  async activateBranch(messageId: string): Promise<ActivateBranchResponse> {
    const message = await this.db.messages.findById(messageId);
    if (!message) {
      throw new NotFoundError("Message", messageId);
    }

    const allMessages = await this.db.messages.findByChat(message.chatId);
    let affectedCount = 0;

    const ancestorIds = this.collectAncestors(message, allMessages);
    const descendantIds = this.collectActiveDescendants(messageId, allMessages);

    const activePathIds = new Set([
      ...ancestorIds,
      messageId,
      ...descendantIds,
    ]);

    for (const msg of allMessages) {
      const shouldBeActive = activePathIds.has(msg.id);
      if (msg.isActive !== shouldBeActive) {
        await this.db.messages.update(msg.id, { isActive: shouldBeActive });
        affectedCount++;
      }
    }

    return {
      activated: true,
      affectedMessages: affectedCount,
    };
  }

  async archiveBranch(messageId: string): Promise<ArchiveBranchResponse> {
    const message = await this.db.messages.findById(messageId);
    if (!message) {
      throw new NotFoundError("Message", messageId);
    }

    if (message.isActive) {
      throw new ValidationError(
        "Cannot archive active branch. Activate a different branch first.",
      );
    }

    const allMessages = await this.db.messages.findByChat(message.chatId);
    const toArchive = this.collectAllDescendants(messageId, allMessages);

    for (const id of toArchive) {
      await this.db.messages.softDelete(id);
    }

    return {
      archived: true,
      archivedCount: toArchive.size,
    };
  }

  private collectAncestors(
    message: Message,
    allMessages: Message[],
  ): Set<string> {
    const ancestorIds = new Set<string>();
    let current: Message | undefined = message;

    while (current) {
      ancestorIds.add(current.id);
      if (current.parentMessageId) {
        current = allMessages.find((m) => m.id === current!.parentMessageId);
      } else {
        current = undefined;
      }
    }

    return ancestorIds;
  }

  private collectActiveDescendants(
    parentId: string,
    allMessages: Message[],
  ): Set<string> {
    const descendantIds = new Set<string>();

    const collect = (pid: string) => {
      const children = allMessages.filter((m) => m.parentMessageId === pid);
      if (children.length === 0) return;

      const activeChild = children.find((c) => c.isActive) || children[0];
      if (activeChild) {
        descendantIds.add(activeChild.id);
        collect(activeChild.id);
      }
    };

    collect(parentId);
    return descendantIds;
  }

  private collectAllDescendants(
    messageId: string,
    allMessages: Message[],
  ): Set<string> {
    const toArchive = new Set<string>([messageId]);

    const collect = (parentId: string) => {
      for (const msg of allMessages) {
        if (msg.parentMessageId === parentId && !toArchive.has(msg.id)) {
          toArchive.add(msg.id);
          collect(msg.id);
        }
      }
    };

    collect(messageId);
    return toArchive;
  }

  private buildTree(messages: Message[]): BranchNode[] {
    const childrenOf = new Map<string | null, Message[]>();

    for (const msg of messages) {
      const parentKey = msg.parentMessageId ?? null;
      if (!childrenOf.has(parentKey)) {
        childrenOf.set(parentKey, []);
      }
      childrenOf.get(parentKey)!.push(msg);
    }

    const buildNode = (msg: Message): BranchNode => {
      const children = childrenOf.get(msg.id) || [];
      return {
        messageId: msg.id,
        depth: msg.depth,
        branchIndex: msg.branchIndex,
        isActive: msg.isActive,
        childCount: children.length,
        preview: this.getPreview(msg),
        role: msg.role,
        createdAt: msg.createdAt.toISOString(),
        children:
          children.length > 0
            ? children
                .sort((a, b) => a.branchIndex - b.branchIndex)
                .map(buildNode)
            : undefined,
      };
    };

    const roots = childrenOf.get(null) || [];
    return roots.sort((a, b) => a.branchIndex - b.branchIndex).map(buildNode);
  }

  private getPreview(msg: Message): string {
    const content = msg.content;
    if (!content) return "";

    if (content.type === "text" && content.text) {
      return content.text.slice(0, 100);
    }

    if (content.type === "multipart" && content.parts) {
      const textPart = content.parts.find((p) => p.type === "text");
      if (textPart?.text) {
        return textPart.text.slice(0, 100);
      }
    }

    if (content.type === "tool_call") {
      return `[Tool call: ${content.toolCalls?.[0]?.name ?? "unknown"}]`;
    }

    if (content.type === "tool_result") {
      return "[Tool result]";
    }

    return "";
  }

  async cleanupInactiveBranches(retentionDays: number = 90): Promise<{
    softDeleted: number;
    hardDeleted: number;
  }> {
    const softDeleted =
      await this.db.messages.cleanupInactiveBranches(retentionDays);

    const hardDeleted = await this.db.messages.hardDeleteSoftDeleted(
      retentionDays * 2,
    );

    return { softDeleted, hardDeleted };
  }
}
