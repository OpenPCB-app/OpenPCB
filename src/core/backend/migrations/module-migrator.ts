import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getSharedSqlite } from "../db/sqlite-client";

export interface MigrationReport {
  moduleId: string;
  applied: string[];
  skipped: string[];
  failed: { name: string; error: string } | null;
}

const TRACKING_TABLE = "openpcb_migrations";

function ensureTrackingTable(): void {
  const db = getSharedSqlite();
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
       module_id TEXT NOT NULL,
       migration_name TEXT NOT NULL,
       applied_at TEXT NOT NULL,
       PRIMARY KEY (module_id, migration_name)
     )`,
  );
}

function listAppliedMigrations(moduleId: string): Set<string> {
  const db = getSharedSqlite();
  const rows = db
    .query<{ migration_name: string }, [string]>(
      `SELECT migration_name FROM ${TRACKING_TABLE} WHERE module_id = ? ORDER BY migration_name`,
    )
    .all(moduleId);
  return new Set(rows.map((row) => row.migration_name));
}

async function listSqlFiles(migrationsDir: string): Promise<string[]> {
  try {
    const dirStat = await stat(migrationsDir);
    if (!dirStat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Splits a Drizzle-generated SQL migration file into individual statements.
 * Drizzle uses `--> statement-breakpoint` as the separator between statements.
 */
function splitStatements(sqlContent: string): string[] {
  return sqlContent
    .split(/--> statement-breakpoint/gi)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function applySingleMigration(
  moduleId: string,
  migrationName: string,
  sqlContent: string,
): void {
  const db = getSharedSqlite();
  const statements = splitStatements(sqlContent);
  const now = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) {
      db.exec(statement);
    }
    db.query(
      `INSERT INTO ${TRACKING_TABLE} (module_id, migration_name, applied_at) VALUES (?, ?, ?)`,
    ).run(moduleId, migrationName, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Apply all unapplied migrations for a module from its backend/migrations folder.
 * Idempotent: already-applied migrations are skipped. On failure, the failing
 * migration's transaction is rolled back and the report records the error.
 */
export async function applyModuleMigrations(
  moduleId: string,
  migrationsDir: string,
): Promise<MigrationReport> {
  ensureTrackingTable();

  const report: MigrationReport = {
    moduleId,
    applied: [],
    skipped: [],
    failed: null,
  };

  const files = await listSqlFiles(migrationsDir);
  if (files.length === 0) {
    return report;
  }

  const already = listAppliedMigrations(moduleId);

  for (const name of files) {
    if (already.has(name)) {
      report.skipped.push(name);
      continue;
    }

    const filePath = path.join(migrationsDir, name);
    const content = await readFile(filePath, "utf8");

    try {
      applySingleMigration(moduleId, name, content);
      report.applied.push(name);
    } catch (error) {
      report.failed = {
        name,
        error: error instanceof Error ? error.message : String(error),
      };
      break;
    }
  }

  return report;
}
