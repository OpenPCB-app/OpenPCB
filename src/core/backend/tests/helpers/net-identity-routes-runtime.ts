import { afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { getSharedDb, getSharedSqlite, resetSharedSqliteForTesting } from "../../db/sqlite-client";
import { resetCaptureRuntimeForTesting } from "../../../../modules/designer/backend/capture";
import {
  commandLog, designHeads, pcbEntities, schematicLabels, schematicParts, schematicPins,
  schematicPrimitives, schematicWires, sessionHistories,
} from "../../../../modules/designer/backend/schema";
import type { DesignerNetIdentitySummary } from "../../../../sdks/designer/net-identity";
import { bootDesignerRuntime } from "./designer-runtime";
import { migrationFixture } from "./net-identity-migration-fixture";

const priorPath = process.env.OPENPCB_DB_PATH;
const priorCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
const files: string[] = [];

afterEach(() => {
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  if (priorPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = priorPath;
  if (priorCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = priorCapture;
  for (const file of files.splice(0)) for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
});

export async function routesRuntime() {
  process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "0";
  const runtime = await bootDesignerRuntime("net-identity-routes");
  files.push(process.env.OPENPCB_DB_PATH!);
  const fixture = migrationFixture(), db = getSharedDb();
  try {
    const { payload, auxiliaryRows } = fixture.input;
    db.transaction(() => {
      db.insert(designHeads).values(auxiliaryRows.designHead).run();
      for (const row of payload.schematic.parts) db.insert(schematicParts).values(row).run();
      for (const row of payload.schematic.pins) db.insert(schematicPins).values(row).run();
      for (const row of payload.schematic.wires) db.insert(schematicWires).values(row).run();
      for (const row of payload.schematic.labels) db.insert(schematicLabels).values(row).run();
      for (const row of payload.schematic.primitives) db.insert(schematicPrimitives).values(row).run();
      for (const row of payload.pcbEntities) db.insert(pcbEntities).values(row).run();
      for (const row of payload.sessionHistories) db.insert(sessionHistories).values(row).run();
      for (const row of auxiliaryRows.commandLog) db.insert(commandLog).values(row).run();
    });
    return { ...runtime, db, designId: fixture.designId, original: payload };
  } finally { fixture.sqlite.close(); }
}

export type RoutesRuntime = Awaited<ReturnType<typeof routesRuntime>>;
export type Status = DesignerNetIdentitySummary & { revision: number };

export function request(runtime: RoutesRuntime, action = "", body?: unknown, designId = runtime.designId) {
  const init = action ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) } : {};
  return runtime.server.fetch(new Request(`http://localhost/api/modules/designer/designs/${designId}/net-identity${action}`, init));
}

export async function status(runtime: RoutesRuntime, action = "", body?: unknown): Promise<Status> {
  const response = await request(runtime, action, body);
  if (response.status !== 200) throw new Error(await response.text());
  return (await response.json() as { data: Status }).data;
}

export function rawDesignerRows(): string {
  const sqlite = getSharedSqlite();
  const tables = sqlite.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'designer_%' ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => ({ name, rows: sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() })));
}
