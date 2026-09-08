import { describe, expect, test } from "bun:test";
import { parseKicadPcb } from "./kicad-pcb-parser";

const HEADER = `(kicad_pcb (version 20231120) (generator pcbnew)`;
const TWO_LAYER_LAYERS = `
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user)
    (33 "F.Adhes" user)
    (44 "Edge.Cuts" user)
  )`;
const FOUR_LAYER_LAYERS = `
  (layers
    (0 "F.Cu" signal)
    (1 "In1.Cu" power)
    (2 "In2.Cu" signal)
    (31 "B.Cu" signal)
    (44 "Edge.Cuts" user)
  )`;

describe("parseKicadPcb", () => {
  test("derives 2-layer count from layers block", () => {
    const result = parseKicadPcb(`${HEADER} ${TWO_LAYER_LAYERS} )`);
    expect(result.copperLayerCount).toBe(2);
    expect(
      result.layers.find((l) => l.canonicalName === "Edge.Cuts"),
    ).toBeTruthy();
  });

  test("derives 4-layer count including In*.Cu", () => {
    const result = parseKicadPcb(`${HEADER} ${FOUR_LAYER_LAYERS} )`);
    expect(result.copperLayerCount).toBe(4);
  });

  test("parses footprint with refdes, value, and pads", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (footprint "Resistor_SMD:R_0805_2012Metric" (layer "F.Cu") (at 10 20 0)
        (property "Reference" "R1" (at 0 0 0))
        (property "Value" "10k" (at 0 0 0))
        (pad "1" smd rect (at -0.95 0 0) (size 1 1.25) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "VCC"))
        (pad "2" smd rect (at 0.95 0 0) (size 1 1.25) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "GND"))
        (model "ref.step")
      )
    )`;
    const result = parseKicadPcb(src);
    expect(result.footprints).toHaveLength(1);
    const fp = result.footprints[0]!;
    expect(fp.libId).toBe("Resistor_SMD:R_0805_2012Metric");
    expect(fp.reference).toBe("R1");
    expect(fp.value).toBe("10k");
    expect(fp.at).toEqual({ xMm: 10, yMm: 20 });
    expect(fp.pads).toHaveLength(2);
    expect(fp.pads[0]?.number).toBe("1");
    expect(fp.pads[0]?.netOrdinal).toBe(1);
    expect(fp.modelRefs).toEqual(["ref.step"]);
  });

  test("parses segment trace with resolved netName", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 1 "VCC")
      (segment (start 1 2) (end 5 2) (width 0.25) (layer "F.Cu") (net 1) (uuid "u1"))
    )`;
    const result = parseKicadPcb(src);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      start: { xMm: 1, yMm: 2 },
      end: { xMm: 5, yMm: 2 },
      widthMm: 0.25,
      layer: "F.Cu",
      netOrdinal: 1,
      netName: "VCC",
    });
  });

  test("parses through-via with resolved netName", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 3 "GND")
      (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 3) (uuid "v1"))
    )`;
    const result = parseKicadPcb(src);
    expect(result.vias).toHaveLength(1);
    expect(result.vias[0]).toMatchObject({
      at: { xMm: 10, yMm: 10 },
      sizeMm: 0.8,
      drillMm: 0.4,
      layers: ["F.Cu", "B.Cu"],
      netOrdinal: 3,
      netName: "GND",
      type: "through",
    });
  });

  test("tessellates arc track into chord segments", () => {
    // Quarter-arc from (10,0) → (0,10) via mid (~7.07, 7.07) around origin
    // (radius 10). Expected: many chord segments, originatedFromArc true.
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 5 "SDA")
      (arc (start 10 0) (mid 7.071 7.071) (end 0 10) (width 0.25) (layer "F.Cu") (net 5))
    )`;
    const result = parseKicadPcb(src);
    expect(result.segments.length).toBeGreaterThanOrEqual(8);
    for (const seg of result.segments) {
      expect(seg.originatedFromArc).toBe(true);
      expect(seg.netName).toBe("SDA");
      expect(seg.layer).toBe("F.Cu");
    }
    // First chord starts at (10,0), last chord ends at (0,10).
    expect(result.segments[0]?.start).toEqual({ xMm: 10, yMm: 0 });
    const last = result.segments[result.segments.length - 1]!;
    expect(last.end.xMm).toBeCloseTo(0);
    expect(last.end.yMm).toBeCloseTo(10);
  });

  test("falls back to fp_text reference/value (KiCad 6)", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (footprint "Resistor_SMD:R_0805_2012Metric" (layer "F.Cu") (at 10 20 0)
        (fp_text reference "R7" (at 0 0 0) (layer "F.SilkS"))
        (fp_text value "100k" (at 0 0 0) (layer "F.Fab"))
      )
    )`;
    const result = parseKicadPcb(src);
    expect(result.footprints[0]).toMatchObject({
      reference: "R7",
      value: "100k",
    });
  });

  test("collects net ordinals + names", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 1 "VCC")
      (net 2 "GND")
    )`;
    const result = parseKicadPcb(src);
    expect(result.nets).toHaveLength(3);
    expect(result.nets[1]).toMatchObject({ ordinal: 1, name: "VCC" });
  });

  test("computes board outline bounding box from Edge.Cuts gr_lines", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (gr_line (start 0 0) (end 100 0) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 100 0) (end 100 80) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 100 80) (end 0 80) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 0 80) (end 0 0) (layer "Edge.Cuts") (width 0.05))
    )`;
    const result = parseKicadPcb(src);
    expect(result.boardOutline).toEqual({
      minXMm: 0,
      minYMm: 0,
      maxXMm: 100,
      maxYMm: 80,
    });
  });

  test("parses zone with net_name, layer, and polygon outline", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 2 "GND")
      (zone (net 2) (net_name "GND") (layer "F.Cu") (hatch edge 0.508) (fill yes (mode solid)) (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))
    )`;
    const result = parseKicadPcb(src);
    expect(result.zoneCount).toBe(1);
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0]).toMatchObject({
      netName: "GND",
      layers: ["F.Cu"],
      fillModeHatch: false,
    });
    expect(result.zones[0]?.polygonPointsMm).toHaveLength(4);
  });

  test("warns when board outline missing", () => {
    const result = parseKicadPcb(`${HEADER} ${TWO_LAYER_LAYERS} )`);
    expect(result.boardOutline).toBeNull();
    expect(
      result.warnings.some((w) => w.code === "board_outline_missing"),
    ).toBe(true);
  });

  test("rejects non-pcb file", () => {
    expect(() => parseKicadPcb("(kicad_sch (version 20231120))")).toThrow(
      /Not a .kicad_pcb/,
    );
  });
});

// ─── S3a contract §8: zone / keepout import mapping ───

/** Circle through (10,0) — (12,5) — (10,10), used by the arc contour tests. */
const ARC_CIRCLE = { cx: 4.75, cy: 5, r: 7.25 };
const ARC_CONTOUR = `(polygon (pts (xy 0 0) (xy 10 0) (arc (start 10 0) (mid 12 5) (end 10 10)) (xy 0 10)))`;
const RECT_CONTOUR = `(polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10)))`;
/** Strictly inside RECT_CONTOUR — a hole. */
const HOLE_CONTOUR = `(polygon (pts (xy 3 3) (xy 7 3) (xy 7 7) (xy 3 7)))`;
/** Disjoint from RECT_CONTOUR — a second outline. */
const DISJOINT_CONTOUR = `(polygon (pts (xy 20 20) (xy 30 20) (xy 30 30) (xy 20 30)))`;

/**
 * A rectangle whose top edge is a SHALLOW arc: sagitta 0.005 mm over a 2 mm
 * chord, below the flattener's chord budget, so the inward flattening is the
 * single chord at y = 0 while the true region reaches y = 0.005.
 */
const SHALLOW_ARC_CONTOUR = `(polygon (pts (xy -1 -2) (xy 1 -2) (xy 1 0) (arc (start 1 0) (mid 0 0.005) (end -1 0))))`;
/** Strictly inside the TRUE outline above (the arc is at y ≈ 0.00495 at x = ±0.1). */
const SHALLOW_ARC_HOLE = `(polygon (pts (xy -0.1 -1) (xy 0.1 -1) (xy 0.1 0.004) (xy -0.1 0.004)))`;

/**
 * CONCAVE arc: a 10×10 square with a half-disc bitten out of its bottom edge.
 * The arc's centre (5,0) is OUTSIDE the region, so the correct construction is
 * the opposite of the convex `ARC_CONTOUR` above.
 */
const NOTCH = { cx: 5, cy: 0, r: 2 };
const NOTCH_CONTOUR = `(polygon (pts (xy 0 0) (xy 3 0) (arc (start 3 0) (mid 5 2) (end 7 0)) (xy 10 0) (xy 10 10) (xy 0 10)))`;
const NOTCH_EXACT_AREA = 100 - (Math.PI * NOTCH.r * NOTCH.r) / 2;

/**
 * Slack for the "polygon tracks the true region" checks. The area between a
 * chord ring and its arc is bounded by `sweep * r * MAX_CHORD_DEVIATION_MM`,
 * which is ~0.06 mm² for the notch and ~0.11 mm² for the bulge; the SIDE of the
 * true area is the assertion that matters, this only pins the magnitude.
 */
const AREA_SLACK = 0.2;

/** Exact area of the convex `ARC_CONTOUR`: the square plus its circular segment. */
const BULGE_SWEEP = 2 * Math.asin(5 / ARC_CIRCLE.r);
const BULGE_EXACT_AREA =
  100 +
  ((ARC_CIRCLE.r * ARC_CIRCLE.r) / 2) * (BULGE_SWEEP - Math.sin(BULGE_SWEEP));

function polygonArea(points: readonly { xMm: number; yMm: number }[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.xMm * b.yMm - b.xMm * a.yMm;
  }
  return Math.abs(twice) / 2;
}

function distanceToNotchCentre(p: { xMm: number; yMm: number }): number {
  return Math.hypot(p.xMm - NOTCH.cx, p.yMm - NOTCH.cy);
}

/** The notch's chord vertices: everything the arc emitted, ending on (7,0). */
function notchArcVertices(
  points: readonly { xMm: number; yMm: number }[],
): { xMm: number; yMm: number }[] {
  const from = points.findIndex((p) => p.xMm === 3 && p.yMm === 0);
  const to = points.findIndex((p) => p.xMm === 7 && p.yMm === 0);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return points.slice(from + 1, to + 1);
}

function parseZoneSource(body: string, layerBlock = TWO_LAYER_LAYERS) {
  return parseKicadPcb(`${HEADER}
    ${layerBlock}
    (net 0 "")
    (net 2 "GND")
    ${body}
  )`);
}

function pointToSegmentDistance(
  p: { xMm: number; yMm: number },
  a: { xMm: number; yMm: number },
  b: { xMm: number; yMm: number },
): number {
  const dx = b.xMm - a.xMm;
  const dy = b.yMm - a.yMm;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.xMm - a.xMm) * dx + (p.yMm - a.yMm) * dy) / lenSq),
        );
  return Math.hypot(p.xMm - (a.xMm + t * dx), p.yMm - (a.yMm + t * dy));
}

describe("parseKicadPcb zones", () => {
  test("splits a multi-layer zone into a layer list", () => {
    const result = parseZoneSource(
      `(zone (net 2) (net_name "GND") (layers "F.Cu" "B.Cu") ${RECT_CONTOUR})`,
    );
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0]?.layers).toEqual(["F.Cu", "B.Cu"]);
  });

  test("expands F&B.Cu to both outer layers", () => {
    const result = parseZoneSource(`(zone (layers "F&B.Cu") ${RECT_CONTOUR})`);
    expect(result.zones[0]?.layers).toEqual(["F.Cu", "B.Cu"]);
  });

  test("expands *.Cu against the file's own copper stackup", () => {
    const result = parseZoneSource(
      `(zone (layers "*.Cu") ${RECT_CONTOUR})`,
      FOUR_LAYER_LAYERS,
    );
    expect(result.zones[0]?.layers).toEqual([
      "F.Cu",
      "In1.Cu",
      "In2.Cu",
      "B.Cu",
    ]);
  });

  test("drops a zone that resolves to no copper layer", () => {
    const result = parseZoneSource(
      `(zone (layer "Edge.Cuts") (name "bad") ${RECT_CONTOUR})`,
    );
    expect(result.zones).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "zone_no_copper_layer")).toBe(
      true,
    );
  });

  test("reads name, priority, min_thickness, locked and hatch mode", () => {
    const result = parseZoneSource(
      `(zone (net 2) (net_name "GND") (layer "F.Cu") (name "pour") (priority 3)
         (locked yes) (min_thickness 0.2) (fill yes (mode hatch)) ${RECT_CONTOUR})`,
    );
    expect(result.zones[0]).toMatchObject({
      name: "pour",
      priority: 3,
      minThicknessMm: 0.2,
      locked: true,
      fillModeHatch: true,
    });
  });

  test("reads thermal gap and bridge width only as a complete pair", () => {
    const both = parseZoneSource(
      `(zone (layer "F.Cu") (fill yes (thermal_gap 0.4) (thermal_bridge_width 0.35)) ${RECT_CONTOUR})`,
    );
    expect(both.zones[0]?.thermal).toEqual({ gapMm: 0.4, spokeWidthMm: 0.35 });
    const partial = parseZoneSource(
      `(zone (layer "F.Cu") (fill yes (thermal_gap 0.4)) ${RECT_CONTOUR})`,
    );
    expect(partial.zones[0]?.thermal).toBeNull();
  });

  test.each([
    ["(connect_pads yes (clearance 0.5))", "solid", 0.5],
    ["(connect_pads no)", "none", null],
    ["(connect_pads thru_hole_only)", "thruHoleThermal", null],
    ["(connect_pads (clearance 0.3))", "thermal", 0.3],
    ["(connect_pads thermal_reliefs)", "thermal", null],
  ])("maps %s to %s", (token, padConnection, clearanceMm) => {
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${token} ${RECT_CONTOUR})`,
    );
    expect(result.zones[0]?.padConnection).toBe(
      padConnection as "solid" | "thermal" | "thruHoleThermal" | "none",
    );
    expect(result.zones[0]?.clearanceMm).toBe(clearanceMm as number | null);
  });

  test("leaves padConnection absent when the file carries no connect_pads", () => {
    const result = parseZoneSource(`(zone (layer "F.Cu") ${RECT_CONTOUR})`);
    expect(result.zones[0]?.padConnection).toBeNull();
    expect(result.zones[0]?.clearanceMm).toBeNull();
  });

  test.each([
    ["(island_removal_mode 0)", "always"],
    ["(island_removal_mode 1)", "never"],
  ])("maps fill %s to %s", (token, expected) => {
    const result = parseZoneSource(
      `(zone (layer "F.Cu") (fill yes ${token}) ${RECT_CONTOUR})`,
    );
    expect(result.zones[0]?.islandRemoval).toBe(expected as "always" | "never");
  });

  test("island_removal_mode 2 needs island_area_min", () => {
    const withArea = parseZoneSource(
      `(zone (layer "F.Cu") (fill yes (island_removal_mode 2) (island_area_min 1.5)) ${RECT_CONTOUR})`,
    );
    expect(withArea.zones[0]?.islandRemoval).toEqual({ minAreaMm2: 1.5 });
    const withoutArea = parseZoneSource(
      `(zone (layer "F.Cu") (fill yes (island_removal_mode 2)) ${RECT_CONTOUR})`,
    );
    expect(withoutArea.zones[0]?.islandRemoval).toBeNull();
  });

  test("net 0 and an empty net name are net-less copper", () => {
    const byOrdinal = parseZoneSource(
      `(zone (net 0) (net_name "") (layer "F.Cu") ${RECT_CONTOUR})`,
    );
    expect(byOrdinal.zones[0]).toMatchObject({ netOrdinal: 0, netName: null });
    const byName = parseZoneSource(
      `(zone (net 7) (layer "F.Cu") ${RECT_CONTOUR})`,
    );
    expect(byName.zones[0]?.netName).toBeNull();
  });

  test("counts a disjoint second outline as an extra contour, not a hole", () => {
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${RECT_CONTOUR} ${DISJOINT_CONTOUR})`,
    );
    expect(result.zones[0]?.extraContours).toBe(1);
    expect(result.zones[0]?.holes).toHaveLength(0);
    expect(result.zones[0]?.polygonPointsMm).toHaveLength(4);
    expect(result.zones[0]?.polygonPointsMm[0]).toEqual({ xMm: 0, yMm: 0 });
  });

  test("keeps a contour strictly inside the outline as a hole, with its points", () => {
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${RECT_CONTOUR} ${HOLE_CONTOUR})`,
    );
    expect(result.zones[0]?.holes).toHaveLength(1);
    expect(result.zones[0]?.holes[0]).toHaveLength(4);
    expect(result.zones[0]?.extraContours).toBe(0);
    expect(result.zones[0]?.polygonPointsMm).toHaveLength(4);
  });

  test("classifies holes and second outlines independently", () => {
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${RECT_CONTOUR} ${HOLE_CONTOUR} ${DISJOINT_CONTOUR})`,
    );
    expect(result.zones[0]?.holes).toHaveLength(1);
    expect(result.zones[0]?.extraContours).toBe(1);
  });

  test("a contour touching the outline edge is not a hole", () => {
    // Shares the x=0 edge with the outline, so it is not STRICTLY inside.
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${RECT_CONTOUR}
        (polygon (pts (xy 0 2) (xy 4 2) (xy 4 6) (xy 0 6))))`,
    );
    expect(result.zones[0]?.holes).toHaveLength(0);
    expect(result.zones[0]?.extraContours).toBe(1);
  });

  test("a hole the INWARD flattening of the outline crosses is still a hole", () => {
    // The outline's top is a shallow arc (sagitta 0.005 mm, under the chord
    // budget) so the inward flattening collapses it to the chord at y = 0. The
    // hole's top corners sit at y = 0.004 — inside the TRUE outline (the arc is
    // at y ≈ 0.00495 there) but ACROSS that chord. Classifying against the
    // inward points called it a second outline and dropped it, and the zone
    // then poured copper inside the drawn cutout.
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${SHALLOW_ARC_CONTOUR} ${SHALLOW_ARC_HOLE})`,
    );
    const zone = result.zones[0];
    // The scenario only bites while the inward outline really is the chord.
    expect(Math.max(...(zone?.polygonPointsMm ?? []).map((p) => p.yMm))).toBe(0);
    expect(zone?.holes).toHaveLength(1);
    expect(zone?.extraContours).toBe(0);
  });

  test("an arc-free contour flattens to exactly its xy points", () => {
    const result = parseZoneSource(`(zone (layer "F.Cu") ${RECT_CONTOUR})`);
    expect(result.zones[0]?.polygonPointsMm).toEqual([
      { xMm: 0, yMm: 0 },
      { xMm: 10, yMm: 0 },
      { xMm: 10, yMm: 10 },
      { xMm: 0, yMm: 10 },
    ]);
  });

  test("a CONCAVE arc flattens away from the notch, never into it", () => {
    // The notch centre lies outside the zone, so an inscribed chord would cut
    // across the notch and add copper the file does not draw (Astra §8).
    const result = parseZoneSource(`(zone (layer "F.Cu") ${NOTCH_CONTOUR})`);
    const pts = result.zones[0]?.polygonPointsMm ?? [];
    expect(pts.length).toBeGreaterThan(6);
    const arcPts = notchArcVertices(pts);
    expect(arcPts.length).toBeGreaterThan(3);
    for (const p of arcPts) {
      expect(distanceToNotchCentre(p)).toBeGreaterThanOrEqual(NOTCH.r - 1e-9);
    }
    // Polygon ⊆ true region: never more copper than drawn.
    expect(polygonArea(pts)).toBeLessThanOrEqual(NOTCH_EXACT_AREA + 1e-9);
    expect(polygonArea(pts)).toBeGreaterThan(NOTCH_EXACT_AREA - AREA_SLACK);
  });

  test("a CONVEX arc still yields a polygon inside the true region", () => {
    const result = parseZoneSource(`(zone (layer "F.Cu") ${ARC_CONTOUR})`);
    const area = polygonArea(result.zones[0]?.polygonPointsMm ?? []);
    expect(area).toBeLessThanOrEqual(BULGE_EXACT_AREA + 1e-9);
    expect(area).toBeGreaterThan(BULGE_EXACT_AREA - AREA_SLACK);
  });

  test("flattens a contour arc inscribed — every vertex sits on the circle", () => {
    const result = parseZoneSource(`(zone (layer "F.Cu") ${ARC_CONTOUR})`);
    const pts = result.zones[0]?.polygonPointsMm ?? [];
    expect(pts.length).toBeGreaterThan(3);
    // Everything from the arc start through the arc end is arc-derived.
    const arcPts = pts.slice(1, pts.length - 1);
    expect(arcPts.length).toBeGreaterThan(3);
    for (const p of arcPts) {
      const d = Math.hypot(p.xMm - ARC_CIRCLE.cx, p.yMm - ARC_CIRCLE.cy);
      expect(Math.abs(d - ARC_CIRCLE.r)).toBeLessThanOrEqual(0.01);
      expect(d).toBeLessThanOrEqual(ARC_CIRCLE.r + 1e-9);
    }
    expect(pts[pts.length - 2]).toEqual({ xMm: 10, yMm: 10 });
  });
});

describe("parseKicadPcb keepouts", () => {
  const KEEPOUT_RULES = `(keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))`;

  test("classifies a rule area as a keepout, not a zone", () => {
    const result = parseZoneSource(
      `(zone (layers "F.Cu" "B.Cu") (name "no-go") ${KEEPOUT_RULES} ${RECT_CONTOUR})`,
    );
    expect(result.zones).toHaveLength(0);
    expect(result.zoneCount).toBe(0);
    expect(result.keepoutCount).toBe(1);
    expect(result.keepouts[0]).toMatchObject({
      name: "no-go",
      layers: ["F.Cu", "B.Cu"],
      locked: false,
      restrictions: {
        tracks: true,
        vias: true,
        pads: false,
        copperPour: true,
        footprints: false,
      },
    });
  });

  test("missing restriction tokens default to allowed", () => {
    const result = parseZoneSource(
      `(zone (layer "F.Cu") (keepout (tracks not_allowed)) ${RECT_CONTOUR})`,
    );
    expect(result.keepouts[0]?.restrictions).toEqual({
      tracks: true,
      vias: false,
      pads: false,
      copperPour: false,
      footprints: false,
    });
  });

  test("counts every further contour, hole or not, as an extra contour", () => {
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${KEEPOUT_RULES} ${RECT_CONTOUR} ${HOLE_CONTOUR})`,
    );
    expect(result.keepouts[0]?.extraContours).toBe(1);
    expect(result.keepouts[0]?.polygonPointsMm).toHaveLength(4);
  });

  test("keeps non-copper layers so the insert step can warn", () => {
    const result = parseZoneSource(
      `(zone (layers "F.Cu" "Edge.Cuts") ${KEEPOUT_RULES} ${RECT_CONTOUR})`,
    );
    expect(result.keepouts[0]?.layers).toEqual(["F.Cu", "Edge.Cuts"]);
  });

  test("a CONCAVE arc flattens into the notch, never away from it", () => {
    // The mirror of the zone case: a rule area may never lose forbidden area,
    // so across a notch it takes the inscribed side.
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${KEEPOUT_RULES} ${NOTCH_CONTOUR})`,
    );
    const pts = result.keepouts[0]?.polygonPointsMm ?? [];
    expect(pts.length).toBeGreaterThan(6);
    const arcPts = notchArcVertices(pts);
    expect(arcPts.length).toBeGreaterThan(3);
    for (const p of arcPts) {
      expect(distanceToNotchCentre(p)).toBeLessThanOrEqual(NOTCH.r + 1e-9);
    }
    // Polygon ⊇ true region: never a smaller forbidden area than drawn.
    expect(polygonArea(pts)).toBeGreaterThanOrEqual(NOTCH_EXACT_AREA - 1e-9);
    expect(polygonArea(pts)).toBeLessThan(NOTCH_EXACT_AREA + AREA_SLACK);
  });

  test("a CONVEX arc still yields a polygon enclosing the true region", () => {
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${KEEPOUT_RULES} ${ARC_CONTOUR})`,
    );
    const area = polygonArea(result.keepouts[0]?.polygonPointsMm ?? []);
    expect(area).toBeGreaterThanOrEqual(BULGE_EXACT_AREA - 1e-9);
    expect(area).toBeLessThan(BULGE_EXACT_AREA + AREA_SLACK);
  });

  test("flattens a contour arc circumscribed — every chord is tangent", () => {
    const result = parseZoneSource(
      `(zone (layer "F.Cu") ${KEEPOUT_RULES} ${ARC_CONTOUR})`,
    );
    const pts = result.keepouts[0]?.polygonPointsMm ?? [];
    expect(pts.length).toBeGreaterThan(3);
    const center = { xMm: ARC_CIRCLE.cx, yMm: ARC_CIRCLE.cy };
    // Vertices 1..len-2 span the arc: (10,0) → tangent chain → (10,10).
    for (let i = 1; i < pts.length - 2; i += 1) {
      const d = pointToSegmentDistance(center, pts[i]!, pts[i + 1]!);
      expect(Math.abs(d - ARC_CIRCLE.r)).toBeLessThanOrEqual(1e-9);
    }
    // Tangent vertices lie strictly outside the circle.
    for (let i = 2; i < pts.length - 2; i += 1) {
      const p = pts[i]!;
      const d = Math.hypot(p.xMm - ARC_CIRCLE.cx, p.yMm - ARC_CIRCLE.cy);
      expect(d).toBeGreaterThan(ARC_CIRCLE.r);
    }
    expect(pts[pts.length - 2]).toEqual({ xMm: 10, yMm: 10 });
  });
});
