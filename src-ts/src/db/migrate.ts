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

// ---------------------------------------------------------------------------
// Schema Validation & Repair
// ---------------------------------------------------------------------------

/**
 * Expected schema definition for validation.
 * Maps table names to required columns with their default values.
 */
const EXPECTED_SCHEMA: Record<string, Array<{ name: string; type: string; defaultValue?: string }>> = {
  component_family: [
    { name: 'id', type: 'TEXT' },
    { name: 'canonical_key', type: 'TEXT' },
    { name: 'display_label', type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'scope', type: 'TEXT' },
    { name: 'symbol_data', type: 'TEXT' },
    { name: 'default_package_variant_id', type: 'TEXT' },
    { name: 'category_path', type: 'TEXT' },
    { name: 'tags', type: 'TEXT', defaultValue: "'[]'" },
    { name: 'created_at', type: 'INTEGER' },
    { name: 'updated_at', type: 'INTEGER' },
    { name: 'deleted_at', type: 'INTEGER' },
  ],
  model_3d_option: [
    { name: 'id', type: 'TEXT' },
    { name: 'footprint_option_id', type: 'TEXT' },
    { name: 'file_name', type: 'TEXT' },
    { name: 'is_default', type: 'INTEGER' },
    { name: 'link_status', type: 'TEXT' },
    { name: 'step_asset_path', type: 'TEXT' },
    { name: 'gltf_preview_path', type: 'TEXT' },
    { name: 'created_at', type: 'INTEGER' },
    { name: 'updated_at', type: 'INTEGER' },
  ],
  footprint_option: [
    { name: 'id', type: 'TEXT' },
    { name: 'variant_id', type: 'TEXT' },
    { name: 'label', type: 'TEXT' },
    { name: 'is_default', type: 'INTEGER', defaultValue: '0' },
    { name: 'kicad_payload', type: 'TEXT' },
    { name: 'density_level', type: 'TEXT' },
    { name: 'ipc_name', type: 'TEXT' },
    { name: 'default_model_3d_option_id', type: 'TEXT' },
    { name: 'created_at', type: 'INTEGER' },
    { name: 'updated_at', type: 'INTEGER' },
    { name: 'deleted_at', type: 'INTEGER' },
  ],
};

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * Get existing columns for a table
 */
function getTableColumns(db: ReturnType<DatabaseAccess['getRawDb']>, tableName: string): Map<string, ColumnInfo> {
  const columns = new Map<string, ColumnInfo>();
  try {
    const result = db.query<ColumnInfo, []>(`PRAGMA table_info(${tableName})`).all();
    for (const col of result) {
      columns.set(col.name, col);
    }
  } catch {
    // Table doesn't exist
  }
  return columns;
}

/**
 * Validate and repair schema by adding missing columns.
 * This runs AFTER drizzle migrations to catch any silently failed ALTER TABLE statements.
 */
export async function validateAndRepairSchema(): Promise<void> {
  const db = DatabaseAccess.getInstance();
  const rawDb = db.getRawDb();
  
  let repaired = 0;
  
  for (const [tableName, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    const existingColumns = getTableColumns(rawDb, tableName);
    
    // Skip if table doesn't exist (will be created by migrations)
    if (existingColumns.size === 0) {
      continue;
    }
    
    for (const col of expectedColumns) {
      if (!existingColumns.has(col.name)) {
        // Column is missing - add it
        const defaultClause = col.defaultValue ? ` DEFAULT ${col.defaultValue}` : '';
        const sql = `ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}${defaultClause}`;
        
        try {
          rawDb.exec(sql);
          console.log(`[Schema Repair] Added missing column: ${tableName}.${col.name}`);
          repaired++;
        } catch (err) {
          console.error(`[Schema Repair] Failed to add column ${tableName}.${col.name}:`, err);
        }
      }
    }
  }
  
  if (repaired > 0) {
    console.log(`[Schema Repair] ✓ Repaired ${repaired} missing column(s)`);
  }
}

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
 * Also validates schema and repairs any missing columns.
 * Safe to call on every startup.
 */
export async function runMigrationsIfNeeded(
  config?: MigrationConfig
): Promise<void> {
  console.log('[Migrations] Checking for pending migrations...');
  await runMigrations(config);
  
  // Validate and repair schema after migrations
  // This catches any silently failed ALTER TABLE statements
  await validateAndRepairSchema();
}
