/**
 * S8 — the shared legality core (live-parity contract 07 §1 clause 1).
 *
 * Every case is the SAME assertion: `checkPendingCopper(buildDrcItems(P), T)`
 * equals the batch report of `P ⊎ T` filtered to the violations that name a `T`
 * item, compared on `(id, code, layer, severity, measuredMm, requiredMm,
 * message)` with `===` on the measurements. A pair kind that agrees on the
 * verdict but not on the number is a parity bug, so the numbers are compared,
 * not the codes.
 */
import { describe, expect, test } from "bun:test";
import { buildDrcItems } from "../../../shared/drc/drc-context";
import { createBroadPhase } from "../../../shared/drc/broad-phase";
import { finalizeReport, runDrc } from "../../../shared/drc/drc-engine";
import { traceTraceGap } from "../../../shared/drc/pair-gap";
import {
  checkPendingCopper,
  pendingItems,
  refusedViolations,
  REFUSE_CODES,
  type PendingCopper,
} from "../../../shared/drc/legality";
import type {
  DesignerPcbProjection,
  DrcRuleCode,
  PcbBoardContour,
  DrcViolation,
  PcbDrcRule,
  PcbKeepoutRestrictions,
  PcbPointMm,
} from "../../../sdks/designer";
import type { DrcViolationDraft } from "../../../shared/drc/types";
import { holePairs } from "../../../shared/drc/checks/board";
import { judgeCopperPairs } from "../../../shared/drc/checks/clearance";
import { copperToHolePairs } from "../../../shared/drc/checks/copper-to-hole";
import type { ItemSet } from "../../../shared/drc/checks/clearance";
import {
  board,
  boardWithRules,
  freeHole,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";
import { keepoutRow } from "./helpers/pcb-zone-fixtures";

/** The live code set `L` (07 §3) — the only codes parity is claimed for. */
const LIVE_CODES = new Set<DrcRuleCode>([
  "NET_SHORT_CIRCUIT",
  "TRACE_TO_TRACE_CLEARANCE",
  "TRACE_TO_PAD_CLEARANCE",
  "TRACE_TO_VIA_CLEARANCE",
  "VIA_TO_VIA_CLEARANCE",
  "PAD_TO_PAD_CLEARANCE",
  "PAD_TO_VIA_CLEARANCE",
  "FAB_CLEARANCE",
  "COPPER_TO_HOLE",
  "COPPER_TO_BOARD_EDGE",
  "COPPER_OFF_BOARD",
  "HOLE_TO_BOARD_EDGE",
  "HOLE_OFF_BOARD",
  "HOLE_TO_HOLE",
  "FAB_HOLE_TO_HOLE",
  "KEEPOUT_VIOLATION",
  "TRACE_LAYER_MISMATCH",
  "PAD_LAYER_MISMATCH",
  "VIA_LAYER_SPAN",
  "TRACE_WIDTH_MIN",
  "VIA_DIAMETER_MIN",
  "VIA_DRILL_MIN",
  "DRILL_SIZE_MIN",
  "ANNULAR_RING_MIN",
  "VIA_ASPECT_RATIO",
  "VIA_TYPE_UNSUPPORTED",
  "FAB_TRACE_WIDTH",
  "FAB_DRILL",
  "FAB_PAD",
  "FAB_ANNULAR_RING",
  "NETCLASS_TRACE_WIDTH",
  "NETCLASS_VIA_DIAMETER",
  "NETCLASS_VIA_DRILL",
]);

type Shape = Pick<
  DrcViolation,
  "id" | "code" | "layer" | "severity" | "measuredMm" | "requiredMm" | "message"
>;

function shape(v: DrcViolation): Shape {
  return {
    id: v.id,
    code: v.code,
    layer: v.layer,
    severity: v.severity,
    measuredMm: v.measuredMm,
    requiredMm: v.requiredMm,
    message: v.message,
  };
}

interface ParityOptions {
  replaces?: string[];
  /** Extra `touch` predicate — a bridge attributed to a BOARD item (§1). */
  alsoTouch?: (v: DrcViolation) => boolean;
}

/** `P' ⊎ T` — the board after the commit (07 §1). */
function committed(
  p: DesignerPcbProjection,
  t: PendingCopper,
  replaces: readonly string[],
): DesignerPcbProjection {
  return {
    ...p,
    traces: [...p.traces.filter((x) => !replaces.includes(x.id)), ...t.traces],
    vias: [...p.vias.filter((x) => !replaces.includes(x.id)), ...t.vias],
  };
}

function namesPending(v: DrcViolation, t: PendingCopper): boolean {
  const traceIds = new Set(t.traces.map((x) => x.id));
  const viaIds = new Set(t.vias.map((x) => x.id));
  return v.anchors.some(
    (a) =>
      (a.kind === "trace" && traceIds.has(a.traceId)) ||
      (a.kind === "via" && viaIds.has(a.viaId)),
  );
}

/**
 * The one assertion. Returns the live verdict so a case can additionally pin
 * which codes it expected to see (or not see).
 */
function expectParity(
  p: DesignerPcbProjection,
  t: PendingCopper,
  opts: ParityOptions = {},
): DrcViolation[] {
  const replaces = opts.replaces ?? [];
  const live = checkPendingCopper(buildDrcItems(p), t, { replaces });
  const batch = runDrc(committed(p, t, replaces)).violations.filter(
    (v) =>
      LIVE_CODES.has(v.code) &&
      (namesPending(v, t) || (opts.alsoTouch?.(v) ?? false)),
  );
  expect(live.map(shape)).toEqual(batch.map(shape));
  return live;
}

function codesOf(vs: readonly DrcViolation[]): DrcRuleCode[] {
  return vs.map((v) => v.code);
}

const NO_RESTRICTIONS: PcbKeepoutRestrictions = {
  tracks: false,
  vias: false,
  pads: false,
  copperPour: false,
  footprints: false,
};

const NETS = { a: "NET_A", b: "NET_B" };

// --- pair kinds -------------------------------------------------------------

describe("trace ↔ trace", () => {
  const p = projection({
    board: board(),
    netNames: NETS,
    traces: [trace("bt", "a", [[0, 0], [10, 0]])],
  });
  const pending = (y: number): PendingCopper => ({
    traces: [trace("p1", "b", [[0, y], [10, y]])],
    vias: [],
  });

  test("0.20 mm gap violates the 0.25 mm rule", () => {
    const live = expectParity(p, pending(0.4));
    expect(codesOf(live)).toContain("TRACE_TO_TRACE_CLEARANCE");
    expect(live[0]!.measuredMm).toBeCloseTo(0.2, 9);
    expect(live[0]!.requiredMm).toBe(0.25);
  });

  test("exactly 0.25 mm clears", () => {
    const live = expectParity(p, pending(0.45));
    expect(codesOf(live)).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("overlapping different-net copper is a short", () => {
    const live = expectParity(p, pending(0));
    expect(codesOf(live)).toEqual(["NET_SHORT_CIRCUIT"]);
  });
});

describe("trace ↔ pad", () => {
  // B5-LIVE-ROT-PAD: a 2.0 × 0.5 pad rotated 90° is 0.5 wide and 2.0 tall, so
  // its top copper edge is at y = +1.0 — a live check that used the unrotated
  // extent would measure against y = +0.25 and pass a 0.75 mm error.
  const rotated = projection({
    board: board(),
    netNames: NETS,
    placements: [
      placement("U1", {
        pads: [pad("1", { x: 0, y: 0 }, 2.0, 0.5, { rotationDeg: 90 })],
      }),
    ],
    padNets: { "U1|1": "a" },
  });
  const over = (y: number): PendingCopper => ({
    traces: [trace("p1", "b", [[-5, y], [5, y]])],
    vias: [],
  });

  test("rotated pad: 0.20 mm violates", () => {
    const live = expectParity(rotated, over(1.3));
    expect(codesOf(live)).toContain("TRACE_TO_PAD_CLEARANCE");
  });

  test("rotated pad: exactly 0.25 mm clears", () => {
    const live = expectParity(rotated, over(1.35));
    expect(codesOf(live)).not.toContain("TRACE_TO_PAD_CLEARANCE");
  });

  // B5-LIVE-TH-PAD-SIDE: a through-hole pad of a BOTTOM-side placement still
  // carries copper on F.Cu, so an F.Cu route must be judged against it.
  const farSide = projection({
    board: board(),
    netNames: NETS,
    placements: [
      placement("U2", {
        positionMm: { x: 5, y: 5 },
        layer: "B.Cu",
        mirrored: true,
        pads: [pad("1", { x: 0, y: 0 }, 1, 1, { drillDiameterMm: 0.5 })],
      }),
    ],
    padNets: { "U2|1": "a" },
  });

  test("through-hole pad on the far side: 0.20 mm violates on F.Cu", () => {
    const live = expectParity(farSide, {
      traces: [trace("p1", "b", [[0, 5.8], [10, 5.8]])],
      vias: [],
    });
    expect(codesOf(live)).toContain("TRACE_TO_PAD_CLEARANCE");
  });

  test("through-hole pad on the far side: exactly 0.25 mm clears", () => {
    const live = expectParity(farSide, {
      traces: [trace("p1", "b", [[0, 5.85], [10, 5.85]])],
      vias: [],
    });
    expect(codesOf(live)).not.toContain("TRACE_TO_PAD_CLEARANCE");
  });
});

describe("trace ↔ via", () => {
  const p = projection({
    board: board(),
    netNames: NETS,
    vias: [via("bv", { netId: "a", center: { x: 0, y: 0 } })],
  });
  const over = (y: number): PendingCopper => ({
    traces: [trace("p1", "b", [[-5, y], [5, y]])],
    vias: [],
  });

  test("0.20 mm violates", () => {
    expect(codesOf(expectParity(p, over(0.7)))).toContain(
      "TRACE_TO_VIA_CLEARANCE",
    );
  });

  test("exactly 0.25 mm clears", () => {
    expect(codesOf(expectParity(p, over(0.75)))).not.toContain(
      "TRACE_TO_VIA_CLEARANCE",
    );
  });
});

describe("via ↔ via", () => {
  const p = projection({
    board: board(),
    netNames: NETS,
    vias: [via("bv", { netId: "a", center: { x: 0, y: 0 } })],
  });
  const beside = (x: number): PendingCopper => ({
    traces: [],
    vias: [via("pv", { netId: "b", center: { x, y: 0 } })],
  });

  test("0.20 mm violates the 0.30 mm rule", () => {
    expect(codesOf(expectParity(p, beside(1.0)))).toContain(
      "VIA_TO_VIA_CLEARANCE",
    );
  });

  test("exactly 0.30 mm clears", () => {
    expect(codesOf(expectParity(p, beside(1.1)))).not.toContain(
      "VIA_TO_VIA_CLEARANCE",
    );
  });
});

describe("pad ↔ via", () => {
  const p = projection({
    board: board(),
    netNames: NETS,
    placements: [
      placement("U1", { pads: [pad("1", { x: 0, y: 0 }, 1, 1)] }),
    ],
    padNets: { "U1|1": "a" },
  });
  const beside = (x: number): PendingCopper => ({
    traces: [],
    vias: [via("pv", { netId: "b", center: { x, y: 0 } })],
  });

  test("0.20 mm violates", () => {
    expect(codesOf(expectParity(p, beside(1.1)))).toContain(
      "PAD_TO_VIA_CLEARANCE",
    );
  });

  test("exactly 0.25 mm clears", () => {
    expect(codesOf(expectParity(p, beside(1.15)))).not.toContain(
      "PAD_TO_VIA_CLEARANCE",
    );
  });
});

// --- non-copper tiers -------------------------------------------------------

describe("copper ↔ non-plated hole", () => {
  const p = projection({
    board: board(),
    netNames: NETS,
    freeHoles: [freeHole("h1", { x: 0, y: 0 }, 1.0)],
  });
  const over = (y: number): PendingCopper => ({
    traces: [trace("p1", "b", [[-5, y], [5, y]])],
    vias: [],
  });

  test("0.30 mm violates the 0.50 mm rule", () => {
    expect(codesOf(expectParity(p, over(0.9)))).toContain("COPPER_TO_HOLE");
  });

  test("exactly 0.50 mm clears", () => {
    expect(codesOf(expectParity(p, over(1.1)))).not.toContain("COPPER_TO_HOLE");
  });
});

describe("board edge and off-board", () => {
  const p = projection({ board: board(), netNames: NETS });

  test("0.30 mm from the edge violates the 0.50 mm rule", () => {
    const live = expectParity(p, {
      traces: [trace("p1", "b", [[20, 0], [24.6, 0]])],
      vias: [],
    });
    expect(codesOf(live)).toContain("COPPER_TO_BOARD_EDGE");
  });

  test("exactly 0.50 mm clears", () => {
    const live = expectParity(p, {
      traces: [trace("p1", "b", [[20, 0], [24.4, 0]])],
      vias: [],
    });
    expect(codesOf(live)).not.toContain("COPPER_TO_BOARD_EDGE");
  });

  test("copper past the outline is off-board", () => {
    const live = expectParity(p, {
      traces: [trace("p1", "b", [[24, 0], [26, 0]])],
      vias: [],
    });
    expect(codesOf(live)).toContain("COPPER_OFF_BOARD");
  });
});

describe("hole ↔ hole for a pending via", () => {
  const p = projection({
    board: board(),
    netNames: NETS,
    freeHoles: [freeHole("h1", { x: 0, y: 0 }, 1.0)],
  });
  const beside = (x: number): PendingCopper => ({
    traces: [],
    vias: [via("pv", { netId: "b", center: { x, y: 0 } })],
  });

  test("0.15 mm violates the 0.25 mm drill rule", () => {
    expect(codesOf(expectParity(p, beside(0.85)))).toContain("HOLE_TO_HOLE");
  });

  test("exactly 0.25 mm clears", () => {
    expect(codesOf(expectParity(p, beside(0.95)))).not.toContain(
      "HOLE_TO_HOLE",
    );
  });
});

describe("keepouts", () => {
  const square: PcbPointMm[] = [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 8 },
    { x: 0, y: 8 },
  ];
  const p = projection({
    board: board(),
    netNames: NETS,
    keepouts: [
      keepoutRow("k1", ["F.Cu"], square, { ...NO_RESTRICTIONS, tracks: true }),
    ],
  });

  test("a route entering a tracks keepout is reported", () => {
    expect(
      codesOf(
        expectParity(p, {
          traces: [trace("p1", "b", [[-2, 4], [4, 4]])],
          vias: [],
        }),
      ),
    ).toContain("KEEPOUT_VIOLATION");
  });

  test("a route outside it is not", () => {
    expect(
      codesOf(
        expectParity(p, {
          traces: [trace("p1", "b", [[-6, 4], [-1, 4]])],
          vias: [],
        }),
      ),
    ).not.toContain("KEEPOUT_VIOLATION");
  });
});

describe("per-item scalars", () => {
  const p = projection({ board: board(), netNames: NETS });

  test("a 0.10 mm route is below the 0.20 mm minimum", () => {
    const live = expectParity(p, {
      traces: [trace("p1", "b", [[0, 0], [10, 0]], { widthMm: 0.1 })],
      vias: [],
    });
    expect(codesOf(live)).toContain("TRACE_WIDTH_MIN");
  });

  test("exactly 0.20 mm clears", () => {
    const live = expectParity(p, {
      traces: [trace("p1", "b", [[0, 0], [10, 0]], { widthMm: 0.2 })],
      vias: [],
    });
    expect(codesOf(live)).not.toContain("TRACE_WIDTH_MIN");
  });
});

// --- null-net bridges (07 §4) -----------------------------------------------

describe("null-net bridges", () => {
  test("an unassigned route bridging two board nets is the route's short", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [
        trace("ba", "a", [[0, 0], [4, 0]]),
        trace("bb", "b", [[6, 0], [10, 0]]),
      ],
    });
    const live = expectParity(p, {
      traces: [trace("p1", null, [[4, 0], [6, 0]])],
      vias: [],
    });
    expect(codesOf(live)).toContain("NET_SHORT_CIRCUIT");
    expect(
      live.find((v) => v.code === "NET_SHORT_CIRCUIT")!.message,
    ).toBe("Short circuit: unassigned trace bridges nets NET_A and NET_B");
  });

  test("a board item whose net set GREW is attributed to the route", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [
        trace("ba", "a", [[0, 0], [4, 0]]),
        trace("n1", null, [[4, 0], [6, 0]]),
      ],
    });
    const t: PendingCopper = {
      traces: [trace("p1", "b", [[6, 0], [10, 0]])],
      vias: [],
    };
    const onN1 = (v: DrcViolation): boolean =>
      v.code === "NET_SHORT_CIRCUIT" &&
      v.anchors.some((a) => a.kind === "trace" && a.traceId === "n1");
    const live = expectParity(p, t, { alsoTouch: onN1 });
    // The draft carries no pending anchor at all — rerouting away from the
    // unassigned copper is what fixes it (07 §4).
    const bridge = live.find(onN1);
    expect(bridge).toBeDefined();
    expect(namesPending(bridge!, t)).toBe(false);
  });

  test("a board item whose net set did NOT grow is pre-existing", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [
        trace("ba", "a", [[0, 0], [4, 0]]),
        trace("n1", null, [[4, 0], [6, 0]]),
        trace("bb", "b", [[6, 0], [10, 0]]),
      ],
    });
    const t: PendingCopper = {
      traces: [trace("p1", "a", [[0, -3], [4, -3], [4, 0]])],
      vias: [],
    };
    const live = expectParity(p, t);
    expect(codesOf(live)).not.toContain("NET_SHORT_CIRCUIT");
    // ... while the batch report still carries the pre-existing bridge.
    const batch = runDrc(committed(p, t, [])).violations;
    expect(codesOf(batch)).toContain("NET_SHORT_CIRCUIT");
  });
});

// --- replacement and pending × pending --------------------------------------

describe("replaces", () => {
  const p = projection({
    board: board(),
    netNames: NETS,
    traces: [
      trace("t1", "a", [[0, 0], [10, 0]]),
      trace("t2", "b", [[0, 5], [10, 5]]),
    ],
  });

  test("a tuned trace is judged against the board WITHOUT its old geometry", () => {
    const live = expectParity(
      p,
      { traces: [trace("t1", "a", [[0, 4.6], [10, 4.6]])], vias: [] },
      { replaces: ["t1"] },
    );
    expect(codesOf(live)).toEqual(["TRACE_TO_TRACE_CLEARANCE"]);
    expect(live[0]!.measuredMm).toBeCloseTo(0.2, 9);
  });

  test("reusing a board id WITHOUT `replaces` is refused, not guessed (R1 #4)", () => {
    // The colliding id would make the board twin invisible to the bridge
    // completion (one anchor key, claimed by the subject) — a silent
    // under-report, so there is no verdict at all.
    expect(() =>
      checkPendingCopper(buildDrcItems(p), {
        traces: [trace("t1", "a", [[0, 4.6], [10, 4.6]])],
        vias: [],
      }),
    ).toThrow(/reuses a board trace id/);
    expect(() =>
      checkPendingCopper(
        buildDrcItems(
          projection({
            board: board(),
            netNames: NETS,
            vias: [via("v1", { netId: "a" })],
          }),
        ),
        { traces: [], vias: [via("v1", { netId: "a", center: { x: 3, y: 0 } })] },
      ),
    ).toThrow(/reuses a board via id/);
  });
});

describe("pending × pending", () => {
  test("two unassigned runs of one session are a pair", () => {
    const p = projection({ board: board(), netNames: NETS });
    const live = expectParity(p, {
      traces: [
        trace("p1", null, [[0, 0], [10, 0]]),
        trace("p2", null, [[0, 0.4], [10, 0.4]]),
      ],
      vias: [],
    });
    expect(codesOf(live)).toEqual(["TRACE_TO_TRACE_CLEARANCE"]);
    expect(live[0]!.measuredMm).toBeCloseTo(0.2, 9);
  });
});

// --- the refuse set ---------------------------------------------------------

describe("refuse set (07 §6)", () => {
  const offBoard: PendingCopper = {
    traces: [trace("p1", "b", [[24, 0], [26, 0]])],
    vias: [],
  };

  test("a valid outline refuses the off-board tier", () => {
    const ctx = buildDrcItems(projection({ board: board(), netNames: NETS }));
    expect(ctx.outlineInvalid).toBe(false);
    expect(codesOf(refusedViolations(ctx, checkPendingCopper(ctx, offBoard))))
      .toContain("COPPER_OFF_BOARD");
  });

  test("a bow-tie outline downgrades it to a report", () => {
    // A real self-intersecting outline, so `outlineInvalid` is DERIVED by
    // `buildDrcItems` rather than asserted by the test (R1 #6).
    const bowTie = boardWithRules({
      outline: {
        kind: "polygon",
        widthMm: 40,
        heightMm: 20,
        centerMm: { x: 0, y: 0 },
        pointsMm: [
          { x: -20, y: -10 },
          { x: 20, y: 10 },
          { x: 20, y: -5 },
          { x: -20, y: 10 },
        ],
      },
    });
    const ctx = buildDrcItems(projection({ board: bowTie, netNames: NETS }));
    expect(ctx.outlineInvalid).toBe(true);
    expect(ctx.outlineDrafts.map((d) => d.code)).toEqual([
      "BOARD_OUTLINE_INVALID",
    ]);
    const violations = checkPendingCopper(ctx, {
      traces: [trace("p1", "b", [[60, 60], [70, 60]])],
      vias: [],
    });
    expect(codesOf(violations)).toContain("COPPER_OFF_BOARD");
    expect(codesOf(refusedViolations(ctx, violations))).not.toContain(
      "COPPER_OFF_BOARD",
    );
    expect(codesOf(refusedViolations(ctx, violations))).not.toContain(
      "COPPER_TO_BOARD_EDGE",
    );
  });

  test("an exact-budget note does NOT downgrade the off-board tier (R2 #1)", () => {
    // 07 §6 reserves the downgrade for an outline rerouting cannot fix. The
    // exact-geometry layer's `OUTLINE_WEB_UNCHECKED` note also lands in
    // `outlineDrafts` (12 §3), and deriving `outlineInvalid` from the LENGTH of
    // that list let a 1204-primitive comb — a perfectly valid board whose exact
    // simplicity sweep merely ran out of budget — allow an off-board commit.
    const teeth = 600;
    const pitch = 0.2;
    const w = 100;
    const segments: PcbBoardContour["segments"] = [];
    let y = 0;
    for (let i = 0; i < teeth; i += 1) {
      const x = i % 2 === 0 ? w : -w;
      segments.push({ type: "line", to: { x, y } });
      y += pitch;
      segments.push({ type: "line", to: { x, y } });
    }
    segments.push({ type: "line", to: { x: -w - 5, y } });
    segments.push({ type: "line", to: { x: -w - 5, y: -5 } });
    segments.push({ type: "line", to: { x: -w, y: -5 } });
    segments.push({ type: "line", to: { x: -w, y: 0 } });
    const comb = boardWithRules({
      outline: {
        kind: "contour",
        widthMm: 2 * w + 10,
        heightMm: y + 10,
        centerMm: { x: 0, y: y / 2 },
        start: { x: -w, y: 0 },
        segments,
      },
    });
    const ctx = buildDrcItems(projection({ board: comb, netNames: NETS }));
    // The board IS valid and the note IS reported — both halves matter.
    expect(ctx.outlineDrafts.map((d) => d.code)).toEqual([
      "OUTLINE_WEB_UNCHECKED",
    ]);
    expect(ctx.outlineInvalid).toBe(false);
    const violations = checkPendingCopper(ctx, {
      traces: [trace("p1", "b", [[500, 500], [510, 500]])],
      vias: [],
    });
    expect(codesOf(refusedViolations(ctx, violations))).toContain(
      "COPPER_OFF_BOARD",
    );
    // ...and the batch report carries exactly ONE note, no invalid verdict.
    const report = runDrc(projection({ board: comb, netNames: NETS }));
    expect(
      report.violations.filter((v) => v.code === "OUTLINE_WEB_UNCHECKED"),
    ).toHaveLength(1);
    expect(
      report.violations.filter((v) => v.code === "BOARD_OUTLINE_INVALID"),
    ).toHaveLength(0);
  });

  test("a waived clearance violation is not refused", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [trace("bt", "a", [[0, 0], [10, 0]])],
    });
    const ctx = buildDrcItems(p);
    const t: PendingCopper = {
      traces: [trace("p1", "b", [[0, 0.4], [10, 0.4]])],
      vias: [],
    };
    const [breach] = checkPendingCopper(ctx, t);
    expect(breach!.code).toBe("TRACE_TO_TRACE_CLEARANCE");
    const waived = checkPendingCopper(ctx, t, { waivedIds: [breach!.id] });
    expect(waived[0]!.waived).toBe(true);
    expect(refusedViolations(ctx, waived)).toEqual([]);
  });

  test("a waiver cannot un-refuse a NON_OVERRIDABLE short", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [trace("bt", "a", [[0, 0], [10, 0]])],
    });
    const ctx = buildDrcItems(p);
    const t: PendingCopper = {
      traces: [trace("p1", "b", [[0, 0], [10, 0]])],
      vias: [],
    };
    const [short] = checkPendingCopper(ctx, t);
    expect(short!.code).toBe("NET_SHORT_CIRCUIT");
    // `finalizeReport` never marks a NON_OVERRIDABLE code waived, so the gate
    // still refuses it.
    const waived = checkPendingCopper(ctx, t, { waivedIds: [short!.id] });
    expect(waived[0]!.waived).toBeUndefined();
    expect(codesOf(refusedViolations(ctx, waived))).toEqual([
      "NET_SHORT_CIRCUIT",
    ]);
  });

  test("the allow-list holds only the fifteen refusing codes", () => {
    expect(REFUSE_CODES.size).toBe(15);
    expect(REFUSE_CODES.has("FAB_CLEARANCE")).toBe(false);
    expect(REFUSE_CODES.has("HOLE_TO_HOLE")).toBe(false);
  });
});

// --- broad phase ------------------------------------------------------------

describe("the broad phase is a superset of the exact prefilter", () => {
  /** Deterministic LCG — a fixture, not a random test. */
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  // The v2 grid files a trace PER SUB-SEGMENT (broad-phase contract 08 §2.1),
  // so `near`/`nearPolyline` are no longer a superset of the AABB-within-halo
  // set for traces — the empty corners of a long diagonal's box are
  // deliberately unindexed. What they ARE a superset of is every trace whose
  // COPPER is within the halo, which is the only thing the pair bodies need
  // (§1 L1): a pair the query drops has a true gap above every threshold any
  // tier compares against, so it emits nothing in either mode.
  test("200 items: every trace whose copper is within the halo is returned", () => {
    const rnd = lcg(20260909);
    const traces = Array.from({ length: 200 }, (_, i) => {
      const x = rnd() * 46 - 23;
      const y = rnd() * 26 - 13;
      const dx = rnd() * 6 - 3;
      const dy = rnd() * 6 - 3;
      return trace(`t${i}`, `n${i % 7}`, [
        [x, y],
        [x + dx, y + dy],
      ]);
    });
    const ctx = buildDrcItems(projection({ board: board(), traces }));
    expect(ctx.traces).toHaveLength(200);
    const halo = ctx.maxClearanceBoundMm;
    for (let i = 0; i < ctx.traces.length; i += 1) {
      const a = ctx.traces[i]!;
      const found = new Set(
        ctx.nearPolyline("traces", a.pointsMm, a.halfWidthMm, halo),
      );
      for (let j = 0; j < ctx.traces.length; j += 1) {
        if (traceTraceGap(a, ctx.traces[j]!).gap > halo) continue;
        expect(found.has(j)).toBe(true);
      }
    }
  });

  test("indices come back ascending", () => {
    const ctx = buildDrcItems(
      projection({
        board: board(),
        traces: [
          trace("t0", "a", [[0, 0], [1, 0]]),
          trace("t1", "b", [[0, 1], [1, 1]]),
          trace("t2", "c", [[0, 2], [1, 2]]),
        ],
      }),
    );
    expect(ctx.near("traces", ctx.traces[1]!.bounds, 5)).toEqual([0, 1, 2]);
    const t = ctx.traces[1]!;
    expect(
      ctx.nearPolyline("traces", t.pointsMm, t.halfWidthMm, 5),
    ).toEqual([0, 1, 2]);
  });
});

// --- Astra R2 hardening -----------------------------------------------------

describe("an equal-deficit witness does not follow the pending id (R2 #1)", () => {
  // Two area rules over one pair. The candidate list is
  // `segmentsOf(u) x segmentsOf(v)` and `u` is whichever item has the smaller
  // ANCHOR KEY, so renaming an item transposes the list. Three candidates tie
  // on a 0.25 mm deficit — two at (gap 0.25, required 0.5) inside the LEFT
  // area, one at (gap 0.5, required 0.75) inside the RIGHT one — and they sit
  // OFF the diagonal, which is the one arrangement a transposition reorders.
  const areaRule = (id: string, mm: number, x0: number, x1: number): PcbDrcRule => ({
    id,
    name: id,
    enabled: true,
    priority: 10,
    scopes: [
      {
        kind: "area",
        polygonMm: [
          { x: x0, y: -5 },
          { x: x1, y: -5 },
          { x: x1, y: 5 },
          { x: x0, y: 5 },
        ],
      },
    ],
    constraint: { kind: "clearance", mm },
  });
  const boardRules = boardWithRules({
    drcRules: [areaRule("left", 0.5, -12, 0), areaRule("right", 0.75, 0, 12)],
  });
  // Drawn RIGHT to LEFT, with its riser at x = -6 (well inside the left area),
  // so its segment array runs opposite to the pending run's.
  const named = trace("ba", "a", [
    [10, 0.7],
    [-6, 0.7],
    [-6, 0.45],
    [-10, 0.45],
  ]);
  const pendingWith = (id: string): PendingCopper => ({
    traces: [trace(id, "b", [[-10, 0], [10, 0]])],
    vias: [],
  });
  const p = projection({
    board: boardRules,
    netNames: NETS,
    traces: [named],
  });

  const strip = (v: DrcViolation) => ({
    code: v.code,
    measuredMm: v.measuredMm,
    requiredMm: v.requiredMm,
    message: v.message,
  });

  test("two pending ids that transpose the candidate list agree", () => {
    const ctx = buildDrcItems(p);
    // "a_pending" sorts before "ba" (pending leads); "zzz_pending" after it.
    const low = checkPendingCopper(ctx, pendingWith("a_pending"));
    const high = checkPendingCopper(ctx, pendingWith("zzz_pending"));
    expect(low).toHaveLength(1);
    expect(low[0]!.code).toBe("TRACE_TO_TRACE_CLEARANCE");
    expect(strip(high[0]!)).toEqual(strip(low[0]!));
    // The tie is broken by the geometry: the STRICTEST of the tied
    // requirements, never by whichever candidate the ids happened to order first.
    expect(low[0]!.requiredMm).toBe(0.75);
    expect(low[0]!.measuredMm).toBeCloseTo(0.5, 9);
  });

  test("batch agrees when the two ids swap the orientation", () => {
    const run = (pendingId: string) =>
      runDrc(
        projection({
          board: boardRules,
          netNames: NETS,
          traces: [named, trace(pendingId, "b", [[-10, 0], [10, 0]])],
        }),
      ).violations.filter((v) => v.code === "TRACE_TO_TRACE_CLEARANCE");
    const forward = run("a_pending");
    const reversed = run("zzz_pending");
    expect(forward).toHaveLength(1);
    expect(strip(forward[0]!)).toEqual(strip(reversed[0]!));
    expect(forward[0]!.requiredMm).toBe(0.75);
  });
});

describe("the AABB prefilter cannot drop an exact-boundary short (R2 #2)", () => {
  // Two 0.2 mm traces whose centres are exactly 200 100 nm apart, AWAY FROM THE
  // ORIGIN: `(5.2001 - 5) - 0.2` is 9.9999999999993e-5 (<= SHORT_EPS, a dead
  // short) while `aabbGap`'s `(5.2001 - 0.1) - (5 + 0.1)` is
  // 1.00000000000655e-4 — a hair OVER. With a zero clearance bound the
  // prefilter threshold IS the short epsilon, so the pair was skipped and
  // neither batch nor the gate ever measured it.
  const flat = boardWithRules({
    fabricator: "custom",
    clearance: {
      traceToTraceMm: 0,
      traceToPadMm: 0,
      padToPadMm: 0,
      traceToViaMm: 0,
      viaToViaMm: 0,
    },
    netClasses: [
      {
        id: "flat",
        name: "Flat",
        traceWidthMm: 0.2,
        clearanceMm: 0,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#fff",
        defaultViaProtection: "tented",
      },
    ],
  });
  const p = projection({
    board: flat,
    netNames: NETS,
    traces: [trace("ba", "a", [[0, 5], [10, 5]])],
  });
  const at = (y: number): PendingCopper => ({
    traces: [trace("p1", "b", [[0, y], [10, y]])],
    vias: [],
  });

  test("a 100 nm gap is a short in batch AND through the gate", () => {
    expect(codesOf(expectParity(p, at(5.2001)))).toEqual(["NET_SHORT_CIRCUIT"]);
  });

  test("a 101 nm gap still clears the short tier", () => {
    expect(codesOf(expectParity(p, at(5.200101)))).not.toContain(
      "NET_SHORT_CIRCUIT",
    );
  });
});

describe("the anchor index answers what the scan does (R2 #3)", () => {
  // 2 000 unassigned board runs in a grid; one pending named run crosses a
  // column of them, so the bridge completion is exercised on many keys.
  const traces = Array.from({ length: 2000 }, (_, i) =>
    trace(`n${i}`, null, [
      [-20 + (i % 50) * 0.8, -12 + Math.floor(i / 50) * 0.6],
      [-20 + (i % 50) * 0.8 + 0.5, -12 + Math.floor(i / 50) * 0.6],
    ]),
  );
  const p = projection({ board: board(), netNames: NETS, traces });
  const pending: PendingCopper = {
    traces: [trace("p1", "b", [[-19.9, -12], [-19.9, 11]])],
    vias: [],
  };

  const judge = (useBoardIdentity: boolean): DrcViolation[] => {
    const ctx = buildDrcItems(p);
    const items = pendingItems(ctx, pending);
    const subjects: ItemSet = { traces: items.traces, pads: [], vias: items.vias };
    // Copies break every identity test, so both the pair grid AND the anchor
    // index fall back to the pre-R2 linear scans.
    const others: ItemSet = useBoardIdentity
      ? ctx
      : { traces: [...ctx.traces], pads: [...ctx.pads], vias: [...ctx.vias] };
    const drafts: DrcViolationDraft[] = [];
    judgeCopperPairs(ctx, subjects, others, { out: drafts });
    return finalizeReport(drafts, {
      designId: "",
      revision: 0,
      ignoredRuleClasses: [],
      waivedIds: [],
      severityOverrides: undefined,
    }).violations;
  };

  test("indexed and scanned completions agree", () => {
    const scanned = judge(false);
    expect(scanned.length).toBeGreaterThan(0);
    expect(judge(true).map(shape)).toEqual(scanned.map(shape));
  });

  test("cold and warm timings", () => {
    const ctx = buildDrcItems(p);
    let t = performance.now();
    checkPendingCopper(ctx, pending);
    const coldMs = performance.now() - t;
    t = performance.now();
    for (let i = 0; i < 20; i += 1) checkPendingCopper(ctx, pending);
    const warmMs = (performance.now() - t) / 20;
    console.log(
      `[R2 #3] 2000 unassigned board runs: cold ${coldMs.toFixed(1)} ms, warm ${warmMs.toFixed(3)} ms`,
    );
    expect(warmMs).toBeGreaterThanOrEqual(0);
  });
});

// --- report finalisation ----------------------------------------------------

describe("finalizeReport's same-id survivor is a total order (Astra S8 #6, R1 #1)", () => {
  const draft = (
    message: string,
    locationMm: PcbPointMm = { x: 1, y: 1 },
  ): DrcViolationDraft => ({
    code: "TRACE_TO_TRACE_CLEARANCE",
    message,
    anchors: [
      { kind: "trace", traceId: "x" },
      { kind: "trace", traceId: "y" },
    ],
    locationMm,
    layer: "F.Cu",
    measuredMm: 0.2,
    requiredMm: 0.25,
  });
  const finalize = (drafts: DrcViolationDraft[]) =>
    finalizeReport(drafts, {
      designId: "d",
      revision: 1,
      ignoredRuleClasses: [],
      waivedIds: [],
      severityOverrides: undefined,
    });

  test("two drafts differing only in message collapse to the smaller one", () => {
    const forward = finalize([draft("aaa rule A"), draft("bbb rule B")]);
    const reversed = finalize([draft("bbb rule B"), draft("aaa rule A")]);
    expect(forward.violations).toHaveLength(1);
    expect(forward.violations[0]!.message).toBe("aaa rule A");
    expect(reversed.violations).toEqual(forward.violations);
  });

  test("two drafts differing only in locationMm collapse to the smaller one", () => {
    // Two shapes of one pin inside the SAME 0.1 mm id bucket: same code, same
    // logical anchor, same layer, same measurement, same message — only the
    // marker differs, and it is the last thing left to order them by (R1 #1).
    const lo = draft("same", { x: 1.01, y: 1.0 });
    const hi = draft("same", { x: 1.04, y: 1.0 });
    const forward = finalize([lo, hi]);
    const reversed = finalize([hi, lo]);
    expect(forward.violations).toHaveLength(1);
    expect(forward.violations[0]!.id).toBe(reversed.violations[0]!.id);
    expect(forward.violations[0]!.locationMm).toEqual({ x: 1.01, y: 1.0 });
    expect(reversed.violations).toEqual(forward.violations);
  });

  test("a reversed multi-shape pin keeps the same survivor end to end", () => {
    // The same property through the real engine: reversing a placement's pads
    // must not move the surviving marker of a pin-against-pin verdict.
    const pads = [
      pad("1", { x: 0, y: 0 }, 1, 1),
      pad("1", { x: 0.04, y: 0 }, 1, 1),
      pad("2", { x: 1.15, y: 0 }, 1, 1),
    ];
    const run = (order: typeof pads) =>
      runDrc(
        projection({
          board: board(),
          netNames: NETS,
          placements: [placement("U1", { pads: order })],
          padNets: { "U1|1": "a", "U1|2": "b" },
        }),
      ).violations;
    const forward = run(pads);
    const reversed = run([...pads].reverse());
    expect(forward).toEqual(reversed);
  });
});

// --- broad-phase edge cases (R1 #3) ----------------------------------------

describe("the broad phase fails OPEN on boxes it cannot index", () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
    minX,
    minY,
    maxX,
    maxY,
  });
  const empty = { traces: [], pads: [], vias: [], holes: [] } as const;
  /** A zero-width trace along the box's diagonal — the v2 entry shape (§2.1). */
  const diagonal = (b: ReturnType<typeof box>) => ({
    pointsMm: [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.maxY },
    ],
    halfWidthMm: 0,
    bounds: b,
  });

  test("a NaN item box is returned by every query, unfiltered", () => {
    const bp = createBroadPhase({
      ...empty,
      traces: [
        diagonal(box(0, 0, 1, 1)),
        diagonal(box(NaN, NaN, NaN, NaN)),
        diagonal(box(50, 50, 51, 51)),
      ],
    });
    // `boundsMeet` against a NaN box is false in both directions, so filtering
    // it would DROP a pair `aabbGap` still judges.
    expect(bp.near("traces", box(0, 0, 1, 1), 0.1)).toEqual([0, 1]);
    expect(bp.near("traces", box(900, 900, 901, 901), 0.1)).toEqual([1]);
  });

  test("an item spanning too many cells is returned by every query", () => {
    // 4000 mm across at a 2 mm cell = 2000 columns, past MAX_CELLS_PER_ITEM.
    const bp = createBroadPhase({
      ...empty,
      vias: [box(0, 0, 1, 1), box(-2000, -2000, 2000, 2000)],
    });
    expect(bp.near("vias", box(500, 500, 501, 501), 0)).toEqual([1]);
    expect(bp.near("vias", box(0, 0, 1, 1), 0)).toEqual([0, 1]);
  });

  test("a query box that cannot be indexed returns everything", () => {
    const bp = createBroadPhase({
      ...empty,
      pads: [box(0, 0, 1, 1), box(10, 10, 11, 11)],
    });
    expect(bp.near("pads", box(NaN, 0, 1, 1), 0.1)).toEqual([0, 1]);
  });

  test("a via with a NaN centre still reaches the pair enumeration", () => {
    const ctx = buildDrcItems(
      projection({
        board: board(),
        netNames: NETS,
        vias: [
          via("ok", { netId: "a", center: { x: 0, y: 0 } }),
          via("nan", { netId: "b", center: { x: NaN, y: 0 } }),
        ],
      }),
    );
    const nanIndex = ctx.vias.findIndex((v) => v.via.id === "nan");
    expect(nanIndex).toBeGreaterThanOrEqual(0);
    expect(
      ctx.near("vias", ctx.vias[0]!.bounds, ctx.maxClearanceBoundMm),
    ).toContain(nanIndex);
  });
});

describe("the hole grid answers exactly what the full scan does (R1 #2)", () => {
  // A dense drill field: 400 free holes on a 1.4 mm pitch, so plenty of pairs
  // fall inside the halo and plenty just outside it.
  const holes = Array.from({ length: 400 }, (_, i) =>
    freeHole(
      `h${i}`,
      { x: -20 + (i % 20) * 1.4, y: -10 + Math.floor(i / 20) * 1.4 },
      0.9,
    ),
  );
  const ctx = buildDrcItems(
    projection({ board: board(), netNames: NETS, freeHoles: holes }),
  );
  const pending: PendingCopper = {
    traces: [trace("p1", "b", [[-6, 0.6], [6, 0.6]])],
    vias: [
      via("pv1", { netId: "b", center: { x: 0.7, y: 0.7 } }),
      via("pv2", { netId: "b", center: { x: -12.3, y: -4.1 } }),
    ],
  };

  /** The same forms with a COPY of the hole array — never `ctx.holes`, so the
   *  identity test fails and both fall back to the pre-R1 full scan. */
  const scanned = (): DrcViolation[] => {
    const copy = [...ctx.holes];
    const drafts: DrcViolationDraft[] = [];
    const items = pendingItems(ctx, pending);
    const subjects: ItemSet = { traces: items.traces, pads: [], vias: items.vias };
    copperToHolePairs(ctx, subjects, copy, { out: drafts });
    holePairs(ctx, items.holes, copy, { out: drafts });
    return finalizeReport(drafts, {
      designId: "",
      revision: 0,
      ignoredRuleClasses: [],
      waivedIds: [],
      severityOverrides: undefined,
    }).violations;
  };

  const gridded = (): DrcViolation[] => {
    const drafts: DrcViolationDraft[] = [];
    const items = pendingItems(ctx, pending);
    const subjects: ItemSet = { traces: items.traces, pads: [], vias: items.vias };
    copperToHolePairs(ctx, subjects, ctx.holes, { out: drafts });
    holePairs(ctx, items.holes, ctx.holes, { out: drafts });
    return finalizeReport(drafts, {
      designId: "",
      revision: 0,
      ignoredRuleClasses: [],
      waivedIds: [],
      severityOverrides: undefined,
    }).violations;
  };

  test("both paths report the same violations", () => {
    const viaScan = scanned();
    expect(viaScan.length).toBeGreaterThan(0);
    expect(gridded().map(shape)).toEqual(viaScan.map(shape));
  });
});

// --- unassigned copper is one conductor (item 7) ----------------------------

describe("unassigned copper that touches is an extension of what it touches", () => {
  test("a net-less route's own via on its own run is not a violation", () => {
    const p = projection({ board: board(), netNames: NETS });
    const t: PendingCopper = {
      traces: [trace("p1", null, [[0, 0], [10, 0]])],
      vias: [via("pv", { netId: null, center: { x: 10, y: 0 } })],
    };
    expect(expectParity(p, t)).toEqual([]);
    // ... and batch says the same thing about the committed board.
    expect(
      runDrc(committed(p, t, [])).violations.filter((v) =>
        LIVE_CODES.has(v.code),
      ),
    ).toEqual([]);
  });

  test("two net-less traces 0.05 mm apart are still judged", () => {
    const p = projection({ board: board(), netNames: NETS });
    const live = expectParity(p, {
      traces: [
        trace("p1", null, [[0, 0], [10, 0]]),
        trace("p2", null, [[0, 0.25], [10, 0.25]]),
      ],
      vias: [],
    });
    expect(codesOf(live)).toEqual(["TRACE_TO_TRACE_CLEARANCE"]);
    expect(live[0]!.measuredMm).toBeCloseTo(0.05, 9);
  });

  test("a net-less route OVERLAPPING one named trace reports nothing", () => {
    // The extension case (contracts 01 §2 / 06 §4): the unassigned run becomes
    // part of NET_A, and a conductor cannot violate clearance with itself.
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [trace("ba", "a", [[0, 0], [4, 0]])],
    });
    const t: PendingCopper = {
      traces: [trace("p1", null, [[2, 0], [8, 0]])],
      vias: [],
    };
    expect(expectParity(p, t)).toEqual([]);
    expect(
      runDrc(committed(p, t, [])).violations.filter((v) =>
        LIVE_CODES.has(v.code),
      ),
    ).toEqual([]);
  });

  test("overlapping a SECOND net turns the extension into one bridge", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [
        trace("ba", "a", [[0, 0], [4, 0]]),
        trace("bb", "b", [[6, 0], [10, 0]]),
      ],
    });
    const live = expectParity(p, {
      // Overlaps BOTH named runs, so it bridges them through itself.
      traces: [trace("p1", null, [[3, 0], [7, 0]])],
      vias: [],
    });
    // ONE fault, reported once — not a short plus two clearance breaches.
    expect(codesOf(live)).toEqual(["NET_SHORT_CIRCUIT"]);
    expect(live[0]!.anchors[0]).toEqual({ kind: "trace", traceId: "p1" });
    expect(live[0]!.message).toBe(
      "Short circuit: unassigned trace bridges nets NET_A and NET_B",
    );
  });

  test("a net-less route 0.05 mm from a named trace is still judged", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [trace("ba", "a", [[0, 0], [10, 0]])],
    });
    const live = expectParity(p, {
      traces: [trace("p1", null, [[0, 0.25], [10, 0.25]])],
      vias: [],
    });
    expect(codesOf(live)).toEqual(["TRACE_TO_TRACE_CLEARANCE"]);
    expect(live[0]!.measuredMm).toBeCloseTo(0.05, 9);
  });
});
