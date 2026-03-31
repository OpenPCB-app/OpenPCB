/**
 * WsRouter - Route WebSocket messages to module handlers
 * Provides module-scoped WebSocket routing
 * Implements the WsRouter interface from core types
 */

import type { WsRouter as WsRouterInterface } from "shared/types/ws";
import type { WsHandler, WsMessage, WsClient } from "./types";

export class WsRouter implements WsRouterInterface {
    private handlers = new Map<string, Set<WsHandler>>();

    constructor(private moduleId: string) { }

    /**
     * Register a handler for a message type
     */
    on(type: string, handler: WsHandler): void {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }
        this.handlers.get(type)!.add(handler);
    }

    /**
     * Remove a handler for a message type
     */
    off(type: string, handler: WsHandler): void {
        const handlers = this.handlers.get(type);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.handlers.delete(type);
            }
        }
    }

    /**
     * Handle incoming WebSocket message
     */
    async handle(message: WsMessage, client: WsClient): Promise<void> {
        const handlers = this.handlers.get(message.type);

        if (!handlers || handlers.size === 0) {
            console.warn(`[WsRouter:${this.moduleId}] No handler for message type "${message.type}"`);
            return;
        }

        // Execute all handlers
        await Promise.all(
            Array.from(handlers).map(async (handler) => {
                try {
                    await handler(message, client);
                } catch (error) {
                    console.error(
                        `[WsRouter:${this.moduleId}] Error in handler for type "${message.type}":`,
                        error
                    );
                }
            })
        );
    }

    /**
     * Get all registered message types
     */
    getTypes(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Clear all handlers
     */
    clear(): void {
        this.handlers.clear();
    }
}
