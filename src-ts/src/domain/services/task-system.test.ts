import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { DatabaseAccess, initializeDatabase } from "../../db";
import { runMigrations } from "../../db/migrate";
import { TaskSystem, type MessageTaskSpec } from "./task-system";
import type { ChatManager } from "./chat-manager";
import type { ToolDefinition } from "../../infrastructure/ai-providers/engine";
import type { ActiveContext, MessagePayload } from "../../db/schema/task";
import { cleanTestDatabase } from "../../../test/setup";

describe("TaskSystem MessageTask payload", () => {
  let db: DatabaseAccess;
  let taskSystem: TaskSystem;
  let chatId: string;
  let workspaceId: string;

  beforeAll(async () => {
    await cleanTestDatabase();
    DatabaseAccess.reset();

    db = initializeDatabase();
    await runMigrations();

    const workspace = await db.workspaces.create({ name: "Message Task Workspace" });
    workspaceId = workspace.id;

    const chat = await db.chats.create({
      workspaceId,
      title: "Payload Chat",
      provider: "openai",
      model: "gpt-4o-mini",
    });
    chatId = chat.id;

    const chatManagerStub = {
      loadChatContext: async () => [{ role: "user", content: "previous" }],
    } as unknown as ChatManager;

    taskSystem = new TaskSystem(db, chatManagerStub);
  });

  afterAll(async () => {
    db.close();
    DatabaseAccess.reset();
    await cleanTestDatabase();
  });

  it("persists tools/toolChoice/activeContext on MessageTask payload", async () => {
    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "echo_message",
          description: "Echoes the provided message",
          parameters: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
            required: ["message"],
          },
        },
      },
    ];

    const activeContext: ActiveContext = {
      workspaceId,
      projectId: workspaceId,
      activeTarget: {
        targetType: "knowledge.page",
        targetId: "page-123",
      },
      selection: {
        type: "tiptap",
        from: 0,
        to: 4,
        selectedText: "demo",
      },
    };

    const spec: MessageTaskSpec = {
      chatId,
      provider: "openai",
      model: "gpt-4o-mini",
      userMessage: "Run the tool",
      assistantMessageId: "assistant-msg-1",
      tools,
      toolChoice: "required",
      activeContext,
    };

    const created = await taskSystem.createMessageTask(spec);
    const stored = await db.tasks.findById(created.id);

    expect(stored).toBeDefined();

    const createdPayload = created.payload as MessagePayload;
    const storedPayload = stored?.payload as MessagePayload;

    expect(createdPayload.tools).toEqual(tools);
    expect(createdPayload.toolChoice).toBe("required");
    expect(createdPayload.activeContext).toEqual(activeContext);

    expect(storedPayload.tools).toEqual(tools);
    expect(storedPayload.toolChoice).toBe("required");
    expect(storedPayload.activeContext).toEqual(activeContext);
  });

  it("preserves tool_call_id from chat context into MessageTask payload", async () => {
    const chatManagerStub = {
      loadChatContext: async () => [
        { role: "assistant", content: "Calling tool now" },
        {
          role: "tool",
          content: "Tool result (call-123): {\"ok\":true}",
          tool_call_id: "call-123",
        },
      ],
    } as unknown as ChatManager;

    const localTaskSystem = new TaskSystem(db, chatManagerStub);
    const created = await localTaskSystem.createMessageTask({
      chatId,
      provider: "openai",
      model: "gpt-4o-mini",
      userMessage: "Continue after tool call",
      assistantMessageId: "assistant-msg-2",
    });

    const payload = created.payload as MessagePayload;
    const toolMessage = payload.messages.find((message) => message.role === "tool");

    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call-123");
  });
});
