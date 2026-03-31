/**
 * Test Database Helper
 *
 * Creates isolated SQLite databases for integration tests.
 * Uses unique temp files for each test to avoid singleton issues.
 *
 * IMPORTANT: Due to singleton patterns in TaskOrchestrator internals,
 * tests must run serially and each test gets a unique database file.
 */

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../../../src/db/schema';

/**
 * Lightweight test database wrapper
 * Does not use DatabaseAccess singleton to avoid conflicts
 */
export interface TestDatabase {
    sqlite: Database;
    db: BunSQLiteDatabase<typeof schema>;
    filePath: string;
    cleanup: () => void;
}

let testCounter = 0;
const testDbDir = path.join(import.meta.dir, '../temp');

/**
 * Create an isolated database for testing
 */
export function createTestDatabase(): TestDatabase {
    // Ensure temp directory exists
    if (!fs.existsSync(testDbDir)) {
        fs.mkdirSync(testDbDir, { recursive: true });
    }

    // Create unique file path
    testCounter++;
    const filePath = path.join(testDbDir, `test-${Date.now()}-${testCounter}.db`);

    // Create SQLite database
    const sqlite = new Database(filePath, {
        create: true,
        readwrite: true,
    });

    // Apply schema
    applySchema(sqlite);

    // Create Drizzle instance
    const db = drizzle(sqlite, { schema });

    return {
        sqlite,
        db,
        filePath,
        cleanup: () => {
            try {
                sqlite.close();
                fs.unlinkSync(filePath);
            } catch (e) {
                console.warn(`[TestDB] Cleanup warning: ${e}`);
            }
        },
    };
}

/**
 * Apply database schema
 */
function applySchema(sqlite: Database): void {
    const migrationsDir = path.resolve(import.meta.dir, "../../../drizzle/migrations");
    const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith(".sql"))
        .sort();

    if (migrationFiles.length === 0) {
        throw new Error(`[TestDB] No migration files found in ${migrationsDir}`);
    }

    for (const file of migrationFiles) {
        const migrationPath = path.join(migrationsDir, file);
        const migrationSql = fs.readFileSync(migrationPath, "utf8");
        const statements = migrationSql
            .split("--> statement-breakpoint")
            .map((statement) => statement.trim())
            .filter((statement) => statement.length > 0);

        for (const statement of statements) {
            sqlite.exec(statement);
        }
    }

    // Create default workspace
    const now = Date.now();
    sqlite.exec(`
        INSERT OR IGNORE INTO workspace (id, name, settings, created_at, updated_at)
        VALUES ('00000000-0000-0000-0000-000000000000', 'Default', '{}', ${now}, ${now});
    `);

    console.log('[TestDB] Schema applied');
}

/**
 * Wait for a task to reach a terminal state (queries DB directly)
 */
export async function waitForTaskCompletion(
    sqlite: Database,
    taskId: string,
    timeoutMs: number = 30000,
    pollIntervalMs: number = 500
): Promise<'completed' | 'failed' | 'cancelled' | 'timeout'> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        const stmt = sqlite.prepare('SELECT status FROM task WHERE id = ?');
        const result = stmt.get(taskId) as { status: string } | null;

        if (!result) {
            throw new Error(`Task not found: ${taskId}`);
        }

        if (['completed', 'failed', 'cancelled'].includes(result.status)) {
            return result.status as 'completed' | 'failed' | 'cancelled';
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return 'timeout';
}

/**
 * Cleanup all temp databases
 */
export function cleanupAllTestDatabases(): void {
    if (fs.existsSync(testDbDir)) {
        const files = fs.readdirSync(testDbDir);
        for (const file of files) {
            if (file.endsWith('.db')) {
                try {
                    fs.unlinkSync(path.join(testDbDir, file));
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        }
    }
}
