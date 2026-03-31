import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamChat } from "./useStreamChat";

const { getChatMessagesMock, getActiveTaskMock, getChatMock } = vi.hoisted(() => ({
  getChatMessagesMock: vi.fn(),
  getActiveTaskMock: vi.fn(),
  getChatMock: vi.fn(),
}));

vi.mock("@/lib/api/chat-api", () => ({
  getChatMessages: getChatMessagesMock,
  getActiveTask: getActiveTaskMock,
  getChat: getChatMock,
}));

vi.mock("@/contexts/BackendURLContext", () => ({
  useBackendURL: () => ({ backendURL: "http://backend.local" }),
}));

function buildReplayResponse(taskId: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ event: "start", taskId, replay: true })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ event: "done", text: "Recovered output" })}\n\n`,
        ),
      );
      controller.close();
    },
  });

  return new Response(body, { status: 200 });
}

function buildToolStreamResponse(taskId: string, messageId: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ event: "start", taskId, chatId: "chat-1", messageId })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            event: "tool_call",
            toolCall: { id: "call-1", name: "echo", args: { message: "hello" } },
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            event: "tool_result",
            toolCallId: "call-1",
            toolName: "echo",
            result: { ok: true },
            isError: false,
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ event: "done", text: "" })}\n\n`,
        ),
      );
      controller.close();
    },
  });

  return new Response(body, { status: 200 });
}

describe("useStreamChat crash-only auto-resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChatMessagesMock.mockResolvedValue([]);
    getChatMock.mockResolvedValue({ workspaceId: "ws-1", projectId: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not auto-reconnect replay for non-crash active tasks", async () => {
    getActiveTaskMock.mockResolvedValue({
      taskId: "task-live",
      status: "streaming",
      provider: "openai",
      model: "gpt-4o",
      createdAt: new Date().toISOString(),
      assistantMessageId: "assistant-1",
      waitReason: null,
      resumeEligible: false,
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useStreamChat());
    await act(async () => {
      await result.current.loadMessages("chat-1");
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auto-reconnects replay for crash-resumable active tasks", async () => {
    getActiveTaskMock.mockResolvedValue({
      taskId: "task-crash",
      status: "paused",
      provider: "openai",
      model: "gpt-4o",
      createdAt: new Date().toISOString(),
      assistantMessageId: "assistant-2",
      waitReason: null,
      resumeEligible: true,
    });

    const fetchMock = vi.fn().mockResolvedValue(buildReplayResponse("task-crash"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useStreamChat());
    await act(async () => {
      await result.current.loadMessages("chat-1");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.local/api/stream/replay/task-crash?mode=full",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("maps tool stream events to canonical hyphen parts", async () => {
    getActiveTaskMock.mockResolvedValue(null);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(buildToolStreamResponse("task-tools", "assistant-tools"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useStreamChat());
    await act(async () => {
      await result.current.submitMessage({
        chatId: "chat-1",
        provider: "openai",
        model: "gpt-4o",
        text: "Run tool",
      });
    });

    const assistant = result.current.messages.find(
      (message) => message.id === "assistant-tools",
    );
    expect(assistant).toBeDefined();
    expect(assistant?.parts).toEqual(
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
        }),
      ]),
    );
  });
});
