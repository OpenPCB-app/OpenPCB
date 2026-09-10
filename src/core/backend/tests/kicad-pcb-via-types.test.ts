/**
 * `.kicad_pcb` via types (manufacturability contract 10 §5.3).
 *
 * KiCad board file format: `(via [blind | micro] (at …) (size …) (drill …)
 * (layers …) …)` — the type is a BARE ATOM after `via`, not a sub-list, so the
 * previous `findNode` lookup never matched and every imported via came back
 * `through`. The format has only those two tokens: a BURIED via is written
 * with `blind`, and the span tells them apart.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { parseKicadPcb } from "../../../modules/library/backend/infrastructure/parsers/kicad/kicad-pcb-parser";
import { insertPcbEntities } from "../../../modules/designer/backend/import/kicad-project/insert-pcb";
import { loadPcbVias } from "../../../modules/designer/backend/pcb/pcb-store";
import type { PcbVia } from "../../../sdks/designer";

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
    CREATE TABLE designer_schematic_parts (
      id TEXT PRIMARY KEY NOT NULL,
      design_id TEXT NOT NULL,
      component_id TEXT NOT NULL,
      reference TEXT NOT NULL,
      value TEXT,
      position_x INTEGER NOT NULL,
      position_y INTEGER NOT NULL,
      rotation_deg INTEGER NOT NULL,
      mirrored INTEGER NOT NULL,
      symbol_snapshot_json TEXT NOT NULL,
      footprint_snapshot_json TEXT,
      properties_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite) as unknown as PcbDb;
}

/** A real 4-layer board with one via of each written form. */
const BOARD = `
(kicad_pcb (version 20221018) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (1 "In1.Cu" signal)
    (2 "In2.Cu" signal)
    (31 "B.Cu" signal)
  )
  (net 0 "")
  (net 1 "GND")
  (via blind (at 10 10) (size 0.6) (drill 0.3) (layers "F.Cu" "In1.Cu") (net 1))
  (via blind (at 12 10) (size 0.6) (drill 0.3) (layers "In1.Cu" "In2.Cu") (net 1))
  (via micro (at 14 10) (size 0.4) (drill 0.2) (layers "F.Cu" "In1.Cu") (net 1))
  (via (at 16 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
)
`;

describe("KiCad via type import", () => {
  test("the parser reads the bare `blind` / `micro` atom", () => {
    const parsed = parseKicadPcb(BOARD);
    expect(parsed.copperLayerCount).toBe(4);
    expect(parsed.vias.map((v) => v.type)).toEqual([
      "blind",
      "blind",
      "micro",
      "through",
    ]);
  });

  test("the span separates a blind via from a buried one", () => {
    const db = makeDb();
    const result = insertPcbEntities(
      db,
      {
        designId: "d1",
        pcb: parseKicadPcb(BOARD),
        partIdByRefdes: new Map(),
        boardCenterMm: { x: 0, y: 0 },
      },
      "2026-01-01T00:00:00.000Z",
    );
    expect(result.viasInserted).toBe(4);
    const vias = loadPcbVias(db, "d1");
    const byX = new Map<number, PcbVia>(
      vias.map((via) => [Math.round(via.centerMm.x), via]),
    );
    // One outer layer → blind.
    expect(byX.get(10)!.viaType).toBe("blind");
    // No outer layer → buried, even though KiCad wrote the `blind` token.
    expect(byX.get(12)!.viaType).toBe("buried");
    expect(byX.get(14)!.viaType).toBe("micro");
    expect(byX.get(16)!.viaType).toBe("through");
  });
});
