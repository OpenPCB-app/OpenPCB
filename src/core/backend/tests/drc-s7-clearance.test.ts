/**
 * S7 — the four clearance-side decisions of batch-DRC contract 06:
 *   §4 intra-footprint pads run the SHORT tier only,
 *   §4 an unassigned item touching two known nets bridges them,
 *   §2 a circular pad is judged on its exact disc, not the 48-gon that
 *      circumscribes it,
 *   §6 `COPPER_TO_BOARD_EDGE.measuredMm` is signed.
 * Plus the property all four depend on: the report cannot change when the
 * projection's arrays are reordered (§7).
 */
import { describe, expect, test } from "bun:test";
import { buildDrcContext } from "../../../modules/designer/backend/drc/drc-context";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { tracePadGap } from "../../../modules/designer/backend/drc/pair-gap";
import { clearanceViolated } from "../../../modules/designer/backend/pcb/tolerance";
import type {
  DesignerPcbProjection,
  DrcRuleCode,
  DrcViolation,
} from "../../../sdks/designer";
import {
  boardWithRules,
  codes,
  freePad,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

function of(report: { violations: DrcViolation[] }, code: DrcRuleCode) {
  return report.violations.filter((v) => v.code === code);
}

describe("intra-footprint pads run the short tier only (§4)", () => {
  /** Two 1x1 pads of ONE placement, `dx` apart, on different nets. */
  const oneFootprint = (dx: number): DesignerPcbProjection =>
    projection({
      // A real fabricator, so the FAB tier is live and its silence is a fact.
      board: boardWithRules({ fabricator: "jlcpcb_2l" }),
      placements: [
        placement("U1", {
          pads: [
            pad("1", { x: 0, y: 0 }, 1, 1),
            pad("2", { x: dx, y: 0 }, 1, 1),
          ],
        }),
      ],
      padNets: { "U1|1": "a", "U1|2": "b" },
      netNames: { a: "NET_A", b: "NET_B" },
    });

  test("overlapping different-net pads of one footprint are a short", () => {
    const report = runDrc(oneFootprint(0.5));
    const shorts = of(report, "NET_SHORT_CIRCUIT");
    expect(shorts).toHaveLength(1);
    expect(shorts[0]!.anchors).toEqual([
      { kind: "pad", placementId: "U1", padNumber: "1" },
      { kind: "pad", placementId: "U1", padNumber: "2" },
      { kind: "net", netId: "a" },
      { kind: "net", netId: "b" },
    ]);
    // The other two tiers stay the library's business.
    expect(codes(report)).not.toContain("PAD_TO_PAD_CLEARANCE");
    expect(codes(report)).not.toContain("FAB_CLEARANCE");
  });

  test("a 0.05 mm intra-footprint gap reports nothing at all", () => {
    // 0.05 mm is below the 0.25 mm board rule AND below JLCPCB's fab minimum.
    const report = runDrc(oneFootprint(1.05));
    expect(codes(report)).not.toContain("NET_SHORT_CIRCUIT");
    expect(codes(report)).not.toContain("PAD_TO_PAD_CLEARANCE");
    expect(codes(report)).not.toContain("FAB_CLEARANCE");
  });
});

describe("an unassigned item bridging two nets is a short (§4)", () => {
  const bridge = (padsOn: Array<{ id: string; x: number; net: string }>) =>
    projection({
      board: boardWithRules({}),
      freePads: padsOn.map((p) =>
        freePad(p.id, { center: { x: p.x, y: 0 }, netId: p.net }),
      ),
      traces: [
        trace("t", null, [
          [0, 0],
          [4, 0],
        ]),
      ],
      netNames: { na: "NET_A", nb: "NET_B" },
    });

  test("a null-net trace touching nets A and B emits ONE short over both", () => {
    const report = runDrc(
      bridge([
        { id: "pa", x: 0, net: "na" },
        { id: "pb", x: 4, net: "nb" },
      ]),
    );
    const shorts = of(report, "NET_SHORT_CIRCUIT");
    expect(shorts).toHaveLength(1);
    expect(shorts[0]!.anchors).toEqual([
      { kind: "trace", traceId: "t" },
      { kind: "net", netId: "na" },
      { kind: "net", netId: "nb" },
    ]);
    expect(shorts[0]!.message).toBe(
      "Short circuit: unassigned trace bridges nets NET_A and NET_B",
    );
    expect(shorts[0]!.layer).toBe("F.Cu");
    expect(shorts[0]!.locationMm).toEqual({ x: 2, y: 0 });
    expect(shorts[0]!.measuredMm).toBe(0);
  });

  test("touching ONE net is an extension of it, not a short", () => {
    const report = runDrc(bridge([{ id: "pa", x: 0, net: "na" }]));
    expect(codes(report)).not.toContain("NET_SHORT_CIRCUIT");
  });
});

describe("a circular pad is judged on its exact disc (§2)", () => {
  /** r = 0.5 pad at the origin; a vertical trace of half-width 0.125 at `x`. */
  const discCase = (x: number): DesignerPcbProjection =>
    projection({
      board: boardWithRules({ clearance: { traceToPadMm: 0.25 } }),
      freePads: [
        freePad("p", {
          shape: "circle",
          widthMm: 1,
          heightMm: 1,
          center: { x: 0, y: 0 },
          netId: "a",
        }),
      ],
      traces: [
        trace("t", "b", [
          [x, -5],
          [x, 5],
        ], { widthMm: 0.25 }),
      ],
    });

  test("exactly at the rule it passes, though the 48-gon would have failed", () => {
    // 0.5 + 0.125 + 0.25 -> a disc gap of exactly the 0.25 mm rule.
    const proj = discCase(0.875);
    const ctx = buildDrcContext(proj);
    const t = ctx.traces[0]!;
    const p = ctx.pads[0]!;
    expect(p.disc).toEqual({ center: { x: 0, y: 0 }, radiusMm: 0.5 });
    expect(tracePadGap(t, p).gap).toBe(0.25);

    // The sampled ring circumscribes the circle, so the pre-S7 measurement is
    // strictly smaller — and small enough to have failed the same rule.
    const { disc: _dropped, ...ringOnly } = p;
    const ringGap = tracePadGap(t, ringOnly).gap;
    expect(ringGap).toBeLessThan(0.25);
    expect(clearanceViolated(ringGap, 0.25)).toBe(true);
    expect(0.25 - ringGap).toBeLessThan(0.5 * 0.0022);

    expect(codes(runDrc(proj))).not.toContain("TRACE_TO_PAD_CLEARANCE");
  });

  test("1 nm closer fails", () => {
    const found = of(runDrc(discCase(0.875 - 1e-6)), "TRACE_TO_PAD_CLEARANCE");
    expect(found).toHaveLength(1);
    expect(found[0]!.measuredMm).toBeCloseTo(0.25 - 1e-6, 12);
  });

  test("pad-to-pad between two discs is the exact centre distance minus radii", () => {
    const report = runDrc(
      projection({
        board: boardWithRules({ clearance: { padToPadMm: 1.5 } }),
        freePads: [
          freePad("p1", {
            shape: "circle",
            widthMm: 1,
            heightMm: 1,
            center: { x: 0, y: 0 },
            netId: "a",
          }),
          freePad("p2", {
            shape: "circle",
            widthMm: 1,
            heightMm: 1,
            center: { x: 2, y: 0 },
            netId: "b",
          }),
        ],
      }),
    );
    const found = of(report, "PAD_TO_PAD_CLEARANCE");
    expect(found).toHaveLength(1);
    expect(found[0]!.measuredMm).toBe(1);
  });
});

describe("COPPER_TO_BOARD_EDGE carries a signed measurement (§6)", () => {
  const edgeCase = (x: number) =>
    of(
      runDrc(
        projection({
          board: boardWithRules({
            clearance: { copperToBoardEdgeMm: 1 },
            outline: {
              kind: "rect",
              widthMm: 20,
              heightMm: 20,
              centerMm: { x: 0, y: 0 },
            },
          }),
          vias: [via("v", { center: { x, y: 0 }, netId: "a" })],
        }),
      ),
      "COPPER_TO_BOARD_EDGE",
    );

  test("inside the board the measurement is the positive perimeter gap", () => {
    const found = edgeCase(9);
    expect(found).toHaveLength(1);
    expect(found[0]!.measuredMm).toBeCloseTo(0.6, 9);
  });

  test("outside the outline it is negative, alongside COPPER_OFF_BOARD", () => {
    const found = edgeCase(11);
    expect(found).toHaveLength(1);
    expect(found[0]!.measuredMm).toBeLessThan(0);
  });
});

test("reordering every input array cannot change the report (§7)", () => {
  const parts: Partial<DesignerPcbProjection> = {
    board: boardWithRules({ fabricator: "jlcpcb_2l" }),
    placements: [
      placement("U1", {
        positionMm: { x: -6, y: 0 },
        pads: [pad("1", { x: 0, y: 0 }, 1, 1), pad("2", { x: 0.5, y: 0 }, 1, 1)],
      }),
    ],
    padNets: { "U1|1": "a", "U1|2": "b" },
    freePads: [
      freePad("p1", {
        shape: "circle",
        widthMm: 1,
        heightMm: 1,
        center: { x: 0, y: 0 },
        netId: "a",
      }),
      freePad("p2", {
        shape: "circle",
        widthMm: 1,
        heightMm: 1,
        center: { x: 1.2, y: 0 },
        netId: "b",
      }),
      freePad("p3", { center: { x: 4, y: 0 }, netId: "na" }),
      freePad("p4", { center: { x: 8, y: 0 }, netId: "nb" }),
    ],
    traces: [
      trace("t1", null, [
        [4, 0],
        [8, 0],
      ]),
      trace("t2", "a", [
        [0, 4],
        [8, 4],
      ]),
    ],
    vias: [
      via("v1", { center: { x: 2, y: 4 }, netId: "b" }),
      // 0.2 mm apart: a via-to-via CLEARANCE breach, not an overlap.
      via("v2", { center: { x: 3, y: 4 }, netId: "c" }),
    ],
    netNames: { a: "A", b: "B", c: "C", na: "NET_A", nb: "NET_B" },
  };
  const forward = runDrc(projection(parts));
  const reversed = runDrc(
    projection({
      ...parts,
      placements: [...parts.placements!].reverse(),
      freePads: [...parts.freePads!].reverse(),
      traces: [...parts.traces!].reverse(),
      vias: [...parts.vias!].reverse(),
    }),
  );
  // The fixture must actually exercise the changed pairs.
  expect(codes(forward)).toContain("NET_SHORT_CIRCUIT");
  expect(codes(forward)).toContain("PAD_TO_PAD_CLEARANCE");
  expect(codes(forward)).toContain("VIA_TO_VIA_CLEARANCE");
  expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
});
