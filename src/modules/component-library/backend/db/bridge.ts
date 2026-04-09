/**
 * DB Bridge
 *
 * Narrows the untyped Drizzle instance exposed by the module runtime into
 * the typed `BunSQLiteDatabase<typeof schema>` that ComponentRepository
 * expects. Also hosts the bootstrap DDL that creates the tables on first
 * module activation — this replaces drizzle-kit migrations for the
 * first-pass flow, since drizzle.config.ts doesn't currently scan module
 * schemas.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../../core/backend/runtime/modules/backend-module";
import type * as schema from "./schema";

export function getTypedDb(
  ctx: CoreBackendModuleContext,
): BunSQLiteDatabase<typeof schema> {
  const raw = ctx.db.getRawDb();
  if (!raw || typeof raw !== "object") {
    throw new Error("component-library: ctx.db.getRawDb() returned non-object");
  }
  return raw as unknown as BunSQLiteDatabase<typeof schema>;
}

/**
 * Ensure the `components` and `component_variants` tables exist. Matches
 * the Drizzle schema in backend/db/schema/component.ts and component-variant.ts.
 *
 * Executed from the module's onActivate hook. Idempotent via IF NOT EXISTS.
 *
 * Note: these tables are created unprefixed in the shared modules DB file
 * (OpenPCB.modules.db) rather than via the ctx.db.createTable prefixing
 * helper. This matches how the Drizzle repository expects to query them.
 */
export async function ensureComponentLibrarySchema(
  db: BunSQLiteDatabase<typeof schema>,
): Promise<void> {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY NOT NULL,
      canonical_key TEXT NOT NULL,
      display_label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'workspace',
      symbol_data TEXT NOT NULL,
      default_variant_id TEXT,
      category_path TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_components_scope_canonical_key
    ON components(scope, canonical_key)
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_components_scope ON components(scope)
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_components_category_path
    ON components(category_path)
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS component_variants (
      id TEXT PRIMARY KEY NOT NULL,
      component_id TEXT NOT NULL,
      canonical_code TEXT NOT NULL,
      human_label TEXT NOT NULL,
      imperial_alias TEXT,
      metric_alias TEXT,
      mount_type TEXT NOT NULL,
      dimensions TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      pin_remap_table TEXT,
      footprint_options TEXT NOT NULL DEFAULT '[]',
      default_footprint_option_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_component_variants_component
    ON component_variants(component_id)
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_component_variants_default
    ON component_variants(component_id, is_default)
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_component_variants_component_code
    ON component_variants(component_id, canonical_code)
  `);
}
