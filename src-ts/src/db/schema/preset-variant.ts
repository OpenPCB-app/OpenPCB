import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { presetCatalog } from "./preset-catalog";

export const presetVariant = sqliteTable(
  "preset_variant",
  {
    ...uuidPrimaryKey,
    catalogId: text("catalog_id")
      .notNull()
      .references(() => presetCatalog.id, { onDelete: "cascade" }),
    canonicalCode: text("canonical_code").notNull(),
    humanLabel: text("human_label").notNull(),
    imperialAlias: text("imperial_alias"),
    metricAlias: text("metric_alias"),
    mountType: text("mount_type", {
      enum: ["smd", "through_hole", "virtual"],
    }).notNull(),
    typicalDimensions: text("typical_dimensions", { mode: "json" }).$type<{
      lengthMm: number;
      widthMm: number;
      heightMm: number | null;
    }>(),
    pinCount: integer("pin_count"),
    ...timestamps,
  },
  (table) => ({
    catalogIdx: index("idx_preset_variant_catalog").on(table.catalogId),
    codeIdx: index("idx_preset_variant_code").on(
      table.catalogId,
      table.canonicalCode,
    ),
  }),
);

export type PresetVariantRow = typeof presetVariant.$inferSelect;
export type NewPresetVariantRow = typeof presetVariant.$inferInsert;
