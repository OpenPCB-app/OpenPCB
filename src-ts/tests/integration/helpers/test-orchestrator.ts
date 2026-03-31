/**
 * Test Orchestrator Helper
 *
 * Since TaskOrchestrator uses internal singletons that make in-process testing
 * difficult, we provide HTTP-based test helpers that work against a running server.
 */

/**
 * Test configuration
 */
export interface TestConfig {
    /** Backend base URL */
    baseUrl?: string;
    /** OpenAI model to use */
    model?: string;
    /** Enable debug logging */
    debug?: boolean;
}

const DEFAULT_CONFIG: Required<TestConfig> = {
    baseUrl: 'http://localhost:3000',
    model: 'gpt-4o-mini',
    debug: false,
};

/**
 * Check if OpenAI API key is available
 */
export function hasOpenAIKey(): boolean {
    return !!process.env.OPENAI_API_KEY;
}

/**
 * Skip test if no OpenAI API key
 */
export function skipIfNoOpenAIKey(): boolean {
    if (!hasOpenAIKey()) {
        console.log('[Test] Skipping: OPENAI_API_KEY not set');
        return true;
    }
    return false;
}

/**
 * Test prompt that generates a predictable short response
 */
export const SHORT_PROMPT = 'Say "hello world" and nothing else.';

/**
 * Test prompt that generates a longer streaming response
 */
export const LONG_PROMPT = 'Count from 1 to 20, one number per line.';

/**
 * Default workspace ID for tests
 */
export const TEST_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Default provider for tests
 */
export const TEST_PROVIDER = 'openai';

/**
 * Default model for tests
 */
export const TEST_MODEL = 'gpt-4o-mini';

/**
 * Get effective config with defaults
 */
export function getTestConfig(config: TestConfig = {}): Required<TestConfig> {
    return { ...DEFAULT_CONFIG, ...config };
}

/**
 * Create a chat stream via HTTP and return fetch response
 */
export async function createChatStream(
    text: string,
    config: TestConfig = {}
): Promise<{
    response: Response;
    chatId: string;
    taskId: string;
}> {
    const cfg = getTestConfig(config);

    const response = await fetch(`${cfg.baseUrl}/api/stream/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: TEST_PROVIDER,
            model: cfg.model,
            text,
            workspaceId: TEST_WORKSPACE_ID,
        }),
    });

    // Parse SSE header for task/chat IDs
    const chatId = response.headers.get('x-chat-id') || '';
    const taskId = response.headers.get('x-task-id') || '';

    return { response, chatId, taskId };
}

/**
 * Get active task for a chat
 */
export async function getActiveTask(
    chatId: string,
    config: TestConfig = {}
): Promise<any | null> {
    const cfg = getTestConfig(config);

    const response = await fetch(`${cfg.baseUrl}/api/chats/${chatId}/active-task`);

    if (response.status === 204) {
        return null;
    }

    if (!response.ok) {
        throw new Error(`Failed to get active task: ${response.statusText}`);
    }

    const json = await response.json();
    return json.data || null;
}

/**
 * Get task by ID
 */
export async function getTask(
    taskId: string,
    config: TestConfig = {}
): Promise<any | null> {
    const cfg = getTestConfig(config);

    const response = await fetch(`${cfg.baseUrl}/api/tasks/${taskId}`);

    if (!response.ok) {
        return null;
    }

    const json = await response.json();
    return json.data || json;
}

/**
 * Get messages for a chat
 */
export async function getMessages(
    chatId: string,
    config: TestConfig = {}
): Promise<any[]> {
    const cfg = getTestConfig(config);

    const response = await fetch(`${cfg.baseUrl}/api/chats/${chatId}/messages`);

    if (!response.ok) {
        throw new Error(`Failed to get messages: ${response.statusText}`);
    }

    const json = await response.json();
    return json.data?.messages || json.messages || [];
}

/**
 * Poll for task completion
 */
export async function waitForTaskCompletion(
    taskId: string,
    config: TestConfig = {},
    timeoutMs: number = 60000,
    pollIntervalMs: number = 500
): Promise<'completed' | 'failed' | 'cancelled' | 'timeout'> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        const task = await getTask(taskId, config);

        if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) {
            return task.status;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return 'timeout';
}

/**
 * Read SSE events from a Response stream
 */
export async function* readSSEEvents(
    response: Response
): AsyncGenerator<{ event: string; data: string }> {
    if (!response.body) {
        return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events from buffer
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            let currentEvent = '';
            for (const line of lines) {
                if (line.startsWith('event:')) {
                    currentEvent = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    const data = line.slice(5).trim();
                    yield { event: currentEvent || 'message', data };
                    currentEvent = '';
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}
