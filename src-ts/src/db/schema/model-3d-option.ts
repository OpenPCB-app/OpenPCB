import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { footprintOption } from "./footprint-option";

export const model3dOption = sqliteTable(
  "model_3d_option",
  {
    ...uuidPrimaryKey,
    footprintOptionId: text("footprint_option_id")
      .notNull()
      .references(() => footprintOption.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    stepAssetPath: text("step_asset_path"),
    gltfPreviewPath: text("gltf_preview_path"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    linkStatus: text("link_status", {
      enum: ["valid", "missing_target", "orphan_asset", "shared_body"],
    }).notNull(),
    ...timestamps,
  },
  (table) => ({
    fpIdx: index("idx_model_3d_option_fp").on(table.footprintOptionId),
  }),
);

export type Model3dOptionRow = typeof model3dOption.$inferSelect;
export type NewModel3dOptionRow = typeof model3dOption.$inferInsert;
