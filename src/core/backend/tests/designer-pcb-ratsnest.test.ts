/**
 * Ratsnest over the shared copper-connectivity kernel. Every fixture carries
 * REAL pad rings, trace polylines and via discs — the kernel connects copper,
 * not pad centres, so a centre-only fixture would pass vacuously.
 * Contract: docs/pcb-hardening/01-connectivity-contract.md §5.
 */
import { describe, expect, test } from "bun:test";
import {
  computeRatsnest,
  type ComputeRatsnestContext,
} from "../../../modules/designer/backend/pcb/ratsnest";
import { findGroundNetId } from "../../../modules/designer/backend/pcb/net-class-resolver";
import type {
  PcbBoardOutline,
  PcbFreePad,
  PcbNetClass,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  RatsnestSegment,
} from "../../../sdks/designer";
import {
  board,
  freePad,
  pad,
  placement,
  trace,
  via,
} from "./helpers/drc-fixtures";
import {
  buildBoardPourFills,
  computeBoardConnectivity,
  type BoardCopperInput,
  type BoardPourSpec,
} from "../../../modules/designer/backend/pcb/board-connectivity";
import { zonePourNets } from "../../../shared/pcb-areas/pour-params";

const NET_CLASSES: PcbNetClass[] = [
  {
    id: "default",
    name: "Default",
    traceWidthMm: 0.25,
    clearanceMm: 0.2,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#e5e7eb",
    defaultViaProtection: "tented",
  },
];

const OUTLINE: PcbBoardOutline = {
  kind: "rect",
  widthMm: 60,
  heightMm: 40,
  centerMm: { x: 0, y: 0 },
};

/** One placement carrying a single pad at the placement origin. */
function padPart(
  id: string,
  at: { x: number; y: number },
  opts: {
    w?: number;
    h?: number;
    tht?: boolean;
    layer?: PcbPlacedPart["layer"];
  } = {},
): PcbPlacedPart {
  return placement(id, {
    positionMm: at,
    ...(opts.layer ? { layer: opts.layer } : {}),
    pads: [
      pad("1", { x: 0, y: 0 }, opts.w ?? 1, opts.h ?? 1, {
        ...(opts.tht ? { drillDiameterMm: 0.5 } : {}),
      }),
    ],
  });
}

/** Two-point trace, the only shape these fixtures need. */
function line(
  id: string,
  netId: string,
  a: [number, number],
  b: [number, number],
  layer?: PcbTrace["layer"],
): PcbTrace {
  return trace(id, netId, [a, b], layer ? { layer } : {});
}

/**
 * A `BoardPourSpec` is now structurally the composed zone params, so a fixture
 * pour has to state what the derivation would have stated: the zone tier
 * (0 — these fixtures set no zone override), the resolved per-obstacle
 * clearance, the board's minimum width and a solid pad connection. Since S6
 * the clearance comes from the SAME `RuleResolver` batch DRC uses, so a
 * fixture cannot quietly pour at a value no rule tier produces.
 */
type PourFixture = Pick<BoardPourSpec, "layer" | "netId"> &
  Partial<BoardPourSpec>;

const pourSpec = (spec: PourFixture): BoardPourSpec => {
  const settings = board();
  const { resolver } = zonePourNets(settings, {});
  return {
    clearanceMm: 0,
    clearanceForItem: (item) =>
      resolver.clearancePour(
        item.kind === "pad"
          ? "pourToPad"
          : item.kind === "via"
            ? "pourToVia"
            : "pourToTrace",
        spec.layer,
        spec.netId,
        { netId: item.netId, pointMm: item.pointMm },
      ).mm,
    minThicknessMm: settings.designRules.minimums.traceWidthMm,
    padConnection: "solid",
    ...spec,
  };
};

function run(input: {
  placements?: PcbPlacedPart[];
  padNets?: Record<string, string>;
  freePads?: PcbFreePad[];
  traces?: PcbTrace[];
  vias?: PcbVia[];
  netNames?: Record<string, string>;
  pours?: PourFixture[];
}): RatsnestSegment[] {
  const settings = board();
  const copper: BoardCopperInput = {
    layerCount: settings.layerCount,
    placements: input.placements ?? [],
    padNetIds: new Map(Object.entries(input.padNets ?? {})),
    freePads: input.freePads ?? [],
    traces: input.traces ?? [],
    vias: input.vias ?? [],
  };
  const ctx: ComputeRatsnestContext = {
    ...copper,
    netNames: new Map(Object.entries(input.netNames ?? {})),
    netClasses: NET_CLASSES,
    ...(input.pours
      ? {
          pours: buildBoardPourFills(copper, {
            outline: OUTLINE,
            designRules: settings.designRules,
            pours: input.pours.map(pourSpec),
          }),
        }
      : {}),
  };
  return computeRatsnest(ctx);
}

const onNet = (segs: RatsnestSegment[], netId: string): RatsnestSegment[] =>
  segs.filter((s) => s.netId === netId);

describe("computeRatsnest — MST over kernel components", () => {
  test("returns empty for a net with fewer than 2 pads", () => {
    const segs = run({
      placements: [padPart("A", { x: 0, y: 0 })],
      padNets: { "A|1": "n1" },
    });
    expect(segs).toEqual([]);
  });

  test("MST of a triangle picks the 2 shortest edges", () => {
    // A(0,0) — B(3,0) — C(0,4): edges 3, 4, 5 → keep A-B and A-C.
    const segs = run({
      placements: [
        padPart("A", { x: 0, y: 0 }),
        padPart("B", { x: 3, y: 0 }),
        padPart("C", { x: 0, y: 4 }),
      ],
      padNets: { "A|1": "n1", "B|1": "n1", "C|1": "n1" },
    });
    expect(segs).toHaveLength(2);
    const edges = segs
      .map((s) => `${s.fromMm.x},${s.fromMm.y}->${s.toMm.x},${s.toMm.y}`)
      .sort();
    expect(edges).toContain("0,0->3,0");
    expect(edges).toContain("0,0->0,4");
  });

  test("unrouted GND with no pour keeps its airwires", () => {
    const segs = run({
      placements: [
        padPart("A", { x: 0, y: 0 }),
        padPart("B", { x: 5, y: 0 }),
        padPart("C", { x: 10, y: 0 }),
        padPart("D", { x: 0, y: 10 }),
        padPart("E", { x: 5, y: 10 }),
      ],
      padNets: {
        "A|1": "n-gnd",
        "B|1": "n-gnd",
        "C|1": "n-gnd",
        "D|1": "n-sig",
        "E|1": "n-sig",
      },
      netNames: { "n-gnd": "GND", "n-sig": "SIG" },
    });
    expect(onNet(segs, "n-gnd")).toHaveLength(2);
    expect(onNet(segs, "n-sig")).toHaveLength(1);
  });

  test("two separate nets produce independent MSTs", () => {
    const segs = run({
      placements: [
        padPart("A", { x: 0, y: 0 }),
        padPart("B", { x: 5, y: 0 }),
        padPart("C", { x: 0, y: 10 }),
        padPart("D", { x: 5, y: 10 }),
        padPart("E", { x: 10, y: 10 }),
      ],
      padNets: {
        "A|1": "vcc",
        "B|1": "vcc",
        "C|1": "gnd",
        "D|1": "gnd",
        "E|1": "gnd",
      },
    });
    expect(segs).toHaveLength(3);
    expect(onNet(segs, "vcc")).toHaveLength(1);
    expect(onNet(segs, "gnd")).toHaveLength(2);
  });
});

describe("computeRatsnest — trace copper", () => {
  // A(0,0) — B(10,0) joined by t1; C(5,5) drops down to the T-junction.
  const parts = [
    padPart("A", { x: 0, y: 0 }, { tht: true }),
    padPart("B", { x: 10, y: 0 }, { tht: true }),
    padPart("C", { x: 5, y: 5 }, { tht: true }),
  ];
  const padNets = { "A|1": "n1", "B|1": "n1", "C|1": "n1" };
  const t1 = line("t1", "n1", [0, 0], [10, 0]);

  test("same-layer T-junction on a sibling's interior connects", () => {
    const segs = run({
      placements: parts,
      padNets,
      traces: [t1, line("t2", "n1", [5, 5], [5, 0])],
    });
    expect(onNet(segs, "n1")).toHaveLength(0);
  });

  test("interior touch on a DIFFERENT layer does not connect", () => {
    const segs = run({
      placements: parts,
      padNets,
      traces: [t1, line("t2", "n1", [5, 5], [5, 0], "B.Cu")],
    });
    expect(onNet(segs, "n1")).toHaveLength(1);
  });

  test("an end cap 5 µm short of the sibling centreline still overlaps", () => {
    // 0.25 mm-wide traces: the copper overlaps long before the centrelines do.
    const segs = run({
      placements: parts,
      padNets,
      traces: [t1, line("t2", "n1", [5, 5], [5, 0.005])],
    });
    expect(onNet(segs, "n1")).toHaveLength(0);
  });

  test("a genuinely open 0.5 mm gap stays open", () => {
    // Half widths sum to 0.25 mm — half the centreline separation.
    const segs = run({
      placements: parts,
      padNets,
      traces: [t1, line("t2", "n1", [5, 5], [5, 0.5])],
    });
    expect(onNet(segs, "n1")).toHaveLength(1);
  });

  test("a trace ending inside a pad ring off-centre connects", () => {
    const segs = run({
      placements: [
        padPart("A", { x: 0, y: 0 }, { w: 2, h: 1 }),
        padPart("B", { x: 10, y: 0 }, { w: 2, h: 1 }),
      ],
      padNets: { "A|1": "n1", "B|1": "n1" },
      traces: [line("t1", "n1", [0.8, 0], [10, 0])],
    });
    expect(onNet(segs, "n1")).toHaveLength(0);
  });

  test("a trace end cap 0.2 mm outside the pad ring stays open", () => {
    // Ring edge at x = 1, half width 0.125 → a cap at 1.325 leaves a 0.2 gap.
    const segs = run({
      placements: [
        padPart("A", { x: 0, y: 0 }, { w: 2, h: 1 }),
        padPart("B", { x: 10, y: 0 }, { w: 2, h: 1 }),
      ],
      padNets: { "A|1": "n1", "B|1": "n1" },
      traces: [line("t1", "n1", [1.325, 0], [10, 0])],
    });
    expect(onNet(segs, "n1")).toHaveLength(1);
  });
});

describe("computeRatsnest — vias and layers", () => {
  const parts = [
    padPart("A", { x: 0, y: 0 }, { tht: true }),
    padPart("B", { x: 10, y: 0 }, { tht: true }),
  ];
  const padNets = { "A|1": "n1", "B|1": "n1" };
  const crossLayer = [
    line("t1", "n1", [0, 0], [5, 0]),
    line("t2", "n1", [5, 0], [10, 0], "B.Cu"),
  ];

  test("F.Cu and B.Cu traces meeting at a point without a via stay open", () => {
    const segs = run({ placements: parts, padNets, traces: crossLayer });
    expect(onNet(segs, "n1")).toHaveLength(1);
  });

  test("a through via at that point connects them", () => {
    const segs = run({
      placements: parts,
      padNets,
      traces: crossLayer,
      vias: [via("v1", { netId: "n1", center: { x: 5, y: 0 } })],
    });
    expect(onNet(segs, "n1")).toHaveLength(0);
  });

  test("a via on a trace INTERIOR bridges an F.Cu run to a B.Cu run", () => {
    const segs = run({
      placements: [
        padPart("A", { x: 0, y: 0 }, { tht: true }),
        padPart("B", { x: 5, y: 5 }, { tht: true }),
      ],
      padNets: { "A|1": "n1", "B|1": "n1" },
      traces: [
        line("t1", "n1", [0, 0], [10, 0]),
        line("t2", "n1", [5, 0], [5, 5], "B.Cu"),
      ],
      vias: [via("v1", { netId: "n1", center: { x: 5, y: 0 } })],
    });
    expect(onNet(segs, "n1")).toHaveLength(0);
  });

  test("a B.Cu trace at the XY of F.Cu-only SMD pads does not connect", () => {
    const backTrace = line("t1", "n1", [0, 0], [10, 0], "B.Cu");
    const smd = run({
      placements: [padPart("A", { x: 0, y: 0 }), padPart("B", { x: 10, y: 0 })],
      padNets: { "A|1": "n1", "B|1": "n1" },
      traces: [backTrace],
    });
    expect(onNet(smd, "n1")).toHaveLength(1);

    const tht = run({
      placements: [
        padPart("A", { x: 0, y: 0 }, { tht: true }),
        padPart("B", { x: 10, y: 0 }, { tht: true }),
      ],
      padNets: { "A|1": "n1", "B|1": "n1" },
      traces: [backTrace],
    });
    expect(onNet(tht, "n1")).toHaveLength(0);
  });
});

describe("computeRatsnest — free pads", () => {
  test("a std free pad stitches two trace runs into one component", () => {
    const segs = run({
      placements: [padPart("A", { x: 0, y: 0 }), padPart("B", { x: 10, y: 0 })],
      padNets: { "A|1": "n1", "B|1": "n1" },
      freePads: [
        freePad("fp1", {
          padType: "std",
          center: { x: 5, y: 0 },
          widthMm: 1,
          heightMm: 1,
          drillMm: 0.5,
          netId: "n1",
        }),
      ],
      traces: [
        line("t1", "n1", [0, 0], [4.8, 0]),
        line("t2", "n1", [5.2, 0], [10, 0]),
      ],
    });
    expect(onNet(segs, "n1")).toHaveLength(0);
  });

  test("a net made only of free pads produces a freePad-anchored airwire", () => {
    const segs = run({
      freePads: [
        freePad("tp1", { center: { x: 0, y: 0 }, netId: "n2" }),
        freePad("tp2", { center: { x: 8, y: 0 }, netId: "n2" }),
      ],
    });
    expect(segs).toHaveLength(1);
    expect(segs[0]!.netId).toBe("n2");
    expect(segs[0]!.from.kind).toBe("freePad");
    expect(segs[0]!.to.kind).toBe("freePad");
  });
});

describe("computeRatsnest — pour-aware connectivity", () => {
  const parts = [
    padPart("A", { x: -12, y: 0 }, { w: 2, h: 2 }),
    padPart("B", { x: 12, y: 0 }, { w: 2, h: 2 }),
  ];
  const padNets = { "A|1": "gnd", "B|1": "gnd" };

  test("GND pads under a same-net F.Cu pour need no airwire", () => {
    const segs = run({
      placements: parts,
      padNets,
      pours: [{ layer: "F.Cu", netId: "gnd" }],
    });
    expect(onNet(segs, "gnd")).toHaveLength(0);
  });

  test("without the pour the same pads keep their airwire", () => {
    const segs = run({ placements: parts, padNets, pours: [] });
    expect(onNet(segs, "gnd")).toHaveLength(1);
  });

  test("a pour on a different net does not connect GND", () => {
    const segs = run({
      placements: parts,
      padNets,
      pours: [{ layer: "F.Cu", netId: "vcc" }],
    });
    expect(onNet(segs, "gnd")).toHaveLength(1);
  });

  test("trace → via → B.Cu island → THT pad is one component", () => {
    const segs = run({
      placements: [
        padPart("A", { x: -12, y: 0 }, { w: 2, h: 2 }),
        padPart("B", { x: 12, y: 0 }, { w: 2, h: 2, tht: true }),
      ],
      padNets,
      traces: [line("t1", "gnd", [-12, 0], [-5, 0])],
      vias: [via("v1", { netId: "gnd", center: { x: -5, y: 0 } })],
      pours: [{ layer: "B.Cu", netId: "gnd" }],
    });
    expect(onNet(segs, "gnd")).toHaveLength(0);
  });
});

describe("computeRatsnest — overlapping same-net zones", () => {
  const zone = (minX: number, maxX: number) => [
    { x: minX, y: 1 },
    { x: maxX, y: 1 },
    { x: maxX, y: 10 },
    { x: minX, y: 10 },
  ];
  const parts = [
    padPart("A", { x: 3, y: 5 }, { w: 2, h: 2 }),
    padPart("B", { x: 16, y: 5 }, { w: 2, h: 2 }),
  ];
  const padNets = { "A|1": "gnd", "B|1": "gnd" };

  test("two overlapping zones of one net are a single conductor", () => {
    const segs = run({
      placements: parts,
      padNets,
      pours: [
        { layer: "F.Cu", netId: "gnd", clipPolygonMm: zone(1, 10) },
        { layer: "F.Cu", netId: "gnd", clipPolygonMm: zone(8, 18) },
      ],
    });
    expect(onNet(segs, "gnd")).toHaveLength(0);
  });

  test("two disjoint zones of one net still need an airwire", () => {
    const segs = run({
      placements: parts,
      padNets,
      pours: [
        { layer: "F.Cu", netId: "gnd", clipPolygonMm: zone(1, 10) },
        { layer: "F.Cu", netId: "gnd", clipPolygonMm: zone(12, 18) },
      ],
    });
    expect(onNet(segs, "gnd")).toHaveLength(1);
  });

  test("islands of two pours on one layer and net get distinct keys", () => {
    const copper: BoardCopperInput = {
      layerCount: board().layerCount,
      placements: parts,
      padNetIds: new Map(Object.entries(padNets)),
      freePads: [],
      traces: [],
      vias: [],
    };
    const { items } = computeBoardConnectivity({
      ...copper,
      pours: buildBoardPourFills(copper, {
        outline: OUTLINE,
        designRules: board().designRules,
        pours: [
          pourSpec({ layer: "F.Cu", netId: "gnd", clipPolygonMm: zone(1, 10) }),
          pourSpec({ layer: "F.Cu", netId: "gnd", clipPolygonMm: zone(12, 18) }),
        ],
      }),
    });
    const pourKeys = items.filter((i) => i.kind === "pour").map((i) => i.key);
    expect(pourKeys).toEqual(["pour:F.Cu:gnd:0:0", "pour:F.Cu:gnd:1:0"]);
  });
});

describe("computeRatsnest — pins whose copper is degenerate", () => {
  test("a zero-area pad still counts as a pin and keeps its airwire", () => {
    // The 0 × 1 mm pad has no copper item; without the record-based pin pass
    // the net would shrink to one pad and report nothing at all.
    const segs = run({
      placements: [
        placement("A", {
          positionMm: { x: 0, y: 0 },
          pads: [pad("1", { x: 0, y: 0 }, 0, 1)],
        }),
        padPart("B", { x: 10, y: 0 }),
      ],
      padNets: { "A|1": "n1", "B|1": "n1" },
    });
    expect(onNet(segs, "n1")).toHaveLength(1);
    expect(segs[0]!.from).toEqual({
      kind: "pad",
      placementId: "A",
      padNumber: "1",
    });
  });
});

describe("computeRatsnest — pad numbers are free text", () => {
  test('pads "1", "1" and "1#2" are two pins, not three or one', () => {
    // The occurrence suffix must not be able to forge another pin's identity:
    // the second shape of pin "1" and the single shape of pin "1#2" would
    // collide under a concatenated key.
    const segs = run({
      placements: [
        placement("U1", {
          positionMm: { x: 0, y: 0 },
          pads: [
            pad("1", { x: 0, y: 0 }, 1, 1),
            pad("1", { x: 4, y: 0 }, 1, 1),
            pad("1#2", { x: 8, y: 0 }, 1, 1),
          ],
        }),
      ],
      padNets: { "U1|1": "n1", "U1|1#2": "n1" },
    });
    expect(onNet(segs, "n1")).toHaveLength(1);
    expect(segs[0]!.from.kind === "pad" && segs[0]!.from.padNumber).toBe("1");
    expect(segs[0]!.to.kind === "pad" && segs[0]!.to.padNumber).toBe("1#2");
  });
});

describe("computeRatsnest — determinism", () => {
  test("reversing every input array yields identical output", () => {
    const placements = [
      padPart("A", { x: 0, y: 0 }, { tht: true }),
      padPart("B", { x: 10, y: 0 }, { tht: true }),
      padPart("C", { x: 5, y: 8 }, { tht: true }),
    ];
    const padNets = { "A|1": "n1", "B|1": "n1", "C|1": "n1" };
    const traces = [
      line("t1", "n1", [0, 0], [4, 0]),
      line("t2", "n1", [6, 0], [10, 0], "B.Cu"),
    ];
    const vias = [
      via("v1", { netId: "n1", center: { x: 4, y: 0 } }),
      via("v2", { netId: "n1", center: { x: 6, y: 0 } }),
    ];
    const freePads = [
      freePad("fp1", { center: { x: 20, y: 0 }, netId: "n3" }),
      freePad("fp2", { center: { x: 24, y: 0 }, netId: "n3" }),
    ];
    const forward = run({ placements, padNets, traces, vias, freePads });
    const reversed = run({
      placements: [...placements].reverse(),
      padNets,
      traces: [...traces].reverse(),
      vias: [...vias].reverse(),
      freePads: [...freePads].reverse(),
    });
    expect(forward.length).toBeGreaterThan(0);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

describe("findGroundNetId (default pour net)", () => {
  test("matches common ground net names, case-insensitive", () => {
    for (const name of ["GND", "gnd", "GROUND", "AGND", "VSS", "earth"]) {
      expect(findGroundNetId(new Map([["n1", name]]))).toBe("n1");
    }
  });

  test("returns null when no ground net exists", () => {
    expect(
      findGroundNetId(
        new Map([
          ["n1", "VCC"],
          ["n2", "SIG"],
        ]),
      ),
    ).toBeNull();
  });

  test("picks the ground net among several", () => {
    expect(
      findGroundNetId(
        new Map([
          ["n1", "VCC"],
          ["n2", "GND"],
          ["n3", "SIG"],
        ]),
      ),
    ).toBe("n2");
  });
});
