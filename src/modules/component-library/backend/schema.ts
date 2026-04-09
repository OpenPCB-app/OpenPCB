import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

/**
 * Component Library schema — three flat tables backing the MVP part picker.
 * Tables are prefixed `component_library_` to share the openpcb.sqlite DB
 * with other modules without collisions.
 */

export const symbols = sqliteTable("component_library_symbols", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dataJson: text("data_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const footprints = sqliteTable("component_library_footprints", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dataJson: text("data_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const parts = sqliteTable(
  "component_library_parts",
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
    nameIdx: index("component_library_parts_name_idx").on(table.name),
  }),
);
