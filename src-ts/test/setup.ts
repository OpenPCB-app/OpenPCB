/**
 * Global Test Setup
 * 
 * This file is preloaded before all tests run (configured in bunfig.toml).
 * Sets up test environment variables and global test utilities.
 */

import path from "path";
import { jest } from "bun:test";

// ============================================================================
// Test Environment Configuration
// ============================================================================

/**
 * Set NODE_ENV to test mode
 */
process.env.NODE_ENV = "test";

jest.setTimeout(120000);

/**
 * Use separate test database directory
 * This ensures tests don't interfere with development data
 */
const testDataDir = path.join(import.meta.dir, "../.test-data");
process.env.APP_DATA_DIR = testDataDir;

/**
 * Configure test server port
 */
process.env.PORT = "3000";

/**
 * Disable authentication token requirement for tests
 * This makes test requests simpler (no need to set X-OpenPCB-Token header)
 */
process.env.KERNEL_TOKEN = "";

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Wait for server to be ready by polling the health endpoint
 */
export async function waitForServer(
    url: string = "http://127.0.0.1:3000/api/health",
    timeout: number = 10000,
    interval: number = 100
): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        try {
            const response = await fetch(url);
            if (response.status < 500) {
                return true;
            }
        } catch (error) {
            // Server not ready yet, continue polling
        }
        await Bun.sleep(interval);
    }

    throw new Error(`Server failed to start within ${timeout}ms`);
}

/**
 * Clean test database by removing the test data directory
 */
export async function cleanTestDatabase(targetDir?: string): Promise<void> {
    const fs = await import("fs/promises");
    const dataDir = targetDir ?? testDataDir;
    try {
        await fs.rm(dataDir, { recursive: true, force: true });
        console.log(`[Test Setup] Cleaned test database: ${dataDir}`);
    } catch (error) {
        // Directory might not exist, that's ok
    }

    // Recreate the directory for the new test run
    try {
        await fs.mkdir(dataDir, { recursive: true });
        console.log(`[Test Setup] Created test data directory: ${dataDir}`);
    } catch (error) {
        console.error(`[Test Setup] Error creating test data directory:`, error);
    }
}

console.log("[Test Setup] Test environment configured");
console.log(`[Test Setup] Test data directory: ${testDataDir}`);
console.log(`[Test Setup] Test server port: ${process.env.PORT}`);
