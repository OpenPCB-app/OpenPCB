/**
 * Test Server Lifecycle Management
 * 
 * Provides utilities to start and stop the Bun server programmatically
 * for integration tests. Uses Bun's subprocess API.
 */

import { Subprocess } from "bun";
import path from "path";
import { waitForServer } from "../setup";

export class TestServer {
    private process: Subprocess | null = null;
    private readonly serverPath: string;
    private readonly port: number;
    private readonly kernelToken: string;

    constructor(port: number = 3000, kernelToken: string = "") {
        this.port = port;
        this.kernelToken = kernelToken;
        // Path to main.ts relative to test/helpers directory
        this.serverPath = path.join(import.meta.dir, "../../src/main.ts");
    }

    /**
   * Start the server as a subprocess
   * Waits for server to be ready before returning
   */
    async start(): Promise<void> {
        if (this.process) {
            console.warn("[TestServer] Server already running");
            return;
        }

        console.log(`[TestServer] Starting server from ${this.serverPath}...`);

        // Start server as subprocess
        this.process = Bun.spawn(["bun", "run", this.serverPath], {
            env: {
                ...process.env,
                NODE_ENV: "test",
                PORT: this.port.toString(),
                APP_DATA_DIR: process.env.APP_DATA_DIR || path.join(import.meta.dir, "../../.test-data"),
                KERNEL_TOKEN: this.kernelToken,
            },
            stdout: "inherit", // Inherit stdout for debugging
            stderr: "inherit", // Inherit stderr for debugging
        });

        // Wait for server to be ready
        try {
            // Increase timeout to 90s for server startup (includes migrations, DB init, etc.)
            await waitForServer(`http://127.0.0.1:${this.port}/api/health`, 90000);
            console.log(`[TestServer] Server started successfully on port ${this.port}`);
        } catch (error) {
            await this.stop();
            throw new Error(`Failed to start test server: ${error}`);
        }
    }

    /**
     * Stop the server subprocess
     */
    async stop(): Promise<void> {
        if (!this.process) {
            return;
        }

        console.log("[TestServer] Stopping server...");

        try {
            // Kill the process
            this.process.kill();

            // Wait for process to exit
            await this.process.exited;

            console.log("[TestServer] Server stopped");
        } catch (error) {
            console.error("[TestServer] Error stopping server:", error);
        } finally {
            this.process = null;
        }
    }

    /**
     * Restart the server
     */
    async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    /**
     * Check if server is running
     */
    isRunning(): boolean {
        return this.process !== null;
    }

    /**
     * Get the server URL
     */
    getUrl(): string {
        return `http://127.0.0.1:${this.port}`;
    }

    /**
     * Get the API base URL
     */
    getApiUrl(): string {
        return `${this.getUrl()}/api`;
    }
}

/**
 * Singleton instance for global use
 */
let globalTestServer: TestServer | null = null;

/**
 * Get or create the global test server instance
 */
export function getTestServer(): TestServer {
    if (!globalTestServer) {
        globalTestServer = new TestServer();
    }
    return globalTestServer;
}
