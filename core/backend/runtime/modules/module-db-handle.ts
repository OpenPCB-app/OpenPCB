import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export interface CoreModuleDbHandle {
  getRawDb(): BunSQLiteDatabase<Record<string, unknown>>;
  query<T = unknown>(sqlTemplate: string, tableName: string, params?: unknown[]): Promise<T[]>;
  execute(sqlTemplate: string, tableName: string, params?: unknown[]): Promise<void>;
  createTable(tableName: string, columnDefinitions: string): Promise<void>;
  dropTable(tableName: string): Promise<void>;
  transaction<T>(fn: (handle: CoreModuleDbHandle) => Promise<T>): Promise<T>;
}

let sqlite: Database | null = null;

function resolveDbFilePath(): string {
  const appDataDir = process.env.APP_DATA_DIR ?? path.join(process.cwd(), "data");
  mkdirSync(appDataDir, { recursive: true });
  return path.join(appDataDir, "OpenPCB.modules.db");
}

function getSqlite(): Database {
  if (!sqlite) {
    sqlite = new Database(resolveDbFilePath(), {
      create: true,
      readwrite: true,
    });
    sqlite.exec("PRAGMA journal_mode = WAL;");
    sqlite.exec("PRAGMA busy_timeout = 5000;");
    sqlite.exec("PRAGMA foreign_keys = ON;");
  }
  return sqlite;
}

export class SqliteModuleDbHandle implements CoreModuleDbHandle {
  private readonly sqlite: Database;

  private readonly db: BunSQLiteDatabase<Record<string, unknown>>;

  constructor(private readonly moduleId: string) {
    this.sqlite = getSqlite();
    this.db = drizzle(this.sqlite) as BunSQLiteDatabase<Record<string, unknown>>;
  }

  private normalizedModuleId(): string {
    return this.moduleId.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  private prefixedTable(tableName: string): string {
    return `module_${this.normalizedModuleId()}_${tableName}`;
  }

  private renderSql(sqlTemplate: string, tableName: string): string {
    return sqlTemplate.replace(/\$table/g, this.prefixedTable(tableName));
  }

  async query<T = unknown>(sqlTemplate: string, tableName: string, params: unknown[] = []): Promise<T[]> {
    const statement = this.sqlite.query(this.renderSql(sqlTemplate, tableName));
    return statement.all(...(params as [])) as T[];
  }

  async execute(sqlTemplate: string, tableName: string, params: unknown[] = []): Promise<void> {
    const statement = this.sqlite.query(this.renderSql(sqlTemplate, tableName));
    statement.run(...(params as []));
  }

  async createTable(tableName: string, columnDefinitions: string): Promise<void> {
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS ${this.prefixedTable(tableName)} (${columnDefinitions})`);
  }

  async dropTable(tableName: string): Promise<void> {
    this.sqlite.exec(`DROP TABLE IF EXISTS ${this.prefixedTable(tableName)}`);
  }

  async transaction<T>(fn: (handle: CoreModuleDbHandle) => Promise<T>): Promise<T> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(this);
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  getRawDb(): BunSQLiteDatabase<Record<string, unknown>> {
    return this.db;
  }
}
