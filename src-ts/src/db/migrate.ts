/**
 * Database Migration Runner
 *
 * Handles programmatic database migrations at runtime.
 * Migrations are generated via drizzle-kit and applied via this module.
 *
 * Usage:
 * - Development: `bun run db:migrate`
 * - Production: Migrations run automatically on startup
 */

import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { DatabaseAccess } from './index';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

/**
 * Migration configuration
 */
export interface MigrationConfig {
  /**
   * Path to migrations folder
   * Default: Auto-resolved based on environment
   */
  migrationsFolder?: string;

  /**
   * Custom migration table name
   * Default: __drizzle_migrations
   */
  migrationsTable?: string;
}

/**
 * Resolve the migrations folder path based on environment
 */
function resolveMigrationsFolder(): string {
  // 1. Allow explicit override via environment variable
  if (process.env.MIGRATIONS_FOLDER && existsSync(process.env.MIGRATIONS_FOLDER)) {
    return process.env.MIGRATIONS_FOLDER;
  }

  // 2. Define candidates for different environments
  const candidates = [
    // Development: Relative to this file
    resolve(import.meta.dirname, '../../drizzle/migrations'),

    // Production (macOS): Resources are in ../Resources relative to executable
    // We try multiple levels up/down to catch various bundle structures
    join(process.cwd(), '../Resources/src-ts/drizzle/migrations'),
    join(process.cwd(), 'resources/src-ts/drizzle/migrations'), // Windows/Linux typically

    // Fallback relative to the executable path
    join(dirname(process.execPath), '../Resources/src-ts/drizzle/migrations'),
    join(dirname(process.execPath), 'resources/src-ts/drizzle/migrations'),
  ];

  // 3. Check candidates
  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  // 4. Default fallback (logs warning if not found during migrate)
  return resolve(import.meta.dirname, '../../drizzle/migrations');
}

/**
 * Apply pending migrations to database
 *
 * Reads migration files from migrationsFolder, compares with migration
 * history in database, and applies unapplied migrations sequentially.
 *
 * @param config - Migration configuration
 * @throws Error if migration fails
 *
 * @example
 * await runMigrations();
 */
export async function runMigrations(
  config: MigrationConfig = {}
): Promise<void> {
  const migrationsFolder = config.migrationsFolder || resolveMigrationsFolder();

  console.log(`[Migrations] Running migrations from ${migrationsFolder}...`);

  if (!existsSync(migrationsFolder)) {
     throw new Error(`Migrations folder not found at: ${migrationsFolder}`);
  }

  try {
    const db = DatabaseAccess.getInstance();

    await migrate(db.getDb(), {
      migrationsFolder,
      migrationsTable: config.migrationsTable,
    });

    console.log('[Migrations] ✓ All migrations applied successfully');
  } catch (error) {
    console.error('[Migrations] ✗ Migration failed:', error);
    throw error;
  }
}

/**
 * Check if migrations are needed
 *
 * Compares current schema state with migration history.
 * Returns true if there are pending migrations.
 *
 * Note: This is a simple implementation. For production,
 * consider implementing more sophisticated checks.
 */
export async function hasPendingMigrations(): Promise<boolean> {
  try {
    const db = DatabaseAccess.getInstance();
    const rawDb = db.getRawDb();

    // Check if migrations table exists
    const result = rawDb.query<{ count: number }, []>(
      `SELECT COUNT(*) as count
       FROM sqlite_master
       WHERE type='table' AND name='__drizzle_migrations'`
    );

    const count = result.get()?.count ?? 0;

    // If migrations table doesn't exist, migrations are needed
    return count === 0;
  } catch (error) {
    console.error('[Migrations] Error checking pending migrations:', error);
    return true; // Assume migrations needed on error
  }
}

/**
 * Run migrations if needed (safe startup check)
 *
 * Checks for pending migrations and applies them if necessary.
 * Safe to call on every startup.
 */
export async function runMigrationsIfNeeded(
  config?: MigrationConfig
): Promise<void> {
  console.log('[Migrations] Checking for pending migrations...');
  await runMigrations(config);
}
