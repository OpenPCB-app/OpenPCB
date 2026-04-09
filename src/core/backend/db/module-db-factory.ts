import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { ModuleDbClient } from "../../contracts/modules/backend-module";
import { getSharedDb, getSharedSqlite } from "./sqlite-client";

/**
 * Concrete ModuleDbClient for modules that want strong Drizzle typing at
 * the call site. The structural contract in core/contracts is deliberately
 * untyped so the contracts layer has no dependency on Drizzle; concrete
 * instances exposed to modules use this richer type.
 */
export interface DrizzleModuleDbClient extends ModuleDbClient {
  readonly db: BunSQLiteDatabase<Record<string, unknown>>;
  transaction<T>(fn: (tx: BunSQLiteDatabase<Record<string, unknown>>) => T): T;
}

function normalizeModuleId(moduleId: string): string {
  return moduleId.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
}

/**
 * Build a per-module Drizzle client. The client wraps the shared Drizzle
 * instance but also exposes the module's canonical table prefix so the
 * module can name its tables consistently.
 */
export function createModuleDb(moduleId: string): DrizzleModuleDbClient {
  const normalized = normalizeModuleId(moduleId);
  const tablePrefix = `${normalized}_`;
  const db = getSharedDb();
  const sqlite = getSharedSqlite();

  return {
    moduleId,
    tablePrefix,
    db,
    rawSql<T = unknown>(query: string, params: unknown[] = []): T[] {
      const statement = sqlite.query(query);
      return statement.all(...(params as [])) as T[];
    },
    transaction<T>(
      fn: (tx: BunSQLiteDatabase<Record<string, unknown>>) => T,
    ): T {
      return db.transaction((tx) =>
        fn(tx as BunSQLiteDatabase<Record<string, unknown>>),
      );
    },
  };
}
