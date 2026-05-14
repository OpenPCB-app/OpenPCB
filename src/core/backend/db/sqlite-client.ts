import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import BetterDatabase from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

const require = createRequire(import.meta.url);

export type SharedSqliteDatabase = {
  exec(sql: string): unknown;
  close(): void;
  query<T = unknown, P extends unknown[] = unknown[]>(sql: string): {
    all(...params: P): T[];
    get(...params: P): T | undefined;
    run(...params: P): BetterDatabase.RunResult;
  };
};

let sqlite: SharedSqliteDatabase | null = null;
let drizzleInstance: BetterSQLite3Database<Record<string, unknown>> | null =
  null;

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
function isBunRuntime(): boolean {
  return typeof (process.versions as { bun?: string }).bun === "string";
}

function attachCompatibilityMethods(
  db: BetterDatabase.Database,
): SharedSqliteDatabase {
  const compatible = db as unknown as SharedSqliteDatabase;
  compatible.query = ((sql: string) =>
    db.prepare(sql)) as SharedSqliteDatabase["query"];
  return compatible;
}

function createBunSqlite(dbPath: string): SharedSqliteDatabase {
  const { Database } = require("bun:sqlite") as {
    Database: new (
      path: string,
      options: { create: boolean; readwrite: boolean },
    ) => SharedSqliteDatabase;
  };
  const db = new Database(dbPath, { create: true, readwrite: true });
  return db;
}

export function getSharedSqlite(): SharedSqliteDatabase {
  if (sqlite) {
    return sqlite;
  }

  const dbPath = resolveDbPath();
  ensureDir(dbPath);

  if (isBunRuntime()) {
    const db = createBunSqlite(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA foreign_keys = ON;");
    sqlite = db;
    return sqlite;
  }

  const db = new BetterDatabase(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  sqlite = attachCompatibilityMethods(db);
  return sqlite;
}

/**
 * Returns the shared Drizzle client wrapping the singleton SQLite database.
 * All modules share this database; tables are partitioned by module prefix.
 */
export function getSharedDb(): BetterSQLite3Database<Record<string, unknown>> {
  if (drizzleInstance) {
    return drizzleInstance;
  }

  if (isBunRuntime()) {
    const bunDrizzle = require("drizzle-orm/bun-sqlite") as {
      drizzle(db: SharedSqliteDatabase): unknown;
    };
    drizzleInstance = bunDrizzle.drizzle(
      getSharedSqlite(),
    ) as BetterSQLite3Database<Record<string, unknown>>;
    return drizzleInstance;
  }

  drizzleInstance = drizzle(
    getSharedSqlite() as unknown as BetterDatabase.Database,
  ) as BetterSQLite3Database<Record<string, unknown>>;
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
