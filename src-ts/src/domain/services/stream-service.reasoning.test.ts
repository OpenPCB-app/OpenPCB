import { describe, expect, it, mock } from "bun:test";
import { StreamService } from "./stream-service";
import type { DatabaseAccess } from "../../db";
import type { TaskOrchestrator } from "./queue/task-orchestrator";
import type { ExecutionEvent } from "./queue/task-executor";

/**
 * StreamService Reasoning Persistence Test
 *
 * Note: With the new TaskOrchestrator integration, StreamService listens to
 * execution events rather than calling provider engines directly.
 * This test verifies the event bridge correctly handles reasoning events.
 */
describe("StreamService Reasoning Events", () => {
    it("should emit reasoning SSE events from TaskExecutor events", async () => {
        // Mock database
        const mockDb = {
            tasks: {
                findById: mock(async () => ({
                    id: "task-123",
                    status: "running",
                    result: null,
                })),
            },
            taskChunks: {
                getChunks: mock(async () => []),
            },
            chats: {
                update: mock(async () => ({})),
            },
        } as unknown as DatabaseAccess;

        // Capture SSE events
        const sseEvents: any[] = [];

        // Mock orchestrator - capture event callback
        type EventCallback = (event: ExecutionEvent) => void;
        let eventCallback: EventCallback | null = null;

        const mockOrchestrator = {
            getChatManager: mock(() => ({
                createChat: mock(async () => ({ id: "chat-123" })),
            })),
            createUserMessage: mock(async () => ({ id: "user-msg-123" })),
            createMessageTask: mock(async () => ({
                task: {
                    id: "task-123",
                    status: "pending",
                    provider: "openai",
                    model: "o1-preview",
                },
                queueStatus: { provider: "openai", queuedTasks: 0, activeTasks: 1, availableSlots: 2 },
            })),
            getTaskDependency: mock(async () => ({ dependsOn: null, loadTaskId: null })),
            createAssistantMessage: mock(async () => ({ id: "asst-msg-123" })),
            cancelTask: mock(async () => { }),
            onExecutionEvent: mock((callback: (event: ExecutionEvent) => void) => {
                eventCallback = callback;
                return () => { eventCallback = null; };
            }),
        } as unknown as TaskOrchestrator;

        const service = new StreamService(mockDb, mockOrchestrator);

        // Test Input
        const input = {
            provider: "openai",
            model: "o1-preview",
            text: "test prompt",
        };

        // Execute - create stream
        const result = await service.createChatStream(input);

        // Create stream reader
        const reader = result.stream.getReader();
        const decoder = new TextDecoder();

        // Start reading in background
        const readPromise = (async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                // Parse SSE events
                const lines = text.split("\n").filter(l => l.startsWith("data: "));
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        sseEvents.push(data);
                    } catch { }
                }
            }
        })();

        // Give stream time to start
        await new Promise(r => setTimeout(r, 50));

        // Simulate reasoning event from TaskExecutor
        // Use non-null assertion since we know the callback was registered
        const emitEvent = eventCallback!;

        emitEvent({
            type: "task.reasoning",
            taskId: "task-123",
            data: { text: "Thinking about the problem..." },
            timestamp: new Date().toISOString(),
        });

        emitEvent({
            type: "task.token",
            taskId: "task-123",
            data: { token: "Hello" },
            timestamp: new Date().toISOString(),
        });

        emitEvent({
            type: "task.completed",
            taskId: "task-123",
            data: {
                data: { content: "Hello" },
                tokensUsed: { prompt: 10, completion: 5, total: 15 },
            },
            timestamp: new Date().toISOString(),
        });

        // Wait for stream to complete
        await readPromise;

        // Verify SSE events were emitted
        const reasoningEvents = sseEvents.filter(e => e.event === "reasoning");
        const tokenEvents = sseEvents.filter(e => e.event === "token");
        const doneEvents = sseEvents.filter(e => e.event === "done");

        expect(reasoningEvents.length).toBeGreaterThanOrEqual(1);
        expect(reasoningEvents[0].delta).toBe("Thinking about the problem...");

        expect(tokenEvents.length).toBeGreaterThanOrEqual(1);
        expect(tokenEvents[0].delta).toBe("Hello");

        expect(doneEvents.length).toBe(1);
        expect(doneEvents[0].text).toBe("Hello");
    });
});
