import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";
import { componentFamily } from "./component-family";

export const componentDraft = sqliteTable(
  "component_draft",
  {
    ...uuidPrimaryKey,
    familyId: text("family_id").references(() => componentFamily.id, {
      onDelete: "set null",
    }),
    wizardStep: integer("wizard_step").notNull().default(0),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    warnings: text("warnings", { mode: "json" })
      .$type<unknown[]>()
      .notNull()
      .default([]),
    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    familyIdx: index("idx_component_draft_family").on(table.familyId),
  }),
);

export type ComponentDraftRow = typeof componentDraft.$inferSelect;
export type NewComponentDraftRow = typeof componentDraft.$inferInsert;
