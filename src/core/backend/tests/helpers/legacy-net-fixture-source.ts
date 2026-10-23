import { Database } from "bun:sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { loadSchematicProjection } from "../../../../modules/designer/backend/projection-read";
import { deriveNetsAndJunctions } from "../../../../modules/designer/backend/projection-world";
import { designHeads, schematicParts, schematicPins, schematicWires, schematicLabels, schematicPrimitives, netIdentityState } from "../../../../modules/designer/backend/schema";

type RawRow = Record<string, string | number | null>;
interface LegacyFixture {
  payload: {
    designId: string;
    schematic: { parts: RawRow[]; pins: RawRow[]; wires: RawRow[]; labels: RawRow[]; primitives: RawRow[] };
  };
  auxiliaryRows: { designHead: RawRow };
  observations: Record<string, unknown>;
}

function insertRows(sqlite: Database, table: AnySQLiteTable, rows: RawRow[]): void {
  const columns = getTableColumns(table), name = getTableName(table);
  sqlite.exec(`CREATE TABLE "${name}" (${Object.values(columns).map((column) => `"${column.name}" ${column.getSQLType()}`).join(", ")})`);
  for (const row of rows) {
    const keys = Object.keys(row);
    const statement = `INSERT INTO "${name}" (${keys.map((key) => `"${columns[key]!.name}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
    sqlite.query(statement).run(...keys.map((key) => row[key]!));
  }
}

export async function loadLegacyFixtureSource(name: string) {
  const fixture = await Bun.file(new URL(`../fixtures/legacy-net-ids/${name}.json`, import.meta.url)).json() as LegacyFixture;
  const sqlite = new Database(":memory:");
  try {
    const rows = fixture.payload.schematic;
    const tables: Array<[AnySQLiteTable, RawRow[]]> = [
      [designHeads, [fixture.auxiliaryRows.designHead]], [schematicParts, rows.parts],
      [schematicPins, rows.pins], [schematicWires, rows.wires],
      [schematicLabels, rows.labels], [schematicPrimitives, rows.primitives],
      [netIdentityState, []],
    ];
    for (const [table, records] of tables) insertRows(sqlite, table, records);
    const db = drizzle(sqlite) as unknown as Parameters<typeof loadSchematicProjection>[0];
    const projection = loadSchematicProjection(db, fixture.payload.designId);
    if (!projection) throw new Error(`Missing fixture projection: ${name}`);
    return { fixture, projection };
  } finally {
    sqlite.close();
  }
}

export function legacyDerivationSnapshot(result: ReturnType<typeof deriveNetsAndJunctions>): string {
  return JSON.stringify({
    ...result,
    attachedLabelIds: [...result.attachedLabelIds],
    attachedPrimitiveIds: [...result.attachedPrimitiveIds],
  });
}
