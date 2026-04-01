import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { componentFamily } from "./component-family";

export const componentProvenance = sqliteTable(
  "component_provenance",
  {
    ...uuidPrimaryKey,
    familyId: text("family_id")
      .notNull()
      .references(() => componentFamily.id, { onDelete: "cascade" }),
    sourceFileNames: text("source_file_names", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    sourceHashes: text("source_hashes", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull(),
    importTimestamp: text("import_timestamp").notNull(),
    kicadIdentifiers: text("kicad_identifiers", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull(),
    heuristicDecisions: text("heuristic_decisions", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    ...timestamps,
  },
  (table) => ({
    familyIdx: index("idx_component_provenance_family").on(table.familyId),
  }),
);

export type ComponentProvenanceRow = typeof componentProvenance.$inferSelect;
export type NewComponentProvenanceRow = typeof componentProvenance.$inferInsert;
