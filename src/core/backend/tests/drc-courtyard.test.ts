/**
 * DFM contract 11 §2 — courtyard REGIONS and `COURTYARD_OVERLAP` /
 * `COURTYARD_INVALID`.
 *
 * The region is not the S4 convex hull: it keeps a donut's hole and a
 * connector's cut-out, so parts that nest correctly pass. The two things this
 * file is really about are (a) that the loose graphics chain into the rings the
 * footprint drew, with the depth orientation that makes their NonZero union the
 * filled area, and (b) that nothing fails open — malformed geometry is judged
 * on the superset hull and said so, and a kernel refusal is reported, never
 * swallowed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { parseKicadFootprint } from "@openpcb/kicad-parsers";
import type { DrcReport, PcbPlacedPart, PcbPointMm } from "../../../sdks/designer";
import { placementCourtyardWorldMm } from "../../../shared/pcb-geometry/courtyard";
import type { RawFootprintLookup } from "../../../shared/pcb-geometry/courtyard";
import { placementCourtyardRegionsMm } from "../../../shared/pcb-geometry/courtyard-rings";
import { pointInPolygon } from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import { ringSignedArea } from "../../../shared/pcb-geometry/ring-utils";
import { checkCourtyard } from "../../../shared/drc/checks/courtyard";
import { buildDrcContext } from "../../../shared/drc/drc-context";
import { runDrc } from "../../../shared/drc/drc-engine";
import { finalizeReport } from "../../../shared/drc/drc-engine";
import { pad, projection } from "./helpers/drc-fixtures";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped render model */
function part(
  graphics: unknown[],
  overrides: Record<string, unknown> = {},
  extra: { pads?: unknown[]; bounds?: unknown } = {},
): PcbPlacedPart {
  return {
    id: "p1",
    partId: "p1",
    componentId: "c",
    reference: "U1",
    layer: "F.Cu",
    positionMm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    ...overrides,
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: extra.pads ?? [],
        graphics,
        labels: [],
        bounds: extra.bounds ?? null,
        warnings: [],
      },
    },
  } as unknown as PcbPlacedPart;
}

const line = (
  layer: string,
  a: [number, number],
  b: [number, number],
): unknown => ({
  kind: "line",
  layer,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  strokeWidthMm: 0.05,
});

/** A rectangle drawn as four independent lines — how a footprint draws one. */
function rectLines(
  layer: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): unknown[] {
  return [
    line(layer, [x0, y0], [x1, y0]),
    line(layer, [x1, y0], [x1, y1]),
    line(layer, [x1, y1], [x0, y1]),
    line(layer, [x0, y1], [x0, y0]),
  ];
}

const arc3 = (
  layer: string,
  start: [number, number],
  mid: [number, number],
  end: [number, number],
): unknown => ({
  kind: "arc3",
  layer,
  start: { x: start[0], y: start[1] },
  mid: { x: mid[0], y: mid[1] },
  end: { x: end[0], y: end[1] },
  strokeWidthMm: 0.05,
});

function boundsOf(ring: readonly PcbPointMm[]) {
  return {
    minX: Math.min(...ring.map((p) => p.x)),
    maxX: Math.max(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)),
    maxY: Math.max(...ring.map((p) => p.y)),
  };
}

describe("courtyard regions — assembly (§2.1)", () => {
  test("four loose lines chain into one CCW rectangle ring", () => {
    const r = placementCourtyardRegionsMm(part(rectLines("F.CrtYd", -2, -1, 2, 1)));
    expect(r.source).toBe("courtyard");
    expect(r.malformed).toBe(false);
    expect(r.bottom).toEqual([]);
    expect(r.top).toHaveLength(1);
    expect(ringSignedArea(r.top[0]!)).toBeCloseTo(8, 6);
    expect(boundsOf(r.top[0]!)).toEqual({ minX: -2, maxX: 2, minY: -1, maxY: 1 });
  });

  test("a circle bypasses chaining and lands as one S2 ring", () => {
    const r = placementCourtyardRegionsMm(
      part([
        {
          kind: "circle",
          layer: "F.CrtYd",
          center: { x: 0, y: 0 },
          radiusMm: 2,
          fill: "none",
          strokeWidthMm: 0.05,
        },
      ]),
    );
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(1);
    // The S2 chord rule, not the old fixed 16-gon.
    expect(r.top[0]!.length).toBeGreaterThan(16);
    // Unbiased (inscribed): just inside the true disc, by the chord tolerance.
    const areaMm2 = Math.abs(ringSignedArea(r.top[0]!));
    expect(areaMm2).toBeLessThan(Math.PI * 4);
    expect(areaMm2).toBeGreaterThan(Math.PI * 4 - 0.1);
  });

  test("two OPPOSITE semicircles are not duplicates — they close a circle", () => {
    // Same endpoints and centre, opposite sweep: an endpoint-only de-duplication
    // would delete one and leave an open chain (Astra run 1 #16).
    const r = placementCourtyardRegionsMm(
      part([
        arc3("F.CrtYd", [-2, 0], [0, 2], [2, 0]),
        arc3("F.CrtYd", [2, 0], [0, -2], [-2, 0]),
      ]),
    );
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(1);
    const areaMm2 = Math.abs(ringSignedArea(r.top[0]!));
    expect(areaMm2).toBeLessThan(Math.PI * 4);
    expect(areaMm2).toBeGreaterThan(Math.PI * 4 - 0.1);
  });

  test("a duplicated straight edge is dropped and the loop still closes", () => {
    const graphics = rectLines("F.CrtYd", -2, -1, 2, 1);
    // The same edge again, drawn backwards.
    graphics.push(line("F.CrtYd", [2, -1], [-2, -1]));
    const r = placementCourtyardRegionsMm(part(graphics));
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(1);
    expect(ringSignedArea(r.top[0]!)).toBeCloseTo(8, 6);
  });

  test("a donut: the inner ring is oriented CW so the hole survives the union", () => {
    const r = placementCourtyardRegionsMm(
      part([
        ...rectLines("F.CrtYd", -3, -2, 3, 2),
        ...rectLines("F.CrtYd", -1, -0.5, 1, 0.5),
      ]),
    );
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(2);
    const outer = r.top.find((ring) => Math.abs(ringSignedArea(ring)) > 10)!;
    const inner = r.top.find((ring) => Math.abs(ringSignedArea(ring)) < 10)!;
    expect(ringSignedArea(outer)).toBeGreaterThan(0);
    expect(ringSignedArea(inner)).toBeLessThan(0);
  });

  test("two OVERLAPPING exterior rings are both material (depth 0), not a hole", () => {
    // A body outline plus a mating-area outline. Even-odd would cancel the
    // overlap into a void (Astra run 1 #14).
    const r = placementCourtyardRegionsMm(
      part([
        ...rectLines("F.CrtYd", -3, -1, 1, 1),
        ...rectLines("F.CrtYd", -1, -1, 3, 1),
      ]),
    );
    expect(r.top).toHaveLength(2);
    for (const ring of r.top) expect(ringSignedArea(ring)).toBeGreaterThan(0);
  });

  test("an open chain is malformed and falls back to the superset hull", () => {
    const r = placementCourtyardRegionsMm(
      part(rectLines("F.CrtYd", -2, -1, 2, 1).slice(0, 3)),
    );
    expect(r.malformed).toBe(true);
    expect(r.source).toBe("courtyard");
    expect(r.top).toHaveLength(1);
    // The hull of the three lines' endpoints still contains the drawn area.
    expect(boundsOf(r.top[0]!)).toEqual({ minX: -2, maxX: 2, minY: -1, maxY: 1 });
  });

  test("a closed polyline that REPEATS its first point is not malformed", () => {
    // `kicad-import` closes every polyline by repeating `points[0]`, so the
    // wrap edge is zero-length. Treating the chainer's diagnostic about it as a
    // malformation condemned every imported courtyard to its bounding hull.
    const u: Array<[number, number]> = [
      [-2, -2],
      [2, -2],
      [2, 2],
      [1, 2],
      [1, -1],
      [-1, -1],
      [-1, 2],
      [-2, 2],
    ];
    const poly = (points: Array<[number, number]>) => ({
      kind: "polyline",
      layer: "F.CrtYd",
      points: points.map(([x, y]) => ({ x, y })),
      closed: true,
      fill: "none",
      strokeWidthMm: 0.05,
    });
    const open = placementCourtyardRegionsMm(part([poly(u)]));
    const repeated = placementCourtyardRegionsMm(part([poly([...u, u[0]!])]));
    for (const r of [open, repeated]) {
      expect(r.malformed).toBe(false);
      expect(r.source).toBe("courtyard");
      expect(r.top).toHaveLength(1);
      expect(Math.abs(ringSignedArea(r.top[0]!))).toBeCloseTo(4 * 4 - 2 * 3, 6);
      // The U's cut-out stays a cut-out.
      expect(pointInPolygon({ x: 0, y: 1 }, r.top[0]!)).toBe(false);
    }
    // …and a part sitting IN the cut-out does not overlap the U.
    const uPart = part([poly(u)], { id: "U", partId: "U", reference: "U" });
    const inside = rectPart("IN", { x: 0, y: 1 }, { w: 0.4, h: 0.4 });
    expect(courtyardReport([uPart, inside]).violations).toEqual([]);
  });

  test("an internal duplicate vertex is compacted, not malformed", () => {
    const r = placementCourtyardRegionsMm(
      part([
        {
          kind: "polyline",
          layer: "F.CrtYd",
          points: [
            { x: -2, y: -1 },
            { x: 2, y: -1 },
            // The same vertex twice — a zero-length edge to the chainer.
            { x: 2, y: 1 },
            { x: 2, y: 1 },
            { x: -2, y: 1 },
          ],
          closed: true,
          fill: "none",
          strokeWidthMm: 0.05,
        },
      ]),
    );
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(1);
    expect(Math.abs(ringSignedArea(r.top[0]!))).toBeCloseTo(8, 6);
  });

  test("a stray zero-length fp_line among four good ones is not malformed", () => {
    const graphics = [
      ...rectLines("F.CrtYd", -2, -1, 2, 1),
      line("F.CrtYd", [0.5, 0.5], [0.5, 0.5]),
    ];
    const r = placementCourtyardRegionsMm(part(graphics));
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(1);
    expect(ringSignedArea(r.top[0]!)).toBeCloseTo(8, 6);
  });

  test("a BRANCH is malformed even though the chainer closes a loop", () => {
    const graphics = [
      ...rectLines("F.CrtYd", -2, -1, 2, 1),
      // A fifth edge into an existing vertex: three edges meet at (2, -1).
      line("F.CrtYd", [2, -1], [4, -3]),
    ];
    const r = placementCourtyardRegionsMm(part(graphics));
    expect(r.malformed).toBe(true);
  });
});

describe("courtyard regions — face mapping (§1.1, §2.1)", () => {
  test("a mirrored F.Cu placement mirrors in X and STAYS on the top face", () => {
    const r = placementCourtyardRegionsMm(
      part(rectLines("F.CrtYd", 1, -1, 3, 1), { mirrored: true }),
    );
    expect(r.bottom).toEqual([]);
    expect(boundsOf(r.top[0]!)).toEqual({ minX: -3, maxX: -1, minY: -1, maxY: 1 });
  });

  test("a B.Cu placement swaps both sides", () => {
    const r = placementCourtyardRegionsMm(
      part(
        [
          ...rectLines("F.CrtYd", 1, -1, 3, 1),
          ...rectLines("B.CrtYd", -3, -1, -1, 1),
        ],
        { layer: "B.Cu" },
      ),
    );
    // F.CrtYd → bottom, B.CrtYd → top, and both are mirrored in X.
    expect(boundsOf(r.bottom[0]!)).toEqual({ minX: -3, maxX: -1, minY: -1, maxY: 1 });
    expect(boundsOf(r.top[0]!)).toEqual({ minX: 1, maxX: 3, minY: -1, maxY: 1 });
  });
});

describe("courtyard regions — fallback (§2.1)", () => {
  test("no courtyard: the preview bounds inflated by the rule, rotated", () => {
    const r = placementCourtyardRegionsMm(
      part([], { rotationDeg: 90 }, { bounds: { minX: -2, minY: -1, maxX: 2, maxY: 1 } }),
      undefined,
      0.25,
    );
    expect(r.source).toBe("fallback");
    expect(r.malformed).toBe(false);
    // 4.5 x 2.5 rotated by 90° is 2.5 x 4.5.
    expect(boundsOf(r.top[0]!)).toEqual({
      minX: -1.25,
      maxX: 1.25,
      minY: -2.25,
      maxY: 2.25,
    });
  });

  test("no bounds either: the PAD box, inflated the same way", () => {
    const r = placementCourtyardRegionsMm(
      part([], {}, { pads: [pad("1", { x: 0, y: 0 }, 2, 1)] }),
      undefined,
      0.25,
    );
    expect(r.source).toBe("fallback");
    expect(boundsOf(r.top[0]!)).toEqual({
      minX: -1.25,
      maxX: 1.25,
      minY: -0.75,
      maxY: 0.75,
    });
  });

  test("the fallback lands on the placement's OWN face only", () => {
    const r = placementCourtyardRegionsMm(
      part([], { layer: "B.Cu" }, { bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 } }),
      undefined,
      0.25,
    );
    expect(r.top).toEqual([]);
    expect(r.bottom).toHaveLength(1);
  });

  test("an empty model has no courtyard at all — not evaluated (§10)", () => {
    const r = placementCourtyardRegionsMm(part([]));
    expect(r).toEqual({ top: [], bottom: [], source: null, malformed: false });
  });
});

// =========================================================================
// The check
// =========================================================================

function courtyardReport(placements: PcbPlacedPart[]): DrcReport {
  const ctx = buildDrcContext(projection({ placements }));
  return finalizeReport(checkCourtyard(ctx), {
    designId: "t",
    revision: 1,
    ignoredRuleClasses: [],
    waivedIds: [],
    severityOverrides: undefined,
  });
}

function rectPart(
  id: string,
  at: { x: number; y: number },
  half: { w: number; h: number },
  overrides: Record<string, unknown> = {},
): PcbPlacedPart {
  return part(rectLines("F.CrtYd", -half.w, -half.h, half.w, half.h), {
    id,
    partId: id,
    reference: id,
    positionMm: at,
    ...overrides,
  });
}

describe("checkCourtyard (§2.2)", () => {
  test("TOUCHING courtyards pass; a real overlap is an error", () => {
    const touching = courtyardReport([
      rectPart("A", { x: 0, y: 0 }, { w: 1, h: 1 }),
      rectPart("B", { x: 2, y: 0 }, { w: 1, h: 1 }),
    ]);
    expect(touching.violations).toEqual([]);

    const overlapping = courtyardReport([
      rectPart("A", { x: 0, y: 0 }, { w: 1, h: 1 }),
      rectPart("B", { x: 1.5, y: 0 }, { w: 1, h: 1 }),
    ]);
    expect(overlapping.violations.map((v) => v.code)).toEqual([
      "COURTYARD_OVERLAP",
    ]);
    const v = overlapping.violations[0]!;
    expect(v.severity).toBe("error");
    expect(v.layer).toBe("F.Cu");
    // 0.5 x 2 overlap, centred at x = 0.75.
    expect(v.message).toContain("1.0000 mm²");
    expect(v.locationMm!.x).toBeCloseTo(0.75, 6);
    expect(v.locationMm!.y).toBeCloseTo(0, 6);
    // The intersection is an AREA, not a length: it must not masquerade as one.
    expect(v.measuredMm).toBeUndefined();
  });

  test("a donut's hole is a hole: a part inside it does not overlap", () => {
    const donut = part(
      [
        ...rectLines("F.CrtYd", -3, -2, 3, 2),
        ...rectLines("F.CrtYd", -1.5, -1, 1.5, 1),
      ],
      { id: "RING", partId: "RING", reference: "RING" },
    );
    const inner = rectPart("IN", { x: 0, y: 0 }, { w: 0.5, h: 0.5 });
    expect(courtyardReport([donut, inner]).violations).toEqual([]);
    // The same part moved onto the donut's material DOES overlap.
    const onMaterial = rectPart("IN", { x: 2.2, y: 0 }, { w: 0.5, h: 0.5 });
    expect(courtyardReport([donut, onMaterial]).violations.map((v) => v.code)).toEqual([
      "COURTYARD_OVERLAP",
    ]);
  });

  test("courtyards on opposite faces never meet", () => {
    const top = rectPart("A", { x: 0, y: 0 }, { w: 1, h: 1 });
    const bottom = part(rectLines("F.CrtYd", -1, -1, 1, 1), {
      id: "B",
      partId: "B",
      reference: "B",
      layer: "B.Cu",
      positionMm: { x: 0, y: 0 },
    });
    expect(courtyardReport([top, bottom]).violations).toEqual([]);
  });

  test("equal-area lobes pick the smaller (x, y) centroid — a total order", () => {
    // An H-shaped courtyard crossed by a bar: two identical overlap lobes at
    // x = ±2. Either could be emitted first; the tie-break fixes the marker.
    const h = part(
      [
        ...rectLines("F.CrtYd", -3, -2, -1, 2),
        ...rectLines("F.CrtYd", 1, -2, 3, 2),
      ],
      { id: "H", partId: "H", reference: "H" },
    );
    const bar = rectPart("BAR", { x: 0, y: 0 }, { w: 4, h: 0.5 });
    const report = courtyardReport([h, bar]);
    expect(report.violations.map((v) => v.code)).toEqual(["COURTYARD_OVERLAP"]);
    expect(report.violations[0]!.locationMm!.x).toBeCloseTo(-2, 6);
  });

  test("malformed geometry reports COURTYARD_INVALID and still gets judged", () => {
    const broken = part(rectLines("F.CrtYd", -1, -1, 1, 1).slice(0, 3), {
      id: "BAD",
      partId: "BAD",
      reference: "BAD",
      positionMm: { x: 0, y: 0 },
    });
    const neighbour = rectPart("N", { x: 1.5, y: 0 }, { w: 1, h: 1 });
    const report = courtyardReport([broken, neighbour]);
    const codes = report.violations.map((v) => v.code).sort();
    expect(codes).toEqual(["COURTYARD_INVALID", "COURTYARD_OVERLAP"]);
    const invalid = report.violations.find((v) => v.code === "COURTYARD_INVALID")!;
    expect(invalid.severity).toBe("warning");
    // A structural verdict about one part: no face, no location bucket.
    expect(invalid.layer).toBeUndefined();
    expect(invalid.anchors).toEqual([{ kind: "placement", placementId: "BAD" }]);
  });

  test("a kernel refusal reports COURTYARD_INVALID for BOTH parts, never a pass", () => {
    // Coordinates past Clipper's scaled-integer range: the boolean throws, and
    // the pair must be reported as unevaluated rather than silently cleared.
    const far = 1e12;
    const report = courtyardReport([
      rectPart("A", { x: far, y: 0 }, { w: 1, h: 1 }),
      rectPart("B", { x: far + 1.5, y: 0 }, { w: 1, h: 1 }),
    ]);
    expect(report.violations.map((v) => v.code)).toEqual([
      "COURTYARD_INVALID",
      "COURTYARD_INVALID",
    ]);
    expect(report.violations.every((v) => v.message.includes("could not be evaluated"))).toBe(
      true,
    );
  });

  test("the check reaches runDrc as the `dfm` class", () => {
    const report = runDrc(
      projection({
        placements: [
          rectPart("A", { x: 0, y: 0 }, { w: 1, h: 1 }),
          rectPart("B", { x: 1.5, y: 0 }, { w: 1, h: 1 }),
        ],
      }),
    );
    const v = report.violations.find((x) => x.code === "COURTYARD_OVERLAP");
    expect(v?.ruleClass).toBe("dfm");
  });
});

describe("courtyard regions — the hull contract is unchanged (§2.1)", () => {
  test("the region keeps a concavity the S4 hull fills", () => {
    // An L: the hull would claim the missing quadrant.
    const l = part([
      line("F.CrtYd", [-2, -2], [2, -2]),
      line("F.CrtYd", [2, -2], [2, 0]),
      line("F.CrtYd", [2, 0], [0, 0]),
      line("F.CrtYd", [0, 0], [0, 2]),
      line("F.CrtYd", [0, 2], [-2, 2]),
      line("F.CrtYd", [-2, 2], [-2, -2]),
    ]);
    const r = placementCourtyardRegionsMm(l);
    expect(r.malformed).toBe(false);
    expect(pointInPolygon({ x: 1, y: 1 }, r.top[0]!)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 1 }, r.top[0]!)).toBe(true);
  });
});

// =========================================================================
// The RAW (KiCad-parsed) path — contract §2.1's second provenance
// =========================================================================

/**
 * The KiCad import whitelist drops `F.CrtYd` / `B.CrtYd` before persistence, so
 * an imported placement's own render model has NO courtyard and the only copy
 * is the parsed row in `library_footprints.data_json.raw`. That row holds the
 * PARSER's shape — `start: [x, y]`, `pts: [["xy", x, y], …]`, never `{x, y}` —
 * which both raw readers used to read as `data.start.x`, i.e. `undefined`.
 * Every KiCad-imported part therefore fell through to its bounding box.
 *
 * These cases run the REAL parser over real `.kicad_mod` files from the
 * vendored library, so the shape cannot drift back without failing here.
 */
const LIB_DIR = path.resolve(import.meta.dir, "fixtures/library");

/** The lookup value the designer's `buildRawFootprintLookup` hands the kernel. */
function rawLookupFromKicad(file: string): RawFootprintLookup {
  const parsed = parseKicadFootprint(
    readFileSync(path.join(LIB_DIR, file), "utf8"),
  );
  return () => ({ raw: parsed as unknown as Record<string, unknown> });
}

/** The same, from a whole PERSISTED row (`data_json`) rather than a re-parse. */
function rawLookupFromRow(file: string): RawFootprintLookup {
  const row = JSON.parse(readFileSync(path.join(LIB_DIR, file), "utf8"));
  return () => row as Record<string, unknown>;
}

/** An imported placement: pads and graphics stripped, exactly as persisted. */
function importedPart(id = "p1", at = { x: 0, y: 0 }): PcbPlacedPart {
  return part([], { id, partId: id, reference: id, positionMm: at });
}

describe("raw KiCad courtyards (§2.1)", () => {
  test("fp_rect: the parser's `[x, y]` arrays yield the exact ring", () => {
    const lookup = rawLookupFromKicad("BatteryClip_Keystone_54_D16-19mm.kicad_mod");
    const r = placementCourtyardRegionsMm(importedPart(), lookup, 0.25);
    expect(r.source).toBe("courtyard");
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(1);
    // `(fp_rect (start 9.92 10) (end -4.18 -10) … (layer "F.CrtYd"))`.
    expect(boundsOf(r.top[0]!)).toEqual({
      minX: -4.18,
      maxX: 9.92,
      minY: -10,
      maxY: 10,
    });
    expect(Math.abs(ringSignedArea(r.top[0]!))).toBeCloseTo(14.1 * 20, 6);
  });

  test("fp_poly: `pts` of `[\"xy\", x, y]` keeps the CONCAVE ring", () => {
    const lookup = rawLookupFromKicad("SW_TH_Tactile_Omron_B3F-110x.kicad_mod");
    const r = placementCourtyardRegionsMm(importedPart(), lookup, 0.25);
    expect(r.source).toBe("courtyard");
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(1);
    expect(r.top[0]).toHaveLength(8);
    // The actuator boss (x ∈ [2.15, 4.35]) stands above an otherwise flat top
    // edge at y = 5.7, so the corner beside it is a real concavity: the region
    // excludes it and the S4 convex hull swallows it. This is the whole reason
    // the check cannot use the hull (§2.1).
    const corner = { x: 1.0, y: 6.5 };
    expect(pointInPolygon(corner, r.top[0]!)).toBe(false);
    const hull = placementCourtyardWorldMm(importedPart(), lookup, {
      superset: true,
    })!;
    expect(pointInPolygon(corner, hull)).toBe(true);
  });

  test("fp_arc + fp_line chain into one closed ring", () => {
    const lookup = rawLookupFromKicad(
      "BatteryHolder_ComfortableElectronic_CH273-2450_1x2450.kicad_mod",
    );
    const r = placementCourtyardRegionsMm(importedPart(), lookup, 0.25);
    expect(r.source).toBe("courtyard");
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(1);
    // The arc is sampled by the S2 kernel, so the ring is far richer than the
    // handful of vertices the raw graphics name.
    expect(r.top[0]!.length).toBeGreaterThan(20);
  });

  test("fp_circle, from a whole PERSISTED library row", () => {
    const lookup = rawLookupFromRow("mountinghole-m3.fp.json");
    const r = placementCourtyardRegionsMm(importedPart(), lookup, 0.25);
    expect(r.source).toBe("courtyard");
    expect(r.malformed).toBe(false);
    expect(r.top).toHaveLength(1);
    // `(fp_circle (center 0 0) (end 3.45 0) … (layer "F.CrtYd"))` — r = 3.45,
    // sampled unbiased, so just inside the true disc by the chord tolerance.
    const exact = Math.PI * 3.45 * 3.45;
    const areaMm2 = Math.abs(ringSignedArea(r.top[0]!));
    expect(areaMm2).toBeLessThan(exact);
    expect(areaMm2).toBeGreaterThan(exact - 0.2);
  });

  test("the S4 HULL reads the same row — it had the same bug", () => {
    for (const lookup of [
      rawLookupFromKicad("BatteryClip_Keystone_54_D16-19mm.kicad_mod"),
      rawLookupFromKicad("SW_TH_Tactile_Omron_B3F-110x.kicad_mod"),
      rawLookupFromRow("mountinghole-m3.fp.json"),
    ]) {
      const hull = placementCourtyardWorldMm(importedPart(), lookup, {
        superset: true,
      });
      expect(hull).not.toBeNull();
      expect(hull!.length).toBeGreaterThanOrEqual(4);
    }
  });

  test("end to end: two imported parts overlap; one alone is clean", () => {
    const lookup = rawLookupFromKicad("BatteryClip_Keystone_54_D16-19mm.kicad_mod");
    const withLookup = (placements: PcbPlacedPart[]): DrcReport => {
      const ctx = buildDrcContext(projection({ placements }), {
        lookupRawFootprint: lookup,
      });
      return finalizeReport(checkCourtyard(ctx), {
        designId: "t",
        revision: 1,
        ignoredRuleClasses: [],
        waivedIds: [],
        severityOverrides: undefined,
      });
    };
    // The courtyard spans x ∈ [-4.18, 9.92]: 10 mm apart they overlap.
    const overlapping = withLookup([
      importedPart("A", { x: 0, y: 0 }),
      importedPart("B", { x: 10, y: 0 }),
    ]);
    expect(overlapping.violations.map((v) => v.code)).toEqual([
      "COURTYARD_OVERLAP",
    ]);
    // A lone imported part is silent — in particular NOT `COURTYARD_INVALID`,
    // which is what a raw reader that parsed nothing used to produce.
    expect(withLookup([importedPart("A", { x: 0, y: 0 })]).violations).toEqual([]);
    // …and 20 mm apart they clear.
    expect(
      withLookup([
        importedPart("A", { x: 0, y: 0 }),
        importedPart("B", { x: 20, y: 0 }),
      ]).violations,
    ).toEqual([]);
  });
});
