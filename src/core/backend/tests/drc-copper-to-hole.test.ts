/**
 * S7 — `COPPER_TO_HOLE` (batch-DRC contract 06 §4): copper against a NON-PLATED
 * drill, the pair kind the pour has always cleared and DRC never judged.
 *
 * The two halves must agree by construction, so the last test pins the shared
 * value: the same `copperToHoleClearanceMm` that decides the violation is the
 * radius the fill keeps its copper off the hole by.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type {
  DesignerPcbProjection,
  DrcViolation,
  PcbBoardOutline,
  PcbFreeHole,
  PcbPointMm,
} from "../../../sdks/designer";
import { copperToHoleClearanceMm } from "../../../shared/drc/rule-resolver";
import {
  buildCopperFillIslands,
  type CopperFillPourParams,
} from "../../../shared/rendering/copper-fill/copper-fill-geometry";
import {
  boardWithRules,
  freeHole,
  freePad,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

/** Every geometry below is exactly representable in binary, so gaps are exact. */
const HOLE_D = 1; // drill diameter -> radius 0.5
const HALF = 0.125; // trace half width (widthMm 0.25)

function holes(report: { violations: DrcViolation[] }): DrcViolation[] {
  return report.violations.filter((v) => v.code === "COPPER_TO_HOLE");
}

function run(
  parts: Partial<DesignerPcbProjection>,
  clearance: { copperToBoardEdgeMm: number; copperToHoleMm?: number },
): DrcViolation[] {
  return holes(
    runDrc(projection({ ...parts, board: boardWithRules({ clearance }) })),
  );
}

describe("COPPER_TO_HOLE — copper against a non-plated drill", () => {
  test("a trace crossing a round NPTH free hole is reported", () => {
    const found = run(
      {
        traces: [
          trace("t", "n1", [
            [-5, 0],
            [5, 0],
          ], { widthMm: 0.25 }),
        ],
        freeHoles: [freeHole("h", { x: 0, y: 0 }, HOLE_D)],
      },
      { copperToBoardEdgeMm: 0.5 },
    );
    expect(found).toHaveLength(1);
    // Canonical anchor orientation (06 §7, S9): the smaller anchor key leads,
    // and `fh:h` sorts before `t:t`.
    expect(found[0]!.anchors).toEqual([
      { kind: "freeHole", freeHoleId: "h" },
      { kind: "trace", traceId: "t" },
    ]);
    expect(found[0]!.layer).toBe("F.Cu");
    expect(found[0]!.locationMm).toEqual({ x: 0, y: 0 });
    // Centreline through the centre: -(r + half).
    expect(found[0]!.measuredMm).toBe(-(0.5 + HALF));
    expect(found[0]!.requiredMm).toBe(0.5);
    expect(found[0]!.severity).toBe("error");
  });

  test("with no copperToHoleMm the board-edge rule decides: exact passes, 1 nm closer fails", () => {
    const at = (y: number): DrcViolation[] =>
      run(
        {
          traces: [
            trace("t", "n1", [
              [-5, y],
              [5, y],
            ], { widthMm: 0.25 }),
          ],
          freeHoles: [freeHole("h", { x: 0, y: 0 }, HOLE_D)],
        },
        { copperToBoardEdgeMm: 0.5 },
      );
    // 0.5 (radius) + 0.125 (half width) + 0.5 (rule) — a gap of exactly 0.5.
    expect(at(1.125)).toHaveLength(0);
    const closer = at(1.125 - 1e-6);
    expect(closer).toHaveLength(1);
    expect(closer[0]!.measuredMm).toBeCloseTo(0.5 - 1e-6, 12);
  });

  test("an explicit copperToHoleMm smaller than the edge rule relaxes the check", () => {
    const geometry = {
      traces: [
        trace("t", "n1", [
          [-5, 0.875],
          [5, 0.875],
        ], { widthMm: 0.25 }),
      ],
      freeHoles: [freeHole("h", { x: 0, y: 0 }, HOLE_D)],
    };
    // The gap is 0.25 mm: the 0.5 mm edge rule fails it, an explicit 0.125 does not.
    expect(run(geometry, { copperToBoardEdgeMm: 0.5 })[0]!.measuredMm).toBe(0.25);
    expect(
      run(geometry, { copperToBoardEdgeMm: 0.5, copperToHoleMm: 0.125 }),
    ).toHaveLength(0);
  });

  test("a slotted free hole is measured on its stadium, not on its centre", () => {
    const slotted: PcbFreeHole = {
      ...freeHole("h", { x: 0, y: 0 }, HOLE_D),
      drillSlot: { lengthMm: 4, widthMm: 1, angleDeg: 0 },
    };
    const found = run(
      {
        traces: [
          trace("t", "n1", [
            [3, -5],
            [3, 5],
          ], { widthMm: 0.25 }),
        ],
        freeHoles: [slotted],
      },
      { copperToBoardEdgeMm: 0.5, copperToHoleMm: 1 },
    );
    // Slot cap centre at x = 1.5: 3 - 1.5 - 0.5 - 0.125. A round-hole model
    // would have measured 2.375 mm and cleared the 1 mm rule.
    expect(found).toHaveLength(1);
    expect(found[0]!.measuredMm).toBe(0.875);
  });

  test("a drilled smd free pad: its own copper is not a pair, foreign copper is", () => {
    const drilled = freePad("fp", {
      padType: "smd",
      shape: "circle",
      widthMm: 1.6,
      heightMm: 1.6,
      center: { x: 0, y: 0 },
      drillMm: HOLE_D,
    });
    const own = run({ freePads: [drilled] }, { copperToBoardEdgeMm: 0.5 });
    expect(own).toHaveLength(0);

    const foreign = run(
      {
        freePads: [drilled],
        traces: [
          trace("t", "n1", [
            [-5, 0],
            [5, 0],
          ], { widthMm: 0.25 }),
        ],
      },
      { copperToBoardEdgeMm: 0.5 },
    );
    expect(foreign).toHaveLength(1);
    // `fp:fp` sorts before `t:t` (canonical orientation, 06 §7).
    expect(foreign[0]!.anchors).toEqual([
      { kind: "freePad", freePadId: "fp" },
      { kind: "trace", traceId: "t" },
    ]);
  });

  test("a pad and a via over an NPTH are reported, with no layer of their own", () => {
    const found = run(
      {
        freeHoles: [
          freeHole("h1", { x: 0, y: 0 }, HOLE_D),
          freeHole("h2", { x: 5, y: 0 }, HOLE_D),
        ],
        freePads: [
          freePad("fp", { padType: "smd", center: { x: 0.6, y: 0 } }),
        ],
        vias: [via("v", { center: { x: 5.8, y: 0 } })],
      },
      { copperToBoardEdgeMm: 0.5 },
    );
    const pairs = found.map((v) => v.anchors);
    // Canonical orientation (06 §7): `fh:h1` < `fp:fp`, `fh:h2` < `v:v`.
    expect(pairs).toContainEqual([
      { kind: "freeHole", freeHoleId: "h1" },
      { kind: "freePad", freePadId: "fp" },
    ]);
    expect(pairs).toContainEqual([
      { kind: "freeHole", freeHoleId: "h2" },
      { kind: "via", viaId: "v" },
    ]);
    // A drill is through-stack and a pad / via spans layers of its own, so
    // neither report carries one.
    for (const v of found) expect(v.layer).toBeUndefined();
  });

  test("ids, anchors and measurements do not depend on the input array order", () => {
    const parts = {
      traces: [
        trace("t1", "n1", [
          [-5, 0],
          [5, 0],
        ], { widthMm: 0.25 }),
        trace("t2", "n2", [
          [-5, 0.2],
          [5, 0.2],
        ], { widthMm: 0.25 }),
      ],
      freeHoles: [
        freeHole("h1", { x: 0, y: 0 }, HOLE_D),
        freeHole("h2", { x: 2, y: 0 }, HOLE_D),
      ],
    };
    const board = boardWithRules({ clearance: { copperToBoardEdgeMm: 0.5 } });
    const forward = holes(runDrc(projection({ ...parts, board })));
    const reversed = holes(
      runDrc(
        projection({
          ...parts,
          board,
          traces: [...parts.traces].reverse(),
          freeHoles: [...parts.freeHoles].reverse(),
        }),
      ),
    );
    expect(forward.length).toBe(4);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

// --- the pour side of the same number ---------------------------------------

const POUR_OUTLINE: PcbBoardOutline = {
  kind: "rect",
  widthMm: 20,
  heightMm: 20,
  centerMm: { x: 10, y: 10 },
};
const HOLE_AT: PcbPointMm = { x: 10, y: 10 };

/**
 * Exact-geometry pour of a bare plane around one drilled obstacle: the closest
 * approach of any poured ring to the drill centre. With no fillet, no
 * min-thickness open and a zero zone clearance, only the drill's own halo
 * shapes that number.
 */
function planeAround(
  params: Pick<CopperFillPourParams, "copperToBoardEdgeMm"> &
    Partial<
      Pick<CopperFillPourParams, "copperToHoleMm" | "freeHoles" | "freePads">
    >,
): number {
  const result = buildCopperFillIslands({
    layer: "F.Cu",
    layerCount: 2,
    outline: POUR_OUTLINE,
    placements: [],
    traces: [],
    vias: [],
    pourNetId: "gnd",
    padNetIds: new Map(),
    clearanceMm: 0,
    clearanceForItem: () => 0,
    cornerRadiusMm: 0,
    minThicknessMm: 0,
    minIslandAreaMm2: 0,
    freeHoles: params.freeHoles ?? [freeHole("h", HOLE_AT, HOLE_D)],
    ...params,
  });
  expect(result.status).toBe("ok");
  let best = Infinity;
  for (const island of result.islands) {
    for (const ring of island.rings) {
      for (const p of ring) {
        const d = Math.hypot(p.x - HOLE_AT.x, p.y - HOLE_AT.y);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

describe("COPPER_TO_HOLE — the pour clears exactly what DRC requires", () => {
  test("the NPTH halo radius is the DRC requirement, field present or absent", () => {
    // ONE value, read by both sides.
    const explicit = copperToHoleClearanceMm(
      boardWithRules({
        clearance: { copperToBoardEdgeMm: 0.3, copperToHoleMm: 0.9 },
      }).designRules,
    );
    const inherited = copperToHoleClearanceMm(
      boardWithRules({ clearance: { copperToBoardEdgeMm: 0.3 } }).designRules,
    );
    expect(explicit).toBe(0.9);
    expect(inherited).toBe(0.3);

    // The fill's void starts at the drill wall + that requirement; the small
    // surplus is the round-offset chord compensation plus one output grid step.
    for (const [required, edge] of [
      [explicit, 0.3],
      [inherited, 0.3],
    ] as const) {
      const halo = planeAround({
        copperToBoardEdgeMm: edge,
        copperToHoleMm: required,
      });
      expect(halo).toBeGreaterThanOrEqual(HOLE_D / 2 + required);
      // The surplus is the kernel's own conservative padding — the round
      // offset's chord compensation plus one output grid step (§3.2) — and
      // never the clearance itself, whose smallest value here is 0.3.
      expect(halo).toBeLessThan(HOLE_D / 2 + required + 0.05);
    }

    // An absent key reproduces the pre-S7 artwork: the board-edge rule.
    expect(planeAround({ copperToBoardEdgeMm: 0.3 })).toBe(
      planeAround({ copperToBoardEdgeMm: 0.3, copperToHoleMm: inherited }),
    );
  });

  test("a drilled smd free pad is a non-plated aperture, like a free hole", () => {
    // Same-net copper merges into the pour, so the ONLY void this pad makes is
    // its drill's halo — which the pre-S7 `padType === "hole"` filter left out
    // entirely, pouring copper onto a bare drilled wall.
    const params = { copperToBoardEdgeMm: 0.3, copperToHoleMm: 0.4 } as const;
    expect(
      planeAround({
        ...params,
        freeHoles: [],
        freePads: [
          freePad("fp", {
            padType: "smd",
            shape: "circle",
            widthMm: 1.6,
            heightMm: 1.6,
            center: HOLE_AT,
            drillMm: HOLE_D,
            netId: "gnd",
          }),
        ],
      }),
    ).toBe(planeAround(params));
  });
});
