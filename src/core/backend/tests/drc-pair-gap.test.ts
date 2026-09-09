/**
 * S7 — `drc/pair-gap.ts` is the ONE place DRC turns two items into a gap
 * (contract 06 §3). These pin the properties every consumer relies on:
 * exactness on a true disc, the circumscribed-ring bias it removes, the slot
 * stadium, and symmetry of every same-kind kernel (an asymmetric gap would make
 * a violation's marker — and with it its id — depend on input array order).
 */
import { describe, expect, test } from "bun:test";
import { buildDrcContext } from "../../../modules/designer/backend/drc/drc-context";
import type {
  DrcHole,
  DrcPad,
  DrcTrace,
  DrcViaGeom,
} from "../../../modules/designer/backend/drc/drc-context";
import {
  copperHoleGap,
  padPadGap,
  padViaGap,
  segmentSegmentGap,
  traceTraceGap,
  viaViaGap,
} from "../../../modules/designer/backend/drc/pair-gap";
import type { PcbFreePad } from "../../../sdks/designer";
import { freePad, projection, trace, via } from "./helpers/drc-fixtures";

/** Real context pads, so the disc / ring the kernels see is the real data. */
function padsOf(freePads: PcbFreePad[]): DrcPad[] {
  return buildDrcContext(projection({ freePads })).pads;
}

const CIRCLE = freePad("circle", {
  shape: "circle",
  widthMm: 1,
  heightMm: 1,
  center: { x: 0, y: 0 },
});
const SQUARE = freePad("square", {
  shape: "rect",
  widthMm: 1,
  heightMm: 1,
  center: { x: 10, y: 0 },
});

/** A zero-radius via = a bare point, so the gap is the pad-to-point distance. */
function pointVia(x: number, y: number, radiusMm = 0): DrcViaGeom {
  return {
    via: via("v", { center: { x, y }, diameterMm: radiusMm * 2 }),
    netId: null,
    center: { x, y },
    radiusMm,
    layers: ["F.Cu"],
    bounds: { minX: x, minY: y, maxX: x, maxY: y },
    layerSpanInvalid: false,
    viaTypeInvalid: false,
  };
}

describe("pair-gap — pad shape model", () => {
  test("a circular pad measures on its exact disc", () => {
    const [circle] = padsOf([CIRCLE]);
    expect(circle!.disc).toEqual({ center: { x: 0, y: 0 }, radiusMm: 0.5 });
    // A point 1.0 mm from the centre of an r = 0.5 pad is 0.5 mm from copper.
    expect(padViaGap(circle!, pointVia(1, 0)).gap).toBe(0.5);
  });

  test("the circumscribed ring under-reports the same gap", () => {
    const [circle] = padsOf([CIRCLE]);
    const { disc: _disc, ...ringOnly } = circle!;
    const ring = padViaGap(ringOnly, pointVia(1, 0)).gap;
    expect(ring).toBeLessThan(0.5);
    // sec(pi/48) - 1 ~ 0.215 % of r — the false-fail band the disc removes.
    expect(0.5 - ring).toBeLessThan(0.5 * 0.0022);
  });

  test("a rectangular pad's ring is exact — disc and ring agree", () => {
    const [square] = padsOf([SQUARE]);
    expect(square!.disc).toBeUndefined();
    // Pad spans x in [9.5, 10.5]; a point at x = 11 is 0.5 mm from its edge.
    expect(padViaGap(square!, pointVia(11, 0)).gap).toBe(0.5);
  });
});

describe("pair-gap — holes", () => {
  const roundHole: DrcHole = {
    anchor: { kind: "freeHole", freeHoleId: "h" },
    kind: "npth",
    netId: null,
    center: { x: 0, y: 0 },
    drillMm: 1,
  };
  const slotHole: DrcHole = {
    ...roundHole,
    drillMm: 0.5,
    slot: { a: { x: -0.75, y: 0 }, b: { x: 0.75, y: 0 }, widthMm: 0.5 },
  };

  test("a round hole is a disc of drillMm / 2", () => {
    expect(copperHoleGap(pointVia(2, 0, 0.25), roundHole).gap).toBe(1.25);
  });

  test("a slotted hole is the stadium around its centreline", () => {
    // Broadside: 1 mm above the centreline, minus the via radius and the
    // stadium's 0.25 mm half width.
    expect(copperHoleGap(pointVia(0, 1, 0.3), slotHole).gap).toBeCloseTo(
      0.45,
      12,
    );
    // Endwise: the cap centre sits at x = 0.75, not at the hole centre.
    expect(copperHoleGap(pointVia(2, 0, 0.3), slotHole).gap).toBeCloseTo(
      0.7,
      12,
    );
  });

  test("the marker sits at the hole centre for either shape", () => {
    expect(copperHoleGap(pointVia(2, 0, 0.25), slotHole).location).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("pair-gap — symmetry", () => {
  function traceOf(id: string, y: number): DrcTrace {
    return buildDrcContext(
      projection({ traces: [trace(id, null, [[0, y], [10, y]])] }),
    ).traces[0]!;
  }

  test("traceTraceGap(a, b) === traceTraceGap(b, a)", () => {
    const a = traceOf("a", 0);
    const b = traceOf("b", 0.4);
    expect(traceTraceGap(a, b).gap).toBe(traceTraceGap(b, a).gap);
  });

  test("segmentSegmentGap is symmetric", () => {
    const p = { x: 0, y: 0 };
    const q = { x: 4, y: 3 };
    const r = { x: 1, y: 2 };
    const s = { x: 5, y: -1 };
    expect(segmentSegmentGap(p, q, r, s, 0.3).gap).toBe(
      segmentSegmentGap(r, s, p, q, 0.3).gap,
    );
  });

  test("padPadGap is symmetric for disc/disc, disc/ring and ring/ring", () => {
    const [circle, square] = padsOf([CIRCLE, SQUARE]);
    const [circle2] = padsOf([{ ...CIRCLE, id: "c2", centerMm: { x: 4, y: 0 } }]);
    const { disc: _d, ...squareRing } = square!;
    expect(padPadGap(circle!, circle2!).gap).toBe(
      padPadGap(circle2!, circle!).gap,
    );
    expect(padPadGap(circle!, squareRing).gap).toBe(
      padPadGap(squareRing, circle!).gap,
    );
    const [sq2] = padsOf([{ ...SQUARE, id: "s2", centerMm: { x: 13, y: 0 } }]);
    expect(padPadGap(square!, sq2!).gap).toBe(padPadGap(sq2!, square!).gap);
  });

  test("viaViaGap is symmetric", () => {
    const a = pointVia(0, 0, 0.4);
    const b = pointVia(3, 4, 0.25);
    expect(viaViaGap(a, b).gap).toBe(viaViaGap(b, a).gap);
    expect(viaViaGap(a, b).gap).toBe(5 - 0.65);
  });
});
