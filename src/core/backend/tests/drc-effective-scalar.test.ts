import { describe, expect, test } from "bun:test";
import type {
  DesignerPcbProjection,
  DrcRuleCode,
  DrcViolation,
  PcbDrcRule,
} from "../../../sdks/designer";
import { buildDrcContext } from "../../../shared/drc/drc-context";
import { runDrc } from "../../../shared/drc/drc-engine";
import { checkPendingCopper, type PendingCopper } from "../../../shared/drc/legality";
import type { DrcBroadPhaseMode } from "../../../shared/drc/types";
import { board, freeHole, freePad, projection, trace, via } from "./helpers/drc-fixtures";

const SCALAR_CODES = new Set<DrcRuleCode>([
  "TRACE_WIDTH_MIN",
  "VIA_DIAMETER_MIN",
  "VIA_DRILL_MIN",
  "ANNULAR_RING_MIN",
  "COPPER_TO_BOARD_EDGE",
  "HOLE_TO_HOLE",
]);

function rule(
  kind: "trackWidth" | "viaDiameter" | "viaDrill" | "annularRing" | "edgeClearance" | "holeToHole",
  minMm: number,
): PcbDrcRule {
  return {
    id: kind,
    name: kind,
    enabled: true,
    priority: 1,
    scopes: [{ kind: "net", netIds: ["a"] }],
    constraint: { kind, minMm },
  };
}

function scene(
  rules: PcbDrcRule[],
  parts: Partial<DesignerPcbProjection> = {},
): DesignerPcbProjection {
  return projection({
    ...parts,
    netNames: { a: "A", b: "B" },
    board: board({
      fabricator: "custom",
      drcRules: rules,
      outline: {
        kind: "rect",
        widthMm: 100,
        heightMm: 100,
        centerMm: { x: 0, y: 0 },
      },
    }),
  });
}

function scalarRows(rows: DrcViolation[]): DrcViolation[] {
  return rows.filter((v) => SCALAR_CODES.has(v.code));
}

function batch(p: DesignerPcbProjection, broadPhase: DrcBroadPhaseMode): DrcViolation[] {
  return scalarRows(runDrc(p, { broadPhase }).violations);
}

function committed(
  p: DesignerPcbProjection,
  pending: PendingCopper,
  replaces: string[] = [],
): DesignerPcbProjection {
  return {
    ...p,
    traces: [...p.traces.filter((t) => !replaces.includes(t.id)), ...pending.traces],
    vias: [...p.vias.filter((v) => !replaces.includes(v.id)), ...pending.vias],
  };
}

function live(
  p: DesignerPcbProjection,
  pending: PendingCopper,
  broadPhase: DrcBroadPhaseMode,
  replaces: string[] = [],
): DrcViolation[] {
  return scalarRows(
    checkPendingCopper(buildDrcContext(p, { broadPhase }), pending, {
      replaces,
    }),
  );
}

for (const broadPhase of ["grid", "exhaustive"] as const) {
  describe(`effective scalar rules (${broadPhase})`, () => {
    test("unassigned trace inherits explicit net and net-class width minima", () => {
      const p = scene([rule("trackWidth", 0.8)], {
        traces: [
          trace(
            "rated",
            "a",
            [
              [0, 0],
              [5, 0],
            ],
            { widthMm: 1 },
          ),
          trace(
            "extension",
            null,
            [
              [5, 0],
              [10, 0],
            ],
            { widthMm: 0.25 },
          ),
        ],
      });
      expect(batch(p, broadPhase).map((v) => [v.code, v.requiredMm])).toEqual([
        ["TRACE_WIDTH_MIN", 0.8],
      ]);
      p.board.perNetClassAssignments = { a: p.board.netClasses[0]!.id };
      p.board.drcRules![0]!.scopes = [
        { kind: "netClass", netClassIds: [p.board.netClasses[0]!.id] },
      ];
      expect(batch(p, broadPhase).map((v) => [v.code, v.requiredMm])).toEqual([
        ["TRACE_WIDTH_MIN", 0.8],
      ]);
    });

    test("pending connector changes existing trace and via tiers; live equals batch", () => {
      const p = scene(
        [
          rule("trackWidth", 0.8),
          rule("viaDiameter", 0.9),
          rule("viaDrill", 0.5),
          rule("annularRing", 0.25),
          rule("holeToHole", 1),
        ],
        {
          traces: [
            trace(
              "rated",
              "a",
              [
                [0, 0],
                [4, 0],
              ],
              { widthMm: 1 },
            ),
            trace(
              "extension",
              null,
              [
                [6, 0],
                [10, 0],
              ],
              { widthMm: 0.25 },
            ),
          ],
          vias: [via("v", { center: { x: 10, y: 0 } })],
          freeHoles: [freeHole("h", { x: 11.2, y: 0 }, 0.4)],
        },
      );
      const pending = {
        traces: [
          trace(
            "connector",
            "a",
            [
              [4, 0],
              [6, 0],
            ],
            { widthMm: 1 },
          ),
        ],
        vias: [],
      };
      expect(batch(p, broadPhase)).toEqual([]);
      const expected = batch(committed(p, pending), broadPhase);
      expect(expected.map((v) => v.code).sort()).toEqual([
        "ANNULAR_RING_MIN",
        "HOLE_TO_HOLE",
        "TRACE_WIDTH_MIN",
        "VIA_DIAMETER_MIN",
        "VIA_DRILL_MIN",
      ]);
      expect(live(p, pending, broadPhase)).toEqual(expected);
      expect(new Set(expected.map((v) => v.id)).size).toBe(expected.length);
    });

    test("pending null via inherits its conductor's diameter, drill and annular rules", () => {
      const p = scene(
        [rule("viaDiameter", 0.9), rule("viaDrill", 0.5), rule("annularRing", 0.25)],
        {
          traces: [
            trace(
              "rated",
              "a",
              [
                [0, 0],
                [5, 0],
              ],
              { widthMm: 1 },
            ),
          ],
        },
      );
      const pending = {
        traces: [],
        vias: [via("v", { center: { x: 5, y: 0 } })],
      };
      const expected = batch(committed(p, pending), broadPhase);
      expect(expected.map((v) => v.code).sort()).toEqual([
        "ANNULAR_RING_MIN",
        "VIA_DIAMETER_MIN",
        "VIA_DRILL_MIN",
      ]);
      expect(live(p, pending, broadPhase)).toEqual(expected);
    });

    test("retiered traces, pads and vias inherit edge scopes", () => {
      const p = scene([rule("edgeClearance", 1.5)], {
        traces: [
          trace(
            "rated",
            "a",
            [
              [44, 0],
              [46, 0],
            ],
            { widthMm: 0.25 },
          ),
          trace(
            "extension",
            null,
            [
              [48, 0],
              [49, 0],
            ],
            { widthMm: 0.25 },
          ),
        ],
        vias: [via("v", { center: { x: 49, y: 0 } })],
        freePads: [
          freePad("p", {
            center: { x: 49, y: 0.5 },
            widthMm: 0.5,
            heightMm: 0.5,
          }),
        ],
      });
      const pending = {
        traces: [
          trace(
            "connector",
            "a",
            [
              [46, 0],
              [48, 0],
            ],
            { widthMm: 0.25 },
          ),
        ],
        vias: [],
      };
      expect(batch(p, broadPhase)).toEqual([]);
      const expected = batch(committed(p, pending), broadPhase);
      expect(expected.map((v) => v.code)).toEqual([
        "COPPER_TO_BOARD_EDGE",
        "COPPER_TO_BOARD_EDGE",
        "COPPER_TO_BOARD_EDGE",
      ]);
      expect(live(p, pending, broadPhase)).toEqual(expected);
    });

    test("plated pad holes inherit tiers; mechanical holes remain unassigned", () => {
      const p = scene([rule("holeToHole", 1.2)], {
        traces: [
          trace(
            "rated",
            "a",
            [
              [0, 0],
              [4, 0],
            ],
            { widthMm: 0.25 },
          ),
        ],
        freePads: [
          freePad("p", {
            padType: "std",
            center: { x: 6, y: 0 },
            widthMm: 1.4,
            heightMm: 1.4,
            drillMm: 0.6,
          }),
        ],
        freeHoles: [freeHole("h", { x: 7.5, y: 0 }, 0.4)],
      });
      const pending = {
        traces: [
          trace(
            "connector",
            "a",
            [
              [4, 0],
              [6, 0],
            ],
            { widthMm: 0.25 },
          ),
        ],
        vias: [],
      };
      const expected = batch(committed(p, pending), broadPhase);
      expect(expected.map((v) => [v.code, v.requiredMm])).toEqual([["HOLE_TO_HOLE", 1.2]]);
      expect(live(p, pending, broadPhase)).toEqual(expected);
    });

    test("replacement disconnects former tier without stale scalar violations", () => {
      const p = scene([rule("trackWidth", 0.8)], {
        traces: [
          trace(
            "rated",
            "a",
            [
              [0, 0],
              [4, 0],
            ],
            { widthMm: 1 },
          ),
          trace(
            "connector",
            "a",
            [
              [4, 0],
              [6, 0],
            ],
            { widthMm: 1 },
          ),
          trace(
            "extension",
            null,
            [
              [6, 0],
              [10, 0],
            ],
            { widthMm: 0.25 },
          ),
        ],
      });
      expect(batch(p, broadPhase).map((v) => v.code)).toEqual(["TRACE_WIDTH_MIN"]);
      const pending = {
        traces: [
          trace(
            "connector",
            "a",
            [
              [4, 0],
              [4.5, 0],
            ],
            { widthMm: 1 },
          ),
        ],
        vias: [],
      };
      expect(live(p, pending, broadPhase, ["connector"])).toEqual([]);
      expect(batch(committed(p, pending, ["connector"]), broadPhase)).toEqual([]);
    });

    test("retiering does not re-report unchanged violations or unrelated copper", () => {
      const p = scene([rule("trackWidth", 0.8)], {
        traces: [
          trace(
            "rated",
            "a",
            [
              [0, 0],
              [4, 0],
            ],
            { widthMm: 1 },
          ),
          trace(
            "unrelated",
            "a",
            [
              [0, 10],
              [4, 10],
            ],
            { widthMm: 0.25 },
          ),
          trace(
            "extension",
            null,
            [
              [6, 0],
              [10, 0],
            ],
            { widthMm: 1 },
          ),
        ],
        vias: [via("v", { center: { x: 10, y: 0 }, diameterMm: 0.3, drillMm: 0.3 })],
      });
      const pending = {
        traces: [
          trace(
            "connector",
            "a",
            [
              [4, 0],
              [6, 0],
            ],
            { widthMm: 1 },
          ),
        ],
        vias: [],
      };
      expect(batch(p, broadPhase).length).toBeGreaterThan(0);
      expect(live(p, pending, broadPhase)).toEqual([]);
    });

    test("severity increase is rechecked; a fixed code override leaves no new violation", () => {
      const common = {
        ...rule("trackWidth", 0.8),
        id: "all",
        scopes: [],
        severity: "warning" as const,
      };
      const scoped = {
        ...rule("trackWidth", 0.8),
        priority: 2,
        severity: "error" as const,
      };
      const p = scene([scoped, common], {
        traces: [
          trace(
            "rated",
            "a",
            [
              [0, 0],
              [4, 0],
            ],
            { widthMm: 1 },
          ),
          trace(
            "extension",
            null,
            [
              [6, 0],
              [10, 0],
            ],
            { widthMm: 0.25 },
          ),
        ],
      });
      const pending = {
        traces: [
          trace(
            "connector",
            "a",
            [
              [4, 0],
              [6, 0],
            ],
            { widthMm: 1 },
          ),
        ],
        vias: [],
      };
      expect(batch(p, broadPhase).map((v) => v.severity)).toEqual(["warning"]);
      expect(live(p, pending, broadPhase).map((v) => v.severity)).toEqual(["error"]);
      const rows = checkPendingCopper(buildDrcContext(p, { broadPhase }), pending, {
        severityOverrides: { TRACE_WIDTH_MIN: "warning" },
      });
      expect(scalarRows(rows)).toEqual([]);
    });
  });
}
