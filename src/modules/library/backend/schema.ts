import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

/**
 * Library schema — three flat tables backing the component library.
 * Tables are prefixed `library_` to share the openpcb.sqlite DB
 * with other modules without collisions.
 */

export const symbols = sqliteTable("library_symbols", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dataJson: text("data_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const footprints = sqliteTable("library_footprints", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dataJson: text("data_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const components = sqliteTable(
  "library_components",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    symbolId: text("symbol_id").notNull(),
    footprintId: text("footprint_id").notNull(),
    tagsJson: text("tags_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    nameIdx: index("library_components_name_idx").on(table.name),
  }),
);
