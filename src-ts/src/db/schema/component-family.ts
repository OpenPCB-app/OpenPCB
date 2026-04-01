import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";

export const componentFamily = sqliteTable(
  "component_family",
  {
    ...uuidPrimaryKey,
    canonicalKey: text("canonical_key").notNull(),
    displayLabel: text("display_label").notNull(),
    description: text("description").notNull().default(""),
    scope: text("scope", { enum: ["built_in", "workspace"] }).notNull(),
    symbolData: text("symbol_data", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    defaultPackageVariantId: text("default_package_variant_id"),
    categoryPath: text("category_path"),
    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    scopeKeyIdx: index("idx_component_family_scope_key").on(
      table.scope,
      table.canonicalKey,
    ),
    scopeIdx: index("idx_component_family_scope").on(table.scope),
  }),
);

export type ComponentFamilyRow = typeof componentFamily.$inferSelect;
export type NewComponentFamilyRow = typeof componentFamily.$inferInsert;
