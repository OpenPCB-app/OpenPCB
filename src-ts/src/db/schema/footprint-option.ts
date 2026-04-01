import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";
import { packageVariant } from "./package-variant";

export const footprintOption = sqliteTable(
  "footprint_option",
  {
    ...uuidPrimaryKey,
    variantId: text("variant_id")
      .notNull()
      .references(() => packageVariant.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    kicadPayload: text("kicad_payload", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    /** IPC-7351 density level: most, nominal, least */
    densityLevel: text("density_level"),
    /** IPC-7351 standardized name (e.g., RESC2012X65N) */
    ipcName: text("ipc_name"),
    defaultModel3dOptionId: text("default_model_3d_option_id"),
    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    variantIdx: index("idx_footprint_option_variant").on(table.variantId),
  }),
);

export type FootprintOptionRow = typeof footprintOption.$inferSelect;
export type NewFootprintOptionRow = typeof footprintOption.$inferInsert;
