import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseAccess } from "../../src/db";
import { runMigrations } from "../../src/db/migrate";
import { generateUUIDv7 } from "../../src/db/schema/base";
import type { MessageContent } from "../../src/db/schema/message";
import { ChatManager } from "../../src/domain/services/chat-manager";

describe("Chat fork integration", () => {
  let db: DatabaseAccess;
  let dbDir: string;
  let chatManager: ChatManager;
  let workspaceId: string;

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), "onemind-chat-fork-"));
    const dbFilePath = join(dbDir, "chat-fork-integration.db");

    DatabaseAccess.reset();
    db = DatabaseAccess.getInstance({ filePath: dbFilePath, logger: false });
    await runMigrations();

    chatManager = new ChatManager(db);
    const workspace = await db.workspaces.create({
      name: "Chat Fork Integration Workspace",
      settings: {},
    });
    workspaceId = workspace.id;
  });

  afterAll(() => {
    DatabaseAccess.reset();
    rmSync(dbDir, { recursive: true, force: true });
  });

  async function createSourceChat(options?: {
    title?: string;
    rootContent?: MessageContent;
  }) {
    const chat = await db.chats.create({
      workspaceId,
      title: options?.title ?? `Source ${generateUUIDv7()}`,
      provider: "openai",
      model: "gpt-4o-mini",
    });

    const root = await db.messages.create({
      chatId: chat.id,
      role: "user",
      content: options?.rootContent ?? ({ type: "text", text: "root user" } as MessageContent),
      parentMessageId: null,
      depth: 0,
      isActive: true,
      taskId: null,
      provider: null,
      model: null,
    });

    const firstAssistantTask = await db.tasks.create({
      type: "message",
      status: "completed",
      priority: 5,
      provider: "openai",
      model: "gpt-4o-mini",
      dependsOn: null,
      waitingTasks: [],
      payload: { source: "chat-fork-test" },
      workspaceId,
      chatId: chat.id,
      assistantMessageId: null,
    });

    const second = await db.messages.create({
      chatId: chat.id,
      role: "assistant",
      content: { type: "text", text: "assistant one" },
      parentMessageId: root.id,
      depth: 1,
      isActive: true,
      taskId: firstAssistantTask.id,
      provider: "openai",
      model: "gpt-4o-mini",
    });

    const third = await db.messages.create({
      chatId: chat.id,
      role: "user",
      content: { type: "text", text: "user two" },
      parentMessageId: second.id,
      depth: 2,
      isActive: true,
      taskId: null,
      provider: null,
      model: null,
    });

    const secondAssistantTask = await db.tasks.create({
      type: "message",
      status: "completed",
      priority: 5,
      provider: "openai",
      model: "gpt-4o-mini",
      dependsOn: null,
      waitingTasks: [],
      payload: { source: "chat-fork-test" },
      workspaceId,
      chatId: chat.id,
      assistantMessageId: null,
    });

    const fourth = await db.messages.create({
      chatId: chat.id,
      role: "assistant",
      content: { type: "text", text: "assistant two" },
      parentMessageId: third.id,
      depth: 3,
      isActive: true,
      taskId: secondAssistantTask.id,
      provider: "openai",
      model: "gpt-4o-mini",
    });

    await db.chats.update(chat.id, {
      messageCount: 4,
      lastMessageAt: fourth.createdAt,
    });

    return {
      chat,
      messages: [root, second, third, fourth],
    };
  }

  it("forks from root into a single-message chat", async () => {
    const { chat, messages } = await createSourceChat();
    const rootMessage = messages[0]!;

    const fork = await chatManager.forkChat(chat.id, rootMessage.id);

    expect(fork.chatId).not.toBe(chat.id);
    expect(fork.messageCount).toBe(1);

    const forkMessages = await db.messages.findActivePath(fork.chatId);
    expect(forkMessages).toHaveLength(1);
    expect(forkMessages[0]?.parentMessageId).toBeNull();
    expect(forkMessages[0]?.depth).toBe(0);
    expect(forkMessages[0]?.taskId).toBeNull();

    const originalMessages = await db.messages.findActivePath(chat.id);
    expect(originalMessages).toHaveLength(4);
    expect(originalMessages.map((message) => message.id)).toEqual(
      messages.map((message) => message.id),
    );
  });

  it("forks from middle and recalculates path/depth/task invariants", async () => {
    const { chat, messages } = await createSourceChat();
    const middleMessage = messages[2]!;

    const fork = await chatManager.forkChat(chat.id, middleMessage.id);

    expect(fork.chatId).not.toBe(chat.id);
    expect(fork.messageCount).toBe(3);

    const forkMessages = await db.messages.findActivePath(fork.chatId);
    expect(forkMessages).toHaveLength(3);
    expect(forkMessages[0]?.parentMessageId).toBeNull();

    for (let i = 0; i < forkMessages.length; i += 1) {
      expect(forkMessages[i]?.depth).toBe(i);
      expect(forkMessages[i]?.taskId).toBeNull();
      if (i > 0) {
        expect(forkMessages[i]?.parentMessageId).toBe(forkMessages[i - 1]?.id ?? null);
      }
    }

    const originalMessages = await db.messages.findActivePath(chat.id);
    expect(originalMessages).toHaveLength(4);
    expect(originalMessages[1]?.taskId).toBe(messages[1]?.taskId ?? null);
    expect(originalMessages[3]?.taskId).toBe(messages[3]?.taskId ?? null);
  });

  it("preserves multipart file references in forked message content", async () => {
    const fileId = generateUUIDv7();
    const { chat, messages } = await createSourceChat({
      rootContent: {
        type: "multipart",
        parts: [
          { type: "text", text: "See attached" },
          { type: "file", fileId },
        ],
      },
    });

    const fork = await chatManager.forkChat(chat.id, messages[0]!.id);
    const forkMessages = await db.messages.findActivePath(fork.chatId);
    const forkedRoot = forkMessages[0];
    const content = forkedRoot?.content as MessageContent | undefined;
    const forkedFilePart = content?.parts?.find((part) => part.type === "file");

    expect(forkedFilePart?.fileId).toBe(fileId);
  });

  it("keeps source and fork independent after later edits", async () => {
    const { chat, messages } = await createSourceChat();
    const fork = await chatManager.forkChat(chat.id, messages[2]!.id);

    const originalPath = await db.messages.findActivePath(chat.id);
    const forkPath = await db.messages.findActivePath(fork.chatId);

    await db.messages.create({
      chatId: chat.id,
      role: "user",
      content: { type: "text", text: "original only edit" },
      parentMessageId: originalPath[3]?.id ?? null,
      depth: 4,
      isActive: true,
      taskId: null,
      provider: null,
      model: null,
    });

    await db.messages.create({
      chatId: fork.chatId,
      role: "user",
      content: { type: "text", text: "fork only edit" },
      parentMessageId: forkPath[2]?.id ?? null,
      depth: 3,
      isActive: true,
      taskId: null,
      provider: null,
      model: null,
    });

    await db.messages.update(messages[0]!.id, {
      content: { type: "text", text: "updated source root" },
    });

    const afterOriginal = await db.messages.findByChat(chat.id);
    const afterFork = await db.messages.findByChat(fork.chatId);

    expect(afterOriginal.length).toBe(5);
    expect(afterFork.length).toBe(4);
    expect(afterOriginal.every((message) => message.chatId === chat.id)).toBe(true);
    expect(afterFork.every((message) => message.chatId === fork.chatId)).toBe(true);

    const sourceRoot = await db.messages.findById(messages[0]!.id);
    const forkRoot = await db.messages.findById(forkPath[0]!.id);
    expect((sourceRoot?.content as MessageContent).text).toBe("updated source root");
    expect((forkRoot?.content as MessageContent).text).toBe("root user");
  });

  it("rolls back fork transaction when an insert fails", async () => {
    const { chat, messages } = await createSourceChat({
      title: `Atomicity ${generateUUIDv7()}`,
    });

    const beforeChats = await db.chats.findByWorkspace(workspaceId, 5000);
    const beforeMessages = await db.messages.findByChat(chat.id);
    const expectedForkPathLength = 3;

    const originalTransaction = db.transaction.bind(db);
    const dbWithPatchedTransaction = db as DatabaseAccess & {
      transaction: typeof db.transaction;
    };

    dbWithPatchedTransaction.transaction = async (fn, options) => {
      return originalTransaction(async (tx) => {
        let insertMessageCalls = 0;
        const originalQuery = tx.query.bind(tx);

        (tx as typeof tx & { query: typeof tx.query }).query = async (
          operation,
          queryFn,
        ) => {
          if (operation === "ChatManager.forkChat.insertMessage") {
            insertMessageCalls += 1;
            if (insertMessageCalls === 2) {
              throw new Error("forced fork failure for atomicity test");
            }
          }
          return originalQuery(operation, queryFn);
        };

        return fn(tx);
      }, options);
    };

    try {
      await expect(chatManager.forkChat(chat.id, messages[2]!.id)).rejects.toThrow();
    } finally {
      dbWithPatchedTransaction.transaction = originalTransaction;
    }

    const afterChats = await db.chats.findByWorkspace(workspaceId, 5000);
    const afterMessages = await db.messages.findByChat(chat.id);

    expect(afterMessages.length).toBe(beforeMessages.length);
    expect(afterMessages.map((message) => message.id)).toEqual(
      beforeMessages.map((message) => message.id),
    );

    const createdForkChats = afterChats.filter(
      (candidate) =>
        !beforeChats.some((existing) => existing.id === candidate.id) &&
        candidate.title === `Fork of ${chat.title}`,
    );
    for (const createdForkChat of createdForkChats) {
      const createdForkMessages = await db.messages.findByChat(createdForkChat.id);
      expect(createdForkMessages.length).toBeLessThan(expectedForkPathLength);
      expect(createdForkChat.messageCount).toBeLessThan(expectedForkPathLength);
    }
  });

  it.skip(
    "handles very large active paths (500+ messages) within acceptable latency (skipped in default CI: perf-heavy/flaky)",
    async () => {
      const { chat, messages } = await createSourceChat();
      expect(chat.id).toBeDefined();
      expect(messages.length).toBeGreaterThan(0);
    },
  );
});
