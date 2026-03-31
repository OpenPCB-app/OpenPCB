import { afterEach, describe, expect, it, mock } from "bun:test";
import type { DatabaseAccess } from "../../db";
import { LicenseDeniedError, LicenseUtil } from "./license-util";
import type { TaskOrchestrator } from "./queue/task-orchestrator";
import { StreamService } from "./stream-service";

describe("StreamService license enforcement", () => {
  const originalGetCurrentStatus = LicenseUtil.getCurrentStatus;

  afterEach(() => {
    LicenseUtil.getCurrentStatus = originalGetCurrentStatus;
  });

  function createHarness() {
    const createChat = mock(async () => ({ id: "chat-1" }));
    const createUserMessage = mock(async () => ({ id: "user-1" }));
    const createMessageTask = mock(async () => ({
      task: {
        id: "task-1",
        status: "pending",
        provider: "openai",
        model: "gpt-4o",
      },
      queueStatus: {
        provider: "openai",
        queuedTasks: 0,
        activeTasks: 1,
        availableSlots: 2,
      },
    }));

    const orchestrator = {
      getChatManager: mock(() => ({ createChat })),
      createUserMessage,
      createMessageTask,
      createAssistantMessage: mock(async () => ({ id: "assistant-1" })),
      getTaskDependency: mock(async () => ({ dependsOn: null, loadTaskId: null })),
      cancelTask: mock(async () => {}),
      onExecutionEvent: mock(() => () => {}),
    } as unknown as TaskOrchestrator;

    const db = {
      tasks: {
        findById: mock(async () => null),
        findByStatus: mock(async () => []),
      },
      chats: {
        update: mock(async () => ({})),
      },
    } as unknown as DatabaseAccess;

    return {
      service: new StreamService(db, orchestrator),
      createChat,
      createUserMessage,
      createMessageTask,
    };
  }

  it("denies blocked license before creating chat/message/task", async () => {
    LicenseUtil.getCurrentStatus = async () => ({
      state: "blocked",
      expiresAt: null,
      features: [],
      reason: "Blocked",
    });

    const { service, createChat, createUserMessage, createMessageTask } = createHarness();

    expect(
      service.createChatStream({
        provider: "openai",
        model: "gpt-4o",
        text: "Hello",
      }),
    ).rejects.toBeInstanceOf(LicenseDeniedError);

    expect(createChat).not.toHaveBeenCalled();
    expect(createUserMessage).not.toHaveBeenCalled();
    expect(createMessageTask).not.toHaveBeenCalled();
  });

  it("allows grace license and proceeds to task creation", async () => {
    LicenseUtil.getCurrentStatus = async () => ({
      state: "grace",
      expiresAt: null,
      features: ["*"],
    });

    const { service, createMessageTask } = createHarness();
    const result = await service.createChatStream({
      provider: "openai",
      model: "gpt-4o",
      text: "Hello",
    });

    expect(createMessageTask).toHaveBeenCalledTimes(1);
    await result.stream.cancel();
  });
});
