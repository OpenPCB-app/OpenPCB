import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";
import { componentFamily } from "./component-family";

export const packageVariant = sqliteTable(
  "package_variant",
  {
    ...uuidPrimaryKey,
    familyId: text("family_id")
      .notNull()
      .references(() => componentFamily.id, { onDelete: "cascade" }),
    canonicalCode: text("canonical_code").notNull(),
    humanLabel: text("human_label").notNull(),
    imperialAlias: text("imperial_alias"),
    metricAlias: text("metric_alias"),
    mountType: text("mount_type", {
      enum: ["smd", "through_hole", "virtual"],
    }).notNull(),
    dimensions: text("dimensions", { mode: "json" }).$type<{
      lengthMm: number;
      widthMm: number;
      heightMm: number | null;
    }>(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    pinRemapTable: text("pin_remap_table", { mode: "json" }).$type<
      Record<string, string>
    >(),
    defaultFootprintOptionId: text("default_footprint_option_id"),
    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    familyIdx: index("idx_package_variant_family").on(table.familyId),
    familyCodeIdx: index("idx_package_variant_family_code").on(
      table.familyId,
      table.canonicalCode,
    ),
  }),
);

export type PackageVariantRow = typeof packageVariant.$inferSelect;
export type NewPackageVariantRow = typeof packageVariant.$inferInsert;
