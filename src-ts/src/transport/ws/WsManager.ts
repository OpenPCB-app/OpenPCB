/**
 * WsManager - Manage WebSocket connections per module
 * Handles connection lifecycle and message routing
 */

import type { ServerWebSocket } from "bun";
import type { WsClient, WsMessage } from "./types";
import type { WsRouter } from "./WsRouter";

/**
 * WebSocket manager for a single module
 */
export class WsManager {
    private clients = new Map<string, WsClient>();

    constructor(
        private moduleId: string,
        private router: WsRouter
    ) {}

    /**
     * Add a new client connection
     */
    addClient(clientId: string, ws: ServerWebSocket<{ id: string; moduleId: string }>): WsClient {
        const client: WsClient = {
            id: clientId,
            ws,
            moduleId: this.moduleId,
            send: (message: WsMessage) => {
                try {
                    ws.send(JSON.stringify(message));
                } catch (error) {
                    console.error(`[WsManager:${this.moduleId}] Error sending message:`, error);
                }
            },
            close: () => {
                ws.close();
            },
        };

        this.clients.set(clientId, client);
        return client;
    }

    /**
     * Remove a client connection
     */
    removeClient(clientId: string): void {
        this.clients.delete(clientId);
    }

    /**
     * Get a client by ID
     */
    getClient(clientId: string): WsClient | undefined {
        return this.clients.get(clientId);
    }

    /**
     * Get all connected clients
     */
    getAllClients(): WsClient[] {
        return Array.from(this.clients.values());
    }

    /**
     * Handle incoming message
     */
    async handleMessage(clientId: string, data: string): Promise<void> {
        const client = this.clients.get(clientId);
        if (!client) {
            console.warn(`[WsManager:${this.moduleId}] Client ${clientId} not found`);
            return;
        }

        try {
            const message: WsMessage = JSON.parse(data);
            await this.router.handle(message, client);
        } catch (error) {
            console.error(`[WsManager:${this.moduleId}] Error handling message:`, error);
            client.send({
                type: "error",
                payload: {
                    error: "Invalid message format",
                    message: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }

    /**
     * Broadcast a message to all clients
     */
    broadcast(message: WsMessage): void {
        const jsonMessage = JSON.stringify(message);
        for (const client of this.clients.values()) {
            try {
                client.ws.send(jsonMessage);
            } catch (error) {
                console.error(
                    `[WsManager:${this.moduleId}] Error broadcasting to client ${client.id}:`,
                    error
                );
            }
        }
    }

    /**
     * Send message to specific client
     */
    sendTo(clientId: string, message: WsMessage): void {
        const client = this.clients.get(clientId);
        if (client) {
            client.send(message);
        }
    }

    /**
     * Get connection count
     */
    getConnectionCount(): number {
        return this.clients.size;
    }

    /**
     * Close all connections
     */
    closeAll(): void {
        for (const client of this.clients.values()) {
            client.close();
        }
        this.clients.clear();
    }
}
