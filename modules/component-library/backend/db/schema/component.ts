import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";

const COMPONENT_SCOPES = ["workspace", "builtin"] as const;

export const component = sqliteTable(
  "components",
  {
    ...uuidPrimaryKey,
    canonicalKey: text("canonical_key").notNull(),
    displayLabel: text("display_label").notNull(),
    description: text("description").notNull().default(""),
    scope: text("scope", { enum: COMPONENT_SCOPES })
      .notNull()
      .default("workspace"),
    symbolData: text("symbol_data", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    defaultVariantId: text("default_variant_id"),
    categoryPath: text("category_path"),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    ...timestamps,
  },
  (table) => ({
    canonicalKeyUniqueIdx: uniqueIndex("ux_components_scope_canonical_key").on(
      table.scope,
      table.canonicalKey,
    ),
    scopeIdx: index("idx_components_scope").on(table.scope),
    categoryPathIdx: index("idx_components_category_path").on(
      table.categoryPath,
    ),
  }),
);

export const componentUsage = sqliteTable(
  "component_usage",
  {
    ...uuidPrimaryKey,
    componentId: text("component_id")
      .notNull()
      .references(() => component.id, { onDelete: "cascade" }),
    designId: text("design_id").notNull(),
    variantId: text("variant_id").notNull(),
    ...timestamps,
  },
  (table) => ({
    componentIdx: index("idx_component_usage_component").on(table.componentId),
    designIdx: index("idx_component_usage_design").on(table.designId),
    uniqueUsageIdx: uniqueIndex(
      "ux_component_usage_design_component_variant",
    ).on(table.designId, table.componentId, table.variantId),
  }),
);

export type ComponentRow = typeof component.$inferSelect;
export type NewComponentRow = typeof component.$inferInsert;

export type ComponentUsageRow = typeof componentUsage.$inferSelect;
export type NewComponentUsageRow = typeof componentUsage.$inferInsert;
