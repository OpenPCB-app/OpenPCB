import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";
import { design } from "./design";
import type { SchematicProjectDocument } from "@shared/types/pcb.types";

export const designSheet = sqliteTable(
  "design_sheet",
  {
    ...uuidPrimaryKey,
    designId: text("design_id")
      .notNull()
      .references(() => design.id, { onDelete: "cascade" }),
    sheetIndex: integer("sheet_index").notNull().default(0),
    title: text("title").notNull().default("Sheet 1"),
    content: text("content", { mode: "json" })
      .$type<SchematicProjectDocument>()
      .notNull(),
    contentHash: text("content_hash"),
    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    designIdx: index("idx_design_sheet_design").on(table.designId),
    designSheetIdx: uniqueIndex("idx_design_sheet_design_sheet").on(
      table.designId,
      table.sheetIndex,
    ),
  }),
);

export type DesignSheetRow = typeof designSheet.$inferSelect;
export type NewDesignSheetRow = typeof designSheet.$inferInsert;
