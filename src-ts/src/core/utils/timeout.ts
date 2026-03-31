/**
 * Timeout utility for async operations
 * Prevents operations from hanging indefinitely
 */

/**
 * Execute a promise with a timeout
 * @param promise - Promise to execute
 * @param ms - Timeout in milliseconds
 * @param name - Operation name for error message
 * @returns Result of promise if it completes in time
 * @throws Error if timeout is reached
 */
export async function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    name: string
): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
        setTimeout(
            () => reject(new Error(`${name} timed out after ${ms}ms`)),
            ms
        )
    );

    return Promise.race([promise, timeout]);
}

/**
 * Default timeout values (in milliseconds)
 */
export const DEFAULT_TIMEOUTS = {
    /** Module lifecycle hooks (onActivate, onDeactivate) */
    LIFECYCLE: 5000,
    /** HTTP request handlers */
    HTTP_HANDLER: 30000,
    /** WebSocket message handlers */
    WS_HANDLER: 10000,
} as const;
