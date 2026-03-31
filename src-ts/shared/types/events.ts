/**
 * Event System Types
 *
 * Defines the core event bus interface for module inter-component communication.
 */

/**
 * Event handler function type
 * @template T - Type of event payload
 */
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

/**
 * Event Bus Interface
 *
 * Provides pub/sub event system for module-scoped communication.
 * Allows modules to emit and listen to events within their scope.
 *
 * @example
 * ```typescript
 * // Subscribe to event
 * ctx.events.on('user:login', async (user) => {
 *     console.log('User logged in:', user);
 * });
 *
 * // Emit event
 * await ctx.events.emit('user:login', { id: '123', name: 'Alice' });
 * ```
 */
export interface EventBus {
    /**
     * Subscribe to an event
     * @param event - Event name
     * @param handler - Handler function to execute when event is emitted
     */
    on<T = unknown>(event: string, handler: EventHandler<T>): void;

    /**
     * Unsubscribe from an event
     * @param event - Event name
     * @param handler - Handler function to remove
     */
    off<T = unknown>(event: string, handler: EventHandler<T>): void;

    /**
     * Emit an event to all subscribers
     * @param event - Event name
     * @param payload - Event data
     */
    emit<T = unknown>(event: string, payload: T): Promise<void>;

    /**
     * Remove all event listeners
     */
    clear(): void;

    /**
     * Get number of listeners for an event
     * @param event - Event name
     * @returns Number of registered handlers
     */
    listenerCount(event: string): number;
}
