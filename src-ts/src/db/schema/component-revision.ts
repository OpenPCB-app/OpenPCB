import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { componentFamily } from "./component-family";

export const componentRevision = sqliteTable(
  "component_revision",
  {
    ...uuidPrimaryKey,
    familyId: text("family_id")
      .notNull()
      .references(() => componentFamily.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: text("snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    publishedAt: text("published_at").notNull(),
    ...timestamps,
  },
  (table) => ({
    familyIdx: index("idx_component_revision_family").on(table.familyId),
    familyRevIdx: index("idx_component_revision_family_rev").on(
      table.familyId,
      table.revisionNumber,
    ),
  }),
);

export type ComponentRevisionRow = typeof componentRevision.$inferSelect;
export type NewComponentRevisionRow = typeof componentRevision.$inferInsert;
