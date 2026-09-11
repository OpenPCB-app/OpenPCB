/**
 * S12 WP4 — the copper-shape check (DFM contract 11 §5, §9).
 *
 * Two layers of assertion:
 *
 *  - KERNEL ORACLE: `groupComponents` / `findNecks` / `findSlivers` fed
 *    hand-built polygons, where the §5.4 residual arithmetic has closed forms
 *    (a convex corner of interior angle `α` at erosion radius `r` leaves
 *    `area = r²(cot(α/2) − (π−α)/2)` and `length = r(cot(α/2) + (π−α)/2)`) and
 *    a fixture board could not express the shape at all.
 *  - BOARD: the real `runDrc`, so the units, the anchors, the messages, the
 *    budget reports and the byte-identity promise are all judged on the path
 *    the product takes.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../shared/drc/drc-engine";
import { NON_OVERRIDABLE, RULE_CLASS_BY_CODE, DEFAULT_SEVERITY_BY_CODE } from "../../../shared/drc/severity";
import {
  analyseGroup,
  groupComponents,
  DEFAULT_COPPER_SHAPE_BUDGETS,
  EROSION_MARGIN_MM,
  type CopperShapeBudgets,
} from "../../../shared/rendering/copper-fill/copper-shape-kernel";
import { union } from "../../../shared/rendering/copper-fill/copper-geometry-kernel";
import type { PathsD } from "clipper2-ts";
import type {
  DesignerPcbProjection,
  DrcReport,
  DrcViolation,
  PcbBoardSettings,
  PcbFreePad,
  PcbZone,
} from "../../../sdks/designer";
import {
  board,
  freeHole,
  freePad,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

// --- shared helpers ---------------------------------------------------------

/** The default effective width: `min(dfm 0.1, minimums.traceWidthMm 0.2)`. */
const W = 0.1;
const R = W / 2 - EROSION_MARGIN_MM; // 0.049

const SHAPE_CODES = new Set([
  "COPPER_CONNECTION_WIDTH",
  "COPPER_SLIVER",
  "COPPER_SHAPE_UNCHECKED",
  "TRACE_ACUTE_ANGLE",
  "TRACE_OVERLAP",
]);

/** Only this check's violations — every fixture also trips width / net rules. */
function shape(report: DrcReport): DrcViolation[] {
  return report.violations.filter((v) => SHAPE_CODES.has(v.code));
}

function withCode(report: DrcReport, code: string): DrcViolation[] {
  return report.violations.filter((v) => v.code === code);
}

/** A board whose `dfm` group is set explicitly (the parser's own shape). */
function dfmBoard(dfm: PcbBoardSettings["designRules"]["dfm"]): PcbBoardSettings {
  const base = board();
  return {
    ...base,
    designRules: { ...base.designRules, ...(dfm ? { dfm } : {}) },
  };
}

/** Rect SMD free pad — the one primitive that gives exact rectangular copper. */
function rect(
  id: string,
  center: { x: number; y: number },
  widthMm: number,
  heightMm: number,
  netId: string | null = "n1",
): PcbFreePad {
  return freePad(id, { center, widthMm, heightMm, netId });
}

/**
 * Two 1 mm lobes joined by an `n`-wide bridge whose NARROW span is exactly
 * `lengthMm`: the bridge overhangs each lobe by 0.1 mm so the union is a clean
 * NonZero merge rather than an exact edge abutment.
 */
function neckBoard(n: number, lengthMm: number): DesignerPcbProjection {
  const half = lengthMm / 2;
  return projection({
    board: board(),
    netNames: { n1: "GND" },
    freePads: [
      rect("lobeA", { x: -0.5 - half, y: 0 }, 1, 1),
      rect("lobeB", { x: 0.5 + half, y: 0 }, 1, 1),
      rect("bridge", { x: 0, y: 0 }, lengthMm + 0.2, n),
    ],
  });
}

// --- §5.3 necks: the verdict band ------------------------------------------

describe("COPPER_CONNECTION_WIDTH — the verdict band (§5.2, §5.3)", () => {
  for (const lengthMm of [0.01, 1.0]) {
    for (const n of [0.05, 0.096]) {
      test(`a ${n} mm neck ${lengthMm} mm long reports ≈${n}`, () => {
        const necks = withCode(
          runDrc(neckBoard(n, lengthMm)),
          "COPPER_CONNECTION_WIDTH",
        );
        expect(necks).toHaveLength(1);
        // A SHORT neck goes through the bisection and is exact to 2δ; a long
        // one is a residual channel whose measure is the MEAN width
        // `τ = nL/(n+L)`, which approaches `n` from below (§5.3 (i)).
        // A short neck is `2ρ` from the bisection, exact to 2δ; a channel is
        // the LOCAL copper width at its marker — the chord of `P` along the
        // wall normal — which is the nominal width, not the residual's mean.
        expect(necks[0]!.measuredMm!).toBeCloseTo(n, 3);
        expect(necks[0]!.measuredMm!).toBeLessThan(W);
        expect(necks[0]!.requiredMm).toBe(W);
        expect(necks[0]!.anchors).toEqual([{ kind: "net", netId: "n1" }]);
        expect(necks[0]!.layer).toBe("F.Cu");
        // The marker sits in the bridge, between the two lobes.
        expect(Math.abs(necks[0]!.locationMm!.x)).toBeLessThanOrEqual(
          lengthMm / 2 + 0.11,
        );
      });
    }

    for (const n of [0.104, 0.15]) {
      test(`a ${n} mm web ${lengthMm} mm long is not a neck`, () => {
        const report = runDrc(neckBoard(n, lengthMm));
        expect(withCode(report, "COPPER_CONNECTION_WIDTH")).toEqual([]);
        expect(withCode(report, "COPPER_SLIVER")).toEqual([]);
      });
    }
  }

  test("an L-shaped (bent) connector reports the neck at the bend", () => {
    const n = 0.05;
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "GND" },
        freePads: [
          // A true elbow: each bar ENDS at the corner square, so the union has
          // no wider crossing blob that would survive the bars' own erosion.
          rect("barV", { x: 0, y: 1.0375 }, n, 2.125),
          rect("barH", { x: 1.0375, y: 0 }, 2.125, n),
          rect("lobeA", { x: 0, y: 2.5 }, 1, 1),
          rect("lobeB", { x: 2.5, y: 0 }, 1, 1),
        ],
      }),
    );
    const necks = withCode(report, "COPPER_CONNECTION_WIDTH");
    // The elbow square admits a slightly larger disc than the bars do
    // (r = 0.0293 vs 0.025), so it survives as a transient third core between
    // those two radii and each LEG is reported as its own 0.05 mm run. Both
    // markers are true and both sit on the connector.
    expect(necks.length).toBeGreaterThanOrEqual(1);
    for (const neck of necks) {
      expect(neck.measuredMm!).toBeCloseTo(n, 3);
      const p = neck.locationMm!;
      const onBar =
        (Math.abs(p.x) <= 0.05 && p.y > -0.05 && p.y < 2.2) ||
        (Math.abs(p.y) <= 0.05 && p.x > -0.05 && p.x < 2.2);
      expect(onBar).toBe(true);
    }
  });

  test("a lone 0.08 mm trace between two pads IS a neck (§5.1: nothing is excluded for being narrow)", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "GND" },
        placements: [
          placement("U1", {
            positionMm: { x: 0, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
          placement("U2", {
            positionMm: { x: 3, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "U1|1": "n1", "U2|1": "n1" },
        traces: [trace("t1", "n1", [[0, 0], [3, 0]], { widthMm: 0.08 })],
      }),
    );
    const necks = withCode(report, "COPPER_CONNECTION_WIDTH");
    expect(necks).toHaveLength(1);
    // The residual channel's mean width: 0.08 x 3 mm -> 0.08·3/3.08.
    expect(necks[0]!.measuredMm!).toBeCloseTo(0.08, 3);
    expect(necks[0]!.locationMm!.x).toBeCloseTo(1.5, 1);
    // The same copper is ALSO the sliver residual; §5.4's fourth bullet says the
    // neck owns it, so exactly one verdict is reported for one piece of copper.
    expect(withCode(report, "COPPER_SLIVER")).toEqual([]);
  });

  test("two 0.08 mm traces side by side are a 0.13 mm connection, not a neck", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "GND" },
        freePads: [
          rect("lobeA", { x: -1.5, y: 0 }, 1, 1),
          rect("lobeB", { x: 1.5, y: 0 }, 1, 1),
        ],
        traces: [
          trace("tA", "n1", [[-1.2, 0.025], [1.2, 0.025]], { widthMm: 0.08 }),
          trace("tB", "n1", [[-1.2, -0.025], [1.2, -0.025]], { widthMm: 0.08 }),
        ],
      }),
    );
    expect(withCode(report, "COPPER_CONNECTION_WIDTH")).toEqual([]);
  });

  test("a corner contact is a zero-width neck located at the contact", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        freePads: [
          rect("padA", { x: 0, y: 0 }, 1, 1),
          rect("padB", { x: 1, y: 1 }, 1, 1),
        ],
      }),
    );
    const necks = withCode(report, "COPPER_CONNECTION_WIDTH");
    expect(necks).toHaveLength(1);
    expect(necks[0]!.measuredMm!).toBeLessThan(0.001);
    expect(necks[0]!.locationMm!.x).toBeCloseTo(0.5, 2);
    expect(necks[0]!.locationMm!.y).toBeCloseTo(0.5, 2);
  });

  test("a 0.1 mm trace never reports at w = 0.1, nor does a 1 nm segment", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        freePads: [
          rect("lobeA", { x: -1.5, y: 0 }, 1, 1),
          rect("lobeB", { x: 1.5, y: 0 }, 1, 1),
        ],
        traces: [
          // The middle vertex is 1 nm off the straight line: a real, persisted
          // one-nanometre segment, not a duplicate point.
          trace("t1", "n1", [[-1.2, 0], [0, 0], [0.000001, 0], [1.2, 0]], {
            widthMm: 0.1,
          }),
        ],
      }),
    );
    expect(withCode(report, "COPPER_CONNECTION_WIDTH")).toEqual([]);
    expect(withCode(report, "COPPER_SLIVER")).toEqual([]);
  });

  test("a 0.2 mm trace never reports at w = 0.2", () => {
    const report = runDrc(
      projection({
        board: dfmBoard({ sliverWidthMm: 0.2 }),
        netNames: { n1: "N1" },
        freePads: [
          rect("lobeA", { x: -1.5, y: 0 }, 1, 1),
          rect("lobeB", { x: 1.5, y: 0 }, 1, 1),
        ],
        traces: [trace("t1", "n1", [[-1.2, 0], [1.2, 0]], { widthMm: 0.2 })],
      }),
    );
    expect(withCode(report, "COPPER_CONNECTION_WIDTH")).toEqual([]);
    expect(withCode(report, "COPPER_SLIVER")).toEqual([]);
  });

  test("a board of round pads and vias has neither slivers nor necks", () => {
    const report = runDrc(
      projection({
        board: board(),
        placements: [
          placement("U1", {
            positionMm: { x: 0, y: 0 },
            pads: [
              pad("1", { x: 0, y: 0 }, 0.5, 0.5, { shape: "circle" }),
              pad("2", { x: 2, y: 0 }, 1, 1, { shape: "circle" }),
              pad("3", { x: 5, y: 0 }, 2, 2, { shape: "circle" }),
            ],
          }),
        ],
        vias: [
          via("v1", { center: { x: 0, y: 5 } }),
          via("v2", { center: { x: 2, y: 5 } }),
        ],
      }),
    );
    expect(withCode(report, "COPPER_SLIVER")).toEqual([]);
    expect(withCode(report, "COPPER_CONNECTION_WIDTH")).toEqual([]);
  });
});

// --- §5.1 null-net units ----------------------------------------------------

describe("Astra run 2 repros", () => {
  test("#1 an internal split inside an opening component is still bisected", () => {
    // Lobes 1 and 2 are joined by a SHORT 0.05 web, so the opening swallows
    // both into one component; lobes 2 and 3 by a LONG 0.08 channel, which is
    // a kind-1 residual. Unioning every core of every touched opening marked
    // the 1-2 connection explained, and its neck vanished.
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "GND" },
        freePads: [
          rect("lobe1", { x: 0, y: 0 }, 1, 1),
          rect("lobe2", { x: 1.01, y: 0 }, 1, 1),
          rect("lobe3", { x: 3.01, y: 0 }, 1, 1),
          rect("webShort", { x: 0.505, y: 0 }, 0.21, 0.05),
          rect("webLong", { x: 2.01, y: 0 }, 1.2, 0.08),
        ],
      }),
    );
    const necks = withCode(report, "COPPER_CONNECTION_WIDTH");
    expect(necks).toHaveLength(2);
    const sorted = [...necks].sort((a, b) => a.measuredMm! - b.measuredMm!);
    expect(sorted[0]!.measuredMm!).toBeCloseTo(0.05, 2);
    expect(sorted[0]!.locationMm!.x).toBeCloseTo(0.505, 1);
    expect(sorted[1]!.measuredMm!).toBeCloseTo(0.08, 2);
    expect(sorted[1]!.locationMm!.x).toBeCloseTo(2.01, 1);
  });

  test("#4 a core nested in another's hole is located at the throat", () => {
    // A frame with a square inside its hole, bridged across the 0.005 mm gap.
    // Comparing OUTER rings only put the marker 0.5 mm deep inside the frame.
    const paths = union(
      // The frame: outer CCW, hole CW.
      [
        ring([
          [-2, -2],
          [2, -2],
          [2, 2],
          [-2, 2],
        ]),
        ring([
          [-1, -1],
          [-1, 1],
          [1, 1],
          [1, -1],
        ]),
      ],
      [
        ring([
          [-0.995, -0.995],
          [0.995, -0.995],
          [0.995, 0.995],
          [-0.995, 0.995],
        ]),
      ],
      [
        ring([
          [0.9, -0.025],
          [1.1, -0.025],
          [1.1, 0.025],
          [0.9, 0.025],
        ]),
      ],
    );
    const [only] = analyse(paths);
    expect(only!.necks).toHaveLength(1);
    expect(Math.abs(only!.necks[0]!.locationMm.x - 1.0)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(only!.necks[0]!.locationMm.y)).toBeLessThanOrEqual(0.05);
  });

  test("#5 two nested 8192-vertex annuli finish fast with no findings", () => {
    const paths = union([
      circle(100, 8192),
      circle(99, 8192).reverse(),
      circle(98, 8192),
      circle(97, 8192).reverse(),
    ]);
    const t0 = performance.now();
    const found = analyse(paths);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
    for (const f of found) {
      expect(f.necks).toEqual([]);
      expect(f.slivers).toEqual([]);
    }
  });

  test("#5 a unit over the edge-comparison budget reports UNCHECKED", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "GND" },
        freePads: [
          rect("lobeA", { x: -0.6, y: 0 }, 1, 1),
          rect("lobeB", { x: 0.6, y: 0 }, 1, 1),
          rect("bridge", { x: 0, y: 0 }, 0.4, 0.05),
        ],
      }),
      { copperShapeBudgets: { maxEdgeComparisonsPerUnit: 10 } },
    );
    const skips = withCode(report, "COPPER_SHAPE_UNCHECKED");
    expect(skips).toHaveLength(1);
    expect(skips[0]!.message).toContain("edge-comparison budget");
    expect(withCode(report, "COPPER_CONNECTION_WIDTH")).toEqual([]);
  });

  test("#6 more groups than the erosion budget reports how many went unexamined", () => {
    const freePads = [];
    for (let i = 0; i < 601; i += 1) {
      freePads.push(
        rect(`p${String(i).padStart(4, "0")}`, { x: (i % 30) * 3, y: Math.floor(i / 30) * 3 }, 1, 1),
      );
    }
    const report = runDrc(projection({ board: board(), netNames: { n1: "GND" }, freePads }));
    const skips = withCode(report, "COPPER_SHAPE_UNCHECKED");
    expect(skips).toHaveLength(1);
    expect(skips[0]!.message).toContain("of 601 copper pieces not examined");
    expect(skips[0]!.message).toContain("erosion budget 600");
  });
});

describe("degenerate rules (§5.5, R2 #7)", () => {
  test("an effective web width below the erosion floor reports, never silence", () => {
    const report = runDrc(
      projection({
        board: dfmBoard({ sliverWidthMm: 0.002 }),
        netNames: { n1: "N1" },
        freePads: [
          rect("lobeA", { x: -0.6, y: 0 }, 1, 1),
          rect("lobeB", { x: 0.6, y: 0 }, 1, 1),
          rect("bridge", { x: 0, y: 0 }, 0.4, 0.05),
        ],
      }),
    );
    const skips = withCode(report, "COPPER_SHAPE_UNCHECKED");
    expect(skips).toHaveLength(1);
    expect(skips[0]!.anchors).toEqual([{ kind: "boardEdge" }]);
    expect(skips[0]!.message).toContain("below the 0.002 mm floor");
    expect(withCode(report, "COPPER_CONNECTION_WIDTH")).toEqual([]);
  });
});

describe("null-net units (§5.1)", () => {
  test("a pad strictly INSIDE another keeps its place in the unit (R2 #4)", () => {
    const report = runDrc(
      projection({
        board: board(),
        freePads: [
          // "fpOuter" > "fpInner" as an anchor key, so the nested pad is the
          // unit anchor — and only containment can find it.
          freePad("fpOuter", {
            center: { x: 0, y: 0 },
            widthMm: 2,
            heightMm: 2,
            netId: null,
          }),
          freePad("fpInner", {
            center: { x: 0, y: 0 },
            widthMm: 0.5,
            heightMm: 0.5,
            netId: null,
          }),
          // A corner contact so the unit has something to report.
          freePad("fpTouch", {
            center: { x: 2, y: 2 },
            widthMm: 2,
            heightMm: 2,
            netId: null,
          }),
        ],
      }),
    );
    const necks = withCode(report, "COPPER_CONNECTION_WIDTH");
    expect(necks).toHaveLength(1);
    expect(necks[0]!.anchors).toEqual([{ kind: "freePad", freePadId: "fpInner" }]);
  });

  test("two overlapping unassigned pads are ONE piece of copper with a throat", () => {
    const report = runDrc(
      projection({
        board: board(),
        freePads: [
          freePad("fpB", { center: { x: 0, y: 0 }, netId: null }),
          freePad("fpA", { center: { x: 0.97, y: 0.97 }, netId: null }),
        ],
      }),
    );
    const necks = withCode(report, "COPPER_CONNECTION_WIDTH");
    expect(necks).toHaveLength(1);
    expect(necks[0]!.measuredMm!).toBeLessThan(W);
    // The unit anchor is the SMALLEST item anchor key ("fp:fpA" < "fp:fpB").
    expect(necks[0]!.anchors).toEqual([{ kind: "freePad", freePadId: "fpA" }]);
  });

  test("two unrelated unassigned pads are two units and no neck", () => {
    const report = runDrc(
      projection({
        board: board(),
        freePads: [
          freePad("fp1", { center: { x: 0, y: 0 }, netId: null }),
          freePad("fp2", { center: { x: 10, y: 0 }, netId: null }),
        ],
      }),
    );
    expect(shape(report)).toEqual([]);
  });
});

// --- §5.4 slivers: the kernel oracle ---------------------------------------

/**
 * A big rectangular body carrying ONE convex spike of interior angle `alphaDeg`
 * at the origin, pointing in −x. The spike is long enough that the residual the
 * opening leaves is entirely inside it (`r·cot(α/2) ≪ 1 mm` for every angle
 * tested), so §5.4's closed form applies.
 */
function spikePaths(alphaDeg: number): PathsD {
  const half = ((alphaDeg / 2) * Math.PI) / 180;
  const h = 1;
  const t = h * Math.tan(half);
  return union([
    [
      { x: -h, y: 0 },
      { x: 0, y: -t },
      { x: 0, y: -5 },
      { x: 10, y: -5 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
      { x: 0, y: t },
    ],
  ]);
}

/** One closed ring as a Clipper path. */
function ring(points: Array<[number, number]>): Array<{ x: number; y: number }> {
  return points.map(([x, y]) => ({ x, y }));
}

/** Circle ring sampled densely enough that the chord error is far below τ. */
function circle(radius: number, segments = 256): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (Math.PI * 2 * i) / segments;
    out.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return out;
}

const ORACLE_BUDGETS: CopperShapeBudgets = DEFAULT_COPPER_SHAPE_BUDGETS;

/** `groupComponents` → `findNecks` → `findSlivers`, as the check chains them. */
function analyse(
  paths: PathsD,
  opts: { minLengthMm?: number; budgets?: CopperShapeBudgets; radiusMm?: number } = {},
) {
  const radiusMm = opts.radiusMm ?? R;
  const budgets = opts.budgets ?? ORACLE_BUDGETS;
  const work = { remaining: budgets.maxEdgeComparisonsPerUnit };
  const budget = { remaining: budgets.maxErosionsPerUnit };
  return groupComponents(paths, work).map((group) =>
    analyseGroup(group, radiusMm, {
      budgets,
      budget,
      work,
      minLengthMm: opts.minLengthMm ?? 0.2,
    }),
  );
}

/** How far a marker sits from a trace's copper (0 when it is on it). */
function distanceToCopper(
  marker: { x: number; y: number },
  pts: Array<[number, number]>,
  widthMm: number,
): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((marker.x - x0) * dx + (marker.y - y0) * dy) / len2),
          );
    best = Math.min(best, Math.hypot(marker.x - (x0 + dx * t), marker.y - (y0 + dy * t)));
  }
  return Math.max(0, best - widthMm / 2);
}

describe("COPPER_SLIVER — thickness and length (§5.4 kernel oracle)", () => {
  test("a 90° convex corner leaves a residual far too short to report", () => {
    const [only] = analyse(spikePaths(90));
    expect(only!.slivers).toEqual([]);
  });

  test("a 45° convex corner is 0.176 mm long — still below the 0.2 mm floor", () => {
    const [only] = analyse(spikePaths(45));
    expect(only!.slivers).toEqual([]);
  });

  test("a 35° convex spike reports", () => {
    const [only] = analyse(spikePaths(35));
    expect(only!.slivers).toHaveLength(1);
    const sliver = only!.slivers[0]!;
    expect(sliver.lengthMm).toBeGreaterThanOrEqual(0.2);
    expect(sliver.thicknessMm).toBeGreaterThan(1e-3);
    // Closed form: length = r(cot(α/2) + (π−α)/2) ≈ 0.217 at r = 0.049, less
    // the 2e-4 mm the residue guard trims off every boundary.
    expect(sliver.lengthMm).toBeGreaterThan(0.2);
    expect(sliver.lengthMm).toBeLessThan(0.23);
    // The marker sits in the spike, left of the body.
    expect(sliver.locationMm.x).toBeLessThan(0);
  });

  test("a 15 µm annulus reports its radial thickness", () => {
    const annulus = union([circle(1.0), circle(0.985).reverse()]);
    const [only] = analyse(annulus);
    expect(only!.slivers).toHaveLength(1);
    // τ = 2·area/perimeter IS the radial thickness for an annulus (§5.4).
    expect(only!.slivers[0]!.thicknessMm).toBeCloseTo(0.015, 3);
    expect(only!.slivers[0]!.lengthMm).toBeCloseTo(Math.PI * 1.985, 1);
    // The marker is ON the copper: the area centroid of an annulus is its
    // CENTRE, which is the hole, so the nearest boundary point is used instead.
    const m = only!.slivers[0]!.locationMm;
    expect(Math.hypot(m.x, m.y)).toBeGreaterThan(0.98);
    expect(Math.hypot(m.x, m.y)).toBeLessThan(1.005);
  });

  test("a 0.05 × 0.21 appendage reports; a 0.05 × 0.19 one does not", () => {
    // The rectangle's first 0.05 mm sits INSIDE the pad, so its protrusion is
    // `len − 0.05` and `length = perimeter/2 = 0.05 + (len − 0.05) = len`.
    const appendage = (len: number): PathsD =>
      union(
        [
          [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 0 },
            { x: -1, y: 0 },
          ],
        ],
        [
          [
            { x: -0.025, y: -0.05 },
            { x: 0.025, y: -0.05 },
            { x: 0.025, y: len - 0.05 },
            { x: -0.025, y: len - 0.05 },
          ],
        ],
      );
    const long = analyse(appendage(0.21))[0]!;
    expect(long.slivers).toHaveLength(1);
    expect(long.slivers[0]!.lengthMm).toBeGreaterThanOrEqual(0.2);
    // `τ = 2A/P` is the MEAN thickness: for a `w × L` rectangle it is
    // `wL/(w+L)`, not `w` — the contract's "τ ≈ w'" holds only for `L ≫ w'`.
    expect(long.slivers[0]!.thicknessMm).toBeGreaterThan(1e-3);
    expect(long.slivers[0]!.thicknessMm).toBeLessThanOrEqual(0.05);

    const short = analyse(appendage(0.19))[0]!;
    expect(short.slivers).toEqual([]);
  });
});

// --- §5.3 the U-shaped remote connector ------------------------------------

describe("neck location (§5.3)", () => {
  test("a U-shaped remote connector locates at the U, not in the slit", () => {
    // Two lobes 0.1 mm apart (the slit) whose ONLY copper connection is a
    // 0.05 mm bridge 2.475 mm away. The naive closest points of the eroded
    // cores sit in the slit, where there is no copper at all.
    const paths = union([
      ring([
        [0, 0.05],
        [2.45, 0.05],
        [2.45, 1],
        [0, 1],
      ]),
      ring([
        [0, -1],
        [2.45, -1],
        [2.45, -0.05],
        [0, -0.05],
      ]),
      ring([
        [2.45, -1],
        [2.5, -1],
        [2.5, 1],
        [2.45, 1],
      ]),
    ]);
    const [only] = analyse(paths);
    expect(only!.necks).toHaveLength(1);
    const neck = only!.necks[0]!;
    expect(neck.widthMm).toBeCloseTo(0.05, 3);
    // On the U, not in the slit.
    expect(neck.locationMm.x).toBeGreaterThan(2.4);
    expect(neck.locationMm.x).toBeLessThan(2.51);
  });

  test("an arc-routed 0.05 mm trace between two pads is ONE neck, marked ON the arc", () => {
    // A 90° arc of radius 3 as a 65-point polyline — the R2 #1 repro. The
    // channel's centroid falls in empty board inside the bend, so a marker
    // taken from the centroid (or from two cores' closest points) would not be
    // on the copper it names.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 64; i += 1) {
      const a = (Math.PI / 2) * (i / 64);
      pts.push([3 * Math.cos(a), 3 * Math.sin(a)]);
    }
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "GND" },
        freePads: [
          rect("padA", { x: 3, y: -0.4 }, 1, 1),
          rect("padB", { x: -0.4, y: 3 }, 1, 1),
        ],
        traces: [trace("arc", "n1", pts, { widthMm: 0.05 })],
      }),
    );
    const necks = withCode(report, "COPPER_CONNECTION_WIDTH");
    expect(necks).toHaveLength(1);
    expect(distanceToCopper(necks[0]!.locationMm!, pts, 0.05)).toBeLessThanOrEqual(0.03);
    // The chord across the band, not the residual's mean thickness.
    expect(necks[0]!.measuredMm!).toBeCloseTo(0.05, 2);
    // One piece of copper, one verdict.
    expect(withCode(report, "COPPER_SLIVER")).toEqual([]);
  });

  test("a dog-legged channel is ONE neck, marked on the channel", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "GND" },
        freePads: [
          rect("lobeA", { x: -2, y: 0 }, 1, 1),
          rect("lobeB", { x: 2, y: 1 }, 1, 1),
          // Z-shaped 0.05 mm channel: right, up, right.
          rect("legA", { x: -1.05, y: 0 }, 1.1, 0.05),
          rect("legB", { x: -0.525, y: 0.5 }, 0.05, 1.05),
          rect("legC", { x: 0.75, y: 1 }, 2.6, 0.05),
        ],
      }),
    );
    const necks = withCode(report, "COPPER_CONNECTION_WIDTH");
    expect(necks).toHaveLength(1);
    expect(necks[0]!.measuredMm!).toBeCloseTo(0.05, 3);
    // The marker is on one of the three legs, never in the empty board the
    // channel wraps around.
    const p = necks[0]!.locationMm!;
    const onLeg =
      (Math.abs(p.y) <= 0.04 && p.x > -1.65 && p.x < -0.45) ||
      (Math.abs(p.x + 0.525) <= 0.04 && p.y > -0.05 && p.y < 1.05) ||
      (Math.abs(p.y - 1) <= 0.04 && p.x > -0.6 && p.x < 2.1);
    expect(onLeg).toBe(true);
  });
});

describe("parallel bridges (§5.3 (i), R2 blocker 2)", () => {
  /** Two lobes joined by TWO sub-`w` bridges of different widths. */
  function parallelBridges(gapMm: number): DesignerPcbProjection {
    const half = gapMm / 2;
    return projection({
      board: board(),
      netNames: { n1: "GND" },
      freePads: [
        rect("lobeA", { x: -half - 0.5, y: 0 }, 1, 1),
        rect("lobeB", { x: half + 0.5, y: 0 }, 1, 1),
        rect("thin", { x: 0, y: 0.3 }, gapMm + 0.2, 0.05),
        rect("wide", { x: 0, y: -0.3 }, gapMm + 0.2, 0.08),
      ],
    });
  }

  for (const gapMm of [1.2, 0.16]) {
    test(`both bridges report across a ${gapMm} mm gap, each on its own bridge`, () => {
      const necks = withCode(
        runDrc(parallelBridges(gapMm)),
        "COPPER_CONNECTION_WIDTH",
      );
      expect(necks).toHaveLength(2);
      const sorted = [...necks].sort((a, b) => a.measuredMm! - b.measuredMm!);
      // Each channel is measured at its own marker, so both read their nominal
      // width — the verdict the bisection alone could never produce (it cuts
      // once, at the 0.08 mm bridge, and never sees the 0.05 mm one).
      expect(sorted[0]!.measuredMm!).toBeCloseTo(0.05, 3);
      expect(sorted[1]!.measuredMm!).toBeCloseTo(0.08, 3);
      // The narrow one is marked on the y = +0.3 bridge, the wide one on -0.3.
      expect(sorted[0]!.locationMm!.y).toBeGreaterThan(0);
      expect(sorted[1]!.locationMm!.y).toBeLessThan(0);
    });
  }
});

// --- §5.5 truncation and budgets -------------------------------------------

/** A chain of `count + 1` lobes joined by `count` bridges of distinct widths. */
function neckChain(count: number, order: "narrowestLast" | "narrowestFirst"): PathsD {
  const widths: number[] = [];
  for (let i = 0; i < count; i += 1) widths.push(0.02 + i * 0.001);
  if (order === "narrowestLast") widths.reverse();
  // `widths[i]` is the bridge to the RIGHT of lobe i, so "narrowest last" puts
  // the 0.02 mm bridge at the far end of the input order.
  const parts: PathsD = [];
  const pitch = 1.5;
  for (let i = 0; i <= count; i += 1) {
    const cx = i * pitch;
    parts.push([
      { x: cx - 0.5, y: -0.5 },
      { x: cx + 0.5, y: -0.5 },
      { x: cx + 0.5, y: 0.5 },
      { x: cx - 0.5, y: 0.5 },
    ]);
  }
  for (let i = 0; i < count; i += 1) {
    const n = widths[i]!;
    const x0 = i * pitch + 0.45;
    const x1 = (i + 1) * pitch - 0.45;
    parts.push([
      { x: x0, y: -n / 2 },
      { x: x1, y: -n / 2 },
      { x: x1, y: n / 2 },
      { x: x0, y: n / 2 },
    ]);
  }
  return union(parts);
}

describe("COPPER_SHAPE_UNCHECKED — explicit truncation (§5.5)", () => {
  test("65 necks with the narrowest last: the narrowest is reported first and the remainder is named", () => {
    // The erosion cap is lifted so the NECK cap (64) is what truncates.
    const budgets: CopperShapeBudgets = {
      ...DEFAULT_COPPER_SHAPE_BUDGETS,
      maxErosionsPerUnit: 200_000,
    };
    const [only] = analyse(neckChain(65, "narrowestLast"), { budgets });
    expect(only!.necks).toHaveLength(64);
    expect(only!.unlocatedCount).toBe(1);
    expect(only!.truncation).toBe("neckCap");
    expect(only!.unlocatedIsLowerBound).toBe(false);
    // Narrowest first, monotonically.
    const widths = only!.necks.map((n: { widthMm: number }) => n.widthMm);
    expect(widths[0]!).toBeCloseTo(0.02, 3);
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]!);
    }
  });

  /** A staircase of pads touching at their corners — zero-width necks only. */
  function cornerChain(count: number): PathsD {
    const parts: PathsD = [];
    for (let i = 0; i < count; i += 1) {
      const x = i * 1;
      const y = i * 1;
      parts.push([
        { x: x - 0.5, y: y - 0.5 },
        { x: x + 0.5, y: y - 0.5 },
        { x: x + 0.5, y: y + 0.5 },
        { x: x - 0.5, y: y + 0.5 },
      ]);
    }
    return union(parts);
  }

  test("the erosion budget truncates the BISECTION and says so as a lower bound", () => {
    // Corner contacts are invisible to the residual rule — the opening cuts
    // them in two — so every one of them costs a bisection.
    const budgets: CopperShapeBudgets = {
      ...DEFAULT_COPPER_SHAPE_BUDGETS,
      // One bisection round is ~10 erosions; five is not enough to converge.
      maxErosionsPerUnit: 5,
    };
    const [only] = analyse(cornerChain(6), { budgets });
    expect(only!.coreCount).toBe(6);
    expect(only!.necks.length).toBeLessThan(5);
    expect(only!.unlocatedCount).toBeGreaterThan(0);
    expect(only!.truncation).toBe("erosionBudget");
    expect(only!.unlocatedIsLowerBound).toBe(true);
  });

  test("a chain of corner contacts is fully located with the default budget", () => {
    const [only] = analyse(cornerChain(6));
    expect(only!.necks).toHaveLength(5);
    expect(only!.unlocatedCount).toBe(0);
    for (const neck of only!.necks) expect(neck.widthMm).toBeLessThan(0.001);
  });

  test("a unit over the vertex budget is skipped, never silently passed", () => {
    const report = runDrc(neckBoard(0.05, 1.0), {
      copperShapeBudgets: { vertexBudget: 10 },
    });
    const skips = withCode(report, "COPPER_SHAPE_UNCHECKED");
    expect(skips).toHaveLength(1);
    expect(skips[0]!.message).toContain("input vertices exceed the 10 budget");
    expect(skips[0]!.anchors).toEqual([{ kind: "net", netId: "n1" }]);
    // The neck it could not look for is NOT reported as absent.
    expect(withCode(report, "COPPER_CONNECTION_WIDTH")).toEqual([]);
  });

  test("COPPER_SHAPE_UNCHECKED is an overridable info-class dfm advisory", () => {
    const report = runDrc(neckBoard(0.05, 1.0), {
      copperShapeBudgets: { vertexBudget: 10 },
    });
    const skip = withCode(report, "COPPER_SHAPE_UNCHECKED")[0]!;
    expect(skip.severity).toBe("info");
    expect(skip.ruleClass).toBe("dfm");
    expect(DEFAULT_SEVERITY_BY_CODE.COPPER_SHAPE_UNCHECKED).toBe("info");
    expect(RULE_CLASS_BY_CODE.COPPER_SHAPE_UNCHECKED).toBe("dfm");
    expect(NON_OVERRIDABLE.has("COPPER_SHAPE_UNCHECKED")).toBe(false);
  });
});

// --- §5.1 pours -------------------------------------------------------------

describe("pour copper joins its net's unit (§5.1)", () => {
  test("two same-net pours bridged by 0.05 mm of copper are ONE unit with a neck", () => {
    // The pour's own min-width open (r = traceWidthMm/2) means no single zone
    // can emit sub-`w` copper; the neck lives in the UNION of the two pours
    // and the same-net bridge pad, which is exactly the unit §5.1 builds.
    const zone = (id: string, x0: number, x1: number): PcbZone => ({
      id,
      name: id,
      enabled: true,
      lockedAt: null,
      layer: "F.Cu",
      netId: "n1",
      netName: "GND",
      region: {
        kind: "polygon",
        pointsMm: [
          { x: x0, y: 0 },
          { x: x1, y: 0 },
          { x: x1, y: 2 },
          { x: x0, y: 2 },
        ],
      },
      priority: 0,
    });
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "GND" },
        zones: [zone("zA", 0, 2), zone("zB", 3, 5)],
        freePads: [rect("bridge", { x: 2.5, y: 1 }, 1.2, 0.05)],
      }),
    );
    const necks = withCode(report, "COPPER_CONNECTION_WIDTH");
    expect(necks).toHaveLength(1);
    expect(necks[0]!.measuredMm!).toBeCloseTo(0.05, 3);
    // The marker is between the two pours, on the bridge.
    expect(necks[0]!.locationMm!.x).toBeGreaterThan(2);
    expect(necks[0]!.locationMm!.x).toBeLessThan(3);
    expect(necks[0]!.anchors).toEqual([{ kind: "net", netId: "n1" }]);
  });
});

// --- §5.6 acute wedges ------------------------------------------------------

/** A two-segment trace whose interior vertex subtends `deg`. */
function bentTrace(id: string, deg: number, netId: string | null = "n1") {
  const a = (deg * Math.PI) / 180;
  return trace(id, netId, [
    [0, 0],
    [5, 0],
    [5 - 5 * Math.cos(a), 5 * Math.sin(a)],
  ]);
}

describe("TRACE_ACUTE_ANGLE (§5.6)", () => {
  test("(a) a 30° interior vertex reports; 90° and the 135° of 45° routing do not", () => {
    const at = (deg: number) =>
      withCode(
        runDrc(projection({ board: board(), netNames: { n1: "N1" }, traces: [bentTrace("t1", deg)] })),
        "TRACE_ACUTE_ANGLE",
      );
    const acute = at(30);
    expect(acute).toHaveLength(1);
    expect(acute[0]!.message).toContain("30.0°");
    expect(acute[0]!.measuredMm).toBeUndefined();
    expect(acute[0]!.requiredMm).toBeUndefined();
    expect(acute[0]!.locationMm!.x).toBeCloseTo(5, 6);
    expect(acute[0]!.anchors).toEqual([
      { kind: "segment", traceId: "t1", index: 0 },
      { kind: "segment", traceId: "t1", index: 1 },
    ]);
    expect(at(90)).toEqual([]);
    expect(at(135)).toEqual([]);
    // A 180° reversal is θ = 0: the two stadiums lie on top of each other, so
    // there is no copper-free wedge — that fold is `TRACE_OVERLAP`'s.
    expect(at(0)).toEqual([]);
  });

  test("(b) two traces whose ends meet at 30° report — even 1 nm apart", () => {
    const a = (30 * Math.PI) / 180;
    for (const offsetMm of [0, 0.000001]) {
      const report = runDrc(
        projection({
          board: board(),
          netNames: { n1: "N1" },
          traces: [
            trace("t1", "n1", [[0, 0], [5, 0]]),
            trace("t2", "n1", [
              [5 + offsetMm, 0],
              [5 - 5 * Math.cos(a), 5 * Math.sin(a)],
            ]),
          ],
        }),
      );
      const acute = withCode(report, "TRACE_ACUTE_ANGLE");
      expect(acute).toHaveLength(1);
      expect(acute[0]!.message).toContain("30.0°");
    }
  });

  test("(c) a 90° T does not report, a 30° T does", () => {
    const tee = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return withCode(
        runDrc(
          projection({
            board: board(),
            netNames: { n1: "N1" },
            traces: [
              trace("t1", "n1", [[0, 0], [10, 0]]),
              trace("t2", "n1", [
                [5, 0],
                [5 + 4 * Math.cos(a), 4 * Math.sin(a)],
              ]),
            ],
          }),
        ),
        "TRACE_ACUTE_ANGLE",
      );
    };
    expect(tee(90)).toEqual([]);
    const acute = tee(30);
    expect(acute).toHaveLength(1);
    expect(acute[0]!.message).toContain("30.0°");
    expect(acute[0]!.locationMm!.x).toBeCloseTo(5, 6);
  });

  test("(d) two traces crossing at 30° report; at 90° they do not", () => {
    const cross = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return withCode(
        runDrc(
          projection({
            board: board(),
            netNames: { n1: "N1" },
            traces: [
              trace("t1", "n1", [[-5, 0], [5, 0]]),
              trace("t2", "n1", [
                [-5 * Math.cos(a), -5 * Math.sin(a)],
                [5 * Math.cos(a), 5 * Math.sin(a)],
              ]),
            ],
          }),
        ),
        "TRACE_ACUTE_ANGLE",
      );
    };
    expect(cross(90)).toEqual([]);
    const acute = cross(30);
    expect(acute).toHaveLength(1);
    expect(acute[0]!.message).toContain("30.0°");
    expect(acute[0]!.locationMm!.x).toBeCloseTo(0, 6);
  });

  test("a T landing exactly on a host VERTEX is ONE wedge, not two (R2 #6)", () => {
    const a = (30 * Math.PI) / 180;
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        traces: [
          // The host bends at (5, 0); the branch ends exactly there.
          trace("host", "n1", [[0, 0], [5, 0], [9, 3]]),
          trace("branch", "n1", [
            [5, 0],
            [5 + 4 * Math.cos(a), -4 * Math.sin(a)],
          ]),
        ],
      }),
    );
    const acute = withCode(report, "TRACE_ACUTE_ANGLE");
    // The branch endpoint coincides with the host's own end vertex, so case
    // (b) owns it — one junction, one event, whichever arm names it.
    expect(acute).toHaveLength(1);
    expect(acute[0]!.locationMm!.x).toBeCloseTo(5, 6);
  });

  test("a wedge covered by same-net pad copper is not an acid trap", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        placements: [
          placement("U1", {
            positionMm: { x: 5, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 2, 2)],
          }),
        ],
        padNets: { "U1|1": "n1" },
        traces: [bentTrace("t1", 30)],
      }),
    );
    expect(withCode(report, "TRACE_ACUTE_ANGLE")).toEqual([]);
  });

  test("a different-net junction is NET_SHORT_CIRCUIT's, not a wedge", () => {
    const a = (30 * Math.PI) / 180;
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1", n2: "N2" },
        traces: [
          trace("t1", "n1", [[0, 0], [5, 0]]),
          trace("t2", "n2", [
            [5, 0],
            [5 - 5 * Math.cos(a), 5 * Math.sin(a)],
          ]),
        ],
      }),
    );
    expect(withCode(report, "TRACE_ACUTE_ANGLE")).toEqual([]);
  });

  test("the angle limit is angular, not millimetric: 89.9999° reports, 90° does not", () => {
    const at = (deg: number) =>
      withCode(
        runDrc(projection({ board: board(), netNames: { n1: "N1" }, traces: [bentTrace("t1", deg)] })),
        "TRACE_ACUTE_ANGLE",
      );
    expect(at(89.9999)).toHaveLength(1);
    expect(at(90)).toEqual([]);
  });
});

// --- §5.7 overlap -----------------------------------------------------------

describe("TRACE_OVERLAP (§5.7)", () => {
  test("a duplicated stub reports once with both segment anchors", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        traces: [
          trace("t1", "n1", [[0, 0], [5, 0]]),
          trace("t2", "n1", [[0, 0], [5, 0]]),
        ],
      }),
    );
    const overlaps = withCode(report, "TRACE_OVERLAP");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.anchors).toEqual([
      { kind: "segment", traceId: "t1", index: 0 },
      { kind: "segment", traceId: "t2", index: 0 },
    ]);
    expect(overlaps[0]!.locationMm!.x).toBeCloseTo(2.5, 6);
    expect(overlaps[0]!.message).toContain("5.000 mm");
    // The two shared ends are COLLINEAR junctions, not wedges: one fact, one
    // code (§5.6, §5.7).
    expect(withCode(report, "TRACE_ACUTE_ANGLE")).toEqual([]);
  });

  test("a trace that doubles back over itself reports the fold once", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        traces: [trace("t1", "n1", [[0, 0], [5, 0], [2, 0]])],
      }),
    );
    const overlaps = withCode(report, "TRACE_OVERLAP");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.anchors).toEqual([
      { kind: "segment", traceId: "t1", index: 0 },
      { kind: "segment", traceId: "t1", index: 1 },
    ]);
    expect(overlaps[0]!.message).toContain("3.000 mm");
    // The doubled run is x ∈ [2, 5]; its midpoint is 3.5.
    expect(overlaps[0]!.locationMm!.x).toBeCloseTo(3.5, 6);
    expect(withCode(report, "TRACE_ACUTE_ANGLE")).toEqual([]);
  });

  test("a fold whose vertex is DUPLICATED still reports (R2 #3)", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        // The zero-length segment between the two real ones is what a blind
        // consecutive-pair walk compares against, and finds nothing.
        traces: [trace("t1", "n1", [[0, 0], [5, 0], [5, 0], [2, 0]])],
      }),
    );
    const overlaps = withCode(report, "TRACE_OVERLAP");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.message).toContain("3.000 mm");
    expect(overlaps[0]!.locationMm!.x).toBeCloseTo(3.5, 6);
  });

  test("a trace that loops back over a NON-adjacent run reports (R2 #5)", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        // Out along y = 0, up and around, then back along y = 0 over itself.
        traces: [
          trace("t1", "n1", [
            [0, 0],
            [6, 0],
            [6, 2],
            [2, 2],
            [2, 0],
            [5, 0],
          ]),
        ],
      }),
    );
    const overlaps = withCode(report, "TRACE_OVERLAP");
    expect(overlaps).toHaveLength(1);
    // Segment 0 (0→6) against segment 4 (2→5): 3 mm of shared run.
    expect(overlaps[0]!.anchors).toEqual([
      { kind: "segment", traceId: "t1", index: 0 },
      { kind: "segment", traceId: "t1", index: 4 },
    ]);
    expect(overlaps[0]!.message).toContain("3.000 mm");
  });

  test("a straight continuation is not a fold", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        traces: [trace("t1", "n1", [[0, 0], [5, 0], [9, 0]])],
      }),
    );
    expect(withCode(report, "TRACE_OVERLAP")).toEqual([]);
    expect(withCode(report, "TRACE_ACUTE_ANGLE")).toEqual([]);
  });

  test("a COLLINEAR T-junction is an overlap, not a wedge", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        traces: [
          trace("t1", "n1", [[0, 0], [10, 0]]),
          trace("t2", "n1", [[5, 0], [8, 0]]),
        ],
      }),
    );
    expect(withCode(report, "TRACE_OVERLAP")).toHaveLength(1);
    expect(withCode(report, "TRACE_ACUTE_ANGLE")).toEqual([]);
  });

  test("a partial collinear overlap reports its shared length", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        traces: [
          trace("t1", "n1", [[0, 0], [5, 0]]),
          trace("t2", "n1", [[4, 0], [9, 0]]),
        ],
      }),
    );
    const overlaps = withCode(report, "TRACE_OVERLAP");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.message).toContain("1.000 mm");
    expect(overlaps[0]!.locationMm!.x).toBeCloseTo(4.5, 6);
    expect(withCode(report, "TRACE_ACUTE_ANGLE")).toEqual([]);
  });

  test("a null-net duplicate still reports — the item model cannot see it", () => {
    const report = runDrc(
      projection({
        board: board(),
        traces: [
          trace("t1", null, [[0, 0], [5, 0]]),
          trace("t2", null, [[0, 0], [5, 0]]),
        ],
      }),
    );
    expect(withCode(report, "TRACE_OVERLAP")).toHaveLength(1);
  });

  test("a different-net overlap is a short, not this code", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1", n2: "N2" },
        traces: [
          trace("t1", "n1", [[0, 0], [5, 0]]),
          trace("t2", "n2", [[0, 0], [5, 0]]),
        ],
      }),
    );
    expect(withCode(report, "TRACE_OVERLAP")).toEqual([]);
    expect(withCode(report, "NET_SHORT_CIRCUIT").length).toBeGreaterThan(0);
  });

  test("two parallel but NOT collinear traces do not overlap", () => {
    const report = runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        traces: [
          trace("t1", "n1", [[0, 0], [5, 0]]),
          trace("t2", "n1", [[0, 0.05], [5, 0.05]]),
        ],
      }),
    );
    expect(withCode(report, "TRACE_OVERLAP")).toEqual([]);
  });
});

// --- contract 06 §7 determinism --------------------------------------------

/**
 * A fixture that provokes every copper-shape code family at once, across both
 * layers, with at least two entries in each of the eight reversible arrays.
 */
function determinismFixture(): DesignerPcbProjection {
  const a = (30 * Math.PI) / 180;
  return projection({
    board: board(),
    netNames: { n1: "GND", n2: "SIG" },
    freePads: [
      rect("lobeA", { x: -0.6, y: 0 }, 1, 1),
      rect("lobeB", { x: 0.6, y: 0 }, 1, 1),
      rect("bridge", { x: 0, y: 0 }, 0.4, 0.05),
      freePad("fpX", { center: { x: -5, y: -5 }, netId: null }),
      freePad("fpY", { center: { x: -4.03, y: -4.03 }, netId: null }),
    ],
    traces: [
      bentTrace("tAcute", 30, "n2"),
      trace("tDupA", "n2", [[0, 8], [5, 8]]),
      trace("tDupB", "n2", [[0, 8], [5, 8]]),
      trace("tBack", "n2", [[0, -8], [5, -8]], { layer: "B.Cu" }),
      trace("tThin", "n1", [[-8, 3], [-8, 6]], { widthMm: 0.06 }),
    ],
    vias: [
      via("v1", { netId: "n1", center: { x: -8, y: 3 } }),
      via("v2", { netId: "n1", center: { x: -8, y: 6 } }),
    ],
    placements: [
      placement("U1", {
        positionMm: { x: 6, y: 6 },
        pads: [pad("1", { x: 0, y: 0 }, 1, 1), pad("2", { x: 2, y: 0 }, 1, 1)],
      }),
      placement("U2", {
        positionMm: { x: -6, y: 6 },
        pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
      }),
    ],
    padNets: { "U1|1": "n1", "U1|2": "n2", "U2|1": "n1" },
    freeHoles: [
      freeHole("fh1", { x: 9, y: -9 }, 0.4),
      freeHole("fh2", { x: 9, y: -7 }, 0.4),
    ],
    zones: [],
    keepouts: [],
  });
}

const REVERSIBLE = [
  "traces",
  "vias",
  "placements",
  "freePads",
  "freeHoles",
  "zones",
  "keepouts",
] as const;

describe("determinism (contract 06 §7, DFM contract 11 §7)", () => {
  test("the fixture actually provokes the copper-shape codes", () => {
    const codes = new Set(shape(runDrc(determinismFixture())).map((v) => v.code));
    expect(codes.size).toBeGreaterThanOrEqual(3);
  });

  const baseline = JSON.stringify(runDrc(determinismFixture()));

  for (const key of REVERSIBLE) {
    test(`reversing ${key} alone -> byte-identical report`, () => {
      const p = determinismFixture();
      (p[key] as unknown[]) = [...(p[key] as unknown[])].reverse();
      expect(JSON.stringify(runDrc(p))).toBe(baseline);
    });
  }

  test("reversing drcRules alone -> byte-identical report", () => {
    const p = determinismFixture();
    p.board = { ...p.board, drcRules: [...(p.board.drcRules ?? [])].reverse() };
    expect(JSON.stringify(runDrc(p))).toBe(baseline);
  });

  test("reversing all eight arrays together -> byte-identical report", () => {
    const p = determinismFixture();
    for (const key of REVERSIBLE) {
      (p[key] as unknown[]) = [...(p[key] as unknown[])].reverse();
    }
    p.board = { ...p.board, drcRules: [...(p.board.drcRules ?? [])].reverse() };
    expect(JSON.stringify(runDrc(p))).toBe(baseline);
  });

  test("grid and exhaustive broad phases agree", () => {
    expect(JSON.stringify(runDrc(determinismFixture(), { broadPhase: "exhaustive" }))).toBe(
      baseline,
    );
  });
});

// --- contract 09 §6 execution ----------------------------------------------

describe("tick (execution contract 09 §6)", () => {
  test("copperShape ticks per unit and per erosion, not only per stage", () => {
    const stages: string[] = [];
    runDrc(neckBoard(0.05, 1.0), {
      tick: (stage) => {
        stages.push(stage);
      },
    });
    // Exactly one engine stage checkpoint, plus one per unit and one per
    // erosion under the per-item label (contract 11 §5.5). One unit, one
    // erosion: the residual rule answers this board without a bisection.
    expect(stages.filter((s) => s === "copperShape").length).toBe(1);
    expect(stages.filter((s) => s === "copperShapeUnit").length).toBeGreaterThanOrEqual(2);
  });

  test("a board that needs the bisection ticks once per erosion", () => {
    const stages: string[] = [];
    runDrc(
      projection({
        board: board(),
        netNames: { n1: "N1" },
        freePads: [
          rect("padA", { x: 0, y: 0 }, 1, 1),
          rect("padB", { x: 1, y: 1 }, 1, 1),
        ],
      }),
      { tick: (stage) => stages.push(stage) },
    );
    // A corner contact is invisible to the residual rule, so it pays a full
    // bisection: ~10 erosions, each its own checkpoint.
    expect(stages.filter((s) => s === "copperShapeUnit").length).toBeGreaterThan(5);
  });
});
