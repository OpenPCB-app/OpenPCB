import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { pcbEntities } from "../../../modules/designer/backend/schema";
import {
  insertPcbVia,
  loadPcbVias,
} from "../../../modules/designer/backend/pcb/pcb-store";
import type { PcbVia } from "../../../sdks/designer";
import {
  validateTraceAgainstFab,
  validateViaAgainstFab,
} from "../../../modules/designer/backend/pcb/fab-presets";

/**
 * In-memory SQLite test harness — the production migration system applies
 * .sql files at runtime; here we hand-create the bare `pcbEntities` table
 * to keep the test focused on the hydrator default-fill behaviour.
 */
type PcbDb = Parameters<typeof loadPcbVias>[0];

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

describe("PcbVia hydrator default-fill", () => {
  test("loads pre-Phase-B blob with viaType=through and protection=tented defaults", () => {
    const db = makeDb();
    // Pre-Phase-B payload: no viaType, no protection.
    const legacyPayload = JSON.stringify({
      id: "via-legacy",
      netId: "net-1",
      netClassId: "default",
      centerMm: { x: 5, y: 7 },
      diameterMm: 0.8,
      drillMm: 0.4,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
    });
    db.insert(pcbEntities)
      .values({
        id: "via-legacy",
        designId: "d1",
        kind: "via",
        payloadJson: legacyPayload,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      })
      .run();

    const vias = loadPcbVias(db, "d1");
    expect(vias.length).toBe(1);
    const v = vias[0]!;
    expect(v.viaType).toBe("through");
    expect(v.protection).toBe("tented");
    expect(v.fromLayer).toBe("F.Cu");
    expect(v.toLayer).toBe("B.Cu");
    expect(v.diameterMm).toBe(0.8);
    expect(v.drillMm).toBe(0.4);
  });

  test("round-trip preserves new fields when explicitly set", () => {
    const db = makeDb();
    const via: PcbVia = {
      id: "via-roundtrip",
      netId: null,
      netClassId: "default",
      centerMm: { x: 0, y: 0 },
      diameterMm: 0.6,
      drillMm: 0.3,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      viaType: "through",
      protection: "filled",
      provenance: "route",
    };
    insertPcbVia(db, "d2", via, "2026-05-10T00:00:00Z");
    const loaded = loadPcbVias(db, "d2");
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.protection).toBe("filled");
  });

  test("rejects malformed via payload (drill >= diameter)", () => {
    const db = makeDb();
    const bad = JSON.stringify({
      id: "via-bad",
      netClassId: "default",
      centerMm: { x: 0, y: 0 },
      diameterMm: 0.3,
      drillMm: 0.4,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
    });
    db.insert(pcbEntities)
      .values({
        id: "via-bad",
        designId: "d3",
        kind: "via",
        payloadJson: bad,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      })
      .run();
    expect(loadPcbVias(db, "d3").length).toBe(0);
  });
});

describe("Fab preset validation", () => {
  test("custom fabricator emits no violations", () => {
    const violations = validateViaAgainstFab(
      { diameterMm: 0.1, drillMm: 0.05 },
      "custom",
    );
    expect(violations).toEqual([]);
  });

  test("JLCPCB 2L flags below-min drill", () => {
    const violations = validateViaAgainstFab(
      { diameterMm: 0.6, drillMm: 0.2 },
      "jlcpcb_2l",
    );
    expect(violations.find((v) => v.rule === "minDrillMm")).toBeDefined();
  });

  test("JLCPCB 4L accepts compliant 0.2/0.5mm via (AR=0.15)", () => {
    const violations = validateViaAgainstFab(
      { diameterMm: 0.5, drillMm: 0.2 },
      "jlcpcb_4l",
    );
    expect(violations).toEqual([]);
  });

  test("JLCPCB 4L flags 0.2/0.45 via for sub-AR (0.125 < 0.15)", () => {
    const violations = validateViaAgainstFab(
      { diameterMm: 0.45, drillMm: 0.2 },
      "jlcpcb_4l",
    );
    expect(violations.find((v) => v.rule === "minAnnularRingMm")).toBeDefined();
  });

  test("trace below fab min trace width is flagged", () => {
    const violations = validateTraceAgainstFab({ widthMm: 0.05 }, "jlcpcb_2l");
    expect(violations.find((v) => v.rule === "minTraceWidthMm")).toBeDefined();
  });
});
