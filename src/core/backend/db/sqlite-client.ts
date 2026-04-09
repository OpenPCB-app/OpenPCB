import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

let sqlite: Database | null = null;
let drizzleInstance: BunSQLiteDatabase<Record<string, unknown>> | null = null;

function resolveDbPath(): string {
  const explicit = process.env.OPENPCB_DB_PATH;
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  if (process.env.NODE_ENV === "development") {
    return path.resolve(process.cwd(), "dev-data/openpcb.sqlite");
  }

  return path.join(os.homedir(), ".openpcb", "data.sqlite");
}

function ensureDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * Returns the shared SQLite Database handle. Created lazily on first call.
 * Enables WAL mode, foreign keys, and a sensible busy timeout.
 */
export function getSharedSqlite(): Database {
  if (sqlite) {
    return sqlite;
  }

  const dbPath = resolveDbPath();
  ensureDir(dbPath);

  const db = new Database(dbPath, { create: true, readwrite: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");

  sqlite = db;
  return sqlite;
}

/**
 * Returns the shared Drizzle client wrapping the singleton SQLite database.
 * All modules share this database; tables are partitioned by module prefix.
 */
export function getSharedDb(): BunSQLiteDatabase<Record<string, unknown>> {
  if (drizzleInstance) {
    return drizzleInstance;
  }

  drizzleInstance = drizzle(getSharedSqlite()) as BunSQLiteDatabase<
    Record<string, unknown>
  >;
  return drizzleInstance;
}

/**
 * Test-only: close and reset the shared handles so a subsequent call
 * re-opens against a fresh database path (e.g. after setting OPENPCB_DB_PATH).
 */
export function resetSharedSqliteForTesting(): void {
  if (sqlite) {
    sqlite.close();
  }
  sqlite = null;
  drizzleInstance = null;
}
