/**
 * Transaction Wrapper
 *
 * Wraps Drizzle transactions with logging and error handling.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "./schema";
import type { QueryLogger } from "./query-logger";
import { TransactionError } from "./errors";

export type TransactionClient = Parameters<
  Parameters<BunSQLiteDatabase<typeof schema>["transaction"]>[0]
>[0];

/**
 * Transaction wrapper with automatic logging and rollback
 */
export class Transaction {
  private committed = false;
  private rolledBack = false;

  constructor(
    private tx: TransactionClient,
    private logger: QueryLogger,
    private readonly _isolationLevel: "deferred" | "immediate" | "exclusive" = "immediate"
  ) {
    void this._isolationLevel;
  }

  /**
   * Get the underlying transaction client for Drizzle queries
   */
  getClient(): TransactionClient {
    return this.tx;
  }

  /**
   * Commit the transaction
   * Note: Drizzle auto-commits on successful callback completion
   */
  async commit(): Promise<void> {
    if (this.rolledBack) {
      throw new TransactionError("Cannot commit: transaction already rolled back");
    }
    if (this.committed) {
      throw new TransactionError("Transaction already committed");
    }
    this.committed = true;
  }

  /**
   * Rollback the transaction
   * Note: Drizzle auto-rolls back on error/throw
   */
  async rollback(): Promise<void> {
    if (this.committed) {
      throw new TransactionError("Cannot rollback: transaction already committed");
    }
    if (this.rolledBack) {
      return; // Already rolled back
    }
    this.rolledBack = true;
    // Drizzle handles rollback via throw
    throw new TransactionError("Transaction rolled back explicitly");
  }

  /**
   * Check if transaction is active
   */
  isActive(): boolean {
    return !this.committed && !this.rolledBack;
  }

  /**
   * Execute a query with timing
   */
  async query<T>(
    operation: string,
    fn: (client: TransactionClient) => Promise<T>
  ): Promise<T> {
    if (!this.isActive()) {
      throw new TransactionError("Transaction is not active");
    }

    const start = performance.now();
    try {
      const result = await fn(this.tx);
      const duration = performance.now() - start;
      this.logger.logQuery(`[TX] ${operation}`, duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery(`[TX FAILED] ${operation}`, duration);
      throw err;
    }
  }
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  /**
   * Isolation level for the transaction
   * - deferred: Default, starts as shared lock, upgrades on write
   * - immediate: Starts with reserved lock, prevents other writes immediately
   * - exclusive: Prevents all other connections from accessing database
   *
   * Default: immediate (recommended for most use cases)
   */
  isolationLevel?: "deferred" | "immediate" | "exclusive";

  /**
   * Maximum number of retry attempts on SQLITE_BUSY
   * Default: 3
   */
  maxRetries?: number;

  /**
   * Delay between retries in milliseconds
   * Default: 50
   */
  retryDelay?: number;
}
