/**
 * Simple Event Bus for React-side module events
 *
 * Used for:
 * - Module error tracking
 * - Cross-module communication
 * - UI event coordination
 */

type EventHandler = (payload: unknown) => void;

export class EventBus {
    private listeners = new Map<string, Set<EventHandler>>();

    /**
     * Subscribe to an event
     */
    on(event: string, handler: EventHandler): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler);
    }

    /**
     * Unsubscribe from an event
     */
    off(event: string, handler: EventHandler): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    /**
     * Emit an event
     */
    emit(event: string, payload?: unknown): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(payload);
                } catch (error) {
                    console.error(`[EventBus] Error in handler for event '${event}':`, error);
                }
            });
        }
    }

    /**
     * Subscribe once - auto-unsubscribe after first call
     */
    once(event: string, handler: EventHandler): void {
        const wrappedHandler = (payload: unknown) => {
            handler(payload);
            this.off(event, wrappedHandler);
        };
        this.on(event, wrappedHandler);
    }

    /**
     * Clear all listeners for an event, or all events if no event specified
     */
    clear(event?: string): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }
}

/**
 * Global event bus instance
 * Used by ModuleErrorBoundary and other cross-module features
 */
export const globalEventBus = new EventBus();
