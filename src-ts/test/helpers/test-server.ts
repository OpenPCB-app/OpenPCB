/**
 * Test Server Lifecycle Management
 * 
 * Provides utilities to start and stop the Bun server programmatically
 * for integration tests. Uses Bun's subprocess API.
 */

import { Subprocess } from "bun";
import path from "path";
import { mkdir, rm } from "fs/promises";
import { waitForServer } from "../setup";

interface TestServerOptions {
    appDataDir?: string;
    env?: Record<string, string | undefined>;
}

export class TestServer {
    private process: Subprocess | null = null;
    private readonly serverPath: string;
    private port: number;
    private readonly kernelToken: string;
    private readonly appDataDir?: string;
    private readonly envOverrides: Record<string, string | undefined>;

    constructor(port: number = 3000, kernelToken: string = "", options?: TestServerOptions) {
        this.port = port;
        this.kernelToken = kernelToken;
        this.appDataDir = options?.appDataDir;
        this.envOverrides = options?.env ?? {};
        // Path to main.ts relative to test/helpers directory
        this.serverPath = path.join(import.meta.dir, "../../src/main.ts");
    }

    private resolveAppDataDir(): string {
        return this.appDataDir ?? path.join(import.meta.dir, `../../.test-data-${this.port}`);
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

        const basePort = this.port === 0 ? 3000 : this.port;
        let lastError: unknown = null;

        for (let attempt = 0; attempt < 10; attempt++) {
            this.port = basePort + attempt;
            console.log(`[TestServer] Starting server from ${this.serverPath} on port ${this.port}...`);

            const appDataDir = this.resolveAppDataDir();
            await rm(appDataDir, { recursive: true, force: true });
            await mkdir(appDataDir, { recursive: true });

            this.process = Bun.spawn(["bun", "run", this.serverPath], {
                env: {
                    ...process.env,
                    ...this.envOverrides,
                    NODE_ENV: "test",
                    PORT: this.port.toString(),
                    APP_DATA_DIR: appDataDir,
                    KERNEL_TOKEN: this.kernelToken,
                },
                stdout: "inherit",
                stderr: "inherit",
            });

            try {
                const result = await Promise.race([
                    waitForServer(`http://127.0.0.1:${this.port}/api/health`, 15000).then(() => ({ ready: true as const })),
                    this.process.exited.then((code) => ({ ready: false as const, code })),
                ]);

                if (result.ready) {
                    console.log(`[TestServer] Server started successfully on port ${this.port}`);
                    return;
                }

                throw new Error(`Server exited before becoming ready (exit code: ${result.code})`);
            } catch (error) {
                lastError = error;
                await this.stop();
            }
        }

        throw new Error(`Failed to start test server: ${lastError}`);
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

    getPort(): number {
        return this.port;
    }

    /**
     * Get the API base URL
     */
    getApiUrl(): string {
        return `${this.getUrl()}/api`;
    }

    getDataDir(): string {
        return this.resolveAppDataDir();
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
