// P0 correctness fixes for the DRC engine (see plan
// ~/.claude/plans/you-are-reviewing-a-lively-kazoo.md):
//   C9  shorts detected independent of the configured clearance rule
//   C1  pad↔via clearance + short
//   C2  conservative (circumscribed) pad polygons
//   C3  off-board by full shape extent (straddling pad)
//   C10 epsilon-tolerant minimum comparisons (no float false-failures)
//   C0  arbitrary (non-90°) placement rotation in the pad transform
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import type { FootprintRenderSourcePad } from "../../../shared/rendering/types";
import type {
  DesignerPcbProjection,
  DrcReport,
  DrcRuleCode,
  PcbBoardSettings,
  PcbPlacedPart,
  PcbVia,
} from "../../../sdks/designer";

const TS = "2026-01-01T00:00:00.000Z";

function board(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return { ...createDefaultPcbBoardSettings(TS), ...overrides };
}

function projection(
  parts: Partial<DesignerPcbProjection> = {},
): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 1,
    board: parts.board ?? board(),
    placements: parts.placements ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
    freeHoles: parts.freeHoles ?? [],
    freePads: parts.freePads ?? [],
    overlayTexts: parts.overlayTexts ?? [],
    overlayShapes: parts.overlayShapes ?? [],
    zones: parts.zones ?? [],
    ratsnest: parts.ratsnest ?? [],
    netNames: parts.netNames ?? {},
    padNets: parts.padNets,
    warnings: [],
  };
}

function via(
  id: string,
  opts: {
    netId?: string | null;
    center?: { x: number; y: number };
    diameterMm?: number;
    drillMm?: number;
  } = {},
): PcbVia {
  return {
    id,
    netId: opts.netId ?? null,
    netClassId: "default",
    centerMm: opts.center ?? { x: 0, y: 0 },
    diameterMm: opts.diameterMm ?? 0.8,
    drillMm: opts.drillMm ?? 0.4,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    provenance: "route",
  };
}

function pad(
  number: string,
  center: { x: number; y: number },
  w: number,
  h: number,
  shape: FootprintRenderSourcePad["shape"] = "rect",
): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape,
    centerMm: center,
    widthMm: w,
    heightMm: h,
    rotationDeg: 0,
  };
}

function placement(
  id: string,
  opts: {
    positionMm?: { x: number; y: number };
    rotationDeg?: number;
    pads?: FootprintRenderSourcePad[];
  } = {},
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c",
    reference: id,
    positionMm: opts.positionMm ?? { x: 0, y: 0 },
    rotationDeg: opts.rotationDeg ?? 0,
    mirrored: false,
    layer: "F.Cu",
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
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
  };
}

function codes(report: DrcReport): DrcRuleCode[] {
  return report.violations.map((v) => v.code);
}

/** Board with no net classes + a 0 mm pad-to-pad rule → required clearance 0. */
function zeroRuleBoard(): PcbBoardSettings {
  const def = createDefaultPcbBoardSettings(TS);
  return board({
    fabricator: "custom",
    netClasses: [],
    designRules: {
      ...def.designRules,
      clearance: { ...def.designRules.clearance, padToPadMm: 0 },
    },
  });
}

describe("runDrc — P0 fixes", () => {
  test("C9: different-net pad overlap is a short even when the rule is 0", () => {
    // padToPadMm = 0 and no net classes → required = 0. The overlap gap is 0,
    // so the old `gap < required` gate (0 < 0 = false) hid the short.
    const report = runDrc(
      projection({
        board: zeroRuleBoard(),
        placements: [
          placement("A", {
            positionMm: { x: 0, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
          placement("B", {
            positionMm: { x: 0.5, y: 0 }, // overlaps A on -0.5..0.5 vs 0..1.0
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "A|1": "n1", "B|1": "n2" },
      }),
    );
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
  });

  test("C1: a different-net via overlapping a pad is a short", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("A", { pads: [pad("1", { x: 0, y: 0 }, 1, 1)] }),
        ],
        vias: [via("v1", { netId: "n2", center: { x: 0, y: 0 } })],
        padNets: { "A|1": "n1" },
      }),
    );
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
  });

  test("C1: a same-net via on a pad is not flagged", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("A", { pads: [pad("1", { x: 0, y: 0 }, 1, 1)] }),
        ],
        vias: [via("v1", { netId: "n1", center: { x: 0, y: 0 } })],
        padNets: { "A|1": "n1" },
      }),
    );
    expect(codes(report)).not.toContain("NET_SHORT_CIRCUIT");
    expect(codes(report)).not.toContain("PAD_TO_VIA_CLEARANCE");
  });

  test("C1: a different-net via within clearance of a pad is a clearance error", () => {
    const def = createDefaultPcbBoardSettings(TS);
    const b = board({
      fabricator: "custom",
      netClasses: [],
      designRules: {
        ...def.designRules,
        clearance: { ...def.designRules.clearance, traceToViaMm: 0.3 },
      },
    });
    // Pad edge at x=0.5; via center x=1.0, radius 0.4 → gap 0.1 < 0.3 rule.
    const report = runDrc(
      projection({
        board: b,
        placements: [
          placement("A", { pads: [pad("1", { x: 0, y: 0 }, 1, 1)] }),
        ],
        vias: [via("v1", { netId: "n2", center: { x: 1.0, y: 0 } })],
        padNets: { "A|1": "n1" },
      }),
    );
    expect(codes(report)).toContain("PAD_TO_VIA_CLEARANCE");
    expect(codes(report)).not.toContain("NET_SHORT_CIRCUIT");
  });

  test("C2: a via tangent to a circle pad's true edge is caught (conservative)", () => {
    // Circle pad r=0.5; via center on the 3.75° edge-bisector at radius 0.9,
    // via radius 0.4 → true/circumscribed gap ≈ 0 (short). An inscribed polygon
    // would report ~+0.001 mm here and miss it.
    const report = runDrc(
      projection({
        placements: [
          placement("A", { pads: [pad("1", { x: 0, y: 0 }, 1, 1, "circle")] }),
        ],
        vias: [
          via("v1", { netId: "n2", center: { x: 0.898073, y: 0.058863 } }),
        ],
        padNets: { "A|1": "n1" },
      }),
    );
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
  });

  test("C3: a pad straddling the board edge is COPPER_OFF_BOARD", () => {
    const b = board({
      outline: {
        kind: "rect",
        widthMm: 10,
        heightMm: 10,
        centerMm: { x: 0, y: 0 },
      },
    });
    // Board spans -5..5; pad at x=4.9 spans 4.4..5.4 → a vertex is off-board.
    const report = runDrc(
      projection({
        board: b,
        placements: [
          placement("A", {
            positionMm: { x: 4.9, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "A|1": "n1" },
      }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
  });

  test("C10: annular ring at the exact minimum is not a false failure", () => {
    const def = createDefaultPcbBoardSettings(TS);
    const b = board({
      fabricator: "custom",
      designRules: {
        ...def.designRules,
        minimums: {
          ...def.designRules.minimums,
          viaDiameterMm: 0.1,
          viaDrillMm: 0.05,
          annularRingMm: 0.1,
        },
      },
    });
    // (0.3 - 0.1) / 2 = 0.09999999999999999 — must NOT trip ANNULAR_RING_MIN.
    const report = runDrc(
      projection({
        board: b,
        vias: [
          via("v1", {
            netId: "n1",
            center: { x: 0, y: 0 },
            diameterMm: 0.3,
            drillMm: 0.1,
          }),
        ],
      }),
    );
    expect(codes(report)).not.toContain("ANNULAR_RING_MIN");
  });

  test("C0: a 45° placement positions the pad at the true angle, not snapped to 90°", () => {
    // Pad local (1,0) on a part rotated 45° → world ≈ (0.7071, 0.7071). A via
    // there overlaps the pad and shorts. The old 90°-snap put the pad elsewhere
    // and missed it.
    const report = runDrc(
      projection({
        placements: [
          placement("A", {
            positionMm: { x: 0, y: 0 },
            rotationDeg: 45,
            pads: [pad("1", { x: 1, y: 0 }, 0.4, 0.4)],
          }),
        ],
        vias: [via("v1", { netId: "n2", center: { x: 0.7071, y: 0.7071 } })],
        padNets: { "A|1": "n1" },
      }),
    );
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
  });
});
