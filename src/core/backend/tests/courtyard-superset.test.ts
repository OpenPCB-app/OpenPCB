/**
 * The keepout `footprints` extent must be a SUPERSET of the part (zone/keepout
 * contract §4, §13.1). A plain courtyard hull is not: an `arc3` contributes only
 * its three defining points and a circle an inscribed 16-gon (R1 finding, S4).
 * `placementCourtyardWorldMm(…, { superset: true })` flattens both outward.
 */
import { describe, expect, test } from "bun:test";
import type { PcbPlacedPart } from "../../../sdks/designer";
import { placementCourtyardWorldMm } from "../../../modules/designer/backend/pcb/courtyard";
import { placementKeepoutExtentMm } from "../../../modules/designer/backend/pcb/placement-extent";
import { pointInPolygon } from "../../../shared/pcb-geometry/pcb-clearance-geometry";

function part(graphics: unknown[], overrides: Partial<PcbPlacedPart> = {}): PcbPlacedPart {
  return {
    id: "p1",
    reference: "U1",
    layer: "F.Cu",
    positionMm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    footprint: { footprintId: "fp", preview: { graphics, bounds: null, pads: [] } },
  } as unknown as PcbPlacedPart;
}

/** Semicircle of radius 1 about (10, 5), bulging to +y, closed by its chord. */
const SEMI = [
  {
    kind: "arc3",
    layer: "F.CrtYd",
    start: { x: 9, y: 5 },
    mid: { x: 10, y: 6 },
    end: { x: 11, y: 5 },
    strokeWidthMm: 0.05,
  },
  { kind: "line", layer: "F.CrtYd", a: { x: 9, y: 5 }, b: { x: 11, y: 5 }, strokeWidthMm: 0.05 },
];

/**
 * A point of the true arc, pulled inward by 1e-6 mm: the circumscribed chain is
 * TANGENT to the arc at the chord angles, and `pointInPolygon` is strict on the
 * boundary, so the exact tangent points would read as "outside".
 */
const INSIDE = 1 - 1e-6;
function arcPoint(deg: number, scale = INSIDE) {
  const a = (deg * Math.PI) / 180;
  return { x: 10 + scale * Math.cos(a), y: 5 + scale * Math.sin(a) };
}

describe("courtyard superset flattening", () => {
  test("a plain hull misses the arc bulge; the superset hull contains it", () => {
    const plain = placementCourtyardWorldMm(part(SEMI));
    const superset = placementCourtyardWorldMm(part(SEMI), undefined, { superset: true });
    expect(plain).not.toBeNull();
    expect(superset).not.toBeNull();
    const probe = arcPoint(45, 1);
    expect(pointInPolygon(probe, plain!)).toBe(false);
    for (let deg = 1; deg < 180; deg += 3) {
      expect(pointInPolygon(arcPoint(deg), superset!)).toBe(true);
    }
  });

  test("the superset arc chain sweeps through mid, not the long way round", () => {
    // A hull that went the long way would contain (10, 3.5) below the chord.
    const superset = placementCourtyardWorldMm(part(SEMI), undefined, { superset: true })!;
    expect(pointInPolygon({ x: 10, y: 3.5 }, superset)).toBe(false);
  });

  test("a circle courtyard: every point of the true circle is inside the superset hull", () => {
    const circle = [
      { kind: "circle", layer: "F.CrtYd", center: { x: 0, y: 0 }, radiusMm: 5, strokeWidthMm: 0.05 },
    ];
    const plain = placementCourtyardWorldMm(part(circle))!;
    const superset = placementCourtyardWorldMm(part(circle), undefined, { superset: true })!;
    // Inscribed 16-gon: the edge midpoint at 11.25° sits 0.096 mm inside the circle.
    const mid = { x: 5 * Math.cos(Math.PI / 16), y: 5 * Math.sin(Math.PI / 16) };
    expect(pointInPolygon(mid, plain)).toBe(false);
    for (let deg = 0; deg < 360; deg += 3) {
      const a = (deg * Math.PI) / 180;
      const r = 5 * INSIDE; // tangent points sit exactly on an edge (strict test)
      expect(pointInPolygon({ x: r * Math.cos(a), y: r * Math.sin(a) }, superset)).toBe(true);
    }
  });

  test("the keepout extent uses the superset hull (rotated and mirrored)", () => {
    for (const rotationDeg of [0, 90, 180, 270, 37]) {
      for (const layer of ["F.Cu", "B.Cu"] as const) {
        const p = part(SEMI, { rotationDeg, layer, mirrored: layer === "B.Cu" });
        const extent = placementKeepoutExtentMm(p, []);
        const reference = placementCourtyardWorldMm(p, undefined, { superset: true });
        expect(extent).toEqual(reference);
        expect(extent!.length).toBeGreaterThan(3);
      }
    }
  });

  test("collinear arc points fall back to the three points", () => {
    const flat = [
      {
        kind: "arc3",
        layer: "F.CrtYd",
        start: { x: 0, y: 0 },
        mid: { x: 1, y: 0 },
        end: { x: 2, y: 0 },
        strokeWidthMm: 0.05,
      },
      { kind: "line", layer: "F.CrtYd", a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, strokeWidthMm: 0.05 },
    ];
    const superset = placementCourtyardWorldMm(part(flat), undefined, { superset: true });
    expect(superset).not.toBeNull();
    expect(superset!.length).toBe(3);
  });
});

describe("the extent always contains the resolved pads (Astra S4 #5)", () => {
  test("an authored courtyard smaller than the pads is hulled with them", () => {
    const tiny = [
      { kind: "rect", layer: "F.CrtYd", x: -1, y: -1, width: 2, height: 2, fill: false, strokeWidthMm: 0.05 },
    ];
    const p = part(tiny);
    const farPad = [
      { x: 4.5, y: -0.5 },
      { x: 5.5, y: -0.5 },
      { x: 5.5, y: 0.5 },
      { x: 4.5, y: 0.5 },
    ];
    const extent = placementKeepoutExtentMm(p, [farPad])!;
    expect(extent).not.toBeNull();
    for (const v of farPad) {
      // Pad corners lie ON the hull; probe just inside each one.
      expect(pointInPolygon({ x: v.x - Math.sign(v.x) * 1e-3, y: v.y * 0.9 }, extent)).toBe(true);
    }
    // A consistent footprint is unchanged: pads inside the courtyard add nothing.
    const inside = placementKeepoutExtentMm(p, [[{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }]])!;
    expect(inside).toEqual(placementCourtyardWorldMm(p, undefined, { superset: true })!);
  });
});

