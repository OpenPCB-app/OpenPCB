/**
 * Free-pad hydration invariants (manufacturability contract 10 §1.2, §7).
 *
 * Two values that must never disagree once the row is read back:
 *  - `drillMm` IS the tool diameter, so a slotted row takes the slot's width;
 *  - a `circle` pad IS a disc of `widthMm`, so an unequal height collapses.
 *
 * Both are read-time, so a row persisted before the rules existed is corrected
 * without a migration.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { loadPcbFreePads } from "../../../modules/designer/backend/pcb/pcb-store";

type PcbDb = Parameters<typeof loadPcbFreePads>[0];

function makeDb(): PcbDb {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE designer_pcb_entities (
      id TEXT PRIMARY KEY NOT NULL,
      design_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite) as unknown as PcbDb;
}

function seed(db: PcbDb, id: string, payload: Record<string, unknown>): void {
  const sqlite = (db as unknown as { $client: Database }).$client;
  sqlite
    .query(
      `INSERT INTO designer_pcb_entities
         (id, design_id, kind, payload_json, created_at, updated_at)
       VALUES (?, 'd1', 'free_pad', ?, 't', 't')`,
    )
    .run(id, JSON.stringify({ id, ...payload }));
}

const BASE = {
  centerMm: { x: 1, y: 2 },
  rotationDeg: 0,
  padType: "hole",
  shape: "circle",
  widthMm: 3,
  heightMm: 3,
  layer: "F.Cu",
  netId: null,
  solderMaskExpansionMm: null,
  solderPasteExpansionMm: null,
  lockedAt: null,
};

describe("free-pad hydration", () => {
  test("a slotted row takes its tool diameter from the slot width", () => {
    const db = makeDb();
    // A row whose round `drillMm` disagrees with the slot it also carries: the
    // slot is what the fab routes, so the slot width wins.
    seed(db, "fp-slot", {
      ...BASE,
      drillMm: 0.9,
      drillSlot: { lengthMm: 5, widthMm: 3, angleDeg: 0 },
    });
    const [pad] = loadPcbFreePads(db, "d1");
    expect(pad!.drillMm).toBe(3);
    expect(pad!.drillSlot).toEqual({ lengthMm: 5, widthMm: 3, angleDeg: 0 });
  });

  test("a round row keeps its own drill", () => {
    const db = makeDb();
    seed(db, "fp-round", { ...BASE, drillMm: 0.9 });
    expect(loadPcbFreePads(db, "d1")[0]!.drillMm).toBe(0.9);
  });

  test("an unequal `circle` row reads back as a disc", () => {
    const db = makeDb();
    seed(db, "fp-ellipse", {
      ...BASE,
      padType: "smd",
      widthMm: 2,
      heightMm: 1,
      drillMm: null,
    });
    const [pad] = loadPcbFreePads(db, "d1");
    expect(pad!.widthMm).toBe(2);
    expect(pad!.heightMm).toBe(2);
  });

  test("a non-circle row keeps both dimensions", () => {
    const db = makeDb();
    seed(db, "fp-rect", {
      ...BASE,
      padType: "smd",
      shape: "rect",
      widthMm: 2,
      heightMm: 1,
      drillMm: null,
    });
    const [pad] = loadPcbFreePads(db, "d1");
    expect(pad!.widthMm).toBe(2);
    expect(pad!.heightMm).toBe(1);
  });
});
