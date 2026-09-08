/**
 * S3a WP6 — KiCad zone / keepout import, end to end.
 *
 * Parses a minimal `.kicad_pcb` fixture, runs it through the real
 * `insertPcbEntities` path against an in-memory SQLite database, and reads the
 * persisted rows back with the store's own loaders — so the assertions cover
 * parser → insert → persistence exactly as the commit step exercises them.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { insertPcbEntities } from "../../../modules/designer/backend/import/kicad-project/insert-pcb";
import { buildInspectReport } from "../../../modules/designer/backend/import/kicad-project/inspect";
import {
  loadPcbKeepouts,
  loadPcbZones,
} from "../../../modules/designer/backend/pcb/pcb-store";
import { parseKicadPcb } from "../../../modules/library/backend/infrastructure/parsers/kicad/kicad-pcb-parser";

type PcbDb = Parameters<typeof insertPcbEntities>[0];

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
const DESIGN_ID = "design-zone-keepout";

const TWO_LAYER = `(layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))`;
const FOUR_LAYER = `(layers (0 "F.Cu" signal) (1 "In1.Cu" power) (2 "In2.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))`;
const RECT = `(polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10)))`;
const BOWTIE = `(polygon (pts (xy 0 0) (xy 10 10) (xy 10 0) (xy 0 10)))`;
/** Strictly inside RECT — a hole. */
const HOLE = `(polygon (pts (xy 3 3) (xy 7 3) (xy 7 7) (xy 3 7)))`;
/** Disjoint from RECT — a second outline. */
const DISJOINT = `(polygon (pts (xy 20 20) (xy 30 20) (xy 30 30) (xy 20 30)))`;
const KEEPOUT_RULES = `(keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))`;

function board(body: string, layers = TWO_LAYER): string {
  return `(kicad_pcb (version 20231120) (generator pcbnew)
    ${layers}
    (net 0 "")
    (net 2 "GND")
    ${body}
  )`;
}

/**
 * The production migrations run at backend startup; here the two tables the
 * PCB insert step touches are created directly so the test stays focused.
 */
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
      value TEXT NOT NULL,
      position_x_nm INTEGER NOT NULL,
      position_y_nm INTEGER NOT NULL,
      rotation_deg INTEGER NOT NULL DEFAULT 0,
      mirrored INTEGER NOT NULL DEFAULT 0,
      symbol_snapshot_json TEXT NOT NULL,
      footprint_snapshot_json TEXT NOT NULL,
      properties_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite) as unknown as PcbDb;
}

function runImport(pcbSource: string) {
  const db = makeDb();
  const result = insertPcbEntities(
    db,
    {
      designId: DESIGN_ID,
      pcb: parseKicadPcb(pcbSource),
      partIdByRefdes: new Map(),
      boardCenterMm: { x: 0, y: 0 },
    },
    TIMESTAMP,
  );
  const loaded = loadPcbZones(db, DESIGN_ID);
  return {
    result,
    zones: loaded.zones,
    zoneWarnings: loaded.warnings,
    keepouts: loadPcbKeepouts(db, DESIGN_ID),
    codes: result.warnings.map((w) => w.code),
  };
}

describe("KiCad zone import (S3a §8)", () => {
  test("splits a multi-layer zone into one persisted zone per layer", () => {
    const { result, zones, zoneWarnings, codes } = runImport(
      board(
        `(zone (net 2) (net_name "GND") (layers "F.Cu" "B.Cu") (name "pour") ${RECT})`,
      ),
    );
    expect(result.zonesInserted).toBe(2);
    expect(zoneWarnings).toEqual([]);
    expect(zones.map((z) => z.layer).sort()).toEqual(["B.Cu", "F.Cu"]);
    expect(new Set(zones.map((z) => z.name))).toEqual(new Set(["pour"]));
    expect(new Set(zones.map((z) => z.id)).size).toBe(2);
    expect(codes).toContain("zone_multilayer_split");
    for (const zone of zones) {
      expect(zone.enabled).toBe(true);
      expect(zone.netId).toBeNull();
      expect(zone.netName).toBe("GND");
      expect(zone.region).toEqual({
        kind: "polygon",
        pointsMm: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      });
    }
  });

  test("expands *.Cu against the imported 4-layer stackup", () => {
    const { result, zones } = runImport(
      board(`(zone (net 2) (layers "*.Cu") ${RECT})`, FOUR_LAYER),
    );
    expect(result.zonesInserted).toBe(4);
    expect(zones.map((z) => z.layer).sort()).toEqual([
      "B.Cu",
      "F.Cu",
      "In1.Cu",
      "In2.Cu",
    ]);
  });

  test("a net-less zone persists with no net id and no net name", () => {
    const { zones } = runImport(
      board(`(zone (net 0) (net_name "") (layer "F.Cu") ${RECT})`),
    );
    expect(zones).toHaveLength(1);
    expect(zones[0]?.netId).toBeNull();
    expect(zones[0]?.netName).toBeNull();
  });

  test("persists every override the file carries", () => {
    const { zones } = runImport(
      board(
        `(zone (net 2) (layer "F.Cu") (name "tuned") (priority 4) (locked yes)
           (connect_pads thru_hole_only (clearance 0.4)) (min_thickness 0.25)
           (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.45)
             (island_removal_mode 2) (island_area_min 1.25)) ${RECT})`,
      ),
    );
    expect(zones[0]).toMatchObject({
      name: "tuned",
      priority: 4,
      lockedAt: TIMESTAMP,
      padConnection: "thruHoleThermal",
      clearanceMm: 0.4,
      minWidthMm: 0.25,
      thermal: { gapMm: 0.5, spokeWidthMm: 0.45 },
      islandRemoval: { minAreaMm2: 1.25 },
    });
  });

  test("leaves every override absent when the file carries no token", () => {
    const { zones } = runImport(board(`(zone (net 2) (layer "F.Cu") ${RECT})`));
    const zone = zones[0]!;
    expect(zone).not.toHaveProperty("padConnection");
    expect(zone).not.toHaveProperty("clearanceMm");
    expect(zone).not.toHaveProperty("minWidthMm");
    expect(zone).not.toHaveProperty("thermal");
    expect(zone).not.toHaveProperty("islandRemoval");
    expect(zone.priority).toBe(0);
    expect(zone.lockedAt).toBeNull();
    expect(zone.name).toBeNull();
  });

  test("warns about a hatched fill and about a dropped second outline", () => {
    const { result, zones, codes } = runImport(
      board(
        `(zone (net 2) (layer "F.Cu") (fill yes (mode hatch)) ${RECT} ${DISJOINT})`,
      ),
    );
    expect(result.zonesInserted).toBe(1);
    expect(zones[0]?.enabled).toBe(true);
    expect(codes).toContain("zone_hatched_fill_as_solid");
    expect(codes).toContain("zone_extra_contour_dropped");
    expect(codes).not.toContain("zone_hole_invalid_import");
  });

  // S5 (copper-pour contract §11): a hole contour is now imported as a real
  // cutout and the zone comes in ENABLED — the pour subtracts the hole, so it
  // can no longer lay down more copper than the file draws.
  test("imports a zone with a hole contour as an enabled cutout", () => {
    const { result, zones, codes } = runImport(
      board(`(zone (net 2) (layer "F.Cu") (name "ring") ${RECT} ${HOLE})`),
    );
    expect(result.zonesInserted).toBe(1);
    expect(zones[0]?.name).toBe("ring");
    expect(zones[0]?.enabled).toBe(true);
    const region = zones[0]?.region;
    expect(region?.kind).toBe("polygon");
    expect(region?.kind === "polygon" ? region.holesMm : null).toEqual([
      [
        { x: 3, y: 3 },
        { x: 7, y: 3 },
        { x: 7, y: 7 },
        { x: 3, y: 7 },
      ],
    ]);
    expect(codes).not.toContain("zone_hole_invalid_import");
    expect(codes).not.toContain("zone_extra_contour_dropped");
  });

  test("a hole rides into every zone the multilayer split produced", () => {
    const { result, zones } = runImport(
      board(`(zone (net 2) (layers "F.Cu" "B.Cu") ${RECT} ${HOLE})`),
    );
    expect(result.zonesInserted).toBe(2);
    expect(zones.every((z) => z.enabled)).toBe(true);
    for (const zone of zones) {
      expect(
        zone.region.kind === "polygon" ? zone.region.holesMm?.length : 0,
      ).toBe(1);
    }
    // Each row owns its own arrays — one edit must not mutate the other.
    const [a, b] = zones;
    expect(
      a?.region.kind === "polygon" && b?.region.kind === "polygon"
        ? a.region.holesMm !== b.region.holesMm
        : false,
    ).toBe(true);
  });

  test("an arc in a hole contour is flattened OUTWARD (the cutout may only grow)", () => {
    // A half-disc cutout: (3,5) → arc through (5,3) → (7,5), closed straight.
    // Outward means every chord vertex sits OUTSIDE the true arc, i.e. farther
    // from the arc centre (5,5) than the 2 mm radius.
    const ARC_HOLE = `(polygon (pts (xy 3 5) (arc (start 3 5) (mid 5 3) (end 7 5))))`;
    const { zones } = runImport(
      board(`(zone (net 2) (layer "F.Cu") ${RECT} ${ARC_HOLE})`),
    );
    const region = zones[0]?.region;
    const hole = region?.kind === "polygon" ? (region.holesMm ?? [])[0] ?? [] : [];
    expect(hole.length).toBeGreaterThan(3);
    const radii = hole.map((p) => Math.hypot(p.x - 5, p.y - 5));
    expect(Math.max(...radii)).toBeGreaterThan(2);
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(2 - 1e-9);
  });

  test("a hole that is not usable imports the zone DISABLED, keeping the hole", () => {
    // Bow-tie cutout: a ring that cannot be subtracted. Dropping it would pour
    // MORE copper than drawn, so the zone comes in disabled instead.
    const BAD_HOLE = `(polygon (pts (xy 3 3) (xy 7 7) (xy 7 3) (xy 3 7)))`;
    const { result, zones, codes } = runImport(
      board(`(zone (net 2) (layer "F.Cu") ${RECT} ${BAD_HOLE})`),
    );
    expect(result.zonesInserted).toBe(1);
    expect(zones[0]?.enabled).toBe(false);
    expect(
      zones[0]?.region.kind === "polygon"
        ? zones[0]?.region.holesMm?.length
        : 0,
    ).toBe(1);
    expect(codes).toContain("zone_hole_invalid_import");
  });

  test("a hole the outline's INWARD flattening crosses is never dropped", () => {
    // Outer: a rectangle whose top edge is a shallow arc (sagitta 0.005 mm,
    // under the chord budget) so the INWARD flattening the zone pours is the
    // chord at y = 0. The hole's top corners are at y = 0.004 — inside the TRUE
    // outer (the arc is at y ≈ 0.00495 there) but across that chord.
    // Classifying against the inward points made this an extra OUTLINE and
    // dropped it, and the zone then poured copper inside the drawn cutout.
    const SHALLOW_ARC = `(polygon (pts (xy -1 -2) (xy 1 -2) (xy 1 0) (arc (start 1 0) (mid 0 0.005) (end -1 0))))`;
    const CROSSING_HOLE = `(polygon (pts (xy -0.1 -1) (xy 0.1 -1) (xy 0.1 0.004) (xy -0.1 0.004)))`;
    const { result, zones, codes } = runImport(
      board(`(zone (net 2) (layer "F.Cu") ${SHALLOW_ARC} ${CROSSING_HOLE})`),
    );
    expect(result.zonesInserted).toBe(1);
    expect(codes).not.toContain("zone_extra_contour_dropped");
    expect(
      zones[0]?.region.kind === "polygon"
        ? zones[0]?.region.holesMm?.length
        : 0,
    ).toBe(1);
    // The kept cutout pokes past the inward outer, so `zoneRegionValidity`
    // reports `hole_outside_outer` and the zone comes in DISABLED — the
    // fail-safe end of the same invariant: no copper inside the drawn hole.
    expect(zones[0]?.enabled).toBe(false);
    expect(codes).toContain("zone_hole_invalid_import");
  });

  test("drops a zone whose outline is self-intersecting", () => {
    const { result, zones, codes } = runImport(
      board(`(zone (net 2) (layer "F.Cu") (name "bad") ${BOWTIE})`),
    );
    expect(result.zonesInserted).toBe(0);
    expect(zones).toHaveLength(0);
    expect(codes).toContain("zone_ring_invalid");
  });

  test("reports the imported zone and keepout counts", () => {
    const { result } = runImport(
      board(
        `(zone (net 2) (layer "F.Cu") ${RECT})
         (zone (layer "B.Cu") ${KEEPOUT_RULES} ${RECT})`,
      ),
    );
    expect(result.zonesInserted).toBe(1);
    expect(result.keepoutsInserted).toBe(1);
    const summary = result.warnings.find(
      (w) => w.code === "pcb_zones_imported",
    );
    expect(summary?.severity).toBe("info");
    expect(summary?.message).toBe(
      "Imported 1 copper zone(s) and 1 keepout(s).",
    );
  });
});

describe("KiCad rule-area import (S3a §8)", () => {
  test("persists a keepout row with its restrictions and layers", () => {
    const { result, zones, keepouts, codes } = runImport(
      board(
        `(zone (layers "F.Cu" "B.Cu") (name "no-go") (locked yes) ${KEEPOUT_RULES} ${RECT})`,
      ),
    );
    expect(result.zonesInserted).toBe(0);
    expect(zones).toHaveLength(0);
    expect(result.keepoutsInserted).toBe(1);
    expect(keepouts).toHaveLength(1);
    expect(keepouts[0]).toMatchObject({
      name: "no-go",
      enabled: true,
      lockedAt: TIMESTAMP,
      layers: ["F.Cu", "B.Cu"],
      restrictions: {
        tracks: true,
        vias: true,
        pads: false,
        copperPour: true,
        footprints: false,
      },
    });
    expect(keepouts[0]?.pointsMm).toHaveLength(4);
    expect(codes).not.toContain("zone_layer_unsupported");
  });

  test("stays enabled when it carries a hole, dropping the hole with a warning", () => {
    // Ignoring a hole widens the forbidden area — the safe direction — so a
    // rule area is never disabled the way a zone is.
    const { result, keepouts, codes } = runImport(
      board(`(zone (layer "F.Cu") ${KEEPOUT_RULES} ${RECT} ${HOLE})`),
    );
    expect(result.keepoutsInserted).toBe(1);
    expect(keepouts[0]?.enabled).toBe(true);
    expect(keepouts[0]?.pointsMm).toHaveLength(4);
    expect(codes).toContain("zone_extra_contour_dropped");
    expect(codes).not.toContain("zone_hole_invalid_import");
  });

  test("drops non-copper layers and warns", () => {
    const { keepouts, codes } = runImport(
      board(`(zone (layers "F.Cu" "Edge.Cuts") ${KEEPOUT_RULES} ${RECT})`),
    );
    expect(keepouts[0]?.layers).toEqual(["F.Cu"]);
    expect(codes).toContain("zone_layer_unsupported");
  });

  test("skips a rule area left with no copper layer", () => {
    const { result, keepouts, codes } = runImport(
      board(
        `(zone (layers "Edge.Cuts") (name "silk") ${KEEPOUT_RULES} ${RECT})`,
      ),
    );
    expect(result.keepoutsInserted).toBe(0);
    expect(keepouts).toHaveLength(0);
    expect(codes).toContain("zone_layer_unsupported");
  });

  test("drops a rule area whose outline is self-intersecting", () => {
    const { result, keepouts, codes } = runImport(
      board(`(zone (layer "F.Cu") ${KEEPOUT_RULES} ${BOWTIE})`),
    );
    expect(result.keepoutsInserted).toBe(0);
    expect(keepouts).toHaveLength(0);
    expect(codes).toContain("zone_ring_invalid");
  });
});

describe("KiCad inspect report counts", () => {
  test("counts copper zones and rule areas separately", async () => {
    const report = await buildInspectReport(
      {
        projectFileName: "areas.kicad_pro",
        projectContent: JSON.stringify({
          meta: { filename: "areas.kicad_pro", version: 1 },
        }),
        pcbFileName: "areas.kicad_pcb",
        pcbContent: board(
          `(zone (net 2) (layers "F.Cu" "B.Cu") ${RECT})
           (zone (layer "F.Cu") ${KEEPOUT_RULES} ${RECT})
           (zone (layer "B.Cu") ${KEEPOUT_RULES} ${RECT})`,
        ),
        schematicSheets: [
          {
            fileName: "areas.kicad_sch",
            content: "(kicad_sch (version 20231120) (generator eeschema))",
          },
        ],
      },
      async () => null,
    );
    expect(report.counts.pcbZones).toBe(1);
    expect(report.counts.pcbKeepouts).toBe(2);
  });
});
