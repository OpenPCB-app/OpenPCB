import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import type {
  DesignerPcbProjection,
  DrcViolation,
  PcbBoardSettings,
  PcbLengthMatchGroup,
  PcbTrace,
} from "../../../sdks/designer";

const TS = "2026-01-01T00:00:00.000Z";
const MM = 1_000_000;

function board(groups: PcbLengthMatchGroup[]): PcbBoardSettings {
  return {
    ...createDefaultPcbBoardSettings(TS),
    ...(groups.length > 0 ? { lengthMatchGroups: groups } : {}),
  };
}

function projection(
  groups: PcbLengthMatchGroup[],
  traces: PcbTrace[],
  netNames: Record<string, string> = {},
): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 1,
    board: board(groups),
    placements: [],
    traces,
    vias: [],
    freeHoles: [],
    freePads: [],
    overlayTexts: [],
    overlayShapes: [],
    zones: [],
    keepouts: [],
    ratsnest: [],
    netNames,
    warnings: [],
  };
}

/** Straight horizontal trace of `lengthMm` on F.Cu. */
function trace(id: string, netId: string, lengthMm: number, y = 0): PcbTrace {
  return {
    id,
    netId,
    netClassId: "default",
    layer: "F.Cu",
    widthMm: 0.25,
    pointsNm: [
      { x: 0, y: y * MM },
      { x: lengthMm * MM, y: y * MM },
    ],
    segmentMode: "manhattan-90",
  };
}

function lengthViolations(p: DesignerPcbProjection): DrcViolation[] {
  return runDrc(p).violations.filter(
    (v) => v.code === "NET_LENGTH_OUT_OF_RANGE",
  );
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
    const violations = lengthViolations(
      projection(
        [GROUP_LONGEST],
        [
          trace("t-a", "a", 10, 0),
          trace("t-b", "b", 9.8, 2), // within ±0.5 of 10
          trace("t-c", "c", 7, 4), // 3 mm short → violation
        ],
        { c: "DQ3" },
      ),
    );
    expect(violations).toHaveLength(1);
    const v = violations[0]!;
    expect(v.ruleClass).toBe("constraint");
    expect(v.severity).toBe("warning");
    expect(v.anchors).toEqual([{ kind: "net", netId: "c" }]);
    expect(v.measuredMm).toBeCloseTo(7);
    expect(v.requiredMm).toBeCloseTo(10);
    expect(v.message).toContain("DQ3");
    expect(v.message).toContain("'DDR'");
  });

  test("unrouted members are skipped; single routed member is no group", () => {
    // Only net a routed → longest group degenerates, no violations.
    expect(
      lengthViolations(projection([GROUP_LONGEST], [trace("t-a", "a", 10)])),
    ).toHaveLength(0);
  });

  test("multi-trace nets sum across segments", () => {
    const violations = lengthViolations(
      projection(
        [GROUP_LONGEST],
        [
          trace("t-a", "a", 10, 0),
          // Net c = 3 + 4 = 7 mm across two traces → still 3 mm short.
          trace("t-c1", "c", 3, 4),
          trace("t-c2", "c", 4, 6),
        ],
      ),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.measuredMm).toBeCloseTo(7);
  });

  test("absolute target flags both directions", () => {
    const group: PcbLengthMatchGroup = {
      id: "g2",
      name: "CLK",
      netIds: ["long", "short", "ok"],
      target: { kind: "absolute", mm: 8 },
      toleranceMm: 0.5,
    };
    const violations = lengthViolations(
      projection(
        [group],
        [
          trace("t-l", "long", 10, 0), // 2 mm over
          trace("t-s", "short", 7, 2), // 1 mm short
          trace("t-o", "ok", 8.2, 4), // inside the band
        ],
      ),
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

  test("no groups → no length violations", () => {
    expect(
      lengthViolations(projection([], [trace("t-a", "a", 10)])),
    ).toHaveLength(0);
  });
});
