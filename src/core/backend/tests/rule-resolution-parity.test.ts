/**
 * ONE resolution, four consumers (rule-semantics contract §9). Batch DRC's
 * `requiredMm`, a direct `RuleResolver.clearance` call, the live route gate's
 * `requiredMm` and the copper pour's `clearanceForItem` must be the SAME
 * number for the same pair — to 1e-9, not "about the same". Before S6 each of
 * them carried its own formula, and the pour's was a maximum over all four
 * board clearances with no rule tier at all.
 *
 * The fixture exercises every tier at once: an `area` relaxation to 0.15 mm
 * that sits ABOVE the 0.12 mm floor and BELOW the 0.25 mm board rule — so the
 * number all four legs must agree on is the EXPLICIT tier, not a floor clamp
 * that would look identical — plus a 0.8 mm net class on the pair outside that
 * area.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { buildDrcContext } from "../../../modules/designer/backend/drc/drc-context";
import { runLiveDrc } from "../../../modules/designer/frontend/pcb/drc/live-drc";
import { createRuleResolver } from "../../../shared/drc/rule-resolver";
import {
  pourParamsForZone,
  zonePourNets,
} from "../../../shared/pcb-areas";
import { copperLayersForCount } from "../../../sdks/designer";
import type {
  DrcViolation,
  PcbBoardSettings,
  PcbNetClass,
  PcbZone,
} from "../../../sdks/designer";
import {
  boardWithRules,
  freePad,
  MM,
  projection,
  trace,
} from "./helpers/drc-fixtures";

const NET_CLASSES: PcbNetClass[] = [
  {
    id: "default",
    name: "Default",
    traceWidthMm: 0.25,
    clearanceMm: 0.25,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#d4d4d8",
    defaultViaProtection: "tented",
  },
  {
    id: "hv",
    name: "HV",
    traceWidthMm: 0.5,
    clearanceMm: 0.8,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#f87171",
    defaultViaProtection: "tented",
  },
];

/**
 * The relaxing area encloses BOTH items of the left-hand pair, so the mask is
 * constant over it and the resolution is independent of the evaluation point —
 * which is what lets the four consumers be compared exactly (§4.4 fast path).
 */
const RELAX_AREA = [
  { x: -20, y: -5 },
  { x: -5, y: -5 },
  { x: -5, y: 5 },
  { x: -20, y: 5 },
];

const BOARD_ZONE: PcbZone = {
  id: "board:F.Cu",
  name: null,
  enabled: true,
  lockedAt: null,
  layer: "F.Cu",
  netId: "gnd",
  netName: null,
  region: { kind: "board" },
  priority: 0,
  padConnection: "solid",
} as unknown as PcbZone;

function fixtureBoard(): PcbBoardSettings {
  return boardWithRules({
    clearance: { traceToPadMm: 0.25 },
    // The absolute floor: nothing resolves below it, not even an explicit
    // rule. Kept BELOW the relaxing rule's 0.15 so the number the four legs
    // agree on is the rule's, not a clamp that would look the same.
    minimums: { clearanceMm: 0.12 },
    netClasses: NET_CLASSES,
    perNetClassAssignments: { nb: "hv", nd: "hv" },
    drcRules: [
      {
        id: "bga",
        name: "BGA fanout relaxation",
        enabled: true,
        priority: 10,
        scopes: [{ kind: "area", polygonMm: RELAX_AREA }],
        // ABOVE the 0.12 floor and BELOW the 0.25 board rule, so 0.15 is
        // observable as the explicit tier: a leg that silently fell back to
        // the floor or to the board rule would disagree.
        constraint: { kind: "clearance", mm: 0.15 },
      },
    ],
  });
}

function fixtureProjection() {
  return projection({
    board: fixtureBoard(),
    netNames: { na: "NET_A", nb: "NET_B", nc: "NET_C", nd: "NET_D", gnd: "GND" },
    zones: [BOARD_ZONE],
    freePads: [
      // Outside the area; the class tier (0.8) is the implicit maximum.
      freePad("pad_out", { center: { x: 12, y: 0 }, netId: "nd", widthMm: 1, heightMm: 1 }),
    ],
    traces: [
      // The left PAIR, both traces wholly inside the relaxing area: centre
      // gap 0.33 mm, edge gap 0.33 − 0.2 = 0.13 mm, against the relaxed 0.15.
      trace("t_in_a", "na", PENDING_PATH_MM),
      trace("t_in_b", "nb", [
        [-14, 0.33],
        [-10, 0.33],
      ]),
      trace("t_out", "nc", [
        [12, -3],
        [12, -0.7],
      ]),
    ],
  });
}

/** The left pair's first trace, re-used as the live gate's PENDING route. */
const PENDING_PATH_MM: Array<[number, number]> = [
  [-14, 0],
  [-10, 0],
];

function clearanceViolations(): DrcViolation[] {
  return runDrc(fixtureProjection()).violations.filter(
    (v) =>
      v.code === "TRACE_TO_PAD_CLEARANCE" ||
      v.code === "TRACE_TO_TRACE_CLEARANCE",
  );
}

/** The one violation whose anchors name this trace. */
function forTrace(violations: DrcViolation[], traceId: string): DrcViolation {
  const hit = violations.find((v) =>
    v.anchors.some((a) => a.kind === "trace" && a.traceId === traceId),
  );
  if (!hit) throw new Error(`no clearance violation for ${traceId}`);
  return hit;
}

describe("one resolution — batch DRC, the resolver and the pour agree", () => {
  test("batch requiredMm equals a direct resolver call, to 1e-9", () => {
    const proj = fixtureProjection();
    const resolver = createRuleResolver(proj.board, proj.netNames, {
      validCopperLayers: copperLayersForCount(proj.board.layerCount),
    });
    const violations = clearanceViolations();
    expect(violations.length).toBe(2);

    // Inside the relaxing area: the rule matches first and relaxes the pair
    // from the 0.25 board rule to its own 0.15 — above the floor, so this is
    // the EXPLICIT tier and not a clamp.
    const inside = resolver.clearance(
      "traceToTrace",
      "F.Cu",
      { netId: "na", pointMm: { x: -12, y: 0 } },
      { netId: "nb", pointMm: { x: -12, y: 0.33 } },
    );
    expect(inside.mm).toBeCloseTo(0.15, 9);
    expect(inside.rule?.id).toBe("bga");
    expect(inside.mm).toBeGreaterThan(proj.board.designRules.minimums.clearanceMm!);
    expect(forTrace(violations, "t_in_a").requiredMm!).toBeCloseTo(inside.mm, 9);

    // Outside it: implicit tier = max(board 0.25, class(na) 0.25, class(nd) 0.8).
    const outside = resolver.clearance(
      "traceToPad",
      "F.Cu",
      { netId: "nc", pointMm: { x: 12, y: -1.85 } },
      { netId: "nd", pointMm: { x: 12, y: 0 } },
    );
    expect(outside.mm).toBeCloseTo(0.8, 9);
    expect(outside.rule).toBeNull();
    expect(forTrace(violations, "t_out").requiredMm!).toBeCloseTo(outside.mm, 9);
  });

  test("the live route gate agrees with batch on the same trace pair", () => {
    const proj = fixtureProjection();
    const resolver = createRuleResolver(proj.board, proj.netNames, {
      validCopperLayers: copperLayersForCount(proj.board.layerCount),
    });
    const batch = forTrace(clearanceViolations(), "t_in_a");
    expect(batch.code).toBe("TRACE_TO_TRACE_CLEARANCE");

    // Re-route `t_in_a` as a PENDING trace against the rest of the board: the
    // gate must refuse it at exactly the number batch reports, not at the
    // board rule (which it used before S6) and not at the floor.
    const live = runLiveDrc({
      traceNm: PENDING_PATH_MM.map(([x, y]) => ({
        x: Math.round(x * MM),
        y: Math.round(y * MM),
      })),
      traceWidthMm: 0.2,
      netId: "na",
      layer: "F.Cu",
      traces: proj.traces.filter((t) => t.id !== "t_in_a"),
      placements: proj.placements,
      padNetMap: new Map(),
      resolver,
    });
    const gate = live.find((v) => v.type === "trace-trace");
    expect(gate).toBeDefined();
    expect(gate!.requiredMm).toBe(batch.requiredMm!);
    expect(gate!.distanceMm).toBe(batch.measuredMm!);
    // Not vacuous: the agreed number is the rule's, not either fallback.
    expect(gate!.requiredMm).toBeCloseTo(0.15, 9);
  });

  test("the pour's clearanceForItem is the resolver's pour resolution", () => {
    const proj = fixtureProjection();
    const ctx = buildDrcContext(proj);
    const zone = ctx.copperZones.find((z) => z.id === "board:F.Cu")!;
    const params = pourParamsForZone(
      zone,
      proj.board.designRules,
      ctx.keepouts,
      ctx.copperZones,
      zonePourNets(proj.board, ctx.netNames),
    );
    const resolver = createRuleResolver(proj.board, proj.netNames, {
      validCopperLayers: copperLayersForCount(proj.board.layerCount),
    });

    for (const item of [
      { kind: "pad" as const, netId: "nb", pointMm: { x: -12, y: 0 } },
      { kind: "pad" as const, netId: "nd", pointMm: { x: 12, y: 0 } },
      { kind: "trace" as const, netId: "na", pointMm: { x: -12, y: -1.85 } },
      { kind: "via" as const, netId: "nc", pointMm: { x: 12, y: -1.85 } },
    ]) {
      const pairKind =
        item.kind === "pad"
          ? ("pourToPad" as const)
          : item.kind === "via"
            ? ("pourToVia" as const)
            : ("pourToTrace" as const);
      expect(params.clearanceForItem(item)).toBeCloseTo(
        resolver.clearancePour(pairKind, "F.Cu", "gnd", {
          netId: item.netId,
          pointMm: item.pointMm,
        }).mm,
        9,
      );
    }

    // The area rule carries no pour `pairKind` scope, so it cannot reach the
    // fill at all (§6 rule 1): the pad inside the relaxing area is still held
    // at its class tier, not at the clamped 0.15.
    expect(
      params.clearanceForItem({
        kind: "pad",
        netId: "nb",
        pointMm: { x: -12, y: 0 },
      }),
    ).toBeCloseTo(0.8, 9);
  });
});
