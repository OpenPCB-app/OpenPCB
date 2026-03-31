/**
 * Module Database Handle
 *
 * Provides isolated database access for modules with auto-prefixed table names.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "./schema";
import type { QueryLogger } from "./query-logger";
import { sql } from "drizzle-orm";
import { parseSQLiteError } from "./errors";

/**
 * Module-specific database handle with namespace isolation
 *
 * Prevents modules from accessing core tables or other modules' data.
 * All table names are auto-prefixed with `module_${moduleId}_`.
 */
export class ModuleDbHandle {
  constructor(
    private moduleId: string,
    private db: BunSQLiteDatabase<typeof schema>,
    private logger: QueryLogger
  ) {}

  /**
   * Get prefixed table name for module isolation
   */
  private prefixTableName(tableName: string): string {
    return `module_${this.moduleId}_${tableName}`;
  }

  /**
   * Execute raw SQL query with module table name prefixing
   *
   * @example
   * const results = await moduleDb.query<{ id: string }>(
   *   "SELECT * FROM $table WHERE status = ?",
   *   "users",
   *   ["active"]
   * );
   */
  async query<T = unknown>(
    sqlTemplate: string,
    tableName: string,
    _params: unknown[] = []
  ): Promise<T[]> {
    const start = performance.now();
    try {
      const prefixedTable = this.prefixTableName(tableName);
      const finalSql = sqlTemplate.replace(/\$table/g, prefixedTable);

      const result = this.db
        .all(sql.raw(finalSql)) as T[];

      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] ${finalSql}`, duration);

      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] FAILED`, duration);
      throw parseSQLiteError(err, `ModuleDb[${this.moduleId}].query`);
    }
  }

  /**
   * Execute raw SQL statement (INSERT, UPDATE, DELETE)
   */
  async execute(
    sqlTemplate: string,
    tableName: string,
    _params: unknown[] = []
  ): Promise<void> {
    const start = performance.now();
    try {
      const prefixedTable = this.prefixTableName(tableName);
      const finalSql = sqlTemplate.replace(/\$table/g, prefixedTable);

      this.db.run(sql.raw(finalSql));

      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] ${finalSql}`, duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] FAILED`, duration);
      throw parseSQLiteError(err, `ModuleDb[${this.moduleId}].execute`);
    }
  }

  /**
   * Create a table for this module
   *
   * @example
   * await moduleDb.createTable("events", `
   *   id TEXT PRIMARY KEY,
   *   type TEXT NOT NULL,
   *   data TEXT,
   *   created_at INTEGER NOT NULL
   * `);
   */
  async createTable(tableName: string, columnDefinitions: string): Promise<void> {
    const start = performance.now();
    try {
      const prefixedTable = this.prefixTableName(tableName);
      const createSql = `CREATE TABLE IF NOT EXISTS ${prefixedTable} (${columnDefinitions})`;

      this.db.run(sql.raw(createSql));

      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] CREATE TABLE ${prefixedTable}`, duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] CREATE TABLE FAILED`, duration);
      throw parseSQLiteError(err, `ModuleDb[${this.moduleId}].createTable`);
    }
  }

  /**
   * Drop a module table
   */
  async dropTable(tableName: string): Promise<void> {
    const start = performance.now();
    try {
      const prefixedTable = this.prefixTableName(tableName);
      const dropSql = `DROP TABLE IF EXISTS ${prefixedTable}`;

      this.db.run(sql.raw(dropSql));

      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] DROP TABLE ${prefixedTable}`, duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] DROP TABLE FAILED`, duration);
      throw parseSQLiteError(err, `ModuleDb[${this.moduleId}].dropTable`);
    }
  }

  /**
   * Execute a transaction within module namespace
   *
   * @example
   * await moduleDb.transaction(async (tx) => {
   *   await tx.query("INSERT INTO $table VALUES (?)", "users", [userId]);
   *   await tx.query("INSERT INTO $table VALUES (?)", "events", [eventId]);
   * });
   */
  async transaction<T>(
    fn: (handle: ModuleDbHandle) => Promise<T>,
    _options?: unknown
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await this.db.transaction(async (tx) => {
        const txHandle = new ModuleDbHandle(
          this.moduleId,
          tx as BunSQLiteDatabase<typeof schema>,
          this.logger
        );
        return await fn(txHandle);
      });

      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] TRANSACTION`, duration);

      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery(`[Module:${this.moduleId}] TRANSACTION FAILED`, duration);
      throw parseSQLiteError(err, `ModuleDb[${this.moduleId}].transaction`);
    }
  }

  /**
   * Get module ID
   */
  getModuleId(): string {
    return this.moduleId;
  }

  /**
   * Get raw database instance (use sparingly)
   */
  getRawDb(): BunSQLiteDatabase<typeof schema> {
    return this.db;
  }
}
