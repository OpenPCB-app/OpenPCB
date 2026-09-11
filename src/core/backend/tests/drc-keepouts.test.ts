/**
 * `KEEPOUT_VIOLATION` (zone/keepout contract §4, §13.1): item class ×
 * restriction × layer scope, through the REAL `runDrc`. The predicate itself is
 * pinned by `pcb-keepout-predicates.test.ts`; this suite pins the wiring —
 * which items DRC builds, which layers it judges them on, and the one-violation
 * -per-(item, keepout)-pair rule.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { resolveAnchorLabel } from "../../../modules/designer/frontend/pcb/drc/drc-labels";
import type {
  DesignerPcbProjection,
  DrcReport,
  PcbKeepoutRestrictions,
  PcbPlacedPart,
  PcbPointMm,
} from "../../../sdks/designer";
import type {
  FootprintRenderSourcePad,
  PreviewGraphic,
} from "../../../shared/rendering/types";
import {
  board,
  boardWithRules,
  freePad as freePadFixture,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";
import { boardZoneRow, keepoutRow } from "./helpers/pcb-zone-fixtures";
import {
  boardPourSpecs,
  buildBoardPourFills,
} from "../../../modules/designer/backend/pcb/board-connectivity";
import { computeRatsnest } from "../../../modules/designer/backend/pcb/ratsnest";
import { collectCopperZones, collectKeepouts } from "../../../shared/pcb-areas";
import { zonePourNets } from "../../../shared/pcb-areas/pour-params";

/** Keepout square well inside the default 50x30 board. */
const SQUARE: PcbPointMm[] = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 8 },
  { x: 0, y: 8 },
];

const NONE: PcbKeepoutRestrictions = {
  tracks: false,
  vias: false,
  pads: false,
  copperPour: false,
  footprints: false,
};

function keepoutViolations(report: DrcReport) {
  return report.violations.filter((v) => v.code === "KEEPOUT_VIOLATION");
}

function run(parts: Partial<DesignerPcbProjection>): DrcReport {
  return runDrc(projection(parts));
}

/** Placement with an explicit render-model courtyard and/or preview bounds. */
function bodyPlacement(
  id: string,
  opts: {
    positionMm?: PcbPointMm;
    layer?: PcbPlacedPart["layer"];
    courtyardHalfMm?: number;
    boundsHalfMm?: number;
    pads?: FootprintRenderSourcePad[];
  } = {},
): PcbPlacedPart {
  const base = placement(id, {
    positionMm: opts.positionMm ?? { x: 0, y: 0 },
    ...(opts.layer ? { layer: opts.layer } : {}),
    pads: opts.pads ?? [],
  });
  const preview = base.footprint.preview!;
  const half = opts.courtyardHalfMm;
  const corners: PcbPointMm[] = half
    ? [
        { x: -half, y: -half },
        { x: half, y: -half },
        { x: half, y: half },
        { x: -half, y: half },
      ]
    : [];
  const graphics: PreviewGraphic[] = corners.map((a, i) => ({
    kind: "line",
    layer: "F.CrtYd",
    a,
    b: corners[(i + 1) % corners.length]!,
    strokeWidthMm: 0.05,
  }));
  const b = opts.boundsHalfMm;
  return {
    ...base,
    footprint: {
      ...base.footprint,
      preview: {
        ...preview,
        graphics,
        bounds: b ? { minX: -b, minY: -b, maxX: b, maxY: b } : null,
      },
    },
  };
}

describe("KEEPOUT_VIOLATION — traces", () => {
  test("a trace inside a tracks keepout is one error, on its own layer", () => {
    const report = run({
      netNames: { n1: "SIG" },
      traces: [
        trace("t1", "n1", [
          [2, 4],
          [6, 4],
        ]),
      ],
      keepouts: [keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, tracks: true })],
    });
    const found = keepoutViolations(report);
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("error");
    expect(found[0]!.ruleClass).toBe("constraint");
    expect(found[0]!.layer).toBe("F.Cu");
    expect(found[0]!.message).toBe(
      'Trace on F.Cu enters keepout "k1" (tracks forbidden)',
    );
    expect(found[0]!.anchors).toEqual([
      { kind: "trace", traceId: "t1" },
      { kind: "keepout", keepoutId: "k1" },
    ]);
  });

  test("the same trace is silent when `tracks` is off", () => {
    const report = run({
      netNames: { n1: "SIG" },
      traces: [
        trace("t1", "n1", [
          [2, 4],
          [6, 4],
        ]),
      ],
      keepouts: [keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, vias: true })],
    });
    expect(keepoutViolations(report)).toEqual([]);
  });

  test("a keepout on the other layer does not reach the trace", () => {
    const report = run({
      netNames: { n1: "SIG" },
      traces: [
        trace(
          "t1",
          "n1",
          [
            [2, 4],
            [6, 4],
          ],
          { layer: "F.Cu" },
        ),
      ],
      keepouts: [keepoutRow("k1", ["B.Cu"], SQUARE, { ...NONE, tracks: true })],
    });
    expect(keepoutViolations(report)).toEqual([]);
  });

  test("copper whose edge lies exactly on the boundary is legal", () => {
    // A keepout has clearance 0 (§4): the right edge of this 0.2 mm trace sits
    // exactly on x = 0, the keepout's left edge.
    const report = run({
      netNames: { n1: "SIG" },
      traces: [
        trace(
          "t_touch",
          "n1",
          [
            [-0.1, 2],
            [-0.1, 6],
          ],
          { widthMm: 0.2 },
        ),
      ],
      keepouts: [keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, tracks: true })],
    });
    expect(keepoutViolations(report)).toEqual([]);
  });

  test("a trace that crosses one keepout twice reports exactly once", () => {
    const report = run({
      netNames: { n1: "SIG" },
      traces: [
        trace("t_u", "n1", [
          [-2, 2],
          [10, 2],
          [10, 6],
          [-2, 6],
        ]),
      ],
      keepouts: [keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, tracks: true })],
    });
    expect(keepoutViolations(report)).toHaveLength(1);
  });

  test("a disabled keepout affects nothing and warns about nothing", () => {
    const report = run({
      netNames: { n1: "SIG" },
      traces: [
        trace("t1", "n1", [
          [2, 4],
          [6, 4],
        ]),
      ],
      keepouts: [
        keepoutRow(
          "k1",
          ["F.Cu"],
          SQUARE,
          { ...NONE, tracks: true },
          {
            enabled: false,
          },
        ),
      ],
    });
    expect(keepoutViolations(report)).toEqual([]);
    expect(report.violations.filter((v) => v.code === "ZONE_INVALID")).toEqual(
      [],
    );
  });
});

describe("KEEPOUT_VIOLATION — vias and pads", () => {
  test("a via inside a vias keepout reports on the shared layer", () => {
    const report = run({
      netNames: { n1: "SIG" },
      vias: [via("v1", { netId: "n1", center: { x: 4, y: 4 } })],
      keepouts: [keepoutRow("k1", ["B.Cu"], SQUARE, { ...NONE, vias: true })],
    });
    const found = keepoutViolations(report);
    expect(found).toHaveLength(1);
    // The via spans F.Cu→B.Cu; only B.Cu is shared with the keepout.
    expect(found[0]!.layer).toBe("B.Cu");
    expect(found[0]!.message).toBe(
      'Via enters keepout "k1" on B.Cu (vias forbidden)',
    );
    expect(found[0]!.locationMm).toEqual({ x: 4, y: 4 });
  });

  test("an SMD pad on the opposite side is not affected", () => {
    const smd = pad("1", { x: 0, y: 0 }, 1, 1);
    const front = run({
      placements: [
        placement("U1", { positionMm: { x: 4, y: 4 }, pads: [smd] }),
      ],
      keepouts: [keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, pads: true })],
    });
    expect(keepoutViolations(front)).toHaveLength(1);
    expect(keepoutViolations(front)[0]!.message).toBe(
      'Pad U1.1 enters keepout "k1" on F.Cu (pads forbidden)',
    );

    const back = run({
      placements: [
        placement("U1", {
          positionMm: { x: 4, y: 4 },
          layer: "B.Cu",
          pads: [smd],
        }),
      ],
      keepouts: [keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, pads: true })],
    });
    expect(keepoutViolations(back)).toEqual([]);
  });

  test("a through-hole pad is caught by an inner-layer keepout", () => {
    const th = pad("1", { x: 0, y: 0 }, 1.5, 1.5, { drillDiameterMm: 0.8 });
    const report = run({
      board: boardWithRules({ layerCount: 4 }),
      placements: [placement("U1", { positionMm: { x: 4, y: 4 }, pads: [th] })],
      keepouts: [keepoutRow("k1", ["In1.Cu"], SQUARE, { ...NONE, pads: true })],
    });
    const found = keepoutViolations(report);
    expect(found).toHaveLength(1);
    expect(found[0]!.layer).toBe("In1.Cu");
  });

  /**
   * The keepout's right edge is x = 8. An oval pad of 2 x 1 has 0.5 mm caps,
   * so its exact copper starts at `centre − 1`; its CIRCUMSCRIBED ring starts
   * 1.07 µm earlier (sec(π/48) on the cap). A pad whose exact edge sits 0.5 µm
   * outside the keepout used to be reported through that inflation
   * (exact-geometry contract 12 §1.3).
   */
  describe("an oval pad is judged on its exact copper", () => {
    const ovalAt = (x: number) =>
      run({
        freePads: [
          freePadFixture("fp1", {
            shape: "oval",
            widthMm: 2,
            heightMm: 1,
            center: { x, y: 4 },
          }),
        ],
        keepouts: [keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, pads: true })],
      });

    test("the ring's 1.07 µm over-reach no longer affects it", () => {
      expect(keepoutViolations(ovalAt(9.0000005))).toEqual([]);
    });

    test("real copper 5 µm inside is still reported", () => {
      expect(keepoutViolations(ovalAt(8.995))).toHaveLength(1);
    });
  });
});

describe("KEEPOUT_VIOLATION — placements", () => {
  test("the courtyard is the extent, even when no pad enters the keepout", () => {
    const report = run({
      placements: [
        // Body spans x ∈ [-5, 5] around (-2, 4) ⇒ reaches x = 3, inside the
        // keepout; the single pad at the origin never does.
        bodyPlacement("U1", {
          positionMm: { x: -2, y: 4 },
          courtyardHalfMm: 5,
          pads: [pad("1", { x: 0, y: 0 }, 0.5, 0.5)] as never,
        }),
      ],
      keepouts: [
        keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, footprints: true }),
      ],
    });
    const found = keepoutViolations(report);
    expect(found).toHaveLength(1);
    expect(found[0]!.anchors).toEqual([
      { kind: "placement", placementId: "U1" },
      { kind: "keepout", keepoutId: "k1" },
    ]);
    expect(found[0]!.message).toBe(
      'Footprint U1 enters keepout "k1" on F.Cu (footprints forbidden)',
    );
    expect(found[0]!.locationMm).toEqual({ x: -2, y: 4 });
  });

  test("without a courtyard the preview bounds are the extent", () => {
    const report = run({
      placements: [
        bodyPlacement("U1", { positionMm: { x: -2, y: 4 }, boundsHalfMm: 5 }),
      ],
      keepouts: [
        keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, footprints: true }),
      ],
    });
    expect(keepoutViolations(report)).toHaveLength(1);
  });

  test("a placement with no describable extent is not evaluated", () => {
    const report = run({
      placements: [bodyPlacement("U1", { positionMm: { x: 4, y: 4 } })],
      keepouts: [
        keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, footprints: true }),
      ],
    });
    expect(keepoutViolations(report)).toEqual([]);
  });

  test("an inner-layer-only keepout never affects a placement", () => {
    const report = run({
      board: boardWithRules({ layerCount: 4 }),
      placements: [
        bodyPlacement("U1", { positionMm: { x: 4, y: 4 }, courtyardHalfMm: 3 }),
      ],
      keepouts: [
        keepoutRow("k1", ["In1.Cu"], SQUARE, { ...NONE, footprints: true }),
      ],
    });
    expect(keepoutViolations(report)).toEqual([]);
  });

  test("a B.Cu part is judged on B.Cu", () => {
    const back = run({
      board: board(),
      placements: [
        bodyPlacement("U1", {
          positionMm: { x: 4, y: 4 },
          layer: "B.Cu",
          courtyardHalfMm: 3,
        }),
      ],
      keepouts: [
        keepoutRow("k1", ["B.Cu"], SQUARE, { ...NONE, footprints: true }),
      ],
    });
    expect(keepoutViolations(back)).toHaveLength(1);
    expect(keepoutViolations(back)[0]!.layer).toBe("B.Cu");
  });
});

describe("KEEPOUT_VIOLATION — identity", () => {
  test("the id multiset does not depend on input order", () => {
    const keepouts = [
      keepoutRow("k1", ["F.Cu"], SQUARE, { ...NONE, tracks: true }),
      keepoutRow(
        "k2",
        ["F.Cu"],
        SQUARE.map((p) => ({ x: p.x + 10, y: p.y })),
        { ...NONE, tracks: true },
      ),
    ];
    const traces = [
      trace("t1", "n1", [
        [2, 4],
        [6, 4],
      ]),
      trace("t2", "n2", [
        [12, 4],
        [16, 4],
      ]),
    ];
    const ids = (p: DesignerPcbProjection) =>
      keepoutViolations(runDrc(p))
        .map((v) => v.id)
        .sort();

    const forward = ids(
      projection({ netNames: { n1: "A", n2: "B" }, traces, keepouts }),
    );
    const reversed = ids(
      projection({
        netNames: { n1: "A", n2: "B" },
        traces: [...traces].reverse(),
        keepouts: [...keepouts].reverse(),
      }),
    );
    expect(forward).toHaveLength(2);
    expect(reversed).toEqual(forward);
  });

  test("the keepout anchor renders through the panel label resolver", () => {
    const proj = projection({
      netNames: { n1: "SIG" },
      traces: [
        trace("t1", "n1", [
          [2, 4],
          [6, 4],
        ]),
      ],
      keepouts: [
        keepoutRow("keepout-abcdef", ["F.Cu"], SQUARE, {
          ...NONE,
          tracks: true,
        }),
      ],
    });
    const anchor = keepoutViolations(runDrc(proj))[0]!.anchors[1]!;
    expect(resolveAnchorLabel(anchor, proj)).toBe("keepout keepou");

    const named = projection({
      ...proj,
      keepouts: [{ ...proj.keepouts[0]!, name: "Antenna" }],
    });
    expect(
      resolveAnchorLabel(
        keepoutViolations(runDrc(named))[0]!.anchors[1]!,
        named,
      ),
    ).toBe("keepout Antenna");
  });
});

describe("copperPour keepouts and connectivity", () => {
  // Fill parity (contract §13.3): the ratsnest's pours subtract the same
  // keepouts every other fill site does, so a plane a keepout severs stops
  // connecting the pads it used to bridge.
  const GND_PADS = [
    placement("A", {
      positionMm: { x: -10, y: 0 },
      pads: [pad("1", { x: 0, y: 0 }, 2, 2)],
    }),
    placement("B", {
      positionMm: { x: 10, y: 0 },
      pads: [pad("1", { x: 0, y: 0 }, 2, 2)],
    }),
  ];
  const PAD_NETS = { "A|1": "gnd", "B|1": "gnd" };
  const ZONES = [boardZoneRow("F.Cu", "gnd")];

  /** Ratsnest for the GND plane, with `keepouts` subtracted from the pour. */
  function ratsnestWith(keepouts: DesignerPcbProjection["keepouts"]) {
    const settings = board();
    const copper = {
      layerCount: settings.layerCount,
      placements: GND_PADS,
      padNetIds: new Map(Object.entries(PAD_NETS)),
      freePads: [],
      traces: [],
      vias: [],
    };
    return computeRatsnest({
      ...copper,
      netNames: new Map([["gnd", "GND"]]),
      netClasses: settings.netClasses,
      pours: buildBoardPourFills(copper, {
        outline: settings.outline,
        designRules: settings.designRules,
        pours: boardPourSpecs(
          collectCopperZones({
            zones: ZONES,
            layerCount: settings.layerCount,
            knownNetIds: new Set(["gnd"]),
          }).zones,
          settings.designRules,
          collectKeepouts({ keepouts, layerCount: settings.layerCount })
            .keepouts,
          zonePourNets(settings, { gnd: "GND" }),
        ),
      }),
    });
  }

  /** A band across the whole board that cuts the plane in two. */
  const BAND = [
    { x: -1, y: -20 },
    { x: 1, y: -20 },
    { x: 1, y: 20 },
    { x: -1, y: 20 },
  ];
  const POUR_ONLY = { ...NONE, copperPour: true };

  test("the intact plane routes GND; the severed plane does not", () => {
    expect(ratsnestWith([])).toHaveLength(0);

    const severed = ratsnestWith([
      keepoutRow("k_band", ["F.Cu"], BAND, POUR_ONLY),
    ]);
    expect(severed).toHaveLength(1);

    const report = run({
      placements: GND_PADS,
      padNets: PAD_NETS,
      zones: ZONES,
      keepouts: [keepoutRow("k_band", ["F.Cu"], BAND, POUR_ONLY)],
      netNames: { gnd: "GND" },
      ratsnest: severed,
    });
    expect(
      report.violations.filter((v) => v.code === "UNCONNECTED_NET"),
    ).toHaveLength(1);
    // The band forbids copper pour only — no object is inside a forbidden class.
    expect(keepoutViolations(report)).toEqual([]);
  });
});
