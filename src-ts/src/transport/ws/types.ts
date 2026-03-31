/**
 * WebSocket Types - Bun Runtime Implementation
 *
 * Implements the WebSocket protocol using Bun's ServerWebSocket.
 * Re-exports core types and provides Bun-specific implementations.
 */

import type { ServerWebSocket } from "bun";

// Re-export shared types from core
export type { WsMessage, WsHandler } from "shared/types/ws";

/**
 * WebSocket client wrapper (Bun-specific implementation)
 *
 * Provides a clean interface to Bun's ServerWebSocket with
 * module-aware message handling.
 */
export interface WsClient {
    /** Unique client identifier */
    id: string;
    /** Bun's native WebSocket connection */
    ws: ServerWebSocket<{ id: string; moduleId: string }>;
    /** Module this client is connected to */
    moduleId: string;
    /** Send a message to the client */
    send(message: import("shared/types/ws").WsMessage): void;
    /** Close the connection */
    close(): void;
}

/**
 * Bun-specific WebSocket handler
 * Specializes the generic WsHandler with Bun's WsClient type
 */
export type BunWsHandler = import("shared/types/ws").WsHandler<WsClient>;
