/**
 * Shared WebSocket types for module endpoints
 *
 * These types define the core message protocol and handler signatures
 * for WebSocket communication in the module system.
 */

/**
 * WebSocket message structure
 * All WebSocket messages must conform to this interface
 */
export interface WsMessage {
    /** Message type identifier */
    type: string;
    /** Optional channel for message routing */
    channel?: string;
    /** Message payload - application-specific data */
    payload?: unknown;
}

/**
 * Generic WebSocket message handler
 *
 * @template TClient - The client type (runtime-specific implementation)
 * @param message - The incoming WebSocket message
 * @param client - The client instance (provides send, close, etc.)
 *
 * @example
 * ```typescript
 * // Bun runtime uses WsHandler<WsClient>
 * const handler: WsHandler<WsClient> = async (msg, client) => {
 *     client.send({ type: 'response', payload: {...} });
 * };
 * ```
 */
export type WsHandler<TClient = unknown> = (
    message: WsMessage,
    client: TClient
) => void | Promise<void>;

/**
 * WebSocket Router Interface
 *
 * Defines the contract for WebSocket message routing in modules.
 * Implementations provide event-based message handling registration.
 *
 * @example
 * ```typescript
 * // In module endpoint registration:
 * endpoints(ctx, http: HttpRouter, ws: WsRouter) {
 *     ws.on('user:connected', async (msg, client) => {
 *         console.log('User connected:', msg.payload);
 *         client.send({ type: 'welcome', payload: { ... } });
 *     });
 * }
 * ```
 */
export interface WsRouter {
    /**
     * Register a handler for a specific message type
     * @param type - Message type identifier
     * @param handler - Handler function to execute when message is received
     */
    on(type: string, handler: WsHandler<any>): void;

    /**
     * Remove a handler for a specific message type
     * @param type - Message type identifier
     * @param handler - Handler function to remove
     */
    off(type: string, handler: WsHandler<any>): void;
}
