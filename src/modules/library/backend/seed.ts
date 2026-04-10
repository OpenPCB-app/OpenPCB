import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import { components, footprints, symbols } from "./schema";
import { getDb } from "./queries";
import { sql } from "drizzle-orm";

export async function seedIfEmpty(
  ctx: CoreBackendModuleContext,
): Promise<void> {
  const db = getDb(ctx);
  const countRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(components)
    .get();
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.insert(symbols)
      .values([
        {
          id: "sym-resistor-2pin",
          name: "Resistor 2-pin",
          dataJson: JSON.stringify({
            referencePrefix: "R",
            pins: [{ num: "1" }, { num: "2" }],
          }),
          createdAt: now,
        },
        {
          id: "sym-capacitor-2pin",
          name: "Capacitor 2-pin",
          dataJson: JSON.stringify({
            referencePrefix: "C",
            pins: [{ num: "1" }, { num: "2" }],
          }),
          createdAt: now,
        },
      ])
      .run();

    tx.insert(footprints)
      .values([
        {
          id: "fp-0603",
          name: "0603 Metric",
          dataJson: JSON.stringify({ package: "0603", mountType: "smd" }),
          createdAt: now,
        },
        {
          id: "fp-0805",
          name: "0805 Metric",
          dataJson: JSON.stringify({ package: "0805", mountType: "smd" }),
          createdAt: now,
        },
      ])
      .run();

    tx.insert(components)
      .values([
        {
          id: "comp-r-10k-0603",
          name: "Resistor 10k",
          description: "General-purpose resistor",
          symbolId: "sym-resistor-2pin",
          footprintId: "fp-0603",
          tagsJson: JSON.stringify(["resistor", "0603", "passive"]),
          createdAt: now,
        },
        {
          id: "comp-c-100nf-0603",
          name: "Capacitor 100nF",
          description: "Decoupling capacitor",
          symbolId: "sym-capacitor-2pin",
          footprintId: "fp-0603",
          tagsJson: JSON.stringify(["capacitor", "0603", "passive"]),
          createdAt: now,
        },
        {
          id: "comp-c-10uf-0805",
          name: "Capacitor 10uF",
          description: "Bulk capacitor",
          symbolId: "sym-capacitor-2pin",
          footprintId: "fp-0805",
          tagsJson: JSON.stringify(["capacitor", "0805", "passive"]),
          createdAt: now,
        },
      ])
      .run();
  });
}
