import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getSharedDb } from "./sqlite-client";

/**
 * Runs a callback inside a Drizzle transaction on the shared database.
 *
 * Drizzle's better-sqlite3 transaction API is synchronous at the driver level
 * (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`), so the callback MUST be
 * synchronous. For async work, collect the data outside the transaction
 * and pass it in, or call db methods directly without a transaction.
 */
export function runInTransaction<T>(
  fn: (tx: BetterSQLite3Database<Record<string, unknown>>) => T,
): T {
  const db = getSharedDb();
  return db.transaction((tx) =>
    fn(tx as BetterSQLite3Database<Record<string, unknown>>),
  );
}
