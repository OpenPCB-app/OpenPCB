/**
 * The net path model and the junctions it walks
 * (docs/pcb-hardening/14-si-contract.md §1, §2, §7, §9).
 *
 * Every net here carries at least TWO pad terminals: under the path model a
 * trace-only net has no routed length at all (reason `terminals`), so a
 * fixture without pads would go quiet for the wrong reason.
 */
import { describe, expect, test } from "bun:test";
import {
  computeConnectivity,
  computeNetPaths,
  padItemKey,
  pourCopperItem,
  type ConnectivityResult,
  type CopperItem,
  type Junction,
  type NetPath,
  type NetPaths,
  type PourCopperItem,
} from "../../../shared/pcb-connectivity";
import { touchingSelfSegments } from "../../../shared/pcb-connectivity/contact-components";
import { segmentToSegmentDistance } from "../../../shared/pcb-geometry/pcb-trace-geometry";
import { CONNECT_EPS_MM } from "../../../shared/pcb-geometry/tolerance";
import type {
  PcbFreePad,
  PcbLayerCount,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../sdks/designer";
import { freePad, pad, placement, trace, via } from "./helpers/drc-fixtures";
import {
  buildItems,
  randomBoard,
  serialize,
  square,
} from "./helpers/pcb-connectivity-fixtures";

const NET = "n1";

interface Scene {
  items: CopperItem[];
  connectivity: ConnectivityResult;
  paths: NetPaths;
}

interface SceneInput {
  /** `[id, endpoint, outward direction]` — a circle pin that ENDS at the point. */
  pins?: Array<[string, PcbPointMm, PcbPointMm]>;
  placements?: PcbPlacedPart[];
  padNets?: Record<string, string>;
  traces?: PcbTrace[];
  vias?: PcbVia[];
  freePads?: PcbFreePad[];
  pours?: PourCopperItem[];
  layerCount?: PcbLayerCount;
  boardThicknessMm?: number;
}

/**
 * A circle pad of diameter 1 whose copper reaches EXACTLY `at`: the centreline
 * touches its boundary and never enters, so the pin attaches without clipping
 * any length off the trace it terminates.
 */
function endPin(id: string, at: PcbPointMm, dir: PcbPointMm): PcbPlacedPart {
  return placement(id, {
    positionMm: { x: at.x + dir.x * 0.5, y: at.y + dir.y * 0.5 },
    pads: [pad("1", { x: 0, y: 0 }, 1, 1, { shape: "circle" })],
  });
}

function scene(input: SceneInput): Scene {
  const placements = [
    ...(input.pins ?? []).map(([id, at, dir]) => endPin(id, at, dir)),
    ...(input.placements ?? []),
  ];
  const padNetIds = new Map<string, string>();
  for (const [id] of input.pins ?? []) padNetIds.set(`${id}|1`, NET);
  for (const [key, net] of Object.entries(input.padNets ?? {})) {
    padNetIds.set(key, net);
  }
  const layerCount = input.layerCount ?? 2;
  const items = [
    ...buildItems({
      layerCount,
      placements,
      padNetIds,
      traces: input.traces ?? [],
      vias: input.vias ?? [],
      freePads: input.freePads ?? [],
    }),
    ...(input.pours ?? []),
  ];
  const connectivity = computeConnectivity(items, { junctions: true });
  return {
    items,
    connectivity,
    paths: computeNetPaths({
      items,
      connectivity,
      layerCount,
      boardThicknessMm: input.boardThicknessMm ?? 1.6,
    }),
  };
}

function defined(path: NetPath): Extract<NetPath, { kind: "defined" }> {
  if (path.kind !== "defined") {
    throw new Error(`expected a defined path, got ${path.reason}`);
  }
  return path;
}

const w = (points: Array<[number, number]>, id: string, opts = {}) =>
  trace(id, NET, points, { widthMm: 0.2, ...opts });

const P = (x: number, y: number): PcbPointMm => ({ x, y });

/**
 * The arc-length parameter a junction records for one trace. Sides are keyed in
 * canonical (lexicographic) order, never in fixture order.
 */
function sOn(junction: Junction, traceId: string): number {
  const key = `trace:${traceId}`;
  if (junction.a === key && junction.sA !== null) return junction.sA;
  if (junction.b === key && junction.sB !== null) return junction.sB;
  throw new Error(`junction ${junction.a}/${junction.b} has no ${key} side`);
}

// ---------------------------------------------------------------------------
// §1 — junction locations
// ---------------------------------------------------------------------------

describe("junctions locate the S1 model's contacts (§1)", () => {
  test("a T-junction joins the branch at the point it meets the run", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(10, 0), P(1, 0)],
        ["C", P(5, 5), P(0, 1)],
      ],
      traces: [
        w([[0, 0], [10, 0]], "run"),
        w([[5, 0], [5, 5]], "branch"),
      ],
    });
    const junction = s.connectivity.junctions!.find((j) => j.kind === "point")!;
    expect(junction).toBeDefined();
    expect(sOn(junction, "run")).toBeCloseTo(5, 9);
    expect(sOn(junction, "branch")).toBeCloseTo(0, 9);
    const path = defined(s.paths.netPath(NET));
    expect(path.topology).toBe("tree");
    expect(path.lengthMm).toBeCloseTo(15, 9);
  });

  test("an X crossing joins at the exact centreline intersection", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(10, 0), P(1, 0)],
        ["C", P(5, -5), P(0, -1)],
        ["D", P(5, 5), P(0, 1)],
      ],
      traces: [
        w([[0, 0], [10, 0]], "h"),
        w([[5, -5], [5, 5]], "v"),
      ],
    });
    const junction = s.connectivity.junctions!.find((j) => j.kind === "point")!;
    expect(sOn(junction, "h")).toBeCloseTo(5, 9);
    expect(sOn(junction, "v")).toBeCloseTo(5, 9);
    expect(junction.pointMm.x).toBeCloseTo(5, 9);
    expect(junction.pointMm.y).toBeCloseTo(0, 9);
    expect(defined(s.paths.netPath(NET)).lengthMm).toBeCloseTo(20, 9);
  });

  test("a trace crossed twice by one partner yields TWO junctions", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      traces: [
        w([[0, 0], [20, 0]], "run"),
        w([[5, -2], [5, 2], [15, 2], [15, -2]], "bridge"),
      ],
    });
    const points = s.connectivity.junctions!.filter(
      (j) => j.kind === "point" && j.a !== j.b,
    );
    expect(points).toHaveLength(2);
    expect(points.map((j) => Math.round(sOn(j, "run")))).toEqual([5, 15]);
    expect(points.map((j) => Math.round(sOn(j, "bridge")))).toEqual([2, 16]);
  });

  test("a trace that crosses itself joins two NON-ADJACENT segments", () => {
    const s = scene({
      pins: [
        ["A", P(-2, 0), P(-1, 0)],
        ["B", P(2, -1), P(1, 0)],
      ],
      traces: [
        w([[-2, 0], [1, 0], [1, 1], [0, -1], [2, -1]], "s"),
      ],
    });
    const self = s.connectivity.junctions!.filter((j) => j.kind === "self");
    expect(self.length).toBeGreaterThanOrEqual(1);
    expect(self[0]!.sA).toBeCloseTo(2.5, 9);
    expect(self[0]!.sB).toBeCloseTo(4 + Math.sqrt(1.25), 9);
    const path = defined(s.paths.netPath(NET));
    // The whole polyline is 8.236068 mm; the route between the two pins takes
    // the short cut through the crossing.
    expect(path.lengthMm).toBeCloseTo(5.618034, 6);
    expect(path.branchLengthMm).toBeCloseTo(2.618034, 6);
  });

  test("a non-parallel approach sits at the closest approach, not mid-band", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(10, 0), P(1, 0)],
      ],
      traces: [
        w([[0, 0], [10, 0]], "run"),
        w([[0, 0.15], [10, 4]], "rise"),
      ],
    });
    const junction = s.connectivity.junctions!.find(
      (j) => j.kind === "point" && j.a !== j.b,
    )!;
    expect(sOn(junction, "run")).toBeCloseTo(0, 9);
    expect(sOn(junction, "rise")).toBeCloseTo(0, 9);
  });

  test("a collinear overlap joins at the MIDPOINT of the contact band", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      traces: [w([[0, 0], [20, 0]], "run"), w([[5, 0], [15, 0]], "copy")],
    });
    const junction = s.connectivity.junctions!.find(
      (j) => j.kind === "point" && j.a !== j.b,
    )!;
    expect(sOn(junction, "run")).toBeCloseTo(10, 6);
    expect(sOn(junction, "copy")).toBeCloseTo(5, 6);
  });
});

// ---------------------------------------------------------------------------
// §2.2 — terminal attachment and interior clipping
// ---------------------------------------------------------------------------

describe("terminals attach and clip (§2.2)", () => {
  test("a pad the centreline never enters still attaches by its body", () => {
    const s = scene({
      pins: [
        ["A", P(-3, 1.05), P(-1, 0)],
        ["B", P(3, 1.05), P(1, 0)],
      ],
      placements: [
        placement("C", {
          positionMm: { x: 0, y: 0 },
          pads: [pad("1", { x: 0, y: 0 }, 2, 2, { shape: "circle" })],
        }),
      ],
      padNets: { "C|1": NET },
      traces: [w([[-3, 1.05], [3, 1.05]], "run")],
    });
    const path = defined(s.paths.netPath(NET));
    expect(path.terminals).toHaveLength(3);
    expect(path.topology).toBe("tree");
    // Nothing is clipped: the centreline never enters the disc.
    expect(path.lengthMm).toBeCloseTo(6, 9);
    const attach = s.connectivity.junctions!.find(
      (j) => j.kind === "terminal" && j.attachS !== null,
    )!;
    expect(attach.inside).toHaveLength(0);
    expect(attach.attachS).toBeCloseTo(3, 6);
  });

  test("a pad in the MIDDLE of a trace is an interior node, never length", () => {
    const s = scene({
      pins: [
        ["A", P(-2, 0), P(-1, 0)],
        ["B", P(2, 0), P(1, 0)],
      ],
      placements: [
        placement("C", {
          positionMm: { x: 0, y: 0 },
          pads: [pad("1", { x: 0, y: 0 }, 2, 2, { shape: "circle" })],
        }),
      ],
      padNets: { "C|1": NET },
      traces: [w([[-2, 0], [2, 0]], "run")],
    });
    const path = defined(s.paths.netPath(NET));
    expect(path.terminals).toHaveLength(3);
    expect(path.lengthMm).toBeCloseTo(2, 9);
    expect(path.segments).toHaveLength(2);
    expect(path.segments.map((seg) => [seg.s0, seg.s1])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  test("one pin with two copper shapes is ONE terminal", () => {
    const s = scene({
      placements: [
        placement("U1", {
          positionMm: { x: 0, y: 0 },
          pads: [
            pad("1", { x: 0, y: 0 }, 1, 1),
            pad("1", { x: 0, y: 2 }, 1, 1),
          ],
        }),
        endPin("U2", P(10, 0), P(1, 0)),
      ],
      padNets: { "U1|1": NET, "U2|1": NET },
      traces: [w([[0, 0], [10, 0]], "run")],
    });
    expect(s.items.filter((i) => i.kind === "pad")).toHaveLength(3);
    const path = defined(s.paths.netPath(NET));
    expect(path.terminals).toHaveLength(2);
    expect(path.topology).toBe("chain");
  });

  test("an unplated pad is never a terminal", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(10, 0), P(1, 0)],
      ],
      placements: [
        placement("NP", {
          positionMm: { x: 5, y: 0 },
          pads: [
            pad("1", { x: 0, y: 0 }, 2, 2, {
              drillDiameterMm: 0.8,
              plated: false,
            }),
          ],
        }),
      ],
      padNets: { "NP|1": NET },
      traces: [w([[0, 0], [10, 0]], "run")],
    });
    const path = defined(s.paths.netPath(NET));
    expect(path.terminals).toHaveLength(2);
    expect(
      path.terminals.some((t) => t.kind === "pad" && t.placementId === "NP"),
    ).toBe(false);
    // Nothing was clipped either: the rings are null-net copper, not a pin.
    expect(path.lengthMm).toBeCloseTo(10, 9);
  });
});

// ---------------------------------------------------------------------------
// §2.3–§2.4 — clustering, contraction, uniqueness and the measured subtree
// ---------------------------------------------------------------------------

describe("uniqueness and the measured subtree (§2.4)", () => {
  test("a full duplicate record is a loop", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(10, 0), P(1, 0)],
      ],
      traces: [w([[0, 0], [10, 0]], "t1"), w([[0, 0], [10, 0]], "t2")],
    });
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "loop",
    });
  });

  test("a partial duplicate on one trace is a pruned branch", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      traces: [w([[0, 0], [20, 0]], "run"), w([[5, 0], [15, 0]], "copy")],
    });
    const path = defined(s.paths.netPath(NET));
    expect(path.lengthMm).toBeCloseTo(20, 6);
    expect(path.branchLengthMm).toBeCloseTo(10, 6);
  });

  test("a ring hanging off ONE node leaves the path unique", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      traces: [
        w([[0, 0], [20, 0]], "run"),
        w([[10, 0], [12, 3], [8, 3], [10, 0]], "ring"),
      ],
    });
    const path = defined(s.paths.netPath(NET));
    expect(path.lengthMm).toBeCloseTo(20, 6);
    expect(path.branchLengthMm).toBeGreaterThan(10);
  });

  test("a ring through TWO path nodes is a loop", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      traces: [
        w([[0, 0], [20, 0]], "run"),
        w([[5, 0], [5, 4], [15, 4], [15, 0]], "detour"),
      ],
    });
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "loop",
    });
  });

  test("a via dropped on a pad at a trace end contracts to one node", () => {
    const s = scene({
      pins: [["A", P(0, 0), P(-1, 0)]],
      placements: [
        placement("P", {
          positionMm: { x: 10, y: 0 },
          pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
        }),
      ],
      padNets: { "P|1": NET },
      traces: [w([[0, 0], [10, 0]], "run")],
      vias: [via("v", { netId: NET, center: { x: 10, y: 0 } })],
    });
    // Pad–via, pad–trace and via–trace are three zero-weight edges: without
    // contraction before the bridge test they would read as a cycle.
    const path = defined(s.paths.netPath(NET));
    expect(path.lengthMm).toBeCloseTo(9.5, 9);
    expect(path.viaCount).toBe(0);
  });

  test("three terminals report the TREE TOTAL, and a stub is a branch", () => {
    const s = scene({
      pins: [
        ["A", P(1, 0), P(1, 0)],
        ["B", P(-1, 0), P(-1, 0)],
        ["C", P(0, 1), P(0, 1)],
      ],
      traces: [
        w([[0, 0], [1, 0]], "a"),
        w([[0, 0], [-1, 0]], "b"),
        w([[0, 0], [0, 1]], "c"),
        w([[0, 0], [0, -1]], "stub"),
      ],
    });
    const path = defined(s.paths.netPath(NET));
    expect(path.topology).toBe("tree");
    expect(path.lengthMm).toBeCloseTo(3, 9);
    expect(path.branchLengthMm).toBeCloseTo(1, 9);
  });

  test("cuts within CONNECT_EPS_MM are ONE node of bounded diameter", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(10, 0), P(1, 0)],
      ],
      traces: [w([[0, 0], [10, 0]], "run")],
      // Via centres are unquantised mm, so 3e-7 mm apart is expressible where
      // the nanometre trace grid could not express it.
      vias: [
        via("v1", { netId: NET, center: { x: 5, y: 0 } }),
        via("v2", { netId: NET, center: { x: 5 + 3e-7, y: 0 } }),
      ],
    });
    const path = defined(s.paths.netPath(NET));
    expect(path.segments).toHaveLength(2);
    for (const segment of path.segments) {
      expect(segment.s1 - segment.s0).toBeGreaterThan(CONNECT_EPS_MM);
      expect(segment.s1 - segment.s0).toBeCloseTo(4.6, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// §2.5 — vias
// ---------------------------------------------------------------------------

describe("vias (§2.5)", () => {
  test("two through vias outer-to-outer contribute the board thickness twice", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      traces: [
        w([[0, 0], [8, 0]], "f1"),
        w([[8, 0], [12, 0]], "b", { layer: "B.Cu" }),
        w([[12, 0], [20, 0]], "f2"),
      ],
      vias: [
        via("v1", { netId: NET, center: { x: 8, y: 0 } }),
        via("v2", { netId: NET, center: { x: 12, y: 0 } }),
      ],
    });
    const path = defined(s.paths.netPath(NET));
    expect(path.viaCount).toBe(2);
    expect(path.viaLengthMm).toBeCloseTo(3.2, 9);
    expect(path.lengthMm).toBeCloseTo(path.copperLengthMm + 3.2, 9);
  });

  test("a through via traversed to an INNER layer is undefined", () => {
    const s = scene({
      layerCount: 4,
      pins: [["A", P(0, 0), P(-1, 0)]],
      freePads: [
        freePad("inner", {
          center: { x: 16.5, y: 0 },
          layer: "In1.Cu",
          netId: NET,
        }),
      ],
      traces: [
        w([[0, 0], [8, 0]], "f"),
        w([[8, 0], [16, 0]], "i", { layer: "In1.Cu" }),
      ],
      vias: [via("v", { netId: NET, center: { x: 8, y: 0 } })],
    });
    expect(s.paths.netPath(NET)).toEqual({ kind: "undefined", reason: "via" });
  });

  test("a blind via is undefined even when fully traversed", () => {
    const s = scene({
      layerCount: 4,
      pins: [["A", P(0, 0), P(-1, 0)]],
      freePads: [
        freePad("inner", {
          center: { x: 16.5, y: 0 },
          layer: "In1.Cu",
          netId: NET,
        }),
      ],
      traces: [
        w([[0, 0], [8, 0]], "f"),
        w([[8, 0], [16, 0]], "i", { layer: "In1.Cu" }),
      ],
      vias: [
        via("v", {
          netId: NET,
          center: { x: 8, y: 0 },
          toLayer: "In1.Cu",
          viaType: "blind",
        }),
      ],
    });
    expect(s.paths.netPath(NET)).toEqual({ kind: "undefined", reason: "via" });
  });
});

// ---------------------------------------------------------------------------
// §2.6–§2.7 — pours, open nets, and the terminal count
// ---------------------------------------------------------------------------

describe("pours and undefined reasons (§2.6, §2.7)", () => {
  const island = (memberKeys: string[]): PourCopperItem =>
    pourCopperItem({
      layer: "F.Cu",
      netId: NET,
      pourIndex: 0,
      index: 0,
      rings: [square(-2, -2, 22, 2)],
      memberKeys,
    });

  const twoPins: SceneInput = {
    pins: [
      ["A", P(0, 0), P(-1, 0)],
      ["B", P(20, 0), P(1, 0)],
    ],
    traces: [{ ...trace("run", NET, [[0, 0], [20, 0]], { widthMm: 0.2 }) }],
  };

  test("an island touching ONE subtree node leaves the path defined", () => {
    const s = scene({
      ...twoPins,
      pours: [island([padItemKey("B", "1", 0)])],
    });
    expect(defined(s.paths.netPath(NET)).lengthMm).toBeCloseTo(20, 6);
  });

  test("an island reaching TWO subtree nodes bypasses the route", () => {
    const s = scene({
      ...twoPins,
      pours: [island([padItemKey("A", "1", 0), padItemKey("B", "1", 0)])],
    });
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "pour",
    });
  });

  test("terminals joined ONLY by a pour are undefined for the same reason", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      pours: [island([padItemKey("A", "1", 0), padItemKey("B", "1", 0)])],
    });
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "pour",
    });
  });

  test("terminals in different components are open", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
    });
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "open",
    });
  });

  test("fewer than two pins has no routed length at all", () => {
    const s = scene({
      pins: [["A", P(0, 0), P(-1, 0)]],
      traces: [w([[0, 0], [10, 0]], "run")],
    });
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "terminals",
    });
    expect(s.paths.netPath("absent")).toEqual({
      kind: "undefined",
      reason: "terminals",
    });
  });
});

// ---------------------------------------------------------------------------
// §7 — determinism
// ---------------------------------------------------------------------------

describe("determinism (§7)", () => {
  /**
   * A DEFINED fixture, deliberately: the branch leaves the run at x = 6, which
   * is on the F.Cu span, so the whole net is one measured tree. Put it at
   * x = 10 and it lands on the B.Cu jog, the net goes `open`, and every
   * byte-identity assertion below would be comparing two copies of the word
   * "open" while proving nothing.
   */
  const rich = (shift: PcbPointMm = P(0, 0), reversed = false): SceneInput => {
    const at = (x: number, y: number): [number, number] => [
      x + shift.x,
      y + shift.y,
    ];
    const line = (
      id: string,
      points: Array<[number, number]>,
      opts: { layer?: PcbTrace["layer"] } = {},
    ): PcbTrace =>
      trace(id, NET, reversed ? [...points].reverse() : points, {
        widthMm: 0.2,
        ...opts,
      });
    return {
      pins: [
        ["A", P(shift.x, shift.y), P(-1, 0)],
        ["B", P(20 + shift.x, shift.y), P(1, 0)],
        ["C", P(6 + shift.x, 6 + shift.y), P(0, 1)],
      ],
      traces: [
        line("f1", [at(0, 0), at(8, 0)]),
        line("b", [at(8, 0), at(12, 0)], { layer: "B.Cu" }),
        line("f2", [at(12, 0), at(20, 0)]),
        line("branch", [at(6, 0), at(6, 6)]),
      ],
      vias: [
        via("v1", { netId: NET, center: { x: 8 + shift.x, y: shift.y } }),
        via("v2", { netId: NET, center: { x: 12 + shift.x, y: shift.y } }),
      ],
    };
  };

  const dump = (paths: NetPaths): string =>
    JSON.stringify(paths.netIds.map((id) => [id, paths.netPath(id)]));

  test("reversing and shuffling the item array is byte-identical", () => {
    const base = scene(rich());
    const expected = dump(base.paths);
    expect(expected).toContain('"kind":"defined"');
    expect(defined(base.paths.netPath(NET)).lengthMm).toBeCloseTo(27.6, 9);

    const rerun = (items: CopperItem[]) =>
      dump(
        computeNetPaths({
          items,
          connectivity: computeConnectivity(items, { junctions: true }),
          layerCount: 2,
          boardThicknessMm: 1.6,
        }),
      );
    expect(rerun([...base.items].reverse())).toBe(expected);
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let round = 0; round < 50; round += 1) {
      const shuffled = [...base.items];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rnd() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(rerun(shuffled)).toBe(expected);
    }
  });

  test("reversing every trace's points keeps every measure", () => {
    const base = defined(scene(rich()).paths.netPath(NET));
    const flipped = defined(scene(rich(P(0, 0), true)).paths.netPath(NET));
    expect(flipped.lengthMm).toBeCloseTo(base.lengthMm, 9);
    expect(flipped.copperLengthMm).toBeCloseTo(base.copperLengthMm, 9);
    expect(flipped.viaLengthMm).toBeCloseTo(base.viaLengthMm, 9);
    expect(flipped.viaCount).toBe(base.viaCount);
    expect(flipped.branchLengthMm).toBeCloseTo(base.branchLengthMm, 9);
    expect(flipped.topology).toBe(base.topology);
    expect(flipped.terminals).toEqual(base.terminals);
  });

  test("a rigid translation of the whole board moves no measure", () => {
    const base = defined(scene(rich()).paths.netPath(NET));
    // Integer nanometres, so the trace grid re-quantises to the same geometry.
    const moved = defined(scene(rich(P(123.456, -78.9))).paths.netPath(NET));
    expect(moved.lengthMm).toBeCloseTo(base.lengthMm, 9);
    expect(moved.copperLengthMm).toBeCloseTo(base.copperLengthMm, 9);
    expect(moved.branchLengthMm).toBeCloseTo(base.branchLengthMm, 9);
    expect(moved.viaCount).toBe(base.viaCount);
    expect(moved.topology).toBe(base.topology);
  });

  test("junctions are sorted, frozen and witnessed once per unordered pair", () => {
    const s = scene(rich());
    const junctions = s.connectivity.junctions!;
    expect(Object.isFrozen(junctions)).toBe(true);
    expect(junctions.every((j) => Object.isFrozen(j))).toBe(true);
    expect(junctions.every((j) => j.a <= j.b)).toBe(true);
    const keys = junctions.map((j) => [j.a, j.b, j.layer, j.sA ?? -Infinity]);
    expect(keys.length).toBeGreaterThan(3);
    expect(new Set(keys.map((k) => k.join("|"))).size).toBe(keys.length);
    for (let i = 1; i < keys.length; i += 1) {
      const [pa, pb, pl, ps] = keys[i - 1]! as [string, string, string, number];
      const [a, b, l, sa] = keys[i]! as [string, string, string, number];
      expect(
        pa < a ||
          (pa === a && (pb < b || (pb === b && (pl < l || (pl === l && ps <= sa))))),
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §1 — the option costs the S1 result nothing
// ---------------------------------------------------------------------------

describe("junctions never move an S1 result (§1)", () => {
  test("components and contact records are byte-identical either way", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const items = randomBoard(seed);
      const off = computeConnectivity(items);
      const on = computeConnectivity(items, { junctions: true });
      expect(off.junctions).toBeUndefined();
      expect(on.junctions).toBeDefined();
      expect(serialize(on)).toBe(serialize(off));
    }
  });

  test("a random board's paths are computable and deterministic", () => {
    for (const seed of [11, 12, 13]) {
      const items = randomBoard(seed);
      const connectivity = computeConnectivity(items, { junctions: true });
      const run = (order: CopperItem[]) => {
        const paths = computeNetPaths({
          items: order,
          connectivity,
          layerCount: 4,
          boardThicknessMm: 1.6,
        });
        return JSON.stringify(
          paths.netIds.map((id) => [id, paths.netPath(id)]),
        );
      };
      expect(run(items)).toContain("undefined");
      expect(run([...items].reverse())).toBe(run(items));
    }
  });
});

// ---------------------------------------------------------------------------
// §1 — contact components are decided by SPAN OVERLAP, not index adjacency
// ---------------------------------------------------------------------------

describe("contact components (§1, as amended)", () => {
  test("a narrow vee crossing one trace twice is TWO junctions, not one", () => {
    // The two limbs are ADJACENT segments of `vee`, but their crossings are
    // 0.1 mm apart on `run` and a hundred millimetres apart along `vee`: one
    // junction would hide the loop the vee closes through the run.
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      traces: [
        w([[0, 0], [20, 0]], "run"),
        w([[5, -1], [5.05, 50], [5.1, -1]], "vee"),
      ],
    });
    const crossings = s.connectivity.junctions!.filter(
      (j) => j.kind === "point" && j.a !== j.b,
    );
    expect(crossings).toHaveLength(2);
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "loop",
    });
  });

  test("a near-parallel run of forty segment pairs is ONE junction", () => {
    const along = (y: number): Array<[number, number]> =>
      Array.from({ length: 41 }, (_, i) => [i * 0.5, y] as [number, number]);
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      traces: [w(along(0), "run"), w(along(0.15), "near")],
    });
    const crossings = s.connectivity.junctions!.filter(
      (j) => j.kind === "point" && j.a !== j.b,
    );
    expect(crossings).toHaveLength(1);
  });

  test("the prefiltered self-segment scan equals the naive cross product", () => {
    let seed = 99;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let found = 0;
    for (let board = 0; board < 50; board += 1) {
      const count = 4 + Math.floor(rnd() * 8);
      const points: PcbPointMm[] = [];
      for (let i = 0; i < count; i += 1) {
        points.push({
          x: Math.round(rnd() * 40) / 10,
          y: Math.round(rnd() * 40) / 10,
        });
      }
      const hw = 0.1;
      const reach = 2 * hw + CONNECT_EPS_MM;
      const naive: string[] = [];
      for (let i = 0; i + 1 < points.length; i += 1) {
        const a0 = points[i]!;
        const a1 = points[i + 1]!;
        if (a0.x === a1.x && a0.y === a1.y) continue;
        for (let j = i + 2; j + 1 < points.length; j += 1) {
          const b0 = points[j]!;
          const b1 = points[j + 1]!;
          if (b0.x === b1.x && b0.y === b1.y) continue;
          if (segmentToSegmentDistance(a0, a1, b0, b1) <= reach) {
            naive.push(`${i},${j}`);
          }
        }
      }
      const filtered = touchingSelfSegments(points, hw, CONNECT_EPS_MM).map(
        ([i, j]) => `${i},${j}`,
      );
      expect(filtered.sort()).toEqual(naive.sort());
      found += naive.length;
    }
    // Guard the fixture: a prefilter that dropped everything would agree with
    // a naive scan that found nothing.
    expect(found).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// §1 — a fold-back is located where the copper meets, and only once
// ---------------------------------------------------------------------------

describe("fold-back junctions (§1)", () => {
  test("the cap attaches at its MINIMUM-distance point on the body", () => {
    // The cap at (0,0) rests on the return leg. Its nearest point on that leg
    // is 9.99775 mm along; the fold-back boolean's own witness is the FARTHEST
    // point still in reach, which is 0.13 mm further and is not where the
    // copper meets.
    const s = scene({
      pins: [["A", P(2.5, 0), P(0, -1)]],
      traces: [w([[0, 0], [5, 0], [0, 0.15]], "hairpin")],
    });
    const head = s.connectivity
      .junctions!.filter((j) => j.kind === "self")
      .find((j) => j.sB! < 10.0005)!;
    expect(head).toBeDefined();
    expect(head.sA).toBeCloseTo(0, 9);
    expect(head.sB).toBeCloseTo(9.99775, 5);
  });

  test("one fold-back contact yields ONE junction", () => {
    // The cap contact and the non-adjacent segment pair (0, 2) are the same
    // physical contact component; it must not be recorded twice, in two places.
    const s = scene({
      pins: [["A", P(0, 0), P(-1, 0)]],
      traces: [w([[10.15, 0.15], [12, 0.15], [12, 0], [0, 0]], "u")],
    });
    const self = s.connectivity.junctions!.filter((j) => j.kind === "self");
    expect(self).toHaveLength(1);
    expect(self[0]!.sA).toBeCloseTo(0.925, 6);
    expect(self[0]!.sB).toBeCloseTo(2.925, 6);
  });
});

// ---------------------------------------------------------------------------
// §2.6 — a pour bypasses only when it touches the path in two SEPARATE places
// ---------------------------------------------------------------------------

describe("pour bypass is a contact-set count (§2.6, as amended)", () => {
  const ring = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): PcbPointMm[] => square(x0, y0, x1, y1);

  const isle = (
    rings: PcbPointMm[][],
    memberKeys: string[],
  ): PourCopperItem =>
    pourCopperItem({
      layer: "F.Cu",
      netId: NET,
      pourIndex: 0,
      index: 0,
      rings,
      memberKeys,
    });

  const run: SceneInput = {
    pins: [
      ["A", P(0, 0), P(-1, 0)],
      ["B", P(10, 0), P(1, 0)],
    ],
    traces: [{ ...trace("run", NET, [[0, 0], [10, 0]], { widthMm: 0.2 }) }],
  };

  test("an island lying along ONE stretch of a trace leaves the path defined", () => {
    const s = scene({
      ...run,
      pours: [isle([ring(8, -1, 9, 1)], ["trace:run"])],
    });
    expect(defined(s.paths.netPath(NET)).lengthMm).toBeCloseTo(10, 9);
  });

  test("an island reaching the SAME trace at two separated stretches bypasses", () => {
    // A plane with a cutout the trace crosses: copper at x ∈ [2,4] and [6,8],
    // nothing in between — a second conductor in parallel with the run.
    const s = scene({
      ...run,
      pours: [
        isle([ring(2, -1, 8, 1), ring(4, -0.9, 6, 0.9)], ["trace:run"]),
      ],
    });
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "pour",
    });
  });

  test("an island crossing a shared node contiguously is ONE contact", () => {
    // The mid pad cuts the run into two subtree edges meeting at its pin; the
    // island runs across that pin without a break, so it joins nothing new.
    const s = scene({
      pins: [
        ["A", P(-2, 0), P(-1, 0)],
        ["B", P(2, 0), P(1, 0)],
      ],
      placements: [
        placement("C", {
          positionMm: { x: 0, y: 0 },
          pads: [pad("1", { x: 0, y: 0 }, 2, 2, { shape: "circle" })],
        }),
      ],
      padNets: { "C|1": NET },
      traces: [{ ...trace("run", NET, [[-2, 0], [2, 0]], { widthMm: 0.2 }) }],
      pours: [isle([ring(-1.5, -1.4, 1.5, 1.4)], ["trace:run"])],
    });
    expect(defined(s.paths.netPath(NET)).lengthMm).toBeCloseTo(2, 9);
  });
});

// ---------------------------------------------------------------------------
// §2.7 — the input contract, and copper the model cannot locate
// ---------------------------------------------------------------------------

describe("the path model never guesses (§2.7)", () => {
  const twoPads: SceneInput = {
    pins: [
      ["A", P(0, 0), P(-1, 0)],
      ["B", P(10, 0), P(1, 0)],
    ],
  };

  test("connectivity without contact locations is refused at the boundary", () => {
    const s = scene(twoPads);
    expect(() =>
      computeNetPaths({
        items: s.items,
        connectivity: computeConnectivity(s.items),
        layerCount: 2,
        boardThicknessMm: 1.6,
      }),
    ).toThrow(/junctions: true/);
  });

  test("S1-connected copper the model cannot locate is `unresolved`", () => {
    // The island joined the two pins in S1 but is not among the items the path
    // model was given, so nothing in the graph explains the connection. Saying
    // `pour` here would name a cause that is not in evidence.
    const s = scene({
      ...twoPads,
      pours: [
        pourCopperItem({
          layer: "F.Cu",
          netId: NET,
          pourIndex: 0,
          index: 0,
          rings: [square(-2, -2, 12, 2)],
          memberKeys: [padItemKey("A", "1", 0), padItemKey("B", "1", 0)],
        }),
      ],
    });
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "pour",
    });
    const withoutIsland = computeNetPaths({
      items: s.items.filter((item) => item.kind !== "pour"),
      connectivity: s.connectivity,
      layerCount: 2,
      boardThicknessMm: 1.6,
    });
    expect(withoutIsland.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "unresolved",
    });
  });
});

// ---------------------------------------------------------------------------
// §2.2 / §2.6 — Astra run 2: contacts and islands are COUNTED, not collapsed
// ---------------------------------------------------------------------------

describe("every contact is resolved on its own (Astra run 2)", () => {
  /** A circle pin of Ø0.2 centred ON the point, so it clips 0.1 mm of trace. */
  const tinyPin = (id: string, at: PcbPointMm): PcbPlacedPart =>
    placement(id, {
      positionMm: at,
      pads: [pad("1", { x: 0, y: 0 }, 0.2, 0.2, { shape: "circle" })],
    });

  const loopPins = {
    placements: [tinyPin("A", P(-5, 0.45)), tinyPin("B", P(-5, -0.45))],
    padNets: { "A|1": NET, "B|1": NET },
    vias: [via("v", { netId: NET, center: { x: 0, y: 0 } })],
  };

  test("a trace passing ONE via twice attaches both times", () => {
    // Both horizontal runs graze the barrel without their centrelines entering
    // it. Resolving the pair once attached the first run only, and the closed
    // loop read as one 20.7 mm chain instead of a 9.8 mm route with a loop
    // hanging off it.
    const s = scene({
      ...loopPins,
      traces: [
        w([[-5, 0.45], [5, 0.45], [5, -0.45], [-5, -0.45]], "loop"),
      ],
    });
    const path = defined(s.paths.netPath(NET));
    expect(path.lengthMm).toBeCloseTo(9.8, 9);
    expect(path.branchLengthMm).toBeCloseTo(10.9, 9);
    const viaContacts = s.connectivity.junctions!.filter(
      (j) => j.kind === "terminal" && j.b === "via:v",
    );
    expect(viaContacts).toHaveLength(2);
  });

  test("the same copper split into three records measures the same", () => {
    const one = defined(
      scene({
        ...loopPins,
        traces: [w([[-5, 0.45], [5, 0.45], [5, -0.45], [-5, -0.45]], "loop")],
      }).paths.netPath(NET),
    );
    const three = defined(
      scene({
        ...loopPins,
        traces: [
          w([[-5, 0.45], [5, 0.45]], "t1"),
          w([[5, 0.45], [5, -0.45]], "t2"),
          w([[5, -0.45], [-5, -0.45]], "t3"),
        ],
      }).paths.netPath(NET),
    );
    // Prefix sums over one polyline and over three records are different float
    // summations of the same lengths, so this agrees to ulps, not to bytes.
    expect(three.lengthMm).toBeCloseTo(one.lengthMm, 12);
    expect(three.branchLengthMm).toBeCloseTo(one.branchLengthMm, 12);
    expect(three.topology).toBe(one.topology);
    expect(three.terminals).toEqual(one.terminals);
  });

  const islandOf = (
    index: number,
    ring: Array<[number, number]>,
  ): PourCopperItem =>
    pourCopperItem({
      layer: "F.Cu",
      netId: NET,
      pourIndex: index,
      index: 0,
      rings: [ring.map(([x, y]) => ({ x, y }))],
      memberKeys: ["trace:run"],
    });

  test("a collinear vertex inside an island does not split its contact", () => {
    // The middle segment is wholly enclosed, so it has no boundary crossing;
    // leaving it unclassified turned one continuous contact into two and
    // invented a bypass out of a redrawn vertex.
    const ends = {
      placements: [tinyPin("A", P(0, 0)), tinyPin("B", P(10, 0))],
      padNets: { "A|1": NET, "B|1": NET },
      pours: [islandOf(0, [[2, -1], [8, -1], [8, 1], [2, 1]])],
    };
    const plain = defined(
      scene({ ...ends, traces: [w([[0, 0], [10, 0]], "run")] }).paths.netPath(
        NET,
      ),
    );
    const split = defined(
      scene({
        ...ends,
        traces: [w([[0, 0], [3, 0], [7, 0], [10, 0]], "run")],
      }).paths.netPath(NET),
    );
    expect(plain.lengthMm).toBeCloseTo(9.8, 9);
    expect(split.lengthMm).toBeCloseTo(9.8, 9);
  });

  const longRun = {
    placements: [tinyPin("A", P(0, 0)), tinyPin("B", P(20, 0))],
    padNets: { "A|1": NET, "B|1": NET },
    traces: [{ ...trace("run", NET, [[0, 0], [20, 0]], { widthMm: 0.2 }) }],
  };

  test("two OVERLAPPING islands are one conductor and bypass together", () => {
    const s = scene({
      ...longRun,
      pours: [
        islandOf(0, [[2, -1], [4, -1], [4, 2], [11, 2], [11, 3], [2, 3]]),
        islandOf(1, [[9, 2], [16, 2], [16, -1], [18, -1], [18, 3], [9, 3]]),
      ],
    });
    expect(s.paths.netPath(NET)).toEqual({
      kind: "undefined",
      reason: "pour",
    });
  });

  test("two DISJOINT islands touching the route once each do not", () => {
    const s = scene({
      ...longRun,
      pours: [
        islandOf(0, [[2, -1], [4, -1], [4, 1], [2, 1]]),
        islandOf(1, [[16, -1], [18, -1], [18, 1], [16, 1]]),
      ],
    });
    expect(defined(s.paths.netPath(NET)).lengthMm).toBeCloseTo(19.8, 9);
  });

  test("every retained segment names its own trace and width", () => {
    const s = scene({
      pins: [
        ["A", P(0, 0), P(-1, 0)],
        ["B", P(20, 0), P(1, 0)],
      ],
      traces: [
        w([[0, 0], [10, 0]], "wide", { widthMm: 0.5 }),
        w([[10, 0], [20, 0]], "narrow", { widthMm: 0.1 }),
        // A pruned branch of a THIRD width sharing the mid node: matching a
        // segment to a trace by its endpoints would hand its width over.
        w([[10, 0], [10, 5]], "stub", { widthMm: 0.8 }),
      ],
    });
    const path = defined(s.paths.netPath(NET));
    const widths = new Map(
      path.segments.map((seg) => [seg.traceKey, seg.halfWidthMm]),
    );
    expect(widths.get("trace:wide")).toBeCloseTo(0.25, 12);
    expect(widths.get("trace:narrow")).toBeCloseTo(0.05, 12);
    expect(widths.has("trace:stub")).toBe(false);
  });
});
