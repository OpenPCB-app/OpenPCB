/**
 * TaskSystem Integration Tests
 *
 * Tests the complete task execution pipeline via HTTP API with real OpenAI calls.
 * Verifies that tasks complete independently of SSE stream connections
 * and that results are correctly persisted to the database.
 *
 * Prerequisites:
 * - Backend server running (npm run dev)
 * - OPENAI_API_KEY environment variable must be set
 *
 * Run with:
 *   # Start backend first: npm run dev
 *   bun test tests/integration --timeout 120000
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import {
    skipIfNoOpenAIKey,
    getTestConfig,
    createChatStream,
    getActiveTask,
    getMessages,
    waitForTaskCompletion,
    readSSEEvents,
    SHORT_PROMPT,
    LONG_PROMPT,
    TEST_PROVIDER,
    TEST_MODEL,
    type TestConfig,
} from './helpers/test-orchestrator';

// Skip all tests if no API key
const SKIP_TESTS = skipIfNoOpenAIKey();

// Get base URL from environment or use default
const config: TestConfig = {
    baseUrl: process.env.TEST_API_URL || 'http://localhost:3000',
    model: TEST_MODEL,
    debug: true,
};

describe('TaskSystem Integration', () => {
    beforeAll(async () => {
        if (SKIP_TESTS) return;

        // Check if server is running (use workspaces endpoint as health check)
        try {
            const response = await fetch(`${config.baseUrl}/api/workspaces`);
            if (!response.ok) {
                console.error('[Test] Server health check failed');
                throw new Error('Server not healthy');
            }
            console.log('[Test] Server is running');
        } catch (error) {
            console.error(`[Test] Cannot connect to server at ${config.baseUrl}`);
            console.error('[Test] Please start the backend and set TEST_API_URL env var');
            throw error;
        }
    });

    // ─── Test 1: Async Execution ─────────────────────────────────────────────────

    it('should complete task and save to DB after stream disconnects', async () => {
        if (SKIP_TESTS) return;

        console.log('\n[Test 1] Starting: Task completion after stream disconnect');

        // Create a chat stream with a prompt that generates a longer response
        const { response, chatId, taskId } = await createChatStream(LONG_PROMPT, config);
        console.log(`[Test 1] Created task ${taskId} for chat ${chatId}`);

        // Read a few SSE events, then abort
        let eventsRead = 0;
        const maxEvents = 5;
        const abortController = new AbortController();

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        try {
            for await (const event of readSSEEvents(response)) {
                eventsRead++;
                console.log(`[Test 1] Event ${eventsRead}: ${event.event}`);

                if (eventsRead >= maxEvents) {
                    console.log('[Test 1] Aborting stream after reading events');
                    break;
                }
            }
        } catch (e) {
            // Expected when we break out of the loop
        } finally {
            reader.cancel().catch(() => { });
        }

        console.log('[Test 1] Stream aborted, waiting for task completion in background...');

        // Wait for task to complete in background
        const finalStatus = await waitForTaskCompletion(taskId, config, 60000);
        console.log(`[Test 1] Task final status: ${finalStatus}`);

        // Assert task completed
        expect(finalStatus).toBe('completed');

        // Verify messages are saved in database
        const messages = await getMessages(chatId, config);
        console.log(`[Test 1] Messages in DB: ${messages.length}`);

        // Should have at least user message and assistant message
        expect(messages.length).toBeGreaterThanOrEqual(2);

        // Find assistant message and verify content
        const assistantMessage = messages.find((m: any) => m.role === 'assistant');
        expect(assistantMessage).toBeDefined();

        console.log('[Test 1] ✅ Task completed and persisted after stream disconnect');
    }, 90000);

    // ─── Test 2: Multi-Chat Concurrent Execution ─────────────────────────────────

    it('should handle concurrent chats independently', async () => {
        if (SKIP_TESTS) return;

        console.log('\n[Test 2] Starting: Concurrent chat execution');

        // Start first chat with a long prompt
        const stream1 = await createChatStream(LONG_PROMPT, config);
        console.log(`[Test 2] Started Chat 1 (task ${stream1.taskId})`);

        // Read first SSE event from stream 1
        const reader1 = stream1.response.body?.getReader();
        if (reader1) {
            const { value } = await reader1.read();
            console.log('[Test 2] Chat 1: First chunk received');

            // Start second chat immediately (simulating user switching chats)
            const stream2 = await createChatStream(SHORT_PROMPT, config);
            console.log(`[Test 2] Started Chat 2 (task ${stream2.taskId})`);

            // Cancel stream 1 (user switched away)
            await reader1.cancel();
            console.log('[Test 2] Chat 1 stream cancelled');

            // Wait for both tasks to complete
            const [status1, status2] = await Promise.all([
                waitForTaskCompletion(stream1.taskId, config, 60000),
                waitForTaskCompletion(stream2.taskId, config, 60000),
            ]);

            console.log(`[Test 2] Task 1 status: ${status1}, Task 2 status: ${status2}`);

            // Both should complete
            expect(status1).toBe('completed');
            expect(status2).toBe('completed');

            // Verify both chats have messages
            const messages1 = await getMessages(stream1.chatId, config);
            const messages2 = await getMessages(stream2.chatId, config);

            expect(messages1.length).toBeGreaterThanOrEqual(2);
            expect(messages2.length).toBeGreaterThanOrEqual(2);

            console.log('[Test 2] ✅ Both chats completed independently');
        }
    }, 120000);

    // ─── Test 3: Database Persistence Verification ───────────────────────────────

    it('should persist complete assistant message with all content', async () => {
        if (SKIP_TESTS) return;

        console.log('\n[Test 3] Starting: Database persistence verification');

        // Create stream with predictable short response
        const { response, chatId, taskId } = await createChatStream(SHORT_PROMPT, config);
        console.log(`[Test 3] Created task ${taskId}`);

        // Let stream complete fully
        const reader = response.body?.getReader();
        if (reader) {
            let done = false;
            while (!done) {
                const result = await reader.read();
                done = result.done;
            }
            console.log('[Test 3] Stream fully consumed');
        }

        // Wait for task completion
        const status = await waitForTaskCompletion(taskId, config, 30000);
        expect(status).toBe('completed');

        // Verify messages in database
        const messages = await getMessages(chatId, config);
        const assistantMsg = messages.find((m: any) => m.role === 'assistant');
        expect(assistantMsg).toBeDefined();

        // Check content exists
        const content = typeof assistantMsg.content === 'string'
            ? JSON.parse(assistantMsg.content)
            : assistantMsg.content;

        expect(content.length).toBeGreaterThan(0);

        // Extract text content
        const textParts = content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('');

        console.log(`[Test 3] Assistant response: "${textParts.substring(0, 100)}..."`);
        expect(textParts.length).toBeGreaterThan(0);

        console.log('[Test 3] ✅ Message correctly persisted to database');
    }, 60000);

    // ─── Test 4: Active Task Detection ───────────────────────────────────────────

    it('should return active task info for running tasks', async () => {
        if (SKIP_TESTS) return;

        console.log('\n[Test 4] Starting: Active task detection');

        // Create stream with long prompt to give us time to check active status
        const { response, chatId, taskId } = await createChatStream(LONG_PROMPT, config);
        console.log(`[Test 4] Created task ${taskId}`);

        // Read first chunk to ensure task is running
        const reader = response.body?.getReader();
        if (reader) {
            await reader.read();
            console.log('[Test 4] First chunk received');

            // Check for active task
            const activeTask = await getActiveTask(chatId, config);
            console.log(`[Test 4] Active task query result: ${JSON.stringify(activeTask)}`);

            // May be null if task completed very quickly
            if (activeTask) {
                expect(activeTask.taskId).toBe(taskId);
                expect(['running', 'streaming', 'queued']).toContain(activeTask.status);
            }

            // Cancel and wait
            await reader.cancel();
            await waitForTaskCompletion(taskId, config, 60000);

            // After completion, should return null
            const activeAfter = await getActiveTask(chatId, config);
            expect(activeAfter).toBeNull();

            console.log('[Test 4] ✅ Active task detection working correctly');
        }
    }, 60000);
});
