/**
 * S12b WP4 — outline validity on the EXACT contour (§3) and the board-edge
 * CERTIFIED INTERVAL (§4), exact-geometry contract 12.
 *
 * The chord rules stay as the ORACLE: wherever a chord verdict and an exact
 * verdict disagree, the feature that decides must lie within the chord
 * deviation of an arc. Every disagreement asserted here names that feature.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import {
  DEFAULT_SEVERITY_BY_CODE,
  NON_OVERRIDABLE,
  RULE_CLASS_BY_CODE,
} from "../../../shared/drc/severity";
import { EMIT_SITE_BY_CODE } from "../../../modules/designer/backend/drc/code-registry";
import { buildBoardRegion } from "../../../shared/pcb-geometry/board-region";
import {
  regionBoundaryDistancePoint,
  discInsideRegion,
} from "../../../shared/pcb-geometry/board-region";
import { outlineChordBoundMm } from "../../../shared/pcb-geometry/exact-contour";
import { MAX_CHORD_DEVIATION_MM } from "../../../shared/pcb-geometry/arc-chords";
import {
  exactEntryOf,
  exactRingProblem,
} from "../../../shared/pcb-geometry/exact-simplicity";
import { exactContour } from "../../../shared/pcb-geometry/exact-contour";
import { ringSelfIntersects } from "../../../shared/pcb-geometry/segment-predicates";
import { flattenOutline } from "../../../shared/pcb-geometry/outline-geometry";
import { validateContour } from "../../../shared/rendering/pcb/contour-validation";
import type {
  PcbBoardContour,
  PcbBoardOutline,
  PcbBoardSettings,
  PcbPointMm,
} from "../../../sdks/designer";
import { board, codes, freePad, projection, via } from "./helpers/drc-fixtures";

const P = (x: number, y: number): PcbPointMm => ({ x, y });
const line = (x: number, y: number) => ({ type: "line" as const, to: P(x, y) });
const arcTo = (
  to: PcbPointMm,
  centerMm: PcbPointMm,
  cw: boolean,
) => ({ type: "arc" as const, to, centerMm, cw });

function boardWith(outline: PcbBoardOutline, over: Partial<PcbBoardSettings> = {}) {
  return { ...board(), outline, ...over };
}

/** A 100 × 100 rect board with a convex fillet of radius `r` at the top-right. */
function filletBoard(r: number): PcbBoardContour {
  return {
    kind: "contour",
    widthMm: 100,
    heightMm: 100,
    centerMm: P(0, 0),
    start: P(-50, -50),
    segments: [
      line(50, -50),
      line(50, 50 - r),
      arcTo(P(50 - r, 50), P(50 - r, 50 - r), false),
      line(-50, 50),
      line(-50, -50),
    ],
  };
}

describe("S12b §3 — outline validity on the exact contour", () => {
  test("(b) a `circle` cutout is TWO semicircles sharing BOTH endpoints, and valid", () => {
    // Astra run 1 #12: rule (b) must not read a two-primitive ring's second
    // shared junction as a crossing, and two 180° arcs of ONE circle share a
    // single ANGLE, not an interval, so they are not a retrace either.
    const ring = exactContour({
      kind: "circle",
      widthMm: 12,
      heightMm: 12,
      centerMm: P(0, 0),
    });
    expect("prims" in ring && ring.prims.length).toBe(2);
    expect(
      exactRingProblem(exactEntryOf(ring), { comparisons: 100_000 }),
    ).toBeNull();
  });

  test("(b) a full-radius roundrect's adjacent same-circle arcs are not a retrace", () => {
    // 60 × 40 with r = 20 collapses the two SHORT edges, leaving two pairs of
    // adjacent arcs on one circle. `arcArcIntersections().overlap` is true for
    // both pairs; only the angular MEASURE separates a shared endpoint from a
    // retraced interval.
    const ring = exactContour({
      kind: "roundrect",
      widthMm: 60,
      heightMm: 40,
      centerMm: P(0, 0),
      cornerRadiusMm: 20,
    });
    expect(
      exactRingProblem(exactEntryOf(ring), { comparisons: 100_000 }),
    ).toBeNull();
  });

  test("(a) no primitive-count rule: a semicircle plus its diameter is valid", () => {
    // §3 (a). The ring has TWO primitives and shares BOTH endpoints; the
    // editor's `too-few-segments` floor is a structural rule for an AUTHORED
    // contour, not a geometric one, and must not leak into the exact verdict.
    const c = P(0, 0);
    const contour: PcbBoardContour = {
      kind: "contour",
      widthMm: 40,
      heightMm: 20,
      centerMm: c,
      start: P(20, 0),
      segments: [arcTo(P(-20, 0), c, false), line(20, 0)],
    };
    const ring = exactContour(contour);
    expect("prims" in ring && ring.prims.length).toBe(2);
    expect(
      exactRingProblem(exactEntryOf(ring), { comparisons: 100_000 }),
    ).toBeNull();
  });

  test("(b) a same-circle 350° + 20° retrace IS invalid", () => {
    const c = P(0, 0);
    const start = P(30, 0);
    const mid = { x: 30 * Math.cos(-0.1745), y: 30 * Math.sin(-0.1745) };
    const contour: PcbBoardContour = {
      kind: "contour",
      widthMm: 60,
      heightMm: 60,
      centerMm: c,
      start,
      // 350° counter-clockwise, then 20° clockwise back over the last 20° of it.
      segments: [arcTo(mid, c, false), arcTo(start, c, true)],
    };
    const problem = exactRingProblem(exactEntryOf(exactContour(contour)), {
      comparisons: 100_000,
    });
    expect(problem?.fault).toBe("retrace");
  });

  test("(b) S2 #8: a feature 0.002 mm from a fillet is simple, and the chord ring says otherwise", () => {
    // The board's fillet chords dip up to ~0.0095 mm inside the true arc, so a
    // cutout wall 0.002 mm inside it crosses them. Exactly, the gap is
    // 0.002 mm > GEOM_EPS_MM and the cutout is strictly inside.
    const r = 20;
    const outline = filletBoard(r);
    const centre = P(50 - r, 50 - r);
    const d = r - 0.002 - 2;
    const cutout = {
      id: "graze",
      shape: {
        kind: "circle" as const,
        widthMm: 4,
        heightMm: 4,
        centerMm: P(
          centre.x + d * Math.SQRT1_2,
          centre.y + d * Math.SQRT1_2,
        ),
      },
    };
    // The ORACLE: on the biased chord rings the cutout breaches the outline.
    const region = buildBoardRegion(outline, [cutout], { bias: "board-inner" });
    const chordDeviation = outlineChordBoundMm(outline);
    expect(chordDeviation).toBeGreaterThan(0.002);
    const report = runDrc(
      projection({ board: boardWith(outline, { cutouts: [cutout] }) }),
    );
    expect(codes(report)).not.toContain("BOARD_OUTLINE_INVALID");
    // ...and the disagreement is bounded by the chord deviation, as §3 claims.
    expect(region.maxBoundMm).toBeGreaterThanOrEqual(MAX_CHORD_DEVIATION_MM);
  });

  test("(e) concentric cutouts are invalid and name the inner one", () => {
    const cutouts = [
      {
        id: "outer",
        shape: {
          kind: "circle" as const,
          widthMm: 24,
          heightMm: 24,
          centerMm: P(0, 0),
        },
      },
      {
        id: "inner",
        shape: {
          kind: "circle" as const,
          widthMm: 10,
          heightMm: 10,
          centerMm: P(0, 0),
        },
      },
    ];
    const report = runDrc(
      projection({
        board: boardWith(
          { kind: "rect", widthMm: 100, heightMm: 100, centerMm: P(0, 0) },
          { cutouts },
        ),
      }),
    );
    const nesting = report.violations.filter((v) =>
      v.message.includes("lies inside cutout"),
    );
    expect(nesting).toHaveLength(1);
    expect(nesting[0]!.message).toBe(
      "Cutout 2 lies inside cutout 1 — merge them",
    );
    expect(nesting[0]!.locationMm).toEqual(P(0, 0));
  });

  test("the editor gate and the DRC verdict share ONE predicate", () => {
    // §3.2: `validateContour`'s simplicity arm runs the same
    // `exactRingProblem` DRC does, so the draw tool cannot refuse a contour DRC
    // accepts. A return edge inside a fillet's chord band is the case that used
    // to differ.
    const contour: PcbBoardContour = {
      kind: "contour",
      widthMm: 40,
      heightMm: 40,
      centerMm: P(0, 0),
      start: P(-20, -20),
      segments: [
        line(20, -20),
        line(20, 10),
        arcTo(P(10, 20), P(10, 10), false),
        line(-20, 20),
        line(-20, -20),
      ],
    };
    expect(validateContour(contour).ok).toBe(true);
    expect(
      exactRingProblem(exactEntryOf(exactContour(contour)), {
        comparisons: 100_000,
      }),
    ).toBeNull();
    // A genuinely self-crossing contour is refused by BOTH.
    const crossing: PcbBoardContour = {
      ...contour,
      segments: [line(20, -20), line(-20, 20), line(20, 20), line(-20, -20)],
    };
    expect(validateContour(crossing).ok).toBe(false);
    expect(ringSelfIntersects(flattenOutline(crossing))).toBe(true);
  });
});

describe("S12b §4 — board-edge verdicts on a certified interval", () => {
  /** A via whose TRUE clearance to the fillet arc is `clearanceMm`. */
  function bandVia(r: number, clearanceMm: number, radiusMm: number) {
    const centre = P(50 - r, 50 - r);
    const d = r - clearanceMm - radiusMm;
    return via("v", {
      center: P(centre.x + d * Math.SQRT1_2, centre.y + d * Math.SQRT1_2),
      diameterMm: radiusMm * 2,
      drillMm: radiusMm,
    });
  }

  test("copper tangent to a curved edge inside the chord band is no longer reported", () => {
    // 02 §6, closed. True clearance 0.205 mm against a 0.2 mm rule; the inner
    // region reads 0.1952 (a FAIL) and the mirror superset 0.2126 (a PASS), so
    // the verdict is ambiguous and the EXACT answer decides.
    const outline = filletBoard(20);
    const v = bandVia(20, 0.205, 0.4);
    const inner = buildBoardRegion(outline, [], { bias: "board-inner" });
    const loGap = regionBoundaryDistancePoint(inner, v.centerMm) - 0.4;
    const hiGap =
      regionBoundaryDistancePoint(inner.outerBias.region, v.centerMm) - 0.4;
    expect(loGap).toBeLessThan(0.2);
    expect(hiGap).toBeGreaterThan(0.2);
    expect(discInsideRegion(inner, v.centerMm, 0.4)).toBe(true);

    const settings = boardWith(outline);
    settings.designRules = {
      ...settings.designRules,
      clearance: { ...settings.designRules.clearance, copperToBoardEdgeMm: 0.2 },
    };
    const report = runDrc(projection({ board: settings, vias: [v] }));
    expect(codes(report)).not.toContain("COPPER_TO_BOARD_EDGE");
    expect(codes(report)).not.toContain("COPPER_OFF_BOARD");
  });

  test("a verdict OUTSIDE the band is byte-identical in both broad-phase modes", () => {
    // Astra run 1 #2: the indexed halo must carry `maxBoundMm`, or this body
    // certifies a PASS the exhaustive body calls ambiguous.
    const outline = filletBoard(20);
    const settings = boardWith(outline);
    settings.designRules = {
      ...settings.designRules,
      clearance: { ...settings.designRules.clearance, copperToBoardEdgeMm: 0.2 },
    };
    for (const clearanceMm of [0.205, 0.1, 0.5, 0.2001, 0.1999]) {
      const p = projection({
        board: settings,
        vias: [bandVia(20, clearanceMm, 0.4)],
      });
      expect(
        JSON.stringify(runDrc(p, { broadPhase: "exhaustive" })),
        `clearance ${clearanceMm}`,
      ).toBe(JSON.stringify(runDrc(p)));
    }
  });

  test("Astra run 1 #3 — a pad whose EDGE crosses a notch is off-board", () => {
    // Every vertex is on the board; the bottom edge dips into a semicircular
    // notch cut out of the bottom edge.
    const outline: PcbBoardContour = {
      kind: "contour",
      widthMm: 100,
      heightMm: 100,
      centerMm: P(0, 0),
      start: P(-50, -50),
      segments: [
        line(-10, -50),
        arcTo(P(10, -50), P(0, -50), true),
        line(50, -50),
        line(50, 50),
        line(-50, 50),
        line(-50, -50),
      ],
    };
    const report = runDrc(
      projection({
        board: boardWith(outline),
        freePads: [
          freePad("fp", {
            center: P(0, -39),
            widthMm: 24,
            heightMm: 4,
            shape: "rect",
          }),
        ],
      }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
  });

  test("a CAPPED flattening carries a bound above MAX_CHORD_DEVIATION_MM", () => {
    // The `boundMm` term of §4's halo and interval. A cap needs
    // `sweep > 1024·√(0.02/r)`, which with `sweep <= 2π` forces `r >~ 531 mm` —
    // a metre-scale feature no golden board can host, so it is pinned here.
    const big: PcbBoardOutline = {
      kind: "circle",
      widthMm: 1200,
      heightMm: 1200,
      centerMm: P(0, 0),
    };
    expect(outlineChordBoundMm(big)).toBeGreaterThan(MAX_CHORD_DEVIATION_MM);
    const region = buildBoardRegion(big, [], { bias: "board-inner" });
    expect(region.maxBoundMm).toBe(outlineChordBoundMm(big));
    // ...and a shape whose arcs are not capped carries exactly the tolerance.
    expect(outlineChordBoundMm(filletBoard(20))).toBe(MAX_CHORD_DEVIATION_MM);
  });
});

describe("S12b registries — OUTLINE_WEB_UNCHECKED", () => {
  test("the 'we did not answer' code is info, manufacturability, overridable", () => {
    expect(DEFAULT_SEVERITY_BY_CODE.OUTLINE_WEB_UNCHECKED).toBe("info");
    expect(RULE_CLASS_BY_CODE.OUTLINE_WEB_UNCHECKED).toBe("manufacturability");
    expect(NON_OVERRIDABLE.has("OUTLINE_WEB_UNCHECKED")).toBe(false);
    // Three homes, one per place the exact layer can decline to answer.
    expect([...EMIT_SITE_BY_CODE.OUTLINE_WEB_UNCHECKED.checks].sort()).toEqual([
      "board",
      "manufacturability",
      "outline",
    ]);
  });
});
