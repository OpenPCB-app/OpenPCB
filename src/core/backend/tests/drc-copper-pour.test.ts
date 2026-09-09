/**
 * `checks/copper-pour.ts` — the three pour verdicts of copper-pour contract
 * §10, plus the invariant they all rest on: DRC fills every effective zone ONCE
 * (`ctx.pourResults()`) and connectivity reads the SAME islands (§9), so the
 * electrical verdict and the dead-copper report can never be about two
 * different pieces of copper.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { buildDrcContext } from "../../../modules/designer/backend/drc/drc-context";
import { checkCopperPour } from "../../../modules/designer/backend/drc/checks/copper-pour";
import {
  DEFAULT_SEVERITY_BY_CODE,
  NON_OVERRIDABLE,
  RULE_CLASS_BY_CODE,
} from "../../../modules/designer/backend/drc/severity";
import type { CopperFillResult } from "../../../shared/rendering/copper-fill/copper-fill-geometry";
import type { DesignerPcbProjection, DrcReport } from "../../../sdks/designer";
import { board, pad, placement, projection, trace } from "./helpers/drc-fixtures";
import { boardZoneRow, polygonZoneRow } from "./helpers/pcb-zone-fixtures";

const BIG_BOARD = board({
  outline: { kind: "rect", widthMm: 100, heightMm: 100, centerMm: { x: 0, y: 0 } },
});

function rect(x0: number, y0: number, x1: number, y1: number) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function codes(report: DrcReport): string[] {
  return report.violations.map((v) => v.code);
}

/** A `failed` verdict for the FIRST effective zone of a projection. */
function withFailedFill(proj: DesignerPcbProjection, reason: string) {
  const ctx = buildDrcContext(proj);
  const failed: CopperFillResult = {
    status: "failed",
    reason,
    islands: [],
    warnings: [],
  };
  return checkCopperPour({
    ...ctx,
    pourResults: () => [{ zone: ctx.copperZones[0]!, result: failed }],
  });
}

describe("ZONE_FILL_FAILED", () => {
  test("a bailed fill is a non-waivable error naming the zone and the reason", () => {
    const proj = projection({
      netNames: { gnd: "GND" },
      zones: [polygonZoneRow("zf", "F.Cu", "gnd", rect(-5, -5, 5, 5))],
    });
    const drafts = withFailedFill(proj, "[copper-kernel] union failed");
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft.code).toBe("ZONE_FILL_FAILED");
    // Class, severity and non-waivability are the ENGINE's, not the draft's
    // (S6 §7, contract 06 §6): checks emit facts, `RULE_CLASS_BY_CODE` /
    // `DEFAULT_SEVERITY_BY_CODE` / `NON_OVERRIDABLE` decide.
    expect(RULE_CLASS_BY_CODE.ZONE_FILL_FAILED).toBe("structural");
    expect(draft.ruleSeverity).toBeUndefined();
    expect(DEFAULT_SEVERITY_BY_CODE.ZONE_FILL_FAILED).toBe("error");
    expect(NON_OVERRIDABLE.has("ZONE_FILL_FAILED")).toBe(true);
    expect(draft.layer).toBe("F.Cu");
    expect(draft.anchors).toEqual([{ kind: "zone", zoneId: "zf" }]);
    // Located at the zone's first vertex, so the marker sits on the zone.
    expect(draft.locationMm).toEqual({ x: -5, y: -5 });
    expect(draft.message).toContain("[copper-kernel] union failed");
    // A failure is NOT an empty fill — the two must never be confused (§8).
    expect(draft.code).not.toBe("ZONE_EMPTY_FILL");
  });

  test("a failed NET-LESS zone still reports — the copper is missing either way", () => {
    const proj = projection({
      zones: [polygonZoneRow("zf", "F.Cu", null, rect(-5, -5, 5, 5))],
    });
    const drafts = withFailedFill(proj, "boom");
    expect(drafts.map((d) => d.code)).toEqual(["ZONE_FILL_FAILED"]);
  });

  test("the code is an error that cannot be overridden or ignored", () => {
    expect(DEFAULT_SEVERITY_BY_CODE.ZONE_FILL_FAILED).toBe("error");
    expect(NON_OVERRIDABLE.has("ZONE_FILL_FAILED")).toBe(true);
  });
});

describe("ZONE_EMPTY_FILL from the fill side", () => {
  test("a zone entirely off the board pours nothing", () => {
    const report = runDrc(
      projection({
        netNames: { gnd: "GND" },
        zones: [polygonZoneRow("zoff", "F.Cu", "gnd", rect(300, 300, 320, 320))],
      }),
    );
    const empty = report.violations.filter((v) => v.code === "ZONE_EMPTY_FILL");
    expect(empty).toHaveLength(1);
    expect(empty[0]!.severity).toBe("warning");
    expect(empty[0]!.anchors).toEqual([{ kind: "zone", zoneId: "zoff" }]);
    // An empty extent is a geometric fact, never a kernel failure (§8).
    expect(codes(report)).not.toContain("ZONE_FILL_FAILED");
  });
});

describe("ISOLATED_COPPER_ISLAND — the component verdict (§10)", () => {
  /**
   * 100×100 board, F.Cu gnd plane split in two by a full-width SIG trace. The
   * bottom island holds a gnd pad; the top island holds only a floating gnd
   * stub, so it is `attached` (S1 membership) but electrically dead.
   */
  function splitPlane(parts: Partial<DesignerPcbProjection> = {}) {
    return projection({
      board: BIG_BOARD,
      zones: [boardZoneRow("F.Cu", "gnd")],
      netNames: { gnd: "GND", sig: "SIG" },
      traces: [
        trace("splitter", "sig", [
          [-60, 0],
          [60, 0],
        ], { widthMm: 2.0 }),
        trace("stub", "gnd", [
          [0, 30],
          [10, 30],
        ], { widthMm: 0.2 }),
      ],
      placements: [
        placement("U1", {
          positionMm: { x: 0, y: -30 },
          pads: [pad("1", { x: 0, y: 0 }, 2, 2, { drillDiameterMm: 1 })],
        }),
      ],
      padNets: { "U1|1": "gnd" },
      ...parts,
    });
  }

  test("the dead island reports once, with the area in the message only", () => {
    const report = runDrc(splitPlane());
    const dead = report.violations.filter(
      (v) => v.code === "ISOLATED_COPPER_ISLAND",
    );
    expect(dead).toHaveLength(1);
    expect(dead[0]!.severity).toBe("warning");
    expect(dead[0]!.layer).toBe("F.Cu");
    // A board zone anchors on its net — at most one plane per layer.
    expect(dead[0]!.anchors).toEqual([{ kind: "net", netId: "gnd" }]);
    expect(dead[0]!.message).toContain("reach no pad — dead copper");
    expect(dead[0]!.message).toContain("mm² total");
    // B3-9: `measuredMm` is a LENGTH field; an area may not ride in it.
    expect(dead[0]!.measuredMm).toBeUndefined();
  });

  test("a pad in the upper half makes the same island live", () => {
    const report = runDrc(
      splitPlane({
        placements: [
          placement("U1", {
            positionMm: { x: 0, y: -30 },
            pads: [pad("1", { x: 0, y: 0 }, 2, 2, { drillDiameterMm: 1 })],
          }),
          placement("U2", {
            positionMm: { x: 0, y: 30 },
            pads: [pad("1", { x: 0, y: 0 }, 2, 2, { drillDiameterMm: 1 })],
          }),
        ],
        padNets: { "U1|1": "gnd", "U2|1": "gnd" },
      }),
    );
    expect(codes(report)).not.toContain("ISOLATED_COPPER_ISLAND");
  });

  test("a NET-LESS zone's islands are never isolated (§3.2)", () => {
    // The same picture with no net on the zone: the copper is manufactured and
    // joins no net graph, which is intent, not a defect.
    const report = runDrc(
      projection({
        board: BIG_BOARD,
        netNames: { sig: "SIG" },
        zones: [polygonZoneRow("znull", "F.Cu", null, rect(-40, -40, 40, 40))],
        traces: [
          trace("splitter", "sig", [
            [-60, 0],
            [60, 0],
          ], { widthMm: 2.0 }),
        ],
      }),
    );
    expect(codes(report)).not.toContain("ISOLATED_COPPER_ISLAND");
  });
});

describe("one fill per run (§9)", () => {
  test("pourResults covers EVERY effective zone, net-less ones included", () => {
    const proj = projection({
      board: BIG_BOARD,
      netNames: { gnd: "GND" },
      zones: [
        polygonZoneRow("znull", "F.Cu", null, rect(-30, -30, -10, -10)),
        polygonZoneRow("zgnd", "F.Cu", "gnd", rect(10, 10, 30, 30)),
        boardZoneRow("B.Cu", "gnd"),
      ],
    });
    const ctx = buildDrcContext(proj);
    expect(ctx.pourResults().map((p) => p.zone.id)).toEqual(
      ctx.copperZones.map((z) => z.id),
    );
    // Memoized: the same array object, not a second set of kernel runs.
    expect(ctx.pourResults()).toBe(ctx.pourResults());
  });

  test("connectivity's pour nodes are the pourResults islands of net-bound zones", () => {
    const proj = projection({
      board: BIG_BOARD,
      netNames: { gnd: "GND" },
      zones: [
        // A net-less zone FIRST, with a higher priority so the derivation
        // (which sorts explicit zones by priority desc, then id asc — equal
        // priority would put "zgnd" before "znull") really places it first:
        // it contributes no connectivity node, so the pour ordinal of the
        // gnd zone below is 0, not 1.
        polygonZoneRow("znull", "F.Cu", null, rect(-30, -30, -10, -10), {
          priority: 5,
        }),
        polygonZoneRow("zgnd", "F.Cu", "gnd", rect(10, 10, 30, 30)),
      ],
    });
    const ctx = buildDrcContext(proj);
    expect(ctx.copperZones.map((z) => z.id)).toEqual(["znull", "zgnd"]);
    const pourItems = ctx.copperItems().filter((i) => i.kind === "pour");
    const gnd = ctx
      .pourResults()
      .find((p) => p.zone.id === "zgnd")!
      .result;
    expect(gnd.status).toBe("ok");
    expect(pourItems.map((i) => i.key)).toEqual(
      gnd.islands.map((_, i) => `pour:F.Cu:gnd:0:${i}`),
    );
    expect(pourItems.map((i) => i.rings)).toEqual(
      gnd.islands.map((island) => island.rings),
    );
  });
});
