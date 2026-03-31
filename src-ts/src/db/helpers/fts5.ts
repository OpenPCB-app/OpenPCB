/**
 * FTS5 Full-Text Search Helpers
 *
 * Utilities for SQLite FTS5 full-text search indices.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import { sql } from "drizzle-orm";
import { parseSQLiteError } from "../errors";

/**
 * FTS5 Index Manager
 *
 * Creates and manages FTS5 virtual tables for full-text search.
 *
 * @example
 * const fts = new FTS5Index(db, "threads");
 * await fts.createIndex(["title", "summary"]);
 * const results = await fts.search("important meeting", 10);
 */
export class FTS5Index {
  private ftsTableName: string;

  constructor(
    private db: BunSQLiteDatabase<typeof schema>,
    private sourceTable: string
  ) {
    this.ftsTableName = `${sourceTable}_fts`;
  }

  /**
   * Create FTS5 index on specified columns
   *
   * @param columns - Column names to index
   * @param contentTable - Optional external content table (default: sourceTable)
   */
  async createIndex(columns: string[], contentTable?: string): Promise<void> {
    try {
      const content = contentTable ?? this.sourceTable;
      const columnList = columns.join(", ");

      // Create FTS5 virtual table
      const createSql = `
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.ftsTableName}
        USING fts5(
          ${columnList},
          content='${content}',
          content_rowid='rowid'
        )
      `;

      this.db.run(sql.raw(createSql));

      // Create triggers to keep FTS index in sync
      await this.createSyncTriggers(columns);

      // Initial population
      await this.rebuild();
    } catch (err) {
      throw parseSQLiteError(err, `FTS5Index.createIndex(${this.sourceTable})`);
    }
  }

  /**
   * Create triggers to keep FTS index synchronized with source table
   */
  private async createSyncTriggers(columns: string[]): Promise<void> {
    const columnList = columns.join(", ");

    // INSERT trigger
    const insertTrigger = `
      CREATE TRIGGER IF NOT EXISTS ${this.ftsTableName}_insert
      AFTER INSERT ON ${this.sourceTable}
      BEGIN
        INSERT INTO ${this.ftsTableName}(rowid, ${columnList})
        VALUES (new.rowid, ${columns.map(c => `new.${c}`).join(", ")});
      END
    `;

    // UPDATE trigger
    const updateTrigger = `
      CREATE TRIGGER IF NOT EXISTS ${this.ftsTableName}_update
      AFTER UPDATE ON ${this.sourceTable}
      BEGIN
        UPDATE ${this.ftsTableName}
        SET ${columns.map(c => `${c} = new.${c}`).join(", ")}
        WHERE rowid = new.rowid;
      END
    `;

    // DELETE trigger
    const deleteTrigger = `
      CREATE TRIGGER IF NOT EXISTS ${this.ftsTableName}_delete
      AFTER DELETE ON ${this.sourceTable}
      BEGIN
        DELETE FROM ${this.ftsTableName} WHERE rowid = old.rowid;
      END
    `;

    this.db.run(sql.raw(insertTrigger));
    this.db.run(sql.raw(updateTrigger));
    this.db.run(sql.raw(deleteTrigger));
  }

  /**
   * Perform full-text search
   *
   * @param query - Search query (FTS5 syntax)
   * @param limit - Maximum results to return
   * @returns Array of matching row IDs
   *
   * @example
   * // Simple search
   * await fts.search("important meeting");
   *
   * // AND query
   * await fts.search("important AND meeting");
   *
   * // OR query
   * await fts.search("important OR urgent");
   *
   * // Phrase search
   * await fts.search('"exact phrase"');
   *
   * // Column-specific
   * await fts.search("title:meeting");
   */
  async search(query: string, limit = 50): Promise<string[]> {
    try {
      const searchSql = `
        SELECT rowid FROM ${this.ftsTableName}
        WHERE ${this.ftsTableName} MATCH ?
        ORDER BY rank
        LIMIT ?
      `;

      const results = this.db.all(
        sql.raw(searchSql)
      ) as Array<{ rowid: string }>;

      return results.map(r => r.rowid);
    } catch (err) {
      throw parseSQLiteError(err, `FTS5Index.search(${this.sourceTable})`);
    }
  }

  /**
   * Search with highlighted snippets
   *
   * @param query - Search query
   * @param column - Column to extract snippet from
   * @param limit - Maximum results
   * @returns Array of { rowid, snippet }
   */
  async searchWithSnippets(
    query: string,
    column: string,
    limit = 50
  ): Promise<Array<{ rowid: string; snippet: string }>> {
    try {
      const searchSql = `
        SELECT
          rowid,
          snippet(${this.ftsTableName}, -1, '<mark>', '</mark>', '...', 32) as snippet
        FROM ${this.ftsTableName}
        WHERE ${this.ftsTableName} MATCH ?
        ORDER BY rank
        LIMIT ?
      `;

      const results = this.db.all(
        sql.raw(searchSql)
      ) as Array<{ rowid: string; snippet: string }>;

      return results;
    } catch (err) {
      throw parseSQLiteError(err, `FTS5Index.searchWithSnippets(${this.sourceTable})`);
    }
  }

  /**
   * Rebuild FTS index from source table
   */
  async rebuild(): Promise<void> {
    try {
      const rebuildSql = `INSERT INTO ${this.ftsTableName}(${this.ftsTableName}) VALUES('rebuild')`;
      this.db.run(sql.raw(rebuildSql));
    } catch (err) {
      throw parseSQLiteError(err, `FTS5Index.rebuild(${this.sourceTable})`);
    }
  }

  /**
   * Optimize FTS index
   */
  async optimize(): Promise<void> {
    try {
      const optimizeSql = `INSERT INTO ${this.ftsTableName}(${this.ftsTableName}) VALUES('optimize')`;
      this.db.run(sql.raw(optimizeSql));
    } catch (err) {
      throw parseSQLiteError(err, `FTS5Index.optimize(${this.sourceTable})`);
    }
  }

  /**
   * Drop FTS index and triggers
   */
  async dropIndex(): Promise<void> {
    try {
      // Drop triggers
      this.db.run(sql.raw(`DROP TRIGGER IF EXISTS ${this.ftsTableName}_insert`));
      this.db.run(sql.raw(`DROP TRIGGER IF EXISTS ${this.ftsTableName}_update`));
      this.db.run(sql.raw(`DROP TRIGGER IF EXISTS ${this.ftsTableName}_delete`));

      // Drop FTS table
      this.db.run(sql.raw(`DROP TABLE IF EXISTS ${this.ftsTableName}`));
    } catch (err) {
      throw parseSQLiteError(err, `FTS5Index.dropIndex(${this.sourceTable})`);
    }
  }

  /**
   * Get FTS table name
   */
  getFtsTableName(): string {
    return this.ftsTableName;
  }
}
