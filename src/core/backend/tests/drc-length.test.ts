/**
 * Length-match rules on the S14 path model (docs/pcb-hardening/14-si-contract.md
 * §2, §3). Every net carries TWO PAD TERMINALS: a trace-only net has no routed
 * length at all under the path model (reason `terminals`), so a pad-less
 * fixture would go silent for the wrong reason (contract §9, critique #5).
 *
 * The pads are 0.2 × 0.2 mm at the trace ends, so each net's routed length is
 * its trace run minus the 0.1 mm of copper inside each pad — copper inside a
 * terminal is not routed length (§2.2, Decision 1).
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { undefinedReasonText } from "../../../shared/drc/checks/length";
import type {
  DesignerPcbProjection,
  DrcViolation,
  PcbLengthMatchGroup,
  PcbPlacedPart,
  PcbTrace,
} from "../../../sdks/designer";
import { board, pad, placement, projection, trace } from "./helpers/drc-fixtures";

/** A net pinned at both ends of a straight horizontal run on F.Cu. */
interface Net {
  netId: string;
  lengthMm: number;
  yMm: number;
  /** Extra copper joining the same two pads — makes the path a `loop`. */
  detourMm?: number;
}

function pin(netId: string, end: "a" | "b", x: number, y: number): PcbPlacedPart {
  return placement(`P_${netId}_${end}`, {
    positionMm: { x, y },
    pads: [pad("1", { x: 0, y: 0 }, 0.2, 0.2)],
  });
}

function scene(
  groups: PcbLengthMatchGroup[],
  nets: Net[],
  netNames: Record<string, string> = {},
): DesignerPcbProjection {
  const placements: PcbPlacedPart[] = [];
  const traces: PcbTrace[] = [];
  const padNets: Record<string, string> = {};
  for (const net of nets) {
    placements.push(pin(net.netId, "a", 0, net.yMm), pin(net.netId, "b", net.lengthMm, net.yMm));
    padNets[`P_${net.netId}_a|1`] = net.netId;
    padNets[`P_${net.netId}_b|1`] = net.netId;
    traces.push(
      trace(`t-${net.netId}`, net.netId, [[0, net.yMm], [net.lengthMm, net.yMm]], {
        widthMm: 0.25,
      }),
    );
    if (net.detourMm !== undefined) {
      // A second, independent route between the SAME two pads: two routes, no
      // single length (§2.4) — reported rather than silently summed.
      const d = net.yMm - net.detourMm;
      traces.push(
        trace(
          `t-${net.netId}-alt`,
          net.netId,
          [[0, net.yMm], [0, d], [net.lengthMm, d], [net.lengthMm, net.yMm]],
          { widthMm: 0.25 },
        ),
      );
    }
  }
  return projection({
    board: board({
      outline: { kind: "rect", widthMm: 100, heightMm: 100, centerMm: { x: 0, y: 0 } },
      ...(groups.length > 0 ? { lengthMatchGroups: groups } : {}),
    }),
    placements,
    traces,
    padNets,
    netNames,
  });
}

function of(p: DesignerPcbProjection, code: string): DrcViolation[] {
  return runDrc(p).violations.filter((v) => v.code === code);
}

const GROUP_LONGEST: PcbLengthMatchGroup = {
  id: "g1",
  name: "DDR",
  netIds: ["a", "b", "c"],
  target: { kind: "longest" },
  toleranceMm: 0.5,
};

describe("DRC length check", () => {
  test("longest target flags only members short beyond tolerance", () => {
    const violations = of(
      scene(
        [GROUP_LONGEST],
        [
          { netId: "a", lengthMm: 10, yMm: 0 }, // 9.8 routed
          { netId: "b", lengthMm: 9.8, yMm: 2 }, // 9.6 — within ±0.5
          { netId: "c", lengthMm: 7, yMm: 4 }, // 6.8 — 3 mm short
        ],
        { c: "DQ3" },
      ),
      "NET_LENGTH_OUT_OF_RANGE",
    );
    expect(violations).toHaveLength(1);
    const v = violations[0]!;
    expect(v.ruleClass).toBe("constraint");
    expect(v.severity).toBe("warning");
    expect(v.anchors).toEqual([
      { kind: "net", netId: "c" },
      { kind: "lengthGroup", groupId: "g1" },
    ]);
    expect(v.measuredMm).toBeCloseTo(6.8, 3);
    expect(v.requiredMm).toBeCloseTo(9.8, 3);
    expect(v.message).toContain("DQ3");
    expect(v.message).toContain("'DDR'");
  });

  test("unrouted members are skipped; single routed member is no group", () => {
    // Only net a routed → longest group degenerates, no violations.
    expect(
      of(
        scene([GROUP_LONGEST], [{ netId: "a", lengthMm: 10, yMm: 0 }]),
        "NET_LENGTH_OUT_OF_RANGE",
      ),
    ).toHaveLength(0);
  });

  test("multi-trace nets sum across segments", () => {
    const p = scene(
      [GROUP_LONGEST],
      [
        { netId: "a", lengthMm: 10, yMm: 0 },
        { netId: "c", lengthMm: 7, yMm: 4 },
      ],
    );
    // Split net c's single run into two touching traces: the path walks both,
    // so the measured length is unchanged (3 + 4 − 0.2 mm of pad interiors).
    p.traces = p.traces.filter((t) => t.id !== "t-c");
    p.traces.push(
      trace("t-c1", "c", [[0, 4], [3, 4]], { widthMm: 0.25 }),
      trace("t-c2", "c", [[3, 4], [7, 4]], { widthMm: 0.25 }),
    );
    const violations = of(p, "NET_LENGTH_OUT_OF_RANGE");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.measuredMm).toBeCloseTo(6.8, 3);
  });

  test("a dangling stub is a branch, not routed length (§2.4)", () => {
    const p = scene(
      [GROUP_LONGEST],
      [
        { netId: "a", lengthMm: 10, yMm: 0 },
        { netId: "b", lengthMm: 10, yMm: 2 },
      ],
    );
    // 5 mm of copper hanging off net b's run: the pre-S14 sum would have made
    // b the longest member and put a 5 mm gap on a.
    p.traces.push(trace("t-b-stub", "b", [[5, 2], [5, 7]], { widthMm: 0.25 }));
    expect(of(p, "NET_LENGTH_OUT_OF_RANGE")).toHaveLength(0);
  });

  test("absolute target flags both directions", () => {
    const group: PcbLengthMatchGroup = {
      id: "g2",
      name: "CLK",
      netIds: ["long", "short", "ok"],
      target: { kind: "absolute", mm: 8 },
      toleranceMm: 0.5,
    };
    const violations = of(
      scene([group], [
        { netId: "long", lengthMm: 10, yMm: 0 }, // 9.8 → 1.8 over
        { netId: "short", lengthMm: 7, yMm: 2 }, // 6.8 → 1.2 short
        { netId: "ok", lengthMm: 8.2, yMm: 4 }, // 8.0 → inside the band
      ]),
      "NET_LENGTH_OUT_OF_RANGE",
    );
    expect(violations).toHaveLength(2);
    const byNet = new Map(
      violations.map((v) => [
        v.anchors[0]!.kind === "net" ? v.anchors[0]!.netId : "?",
        v,
      ]),
    );
    expect(byNet.get("long")!.message).toContain("over");
    expect(byNet.get("short")!.message).toContain("short of");
    expect(byNet.get("long")!.requiredMm).toBe(8);
  });

  test("a net in two groups yields one violation per group, distinct ids", () => {
    const second: PcbLengthMatchGroup = {
      ...GROUP_LONGEST,
      id: "g2",
      name: "DDR-B",
    };
    const violations = of(
      scene(
        [GROUP_LONGEST, second],
        [
          { netId: "a", lengthMm: 10, yMm: 0 },
          { netId: "c", lengthMm: 7, yMm: 4 }, // 3 mm short in BOTH groups
        ],
      ),
      "NET_LENGTH_OUT_OF_RANGE",
    );
    expect(violations).toHaveLength(2);
    // The report is sorted by (code, id), so compare the group set, not order.
    expect(
      violations
        .map((v) =>
          v.anchors[1]!.kind === "lengthGroup" ? v.anchors[1]!.groupId : "?",
        )
        .sort(),
    ).toEqual(["g1", "g2"]);
    expect(new Set(violations.map((v) => v.id)).size).toBe(2);
  });

  test("a member with no single route is NET_LENGTH_UNDEFINED, never measured", () => {
    const p = scene(
      [GROUP_LONGEST],
      [
        { netId: "a", lengthMm: 10, yMm: 0 },
        { netId: "b", lengthMm: 10, yMm: 4 },
        { netId: "c", lengthMm: 10, yMm: 8, detourMm: 3 }, // two routes → loop
      ],
      { c: "DQ3" },
    );
    const undef = of(p, "NET_LENGTH_UNDEFINED");
    expect(undef).toHaveLength(1);
    const v = undef[0]!;
    expect(v.ruleClass).toBe("constraint");
    expect(v.severity).toBe("warning");
    expect(v.anchors).toEqual([
      { kind: "net", netId: "c" },
      { kind: "lengthGroup", groupId: "g1" },
    ]);
    expect(v.message).toContain("loop");
    expect(v.message).toContain("DQ3");
    // The looped member is not measured, and it does not set the target for
    // the members that ARE measured either.
    expect(
      of(p, "NET_LENGTH_OUT_OF_RANGE").map((r) =>
        r.anchors[0]!.kind === "net" ? r.anchors[0]!.netId : "?",
      ),
    ).toEqual([]);
  });

  test("every undefined reason reaches the report, known or not", () => {
    // The path model can gain reasons (WP1 adds `unresolved`, an S1-connected
    // contact it could not locate). A reason this check does not recognise
    // must still reach the message — a silent skip is exactly the inertness
    // `NET_LENGTH_UNDEFINED` exists to prevent (contract 14 §3).
    expect(undefinedReasonText("loop")).toContain("loop");
    expect(undefinedReasonText("pour")).toContain("pour");
    expect(undefinedReasonText("via")).toContain("via");
    expect(undefinedReasonText("unresolved")).toContain("unresolved");
    expect(undefinedReasonText("multi-terminal")).toContain("multi-terminal");
    expect(undefinedReasonText("something-new")).toContain("something-new");
  });

  test("no groups → no length violations", () => {
    const p = scene([], [{ netId: "a", lengthMm: 10, yMm: 0 }]);
    expect(of(p, "NET_LENGTH_OUT_OF_RANGE")).toHaveLength(0);
    expect(of(p, "NET_LENGTH_UNDEFINED")).toHaveLength(0);
  });
});
