import { describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { applyModuleMigrations } from "../migrations/module-migrator";

const MIGRATIONS_DIR = path.resolve(
  import.meta.dir,
  "../../../modules/designer/backend/migrations",
);
const BINDING = "0019_bom_override_part_binding.sql";

async function migrateUpTo(dir: string, lastExcluded: string): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter(
    (name) => name.endsWith(".sql") && name < lastExcluded,
  );
  for (const name of files) {
    await copyFile(path.join(MIGRATIONS_DIR, name), path.join(dir, name));
  }
  const report = await applyModuleMigrations("designer", dir);
  expect(report.failed).toBeNull();
}

describe("0019 binds BOM overrides to parts (T-217)", () => {
  test("existing rows bind to the part carrying their refdes; refdes is unique only while unbound", async () => {
    resetSharedSqliteForTesting();
    process.env.OPENPCB_DB_PATH = path.join(
      os.tmpdir(),
      `bom-override-migration-${Date.now()}-${crypto.randomUUID()}.sqlite`,
    );
    const dir = await mkdtemp(path.join(os.tmpdir(), "designer-migrations-"));
    await migrateUpTo(dir, BINDING);

    const db = getSharedSqlite();
    const now = new Date().toISOString();
    db.query(
      "insert into designer_design_heads (id, name, revision, created_at, updated_at) values ('d1', 'D', 0, ?, ?)",
    ).run(now, now);
    db.query(
      `insert into designer_schematic_parts (id, design_id, component_id, reference, value,
         position_x_nm, position_y_nm, symbol_snapshot_json, footprint_snapshot_json, created_at, updated_at)
       values ('part-a', 'd1', 'cmp', 'C1', '1u', 0, 0, '{}', '{}', ?, ?)`,
    ).run(now, now);
    for (const [id, refdes] of [
      ["o1", "C1"],
      ["o2", "C9"],
    ] as const) {
      db.query(
        "insert into designer_bom_overrides (id, design_id, refdes, dnp, created_at, updated_at) values (?, 'd1', ?, 1, ?, ?)",
      ).run(id, refdes, now, now);
    }

    await copyFile(path.join(MIGRATIONS_DIR, BINDING), path.join(dir, BINDING));
    const report = await applyModuleMigrations("designer", dir);
    expect(report.failed).toBeNull();
    expect(report.applied).toEqual([BINDING]);

    const rows = db
      .query<{ id: string; part_id: string | null; dnp: number }, []>(
        "select id, part_id, dnp from designer_bom_overrides order by id",
      )
      .all();
    expect(rows).toEqual([
      { id: "o1", part_id: "part-a", dnp: 1 },
      { id: "o2", part_id: null, dnp: 1 },
    ]);

    const insert = (id: string, partId: string | null, refdes: string) =>
      db
        .query(
          "insert into designer_bom_overrides (id, design_id, part_id, refdes, created_at, updated_at) values (?, 'd1', ?, ?, ?, ?)",
        )
        .run(id, partId, refdes, now, now);
    // A bound row may share a (stale) refdes; a second unbound row or a second
    // row for the same part may not.
    expect(() => insert("o3", "part-b", "C1")).not.toThrow();
    expect(() => insert("o4", null, "C9")).toThrow();
    expect(() => insert("o5", "part-a", "C5")).toThrow();
  });
});
