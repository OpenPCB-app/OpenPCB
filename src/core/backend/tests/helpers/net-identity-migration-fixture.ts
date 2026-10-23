import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import type { NetIdentityBackupSnapshot } from "../../../../modules/designer/backend/net-identity/backup";
import { migrateDesignNetIdentity, type MigrationStage } from "../../../../modules/designer/backend/net-identity/migrate";
import type { NetIdentityDb } from "../../../../modules/designer/backend/net-identity/state-store";
import {
  commandLog, designHeads, pcbEntities, schematicLabels, schematicParts,
  schematicPins, schematicPrimitives, schematicWires, sessionHistories,
} from "../../../../modules/designer/backend/schema";

export const MIGRATION_TS = "2026-10-22T22:00:00.000Z";
export const MIGRATION_FIXTURES = ["f1-routed-clean", "f2-t132-stale", "f3-name-hints", "f9-pour-only-gnd"];
interface Fixture {
  payload: NetIdentityBackupSnapshot;
  observations: Record<string, unknown>;
  auxiliaryRows: {
    designHead: typeof designHeads.$inferSelect;
    commandLog: (typeof commandLog.$inferSelect)[];
  };
}

export function migrationFixture(name = MIGRATION_FIXTURES[0]!) {
  const input = JSON.parse(readFileSync(new URL(`../fixtures/legacy-net-ids/${name}.json`, import.meta.url), "utf8")) as Fixture;
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../../../../modules/designer/backend/migrations/", import.meta.url);
  for (const filename of readdirSync(migrations).filter((value) => value.endsWith(".sql")).sort()) {
    for (const sql of readFileSync(new URL(filename, migrations), "utf8").split("--> statement-breakpoint")) sqlite.exec(sql);
  }
  const db = drizzle(sqlite) as unknown as NetIdentityDb, snapshot = input.payload;
  db.insert(designHeads).values(input.auxiliaryRows.designHead).run();
  for (const row of snapshot.schematic.parts) db.insert(schematicParts).values(row).run();
  for (const row of snapshot.schematic.pins) db.insert(schematicPins).values(row).run();
  for (const row of snapshot.schematic.wires) db.insert(schematicWires).values(row).run();
  for (const row of snapshot.schematic.labels) db.insert(schematicLabels).values(row).run();
  for (const row of snapshot.schematic.primitives) db.insert(schematicPrimitives).values(row).run();
  for (const row of snapshot.pcbEntities) db.insert(pcbEntities).values(row).run();
  for (const row of snapshot.sessionHistories) db.insert(sessionHistories).values(row).run();
  for (const row of input.auxiliaryRows.commandLog) db.insert(commandLog).values(row).run();
  const designId = snapshot.designId;
  const migrate = (fault?: (stage: MigrationStage) => void) => db.transaction((tx) =>
    migrateDesignNetIdentity(tx as NetIdentityDb, designId, { timestamp: MIGRATION_TS, fault }));
  const rows = () => db.select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).all();
  return { db, sqlite, input, designId, migrate, rows };
}

export type MigrationFixture = ReturnType<typeof migrationFixture>;

export function rawDatabase(sqlite: Database): string {
  const tables = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => ({ name, rows: sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() })));
}

export function patchEntity(fixture: MigrationFixture, kind: string, update: (raw: Record<string, unknown>) => void): string {
  const row = fixture.rows().find((entry) => entry.kind === kind)!;
  const raw = JSON.parse(row.payloadJson) as Record<string, unknown>;
  update(raw);
  fixture.db.update(pcbEntities).set({ payloadJson: JSON.stringify(raw) }).where(eq(pcbEntities.id, row.id)).run();
  return row.id;
}

export function payloads(fixture: MigrationFixture, kind: string): Record<string, unknown>[] {
  return fixture.rows().filter((row) => row.kind === kind).map((row) => JSON.parse(row.payloadJson) as Record<string, unknown>);
}
