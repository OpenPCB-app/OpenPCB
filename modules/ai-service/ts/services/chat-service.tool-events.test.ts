import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseAccess } from "../../db";
import { runMigrations } from "../../db/migrate";
import { generateUUIDv7 } from "../../db/schema/base";
import { ChatService } from "./chat-service";

describe("ChatService tool-event assembly", () => {
  let db: DatabaseAccess;
  let dbDir: string;
  let chatId: string;
  let assistantMessageId: string;
  let firstTaskId: string;

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), "openpcb-chat-service-tools-"));
    const dbFilePath = join(dbDir, "chat-service-tools.db");

    DatabaseAccess.reset();
    db = DatabaseAccess.getInstance({ filePath: dbFilePath, logger: false });
    await runMigrations();

    const workspace = await db.workspaces.create({
      name: "Chat Service Workspace",
      settings: {},
    });

    const chat = await db.chats.create({
      workspaceId: workspace.id,
      title: "Tool Timeline Chat",
      provider: "test-provider",
      model: "test-model",
    });
    chatId = chat.id;

    await db.messages.create({
      chatId,
      role: "user",
      content: { type: "text", text: "Use a tool and answer." },
    });

    assistantMessageId = generateUUIDv7();
    await db.messages.create({
      id: assistantMessageId,
      chatId,
      role: "assistant",
      content: { type: "text", text: "Final answer" },
      provider: "test-provider",
      model: "test-model",
    });

    firstTaskId = generateUUIDv7();
    await db.tasks.create({
      id: firstTaskId,
      type: "message",
      status: "completed",
      priority: 5,
      provider: "test-provider",
      model: "test-model",
      chatId,
      assistantMessageId,
      dependsOn: null,
      waitingTasks: [],
      payload: {
        chatId,
        messages: [{ role: "user", content: "Use a tool and answer." }],
        userMessage: "Use a tool and answer.",
        stream: true,
      },
      result: {
        success: true,
        data: { content: "", role: "assistant", chunks: [] },
        duration: 1,
        finishReason: "stop",
      },
    });

    const secondTaskId = generateUUIDv7();
    await db.tasks.create({
      id: secondTaskId,
      type: "message",
      status: "completed",
      priority: 5,
      provider: "test-provider",
      model: "test-model",
      chatId,
      assistantMessageId,
      dependsOn: null,
      waitingTasks: [],
      payload: {
        chatId,
        messages: [{ role: "user", content: "Use a tool and answer." }],
        userMessage: "Use a tool and answer.",
        stream: true,
      },
      result: {
        success: true,
        data: { content: "Final answer", role: "assistant", chunks: [] },
        duration: 1,
        finishReason: "stop",
      },
    });

    await db.taskToolEvents.appendToolCall({
      chatId,
      assistantMessageId,
      taskId: firstTaskId,
      seq: 0,
      toolCallId: "call-1",
      toolName: "echo",
      args: { message: "hello" },
    });
    await db.taskToolEvents.appendToolResult({
      chatId,
      assistantMessageId,
      taskId: firstTaskId,
      seq: 1,
      toolCallId: "call-1",
      toolName: "echo",
      result: { ok: true },
      isError: false,
    });
  });

  afterAll(() => {
    DatabaseAccess.reset();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns one assistant message with inline canonical tool parts", async () => {
    const chatService = new ChatService(db);
    const record = await chatService.getWithMessages(chatId);

    expect(record.messages.some((message) => message.role === "tool")).toBe(false);

    const assistant = record.messages.find(
      (message) => message.id === assistantMessageId,
    );
    expect(assistant).toBeDefined();
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    expect(assistant.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "echo",
        }),
        expect.objectContaining({
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "echo",
          result: { ok: true },
          isError: false,
        }),
        expect.objectContaining({
          type: "text",
          text: "Final answer",
        }),
      ]),
    );
  });
});
