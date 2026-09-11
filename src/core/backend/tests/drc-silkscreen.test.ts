/**
 * DFM contract 11 §3 — the silkscreen checks.
 *
 * Every case here is about the ARTWORK: the ink the fab receives, measured as
 * the exact stadiums a round aperture deposits and against the mask openings
 * `emitMask` flashes. The three that would be easy to get wrong and are pinned
 * hardest: a stroke is never an inscribed polygon, the gap to an opening is
 * SIGNED (a line across a pad is penetration, not zero), and the fab silk row
 * measures to the smaller of the opening and the pad's copper — which flips
 * which one bounds when the mask expansion goes negative.
 */
import { describe, expect, test } from "bun:test";
import type {
  DesignerPcbProjection,
  DrcReport,
  PcbBoardSettings,
  PcbOverlayShape,
  PcbOverlayText,
  PcbPlacedPart,
} from "../../../sdks/designer";
import { checkSilkscreen } from "../../../shared/drc/checks/silkscreen";
import { buildDrcContext } from "../../../shared/drc/drc-context";
import { finalizeReport } from "../../../shared/drc/drc-engine";
import { buildGerberLayer } from "../../../modules/designer/backend/export/gerber/writer";
import { boardWithRules, pad, projection } from "./helpers/drc-fixtures";

/** A placement carrying arbitrary silk graphics / labels / pads. */
function part(
  id: string,
  opts: {
    graphics?: unknown[];
    labels?: unknown[];
    pads?: unknown[];
    positionMm?: { x: number; y: number };
    rotationDeg?: number;
    mirrored?: boolean;
    layer?: "F.Cu" | "B.Cu";
  } = {},
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c",
    reference: id,
    positionMm: opts.positionMm ?? { x: 0, y: 0 },
    rotationDeg: opts.rotationDeg ?? 0,
    mirrored: opts.mirrored ?? false,
    layer: opts.layer ?? "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: opts.pads ?? [],
        graphics: opts.graphics ?? [],
        labels: opts.labels ?? [],
        bounds: null,
        warnings: [],
      },
    },
  } as unknown as PcbPlacedPart;
}

const silkLine = (
  a: [number, number],
  b: [number, number],
  widthMm = 0.15,
  layer = "F.SilkS",
): unknown => ({
  kind: "line",
  layer,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  strokeWidthMm: widthMm,
});

const label = (
  id: string,
  at: [number, number],
  fontSizeMm: number,
  text = "R1",
): unknown => ({
  id,
  text,
  at: { x: at[0], y: at[1] },
  fontSizeMm,
  rotationDeg: 0,
  anchorX: "center",
  anchorY: "middle",
  layer: "F.SilkS",
  role: "value",
});

function silkReport(
  parts: Partial<DesignerPcbProjection>,
  board?: PcbBoardSettings,
): DrcReport {
  const proj = projection({ ...parts, ...(board ? { board } : {}) });
  const ctx = buildDrcContext(proj);
  return finalizeReport(checkSilkscreen(ctx), {
    designId: "t",
    revision: 1,
    ignoredRuleClasses: [],
    waivedIds: [],
    severityOverrides: undefined,
  });
}

function codes(report: DrcReport): string[] {
  return report.violations.map((v) => v.code).sort();
}

/** 60 x 40 board. `custom` fab unless a case explicitly wants the rows. */
function board60(
  overrides: Partial<PcbBoardSettings> = {},
): PcbBoardSettings {
  return {
    ...boardWithRules({
      outline: {
        kind: "rect",
        widthMm: 60,
        heightMm: 40,
        centerMm: { x: 0, y: 0 },
      },
      fabricator: "custom",
    }),
    ...overrides,
  };
}

// A 1 x 1 rect pad at the origin of its placement. With the default 0.075 mm
// expansion its mask opening is 1.15 x 1.15 — x ∈ [-0.575, 0.575].
const padPart = (id: string, at: { x: number; y: number }, graphics: unknown[] = []) =>
  part(id, { positionMm: at, pads: [pad("1", { x: 0, y: 0 }, 1, 1)], graphics });

describe("SILK_TO_MASK_CLEARANCE (§3)", () => {
  test("a stroke ACROSS an opening is a negative gap, not a tangency", () => {
    const report = silkReport(
      { placements: [padPart("R1", { x: 0, y: 0 }, [silkLine([-2, 0], [2, 0])])] },
      board60(),
    );
    expect(codes(report)).toEqual(["SILK_TO_MASK_CLEARANCE"]);
    const v = report.violations[0]!;
    expect(v.measuredMm!).toBeLessThan(0);
    expect(v.message).toContain("into a solder-mask opening");
    expect(v.layer).toBe("F.Cu");
    expect(v.anchors).toEqual([
      { kind: "placement", placementId: "R1" },
      { kind: "pad", placementId: "R1", padNumber: "1" },
    ]);
  });

  test("at the default 0 the ink may TOUCH the opening's edge", () => {
    // Opening edge at x = 0.575; a 0.15 line centred at 0.65 reaches 0.575.
    const report = silkReport(
      {
        placements: [
          padPart("R1", { x: 0, y: 0 }, [silkLine([0.65, -2], [0.65, 2])]),
        ],
      },
      board60(),
    );
    expect(codes(report)).toEqual([]);
  });

  test("a positive rule is judged at the DRC epsilon", () => {
    const rules = board60();
    rules.designRules.silkscreen = { silkToMaskClearanceMm: 0.2 };
    const at = (x: number) =>
      silkReport(
        { placements: [padPart("R1", { x: 0, y: 0 }, [silkLine([x, -2], [x, 2])])] },
        rules,
      );
    // Ink edge at x − 0.075; opening edge 0.575. Gap = x − 0.65.
    expect(codes(at(0.84))).toEqual(["SILK_TO_MASK_CLEARANCE"]); // 0.19
    expect(codes(at(0.86))).toEqual([]); // 0.21
  });

  test("a CROSSING marks the middle of the ink on the pad, not an endpoint", () => {
    // The violation id hashes a 0.1 mm location bucket, so a 20 mm line across
    // a pad at (10, 10) that marked either end would point the user 10 mm away
    // and key a waiver there.
    const report = silkReport(
      {
        placements: [
          padPart("R1", { x: 10, y: 10 }, [silkLine([-10, 0], [10, 0])]),
        ],
      },
      board60({ fabricator: "jlcpcb_2l" }),
    );
    expect(codes(report).sort()).toEqual([
      "FAB_SILK_CLEARANCE",
      "SILK_TO_MASK_CLEARANCE",
    ]);
    for (const v of report.violations) {
      expect(v.locationMm!.x).toBeCloseTo(10, 1);
      expect(v.locationMm!.y).toBeCloseTo(10, 1);
    }
    const penetration = report.violations.find(
      (v) => v.code === "SILK_TO_MASK_CLEARANCE",
    )!;
    // Half the pen (0.075) plus the depth at the midpoint (the opening's half
    // height, 0.575, because the line runs through the middle of it).
    expect(penetration.measuredMm).toBeCloseTo(-(0.075 + 0.575), 6);
  });

  test("an ENDPOINT inside the opening stays its own witness", () => {
    const report = silkReport(
      {
        placements: [
          padPart("R1", { x: 10, y: 10 }, [silkLine([0, 0], [-5, 0])]),
        ],
      },
      board60(),
    );
    expect(codes(report)).toEqual(["SILK_TO_MASK_CLEARANCE"]);
    // The end that lands on the pad is at the placement's origin.
    expect(report.violations[0]!.locationMm).toEqual({ x: 10, y: 10 });
  });

  test("a stroke is judged as a STADIUM, never as an inscribed polygon", () => {
    // Ink edge exactly on the opening edge with a 0.6 mm pen: the centreline is
    // 0.3 mm away, which an inscribed model would clear by a wide margin.
    const rules = board60();
    rules.designRules.silkscreen = { silkToMaskClearanceMm: 0.1 };
    const report = silkReport(
      {
        placements: [
          padPart("R1", { x: 0, y: 0 }, [silkLine([0.875, -2], [0.875, 2], 0.6)]),
        ],
      },
      rules,
    );
    expect(codes(report)).toEqual(["SILK_TO_MASK_CLEARANCE"]);
    expect(report.violations[0]!.measuredMm!).toBeCloseTo(0, 6);
  });
});

describe("SILK_TO_BOARD_EDGE (§3)", () => {
  test("the default 0.15 mm rule, at the epsilon", () => {
    // Board edge at x = 30. A 0.15 pen centred at x reaches x + 0.075.
    const at = (x: number) =>
      silkReport(
        { placements: [part("R1", { graphics: [silkLine([x, -2], [x, 2])] })] },
        board60(),
      );
    expect(codes(at(29.8))).toEqual(["SILK_TO_BOARD_EDGE"]); // gap 0.125
    expect(codes(at(29.7))).toEqual([]); // gap 0.225
  });

  test("ink OUTSIDE the board reports the same code with measured 0", () => {
    const report = silkReport(
      { placements: [part("R1", { graphics: [silkLine([40, -2], [40, 2])] })] },
      board60(),
    );
    expect(codes(report)).toEqual(["SILK_TO_BOARD_EDGE"]);
    expect(report.violations[0]!.measuredMm).toBe(0);
    expect(report.violations[0]!.message).toContain("outside the board");
  });
});

describe("the fab silk rows (§3)", () => {
  const jlc = () => board60({ fabricator: "jlcpcb_2l" });

  test("FAB_SILK_WIDTH fires below 0.15 mm and not at it", () => {
    const at = (w: number) =>
      silkReport(
        { placements: [part("R1", { graphics: [silkLine([-2, 5], [2, 5], w)] })] },
        jlc(),
      );
    expect(codes(at(0.1))).toEqual(["FAB_SILK_WIDTH"]);
    expect(codes(at(0.15))).toEqual([]);
  });

  test("FAB_SILK_WIDTH reports ONCE per source, however many strokes it has", () => {
    const report = silkReport(
      {
        placements: [
          part("R1", {
            graphics: [
              silkLine([-2, 5], [2, 5], 0.1),
              silkLine([-2, 6], [2, 6], 0.08),
            ],
          }),
        ],
      },
      jlc(),
    );
    // Two GRAPHICS are two sources, but they share one placement anchor and no
    // location hash, so the report keeps the worst witness.
    expect(codes(report)).toEqual(["FAB_SILK_WIDTH"]);
    expect(report.violations[0]!.measuredMm).toBeCloseTo(0.08, 6);
  });

  test("FAB_SILK_TEXT_HEIGHT fires below 1.0 mm and not at it", () => {
    const at = (size: number) =>
      silkReport(
        { placements: [part("R1", { labels: [label("l1", [0, 5], size)] })] },
        jlc(),
      );
    expect(at(0.6).violations.map((v) => v.code)).toContain(
      "FAB_SILK_TEXT_HEIGHT",
    );
    expect(at(1.0).violations.map((v) => v.code)).not.toContain(
      "FAB_SILK_TEXT_HEIGHT",
    );
  });

  test("a custom fabricator reaches no fab row at all", () => {
    const report = silkReport(
      {
        placements: [
          part("R1", {
            graphics: [silkLine([-2, 5], [2, 5], 0.05)],
            labels: [label("l1", [0, 8], 0.4)],
          }),
        ],
      },
      board60({ fabricator: "custom" }),
    );
    expect(codes(report)).toEqual([]);
  });

  test("FAB_SILK_CLEARANCE is bound by the OPENING under a positive expansion", () => {
    // Expansion +0.075: the opening (0.575) is closer to the ink than the
    // copper (0.5), so the opening decides.
    const report = silkReport(
      {
        placements: [
          padPart("R1", { x: 0, y: 0 }, [silkLine([0.7, -2], [0.7, 2])]),
        ],
      },
      jlc(),
    );
    const v = report.violations.find((x) => x.code === "FAB_SILK_CLEARANCE")!;
    expect(v).toBeDefined();
    expect(v.message).toContain("mask opening");
    expect(v.measuredMm).toBeCloseTo(0.7 - 0.075 - 0.575, 6);
    expect(v.requiredMm).toBe(0.15);
  });

  test("… and by the COPPER under a negative expansion (Astra run 1 #18)", () => {
    // Expansion −0.2: the opening shrinks to 0.3 while the copper stays at 0.5,
    // so measuring only the opening would clear ink that sits on the pad.
    const rules = jlc();
    rules.solderMaskExpansionMm = -0.2;
    const report = silkReport(
      {
        placements: [
          padPart("R1", { x: 0, y: 0 }, [silkLine([0.6, -2], [0.6, 2])]),
        ],
      },
      rules,
    );
    const v = report.violations.find((x) => x.code === "FAB_SILK_CLEARANCE")!;
    expect(v).toBeDefined();
    expect(v.message).toContain("copper");
    expect(v.measuredMm).toBeCloseTo(0.6 - 0.075 - 0.5, 6);
  });

  test("the row names a PAD: an untented via's opening reaches no silk row", () => {
    const report = silkReport(
      {
        placements: [part("R1", { graphics: [silkLine([0.3, -2], [0.3, 2])] })],
        vias: [
          {
            id: "v1",
            netId: null,
            netClassId: "default",
            centerMm: { x: 0, y: 0 },
            diameterMm: 0.6,
            drillMm: 0.3,
            fromLayer: "F.Cu",
            toLayer: "B.Cu",
            viaType: "through",
            protection: "none",
            provenance: "route",
          },
        ],
      },
      jlc(),
    );
    expect(codes(report)).toEqual(["SILK_TO_MASK_CLEARANCE"]);
  });
});

describe("degenerate stroke widths (§1.2)", () => {
  const jlc = () => board60({ fabricator: "jlcpcb_2l" });

  // `(stroke (width 0))` is real stock-KiCad-library data. A zero width reaches
  // the Gerber as an aperture the fab cannot image, and `FAB_SILK_WIDTH` — the
  // one check that exists to catch a too-thin pen — says nothing about it,
  // because 0 is not "below" anything the comparison understands.
  for (const [label, widthMm] of [
    ["zero", 0],
    ["negative", -0.2],
    ["NaN", Number.NaN],
    ["undefined", undefined],
  ] as const) {
    test(`a ${label} footprint width reads as 0.12 and reports`, () => {
      const graphic = {
        kind: "line",
        layer: "F.SilkS",
        a: { x: -2, y: 5 },
        b: { x: 2, y: 5 },
        ...(widthMm === undefined ? {} : { strokeWidthMm: widthMm }),
      };
      const proj = projection({
        placements: [part("R1", { graphics: [graphic] })],
        board: jlc(),
      });
      // The ARTWORK always carries a positive width …
      const artwork = buildDrcContext(proj).silkArtwork();
      expect(artwork.strokes).toHaveLength(1);
      expect(artwork.strokes[0]!.widthMm).toBe(0.12);
      // … and the Gerber formatter therefore never sees a degenerate aperture.
      const warnings: string[] = [];
      const silk = buildGerberLayer(proj, "silk.top", warnings);
      expect(silk).toContain("%ADD10C,0.12*%");
      expect(silk).not.toContain("C,0*%");
      // … and the fab row judges it: 0.12 < JLCPCB's 0.15.
      const report = silkReport(
        { placements: [part("R1", { graphics: [graphic] })] },
        jlc(),
      );
      expect(codes(report)).toEqual(["FAB_SILK_WIDTH"]);
      expect(report.violations[0]!.measuredMm).toBe(0.12);
    });
  }

  test("an unusable OVERLAY width keeps the canvas default instead", () => {
    const shape: PcbOverlayShape = {
      id: "os1",
      layer: "F.SilkS",
      kind: "line",
      pointsMm: [
        { x: -2, y: 5 },
        { x: 2, y: 5 },
      ],
      strokeWidthMm: 0,
      fill: "none",
      lockedAt: null,
    };
    const artwork = buildDrcContext(
      projection({ overlayShapes: [shape], board: jlc() }),
    ).silkArtwork();
    expect(artwork.strokes[0]!.widthMm).toBe(0.15);
  });
});

describe("the two placement predicates (§1.1)", () => {
  test("a MIRRORED F.Cu placement reflects in X and keeps the top face", () => {
    // A mirror is an isometry of the whole footprint, so the test has to be
    // about ABSOLUTE position: a BOARD overlay line at world x = −1 meets the
    // pad only once the mirror has moved it from local +1 to world −1.
    const overlay: PcbOverlayShape = {
      id: "os1",
      layer: "F.SilkS",
      kind: "line",
      pointsMm: [
        { x: -1, y: -2 },
        { x: -1, y: 2 },
      ],
      strokeWidthMm: 0.15,
      fill: "none",
      lockedAt: null,
    };
    const plain = part("R1", { pads: [pad("1", { x: 1, y: 0 }, 1, 1)] });
    const mirrored = part("R1", {
      mirrored: true,
      pads: [pad("1", { x: 1, y: 0 }, 1, 1)],
    });
    expect(
      codes(silkReport({ placements: [plain], overlayShapes: [overlay] }, board60())),
    ).toEqual([]);
    const report = silkReport(
      { placements: [mirrored], overlayShapes: [overlay] },
      board60(),
    );
    expect(codes(report)).toEqual(["SILK_TO_MASK_CLEARANCE"]);
    // `mirrored` alone never moves artwork to the other face (§1.1).
    expect(report.violations[0]!.layer).toBe("F.Cu");
  });

  test("a B.Cu placement's F.SilkS graphics land on the BOTTOM face", () => {
    const p = part("R1", {
      layer: "B.Cu",
      pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
      graphics: [silkLine([-2, 0], [2, 0])],
    });
    const report = silkReport({ placements: [p] }, board60());
    expect(codes(report)).toEqual(["SILK_TO_MASK_CLEARANCE"]);
    expect(report.violations[0]!.layer).toBe("B.Cu");
  });
});

describe("overlay sources (§7 anchors)", () => {
  const overlayLine: PcbOverlayShape = {
    id: "os1",
    layer: "F.SilkS",
    kind: "line",
    pointsMm: [
      { x: -2, y: 0 },
      { x: 2, y: 0 },
    ],
    strokeWidthMm: 0.15,
    fill: "none",
    lockedAt: null,
  };

  const overlayText: PcbOverlayText = {
    id: "ot1",
    layer: "F.SilkS",
    positionMm: { x: 0, y: 0 },
    text: "HI",
    fontSizeMm: 0.5,
    rotationDeg: 0,
    mirror: false,
    justify: "center",
    lockedAt: null,
  };

  test("an overlay SHAPE anchors on overlayShape", () => {
    const report = silkReport(
      {
        placements: [padPart("R1", { x: 0, y: 0 })],
        overlayShapes: [overlayLine],
      },
      board60(),
    );
    expect(codes(report)).toEqual(["SILK_TO_MASK_CLEARANCE"]);
    expect(report.violations[0]!.anchors[0]).toEqual({
      kind: "overlayShape",
      shapeId: "os1",
    });
  });

  test("an overlay TEXT anchors on overlayText and is judged by the height row", () => {
    const report = silkReport(
      { overlayTexts: [overlayText] },
      board60({ fabricator: "jlcpcb_2l" }),
    );
    const v = report.violations.find((x) => x.code === "FAB_SILK_TEXT_HEIGHT")!;
    expect(v).toBeDefined();
    expect(v.anchors).toEqual([{ kind: "overlayText", textId: "ot1" }]);
    expect(v.measuredMm).toBe(0.5);
  });

  test("an overlay on B.SilkS is judged against the BOTTOM openings only", () => {
    const bottomLine: PcbOverlayShape = { ...overlayLine, layer: "B.SilkS" };
    // An SMD pad on F.Cu opens the mask on the top face only, so bottom ink
    // over it is not over an opening.
    const report = silkReport(
      {
        placements: [padPart("R1", { x: 0, y: 0 })],
        overlayShapes: [bottomLine],
      },
      board60(),
    );
    expect(codes(report)).toEqual([]);
  });
});
