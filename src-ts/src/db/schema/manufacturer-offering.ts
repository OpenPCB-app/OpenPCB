import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { packageVariant } from "./package-variant";

export const manufacturerOffering = sqliteTable(
  "manufacturer_offering",
  {
    ...uuidPrimaryKey,
    variantId: text("variant_id")
      .notNull()
      .references(() => packageVariant.id, { onDelete: "cascade" }),
    mpn: text("mpn").notNull(),
    manufacturer: text("manufacturer").notNull(),
    datasheetUrl: text("datasheet_url"),
    ...timestamps,
  },
  (table) => ({
    variantIdx: index("idx_manufacturer_offering_variant").on(table.variantId),
    mpnIdx: index("idx_manufacturer_offering_mpn").on(table.mpn),
  }),
);

export type ManufacturerOfferingRow = typeof manufacturerOffering.$inferSelect;
export type NewManufacturerOfferingRow =
  typeof manufacturerOffering.$inferInsert;
