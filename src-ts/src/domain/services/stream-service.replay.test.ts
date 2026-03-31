import { describe, expect, it, mock } from "bun:test";
import { StreamService } from "./stream-service";
import type { DatabaseAccess } from "../../db";
import type { TaskOrchestrator } from "./queue/task-orchestrator";
import type { ExecutionEvent } from "./queue/task-executor";

describe("StreamService Replay Stream", () => {
    it("should continue streaming tokens after replay when task is active", async () => {
        const mockDb = {
            tasks: {
                findById: mock(async () => ({
                    id: "task-123",
                    status: "streaming",
                    result: null,
                    error: null,
                })),
            },
            taskChunks: {
                getChunks: mock(async () => [
                    { id: "chunk-1", taskId: "task-123", seq: 0, content: "Hello ", createdAt: new Date() },
                ]),
            },
        } as unknown as DatabaseAccess;

        const sseEvents: any[] = [];

        type EventCallback = (event: ExecutionEvent) => void;
        let eventCallback: EventCallback | null = null;

        const mockOrchestrator = {
            onExecutionEvent: mock((callback: (event: ExecutionEvent) => void) => {
                eventCallback = callback;
                return () => { eventCallback = null; };
            }),
        } as unknown as TaskOrchestrator;

        const service = new StreamService(mockDb, mockOrchestrator);

        const result = await service.replayProgress({
            taskId: "task-123",
            mode: "full",
        });

        const reader = result.stream.getReader();
        const decoder = new TextDecoder();

        const readPromise = (async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                const lines = text.split("\n").filter(l => l.startsWith("data: "));
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        sseEvents.push(data);
                    } catch { }
                }
            }
        })();

        await new Promise(r => setTimeout(r, 50));

        const emitEvent = eventCallback!;
        emitEvent({
            type: "task.token",
            taskId: "task-123",
            data: { token: "world", sequence: 1 },
            timestamp: new Date().toISOString(),
        });
        emitEvent({
            type: "task.completed",
            taskId: "task-123",
            data: {
                data: { content: "Hello world" },
                tokensUsed: { prompt: 5, completion: 2, total: 7 },
            },
            timestamp: new Date().toISOString(),
        });

        await readPromise;

        const tokenEvents = sseEvents.filter(e => e.event === "token");
        const doneEvents = sseEvents.filter(e => e.event === "done");

        expect(tokenEvents.some(e => e.delta === "Hello ")).toBe(true);
        expect(tokenEvents.some(e => e.delta === "world")).toBe(true);
        expect(doneEvents.length).toBe(1);
    });

    it("should keep replay stream open when original task completed but follow-up task is still active", async () => {
        let activeTaskIds = ["task-456"];
        const mockDb = {
            tasks: {
                findById: mock(async (taskId: string) => {
                    if (taskId === "task-123") {
                        return {
                            id: "task-123",
                            type: "message",
                            chatId: "chat-1",
                            status: "completed",
                            provider: "openai",
                            model: "gpt-4o",
                            dependsOn: null,
                            metadata: null,
                            result: { data: { content: "" }, tokensUsed: undefined },
                            error: null,
                        };
                    }
                    if (taskId === "task-456") {
                        return {
                            id: "task-456",
                            type: "message",
                            chatId: "chat-1",
                            status: "streaming",
                            provider: "openai",
                            model: "gpt-4o",
                            dependsOn: null,
                            metadata: null,
                            result: null,
                            error: null,
                        };
                    }
                    return null;
                }),
                findByStatus: mock(async () =>
                    activeTaskIds.map((taskId) => ({
                        id: taskId,
                        type: "message",
                        chatId: "chat-1",
                        status: taskId === "task-456" ? "streaming" : "waiting",
                        provider: "openai",
                        model: "gpt-4o",
                        dependsOn: null,
                        metadata: null,
                    }))
                ),
            },
            taskChunks: {
                getChunks: mock(async () => []),
            },
        } as unknown as DatabaseAccess;

        const sseEvents: any[] = [];
        type EventCallback = (event: ExecutionEvent) => void;
        let eventCallback: EventCallback | null = null;

        const mockOrchestrator = {
            onExecutionEvent: mock((callback: (event: ExecutionEvent) => void) => {
                eventCallback = callback;
                return () => {
                    eventCallback = null;
                };
            }),
        } as unknown as TaskOrchestrator;

        const service = new StreamService(mockDb, mockOrchestrator);
        const result = await service.replayProgress({
            taskId: "task-123",
            mode: "full",
        });

        const reader = result.stream.getReader();
        const decoder = new TextDecoder();
        const readPromise = (async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                const lines = text.split("\n").filter((line) => line.startsWith("data: "));
                for (const line of lines) {
                    try {
                        sseEvents.push(JSON.parse(line.slice(6)));
                    } catch { }
                }
            }
        })();

        await new Promise((resolve) => setTimeout(resolve, 25));

        const emitEvent = eventCallback!;
        emitEvent({
            type: "task.started",
            taskId: "task-456",
            timestamp: new Date().toISOString(),
        });
        emitEvent({
            type: "task.token",
            taskId: "task-456",
            data: { token: "follow-up", sequence: 0 },
            timestamp: new Date().toISOString(),
        });

        activeTaskIds = [];
        emitEvent({
            type: "task.completed",
            taskId: "task-456",
            data: {
                data: { content: "follow-up" },
                tokensUsed: { prompt: 6, completion: 3, total: 9 },
            },
            timestamp: new Date().toISOString(),
        });

        await readPromise;

        const tokenEvents = sseEvents.filter((event) => event.event === "token");
        const doneEvents = sseEvents.filter((event) => event.event === "done");
        const continuationLookups = (
            mockDb.tasks.findById as unknown as { mock: { calls: unknown[][] } }
        ).mock.calls.filter(([taskId]) => taskId === "task-456");

        expect(tokenEvents.some((event) => event.delta === "follow-up")).toBe(true);
        expect(doneEvents).toHaveLength(1);
        expect(doneEvents[0].text).toBe("follow-up");
        expect(continuationLookups).toHaveLength(1);
    });

    it("replays persisted tool events before live continuation events", async () => {
        let activeTaskIds = ["task-456"];
        const mockDb = {
            tasks: {
                findById: mock(async (taskId: string) => {
                    if (taskId === "task-123") {
                        return {
                            id: "task-123",
                            type: "message",
                            chatId: "chat-1",
                            status: "completed",
                            provider: "openai",
                            model: "gpt-4o",
                            dependsOn: null,
                            metadata: null,
                            assistantMessageId: "assistant-1",
                            result: { data: { content: "" }, tokensUsed: undefined },
                            error: null,
                        };
                    }
                    if (taskId === "task-456") {
                        return {
                            id: "task-456",
                            type: "message",
                            chatId: "chat-1",
                            status: "streaming",
                            provider: "openai",
                            model: "gpt-4o",
                            dependsOn: null,
                            metadata: null,
                            assistantMessageId: "assistant-1",
                            result: null,
                            error: null,
                        };
                    }
                    return null;
                }),
                findByStatus: mock(async () =>
                    activeTaskIds.map((taskId) => ({
                        id: taskId,
                        type: "message",
                        chatId: "chat-1",
                        status: "streaming",
                        provider: "openai",
                        model: "gpt-4o",
                        dependsOn: null,
                        metadata: null,
                        assistantMessageId: "assistant-1",
                    }))
                ),
            },
            taskChunks: {
                getChunks: mock(async () => []),
            },
            taskToolEvents: {
                listByAssistantMessageId: mock(async () => [
                    {
                        id: "evt-call",
                        chatId: "chat-1",
                        assistantMessageId: "assistant-1",
                        taskId: "task-123",
                        seq: 0,
                        kind: "tool-call",
                        toolCallId: "call-1",
                        toolName: "echo",
                        args: { text: "hi" },
                        result: null,
                        isError: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                    {
                        id: "evt-result",
                        chatId: "chat-1",
                        assistantMessageId: "assistant-1",
                        taskId: "task-123",
                        seq: 1,
                        kind: "tool-result",
                        toolCallId: "call-1",
                        toolName: "echo",
                        args: null,
                        result: { ok: true },
                        isError: false,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ]),
            },
        } as unknown as DatabaseAccess;

        const sseEvents: any[] = [];
        type EventCallback = (event: ExecutionEvent) => void;
        let eventCallback: EventCallback | null = null;

        const mockOrchestrator = {
            onExecutionEvent: mock((callback: (event: ExecutionEvent) => void) => {
                eventCallback = callback;
                return () => {
                    eventCallback = null;
                };
            }),
        } as unknown as TaskOrchestrator;

        const service = new StreamService(mockDb, mockOrchestrator);
        const result = await service.replayProgress({
            taskId: "task-123",
            mode: "full",
        });

        const reader = result.stream.getReader();
        const decoder = new TextDecoder();
        const readPromise = (async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                const lines = text.split("\n").filter((line) => line.startsWith("data: "));
                for (const line of lines) {
                    try {
                        sseEvents.push(JSON.parse(line.slice(6)));
                    } catch {}
                }
            }
        })();

        await new Promise((resolve) => setTimeout(resolve, 25));

        const emitEvent = eventCallback!;
        emitEvent({
            type: "task.token",
            taskId: "task-456",
            data: { token: "after-tools", sequence: 0 },
            timestamp: new Date().toISOString(),
        });

        activeTaskIds = [];
        emitEvent({
            type: "task.completed",
            taskId: "task-456",
            data: {
                data: { content: "after-tools" },
                tokensUsed: { prompt: 6, completion: 2, total: 8 },
            },
            timestamp: new Date().toISOString(),
        });

        await readPromise;

        const firstToolCallIndex = sseEvents.findIndex(
            (event) => event.event === "tool_call",
        );
        const firstToolResultIndex = sseEvents.findIndex(
            (event) => event.event === "tool_result",
        );
        const firstLiveTokenIndex = sseEvents.findIndex(
            (event) => event.event === "token" && event.delta === "after-tools",
        );

        expect(firstToolCallIndex).toBeGreaterThanOrEqual(0);
        expect(firstToolResultIndex).toBeGreaterThanOrEqual(0);
        expect(firstLiveTokenIndex).toBeGreaterThanOrEqual(0);
        expect(firstToolCallIndex).toBeLessThan(firstLiveTokenIndex);
        expect(firstToolResultIndex).toBeLessThan(firstLiveTokenIndex);
    });

    it("reconciles orphaned persisted tool-call events with deterministic synthetic tool-result", async () => {
        const mockDb = {
            tasks: {
                findById: mock(async () => ({
                    id: "task-123",
                    type: "message",
                    chatId: "chat-1",
                    status: "completed",
                    provider: "openai",
                    model: "gpt-4o",
                    dependsOn: null,
                    metadata: null,
                    assistantMessageId: "assistant-1",
                    result: { data: { content: "done" }, tokensUsed: undefined },
                    error: null,
                })),
                findByStatus: mock(async () => []),
            },
            taskChunks: {
                getChunks: mock(async () => []),
            },
            taskToolEvents: {
                listByAssistantMessageId: mock(async () => [
                    {
                        id: "evt-orphan-call",
                        chatId: "chat-1",
                        assistantMessageId: "assistant-1",
                        taskId: "task-123",
                        seq: 0,
                        kind: "tool-call",
                        toolCallId: "call-orphan",
                        toolName: "fetch.info",
                        args: { query: "state" },
                        result: null,
                        isError: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ]),
            },
        } as unknown as DatabaseAccess;

        const mockOrchestrator = {
            onExecutionEvent: mock((_callback: (event: ExecutionEvent) => void) => () => {}),
        } as unknown as TaskOrchestrator;

        const service = new StreamService(mockDb, mockOrchestrator);
        const result = await service.replayProgress({ taskId: "task-123", mode: "full" });

        const events: Array<Record<string, unknown>> = [];
        const reader = result.stream.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const lines = text.split("\n").filter((line) => line.startsWith("data: "));
            for (const line of lines) {
                try {
                    events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
                } catch {
                    continue;
                }
            }
        }

        const toolCallIndex = events.findIndex((event) => {
            const toolCall = (event as { toolCall?: { id?: string } }).toolCall;
            return event.event === "tool_call" && toolCall?.id === "call-orphan";
        });
        const syntheticToolResult = events.find(
            (event) => event.event === "tool_result" && event.toolCallId === "call-orphan",
        ) as
            | {
                  isError?: boolean;
                  result?: { error?: { code?: string; message?: string } };
              }
            | undefined;

        expect(toolCallIndex).toBeGreaterThanOrEqual(0);
        expect(syntheticToolResult).toBeDefined();
        expect(syntheticToolResult?.isError).toBe(true);
        expect(syntheticToolResult?.result?.error?.code).toBe("TOOL_RESULT_MISSING");
        expect(syntheticToolResult?.result?.error?.message).toContain("Missing tool_result event");

        const toolResultIndex = events.findIndex(
            (event) => event.event === "tool_result" && event.toolCallId === "call-orphan",
        );
        expect(toolResultIndex).toBeGreaterThan(toolCallIndex);
    });

    it("does not synthesize missing tool-result events for active tasks", async () => {
        const mockDb = {
            tasks: {
                findById: mock(async () => ({
                    id: "task-123",
                    type: "message",
                    chatId: "chat-1",
                    status: "streaming",
                    provider: "openai",
                    model: "gpt-4o",
                    dependsOn: null,
                    metadata: null,
                    assistantMessageId: "assistant-1",
                    result: null,
                    error: null,
                })),
                findByStatus: mock(async () => []),
            },
            taskChunks: {
                getChunks: mock(async () => []),
            },
            taskToolEvents: {
                listByAssistantMessageId: mock(async () => [
                    {
                        id: "evt-orphan-call",
                        chatId: "chat-1",
                        assistantMessageId: "assistant-1",
                        taskId: "task-123",
                        seq: 0,
                        kind: "tool-call",
                        toolCallId: "call-0",
                        toolName: "edit_content",
                        args: { mode: "replace" },
                        result: null,
                        isError: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ]),
            },
        } as unknown as DatabaseAccess;

        type EventCallback = (event: ExecutionEvent) => void;
        let eventCallback: EventCallback | null = null;
        const mockOrchestrator = {
            onExecutionEvent: mock((callback: (event: ExecutionEvent) => void) => {
                eventCallback = callback;
                return () => {
                    eventCallback = null;
                };
            }),
        } as unknown as TaskOrchestrator;

        const service = new StreamService(mockDb, mockOrchestrator);
        const result = await service.replayProgress({ taskId: "task-123", mode: "full" });

        const events: Array<Record<string, unknown>> = [];
        const reader = result.stream.getReader();
        const decoder = new TextDecoder();
        const readPromise = (async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                const lines = text.split("\n").filter((line) => line.startsWith("data: "));
                for (const line of lines) {
                    try {
                        events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
                    } catch {
                        // noop
                    }
                }
            }
        })();

        await new Promise((resolve) => setTimeout(resolve, 25));

        const emitEvent = eventCallback!;
        emitEvent({
            type: "task.tool_result",
            taskId: "task-123",
            data: {
                toolCallId: "call-0",
                toolName: "edit_content",
                result: { success: true, editId: "edit-1" },
                isError: false,
                seq: 1,
            },
            timestamp: new Date().toISOString(),
        });
        emitEvent({
            type: "task.completed",
            taskId: "task-123",
            data: {
                data: { content: "done" },
                tokensUsed: { prompt: 1, completion: 1, total: 2 },
            },
            timestamp: new Date().toISOString(),
        });

        await readPromise;

        const syntheticMissing = events.find((event) => {
            if (event.event !== "tool_result") {
                return false;
            }

            const resultPayload = event.result as
                | { error?: { code?: string } }
                | undefined;
            return resultPayload?.error?.code === "TOOL_RESULT_MISSING";
        });

        const toolResult = events.find(
            (event) => event.event === "tool_result" && event.toolCallId === "call-0",
        ) as { result?: { success?: boolean; editId?: string } } | undefined;

        expect(syntheticMissing).toBeUndefined();
        expect(toolResult?.result?.success).toBe(true);
        expect(toolResult?.result?.editId).toBe("edit-1");
    });
});
