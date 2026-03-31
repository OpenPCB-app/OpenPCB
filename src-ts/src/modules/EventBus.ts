/**
 * EventBus - Simple in-memory event emitter
 * Module-scoped event system for inter-component communication
 * Implements the EventBus interface from core types
 */

import type { EventBus as EventBusInterface, EventHandler } from "shared/types/events";

export class EventBus implements EventBusInterface {
    private listeners = new Map<string, Set<EventHandler>>();

    /**
     * Subscribe to an event
     */
    on<T = unknown>(event: string, handler: EventHandler<T>): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler as EventHandler);
    }

    /**
     * Unsubscribe from an event
     */
    off<T = unknown>(event: string, handler: EventHandler<T>): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            handlers.delete(handler as EventHandler);
            if (handlers.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    /**
     * Subscribe to an event once (auto-unsubscribes after first emit)
     */
    once<T = unknown>(event: string, handler: EventHandler<T>): void {
        const wrappedHandler: EventHandler<T> = async (payload: T) => {
            this.off(event, wrappedHandler);
            return handler(payload);
        };
        this.on(event, wrappedHandler);
    }

    /**
     * Emit an event to all subscribers
     */
    async emit<T = unknown>(event: string, payload: T): Promise<void> {
        const handlers = this.listeners.get(event);
        if (!handlers || handlers.size === 0) {
            return;
        }

        // Execute all handlers (in parallel for async handlers)
        await Promise.all(
            Array.from(handlers).map((handler) => {
                try {
                    return handler(payload);
                } catch (error) {
                    console.error(`[EventBus] Error in handler for event "${event}":`, error);
                    return undefined;
                }
            })
        );
    }

    /**
     * Remove all listeners
     */
    clear(): void {
        this.listeners.clear();
    }

    /**
     * Get count of listeners for an event
     */
    listenerCount(event: string): number {
        return this.listeners.get(event)?.size ?? 0;
    }
}
