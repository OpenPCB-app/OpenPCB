import { beforeEach, describe, expect, it, mock } from "bun:test";
import { MessageService } from "./message-service";

function makeDbMessage(overrides: Record<string, unknown>) {
  return {
    id: "message-1",
    chatId: "chat-1",
    parentMessageId: null,
    role: "user",
    content: { type: "text", text: "hello" },
    taskId: null,
    provider: null,
    model: null,
    tokenCount: null,
    tokens: null,
    branchIndex: 0,
    depth: 0,
    isActive: true,
    generationParams: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function createServiceHarness() {
  const messages = new Map<string, any>();
  const findById = mock(async (id: string) => messages.get(id) ?? null);
  const createBranch = mock(async (data: Record<string, unknown>) => {
    const id = data.role === "user" ? "user-branch-1" : "assistant-draft-1";
    const created = makeDbMessage({
      id,
      ...data,
      branchIndex: data.role === "user" ? 1 : 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    messages.set(id, created);
    return created;
  });
  const update = mock(async (id: string, updates: Record<string, unknown>) => {
    const existing = messages.get(id);
    const next = { ...(existing ?? {}), ...updates };
    messages.set(id, next);
    return next;
  });
  const activateBranch = mock(async () => ({
    activated: true,
    affectedMessages: 1,
  }));
  const getChat = mock(async () => ({
    config: { provider: "ollama", model: "qwen3:8b" },
  }));
  const createMessageTask = mock(async (spec: Record<string, unknown>) => ({
    task: {
      id: "task-1",
      status: "pending",
      dependsOn: null,
      ...spec,
    },
    queueStatus: { queuedTasks: 0 },
    enqueuedImmediately: true,
  }));

  const service = Object.create(MessageService.prototype) as MessageService & {
    db: any;
    chatManager: any;
    orchestrator: any;
    branchService: any;
  };
  service.db = { messages: { findById, createBranch, update } };
  service.chatManager = { getChat };
  service.orchestrator = { createMessageTask };
  service.branchService = { activateBranch };

  return {
    service,
    messages,
    findById,
    createBranch,
    update,
    activateBranch,
    createMessageTask,
  };
}

describe("MessageService root message actions", () => {
  let harness: ReturnType<typeof createServiceHarness>;

  beforeEach(() => {
    harness = createServiceHarness();
  });

  it("edits a root user message and immediately queues a response task", async () => {
    harness.messages.set(
      "root-user",
      makeDbMessage({
        id: "root-user",
        role: "user",
        parentMessageId: null,
        content: { type: "text", text: "old text" },
      }),
    );

    const result = await harness.service.editMessage("root-user", "edited root");

    expect(result.newMessageId).toBe("user-branch-1");
    expect(result.taskId).toBe("task-1");
    expect(harness.createMessageTask).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        userMessage: "edited root",
        assistantMessageId: "assistant-draft-1",
      }),
    );
    expect(harness.update).toHaveBeenCalledWith(
      "assistant-draft-1",
      expect.objectContaining({
        taskId: "task-1",
      }),
    );
    expect(harness.activateBranch).toHaveBeenCalledWith("user-branch-1");
    expect(harness.activateBranch).toHaveBeenCalledWith("assistant-draft-1");
  });

  it("edits an assistant root message by creating a new user branch and auto-sending", async () => {
    harness.messages.set(
      "root-assistant",
      makeDbMessage({
        id: "root-assistant",
        role: "assistant",
        parentMessageId: null,
        content: { type: "text", text: "assistant answer" },
      }),
    );

    const result = await harness.service.editMessage(
      "root-assistant",
      "new prompt from edit",
    );

    expect(result.newMessageId).toBe("user-branch-1");
    expect(harness.createBranch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        parentMessageId: null,
        role: "user",
        content: { type: "text", text: "new prompt from edit" },
      }),
    );
    expect(harness.createMessageTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: "new prompt from edit",
      }),
    );
  });

  it("regenerates a root assistant message without throwing", async () => {
    harness.messages.set(
      "root-assistant",
      makeDbMessage({
        id: "root-assistant",
        role: "assistant",
        parentMessageId: null,
        content: { type: "text", text: "fallback prompt text" },
      }),
    );

    const result = await harness.service.regenerateMessage("root-assistant");

    expect(result.newMessageId).toBe("assistant-draft-1");
    expect(harness.createMessageTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: "fallback prompt text",
        assistantMessageId: "assistant-draft-1",
      }),
    );
    expect(harness.activateBranch).toHaveBeenCalledWith("assistant-draft-1");
  });
});
