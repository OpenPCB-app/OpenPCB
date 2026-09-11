/**
 * S12b WP4 — the board-material minimum web (exact-geometry contract 12 §5):
 * `OUTLINE_MIN_WEB`, `OUTLINE_WEB_UNCHECKED`, and the three Astra run 1
 * counterexamples the erosion definition exists to answer (#4 separate voids
 * the material runs around, #5 no thickness floor, #7 a plain roundrect reports
 * nothing).
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import {
  DEFAULT_SEVERITY_BY_CODE,
  NON_OVERRIDABLE,
  RULE_CLASS_BY_CODE,
} from "../../../shared/drc/severity";
import { EMIT_SITE_BY_CODE } from "../../../modules/designer/backend/drc/code-registry";
import { analyseMaterialRegion } from "../../../shared/rendering/copper-fill/material-web-kernel";
import {
  DEFAULT_COPPER_SHAPE_BUDGETS,
  EROSION_MARGIN_MM,
  SLIVER_THICKNESS_FLOOR_MM,
} from "../../../shared/rendering/copper-fill/copper-shape-kernel";
import {
  boardMaterialRings,
  findNarrowestSlot,
} from "../../../shared/rendering/pcb/outline-manufacturability";
import type {
  PcbBoardCutout,
  PcbBoardOutline,
  PcbBoardSettings,
  PcbPointMm,
} from "../../../sdks/designer";
import { board, codes, projection } from "./helpers/drc-fixtures";

const P = (x: number, y: number): PcbPointMm => ({ x, y });
const line = (x: number, y: number) => ({ type: "line" as const, to: P(x, y) });

function rectCutout(
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): PcbBoardCutout {
  return {
    id,
    shape: {
      kind: "contour",
      widthMm: x1 - x0,
      heightMm: y1 - y0,
      centerMm: P((x0 + x1) / 2, (y0 + y1) / 2),
      start: P(x0, y0),
      segments: [line(x1, y0), line(x1, y1), line(x0, y1), line(x0, y0)],
    },
  };
}

/** A board with `outline.minWebMm` set, or absent when `minWebMm` is null. */
function webBoard(
  outline: PcbBoardOutline,
  cutouts: PcbBoardCutout[],
  minWebMm: number | null,
): PcbBoardSettings {
  const base = board();
  return {
    ...base,
    outline,
    cutouts,
    designRules: {
      ...base.designRules,
      ...(minWebMm === null ? {} : { outline: { minWebMm } }),
    },
  };
}

const SQUARE: PcbBoardOutline = {
  kind: "rect",
  widthMm: 60,
  heightMm: 60,
  centerMm: P(0, 0),
};

function webs(settings: PcbBoardSettings) {
  return runDrc(projection({ board: settings })).violations.filter(
    (v) => v.code === "OUTLINE_MIN_WEB",
  );
}

describe("S12b §5.2 — the rule and the registries", () => {
  test("OUTLINE_MIN_WEB is a warning, manufacturability, overridable, hashed", () => {
    expect(DEFAULT_SEVERITY_BY_CODE.OUTLINE_MIN_WEB).toBe("warning");
    expect(RULE_CLASS_BY_CODE.OUTLINE_MIN_WEB).toBe("manufacturability");
    expect(NON_OVERRIDABLE.has("OUTLINE_MIN_WEB")).toBe(false);
    expect(EMIT_SITE_BY_CODE.OUTLINE_MIN_WEB.checks).toEqual([
      "manufacturability",
    ]);
  });

  test("an ABSENT rule is no verdict at all", () => {
    const cutouts = [
      rectCutout("a", -20, -5, -0.25, 5),
      rectCutout("b", 0.25, -5, 20, 5),
    ];
    expect(webs(webBoard(SQUARE, cutouts, null))).toHaveLength(0);
    expect(webs(webBoard(SQUARE, cutouts, 1)).length).toBeGreaterThan(0);
  });

  test("a rule below the erosion floor reports UNCHECKED, never silence", () => {
    const report = runDrc(
      projection({
        board: webBoard(SQUARE, [], EROSION_MARGIN_MM),
      }),
    );
    expect(codes(report)).toContain("OUTLINE_WEB_UNCHECKED");
    expect(codes(report)).not.toContain("OUTLINE_MIN_WEB");
  });

  test("two webs on one board get two ids (location-hashed)", () => {
    const found = webs(
      webBoard(
        SQUARE,
        [
          rectCutout("a", -25, 10, -5, 20),
          rectCutout("b", -25, 20.5, -5, 25),
          rectCutout("c", 5, -20, 25, -10),
          rectCutout("d", 5, -25, 25, -20.5),
        ],
        1,
      ),
    );
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(new Set(found.map((v) => v.id)).size).toBe(found.length);
  });
});

describe("S12b §5.1 — what is and is not a web", () => {
  test("Astra run 1 #7: a plain roundrect board reports nothing", () => {
    // The copper residual criteria report four corner slivers here; a residual
    // touching ONE ring is never a web.
    const roundrect: PcbBoardOutline = {
      kind: "roundrect",
      widthMm: 10,
      heightMm: 10,
      centerMm: P(0, 0),
      cornerRadiusMm: 2,
    };
    expect(webs(webBoard(roundrect, [], 1))).toHaveLength(0);
  });

  test("Astra run 1 #4: two SEPARATE voids 0.5 mm apart, material running around", () => {
    // The erosion leaves ONE core (the material goes around both voids) and the
    // union-find sees no neck; the throat between them is still a web.
    const found = webs(
      webBoard(
        SQUARE,
        [rectCutout("a", -10, -5, -0.25, 5), rectCutout("b", 0.25, -5, 10, 5)],
        1,
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.measuredMm!).toBeLessThan(1);
    expect(found[0]!.requiredMm).toBe(1);
    expect(Math.abs(found[0]!.locationMm!.x)).toBeLessThan(0.5);
  });

  test("a HORSESHOE void: two contact intervals on ONE ring is a web", () => {
    // §5.1 amended. The mouth of a horseshoe pinches the material to 0.5 mm and
    // BOTH walls of that web belong to the same cutout ring, so the earlier
    // distinct-RING form of the opposing-wall rule counted one touch and
    // reported nothing. Counted along the residual's own boundary the contact
    // has TWO components, separated by the erosion frontier at each end.
    const horseshoe: PcbBoardCutout = {
      id: "shoe",
      shape: {
        kind: "contour",
        widthMm: 16,
        heightMm: 16,
        centerMm: P(0, 0),
        start: P(-8, -8),
        segments: [
          line(8, -8), line(8, 8), line(0.25, 8), line(0.25, 4),
          line(4, 4), line(4, -4), line(-4, -4), line(-4, 4),
          line(-0.25, 4), line(-0.25, 8), line(-8, 8), line(-8, -8),
        ],
      },
    };
    const found = webs(webBoard(SQUARE, [horseshoe], 1));
    expect(found.length).toBeGreaterThanOrEqual(1);
    // ...and it is reported ON the bridge, not somewhere on the ring.
    const onBridge = found.filter(
      (v) => Math.abs(v.locationMm!.x) < 0.5 && v.locationMm!.y > 3.5,
    );
    expect(onBridge).toHaveLength(1);
    expect(onBridge[0]!.measuredMm!).toBeLessThan(1);
  });

  test("a C-shaped OUTER outline's own bridge is a web", () => {
    // The same two-intervals-on-one-ring shape, with the OUTER ring as both
    // walls: a U-slot cut from the top edge whose bottom bar leaves a 0.5 mm
    // bridge of board.
    const cShaped: PcbBoardOutline = {
      kind: "contour",
      widthMm: 60,
      heightMm: 60,
      centerMm: P(0, 0),
      start: P(-30, -30),
      segments: [
        line(30, -30),
        line(30, 30),
        line(10, 30),
        line(10, -10),
        line(0.25, -10),
        line(0.25, -9.5),
        line(9.5, -9.5),
        line(9.5, 30),
        line(-9.5, 30),
        line(-9.5, -9.5),
        line(-0.25, -9.5),
        line(-0.25, -10),
        line(-10, -10),
        line(-10, 30),
        line(-30, 30),
        line(-30, -30),
      ],
    };
    const found = webs(webBoard(cShaped, [], 1));
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(
      found.some(
        (v) => Math.abs(v.locationMm!.x) < 0.5 && v.locationMm!.y < -9,
      ),
    ).toBe(true);
  });

  test("an annulus between two circular voids is one web, not a continuum", () => {
    const found = webs(
      webBoard(
        SQUARE,
        [
          {
            id: "a",
            shape: { kind: "circle", widthMm: 16, heightMm: 16, centerMm: P(-8.25, 0) },
          },
          {
            id: "b",
            shape: { kind: "circle", widthMm: 16, heightMm: 16, centerMm: P(8.25, 0) },
          },
        ],
        1,
      ),
    );
    expect(found).toHaveLength(1);
  });

  test("a void 0.5 mm from the board edge is a web against the OUTER ring", () => {
    const found = webs(
      webBoard(SQUARE, [rectCutout("a", -10, 10, 10, 29.5)], 1),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.locationMm!.y).toBeGreaterThan(29);
  });
});

describe("S12b §5.1 — the ring-pair arm (Astra run 2)", () => {
  test("#A a throat SHORTER than the opening's disc reach is still a web", () => {
    // Two Ø2 voids 2.9 mm apart leave a 0.900 mm web. The erosion removes the
    // throat and the dilation re-covers its middle from both sides, so the
    // residual splits into two crescents that each contact ONE wall — invisible
    // to both erosion arms. The EXACT distance between the two rings needs no
    // erosion at all.
    const found = webs(
      webBoard(
        { kind: "rect", widthMm: 20, heightMm: 20, centerMm: P(0, 0) },
        [
          {
            id: "a",
            shape: { kind: "circle", widthMm: 2, heightMm: 2, centerMm: P(-1.45, 0) },
          },
          {
            id: "b",
            shape: { kind: "circle", widthMm: 2, heightMm: 2, centerMm: P(1.45, 0) },
          },
        ],
        1,
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.measuredMm!).toBeCloseTo(0.9, 9);
    expect(found[0]!.locationMm).toEqual(P(0, 0));
  });

  test("#D a board the 0.1 µm fill grid cannot hold still reports", () => {
    // 100 × 0.000098 mm: 0.0098 mm² of real material, and NOTHING on the
    // kernel's grid — `groupComponents` returns no group, the accumulated area
    // is 0 and the empty-erosion arm used to stay silent.
    const found = webs(
      webBoard(
        { kind: "rect", widthMm: 100, heightMm: 0.000098, centerMm: P(0, 0) },
        [],
        1,
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.measuredMm).toBe(0);
    expect(found[0]!.message).toContain("narrower than 1.000 mm everywhere");
  });

  test("a ring pair close across a VOID is not a web", () => {
    // The connector must run through MATERIAL. A void in the mouth of a
    // C-shaped board is 0.5 mm from the far arm across AIR.
    const cShaped: PcbBoardOutline = {
      kind: "contour",
      widthMm: 60,
      heightMm: 60,
      centerMm: P(0, 0),
      start: P(-30, -30),
      segments: [
        line(30, -30),
        line(30, 30),
        line(10, 30),
        line(10, -10),
        line(-10, -10),
        line(-10, 30),
        line(-30, 30),
        line(-30, -30),
      ],
    };
    // The void sits in the C's mouth, 0.5 mm from the RIGHT arm's inner wall
    // (x = 10) across material... and 9.5 mm from the left arm. Move it so the
    // only near ring pair crosses the mouth's air: centre it and shrink it.
    const inMouth: PcbBoardCutout = {
      id: "mouth",
      shape: { kind: "circle", widthMm: 2, heightMm: 2, centerMm: P(0, 20) },
    };
    // The void is wholly in the mouth (not board at all) — rule (c) reports the
    // outline, and no `OUTLINE_MIN_WEB` may be invented from the ring distance.
    const found = webs(webBoard(cShaped, [inMouth], 1));
    expect(
      found.filter((v) => Math.abs(v.locationMm!.y - 20) < 2),
    ).toHaveLength(0);
  });
});

describe("S12b §5.1 — the kernel's own contract", () => {
  const options = {
    budgets: DEFAULT_COPPER_SHAPE_BUDGETS,
    budget: { remaining: DEFAULT_COPPER_SHAPE_BUDGETS.maxErosionsPerUnit },
    work: { remaining: DEFAULT_COPPER_SHAPE_BUDGETS.maxEdgeComparisonsPerUnit },
  };

  test("Astra run 1 #5: no thickness floor — a 0.0005 mm strip IS a web", () => {
    // The copper kernel discards a residual whose MEAN thickness is at or below
    // SLIVER_THICKNESS_FLOOR_MM as numerical residue. Board material has no such
    // floor: a 0.0005 mm strip of substrate is a real, fatal web. The strip is
    // 390 mm long so its own thickness, not the residual's end lobes, dominates
    // `2·area/perimeter` — a shorter one measures above the floor and would not
    // tell the two rules apart.
    const wide: PcbBoardOutline = {
      kind: "rect",
      widthMm: 400,
      heightMm: 60,
      centerMm: P(0, 0),
    };
    const material = boardMaterialRings(wide, [
      rectCutout("a", -195, -25, 195, 29.9995).shape,
    ]);
    const found = analyseMaterialRegion(material, 1, { ...options,
      budget: { remaining: DEFAULT_COPPER_SHAPE_BUDGETS.maxErosionsPerUnit },
      work: { remaining: DEFAULT_COPPER_SHAPE_BUDGETS.maxEdgeComparisonsPerUnit },
    });
    expect(found.emptyErosion).toBe(false);
    const strip = found.webs.filter((w) => w.locationMm.y > 29);
    expect(strip.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...strip.map((w) => w.widthMm))).toBeLessThan(
      SLIVER_THICKNESS_FLOOR_MM,
    );
  });

  test("the EMPTY erosion: a whole board narrower than `w`, reported once", () => {
    const sliver: PcbBoardOutline = {
      kind: "rect",
      widthMm: 40,
      heightMm: 0.4,
      centerMm: P(0, 0),
    };
    const found = analyseMaterialRegion(boardMaterialRings(sliver, []), 1, {
      ...options,
      budget: { remaining: DEFAULT_COPPER_SHAPE_BUDGETS.maxErosionsPerUnit },
      work: { remaining: DEFAULT_COPPER_SHAPE_BUDGETS.maxEdgeComparisonsPerUnit },
    });
    expect(found.emptyErosion).toBe(true);
    // The marker is ON the material, not a bounding-box centre of nothing.
    expect(Math.abs(found.markerMm.y)).toBeLessThanOrEqual(0.2);
    const report = runDrc(projection({ board: webBoard(sliver, [], 1) }));
    expect(
      report.violations.filter((v) => v.code === "OUTLINE_MIN_WEB"),
    ).toHaveLength(1);
  });

  test("the material is flattened `board-inner`, and its deviation is ACHIEVED", () => {
    // Astra run 1 #6: a 10× refinement request is capped at MAX_ARC_SEGMENTS, so
    // the band the message states must come from the count actually used.
    // r = 2 still fits inside MAX_ARC_SEGMENTS at 10× and lands on the 1e-4
    // the refinement asks for; r = 600 is capped and carries 100× that, which
    // is exactly why the deviation must be measured and not assumed.
    const small = boardMaterialRings(
      { kind: "circle", widthMm: 4, heightMm: 4, centerMm: P(0, 0) },
      [],
    );
    const huge = boardMaterialRings(
      { kind: "circle", widthMm: 1200, heightMm: 1200, centerMm: P(0, 0) },
      [],
    );
    expect(small.deviationMm).toBeLessThanOrEqual(1.01e-4);
    expect(huge.deviationMm).toBeGreaterThan(1e-3);
    expect(small.outer.length).toBeGreaterThan(64);
  });
});

describe("S12b §5.1 — OUTLINE_SLOT_WIDTH stops reporting material webs", () => {
  test("findNarrowestSlot skips a pair whose connector runs through material", () => {
    // A 20 × 20 ring with a 0.5 mm-wide re-entrant slot: the slot itself is a
    // VOID the cutter must reach into, while the pair across the material is a
    // web `OUTLINE_MIN_WEB` owns.
    const ring: PcbPointMm[] = [
      P(-10, -10),
      P(10, -10),
      P(10, 10),
      P(0.25, 10),
      P(0.25, -5),
      P(-0.25, -5),
      P(-0.25, 10),
      P(-10, 10),
    ];
    const noPredicate = findNarrowestSlot(ring, 1);
    expect(noPredicate).not.toBeNull();
    expect(noPredicate!.gapMm).toBeCloseTo(0.5, 6);
    // With every connector declared "material", nothing is a void any more.
    expect(findNarrowestSlot(ring, 1, () => true)).toBeNull();
    // With none of them material, the answer is the pre-S12b one, bit for bit.
    expect(findNarrowestSlot(ring, 1, () => false)).toEqual(noPredicate);
  });
});
