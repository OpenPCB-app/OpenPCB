import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";

export const presetCatalog = sqliteTable(
  "preset_catalog",
  {
    ...uuidPrimaryKey,
    name: text("name").notNull(),
    scope: text("scope", { enum: ["built_in", "workspace"] }).notNull(),
    isImmutable: integer("is_immutable", { mode: "boolean" })
      .notNull()
      .default(false),
    ...timestamps,
  },
  (table) => ({
    scopeIdx: index("idx_preset_catalog_scope").on(table.scope),
  }),
);

export type PresetCatalogRow = typeof presetCatalog.$inferSelect;
export type NewPresetCatalogRow = typeof presetCatalog.$inferInsert;
