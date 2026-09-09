import { describe, expect, test } from "bun:test";
import { buildRouteObstacles } from "../../../shared/pcb-routing/route-obstacles";
import { segmentIntersectsRectNm } from "../../../shared/pcb-routing/collision";
import { buildDrcItems } from "../../../shared/drc/drc-context";
import { blockingViolations, runLiveDrc } from "../../../modules/designer/frontend/pcb/drc/live-drc";
import { keepoutAffects } from "../../../shared/pcb-areas/keepout-predicates";
import type {
  DesignerPcbProjection,
  DrcRuleCode,
  PcbBoardSettings,
  PcbDrcRule,
  PcbFreeHole,
  PcbFreePad,
  PcbKeepout,
  PcbNetClass,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../sdks/designer";
import type {
  ObstacleRectNm,
  PointNm,
} from "../../../shared/pcb-routing/types";
import { boardWithRules, projection } from "./helpers/drc-fixtures";

const NM = 1_000_000;

function trace(
  id: string,
  pointsNm: Array<{ x: number; y: number }>,
  opts: Partial<Pick<PcbTrace, "netId" | "layer" | "widthMm">> = {},
): PcbTrace {
  return {
    id,
    netId: opts.netId ?? null,
    netClassId: "default",
    layer: opts.layer ?? "F.Cu",
    widthMm: opts.widthMm ?? 0.2,
    pointsNm,
    segmentMode: "manhattan-45",
  };
}

function via(
  id: string,
  xMm: number,
  yMm: number,
  netId: string | null = null,
): PcbVia {
  return {
    id,
    netId,
    netClassId: "default",
    centerMm: { x: xMm, y: yMm },
    diameterMm: 0.8,
    drillMm: 0.4,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    provenance: "route",
  };
}

function pad(
  number: string,
  xMm: number,
  yMm: number,
  wMm = 1,
  hMm = 2,
  opts: { drillDiameterMm?: number } = {},
) {
  return {
    id: `pad-${number}`,
    number,
    shape: "rect" as const,
    centerMm: { x: xMm, y: yMm },
    widthMm: wMm,
    heightMm: hMm,
    rotationDeg: 0,
    ...(opts.drillDiameterMm !== undefined
      ? { drillDiameterMm: opts.drillDiameterMm }
      : {}),
  };
}

function placement(
  id: string,
  positionMm: { x: number; y: number },
  pads: ReturnType<typeof pad>[],
  opts: Partial<Pick<PcbPlacedPart, "rotationDeg" | "layer" | "mirrored">> = {},
): PcbPlacedPart {
  return {
    id,
    partId: `part-${id}`,
    componentId: `comp-${id}`,
    reference: id.toUpperCase(),
    positionMm,
    rotationDeg: opts.rotationDeg ?? 0,
    mirrored: opts.mirrored ?? false,
    layer: opts.layer ?? "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads,
        graphics: [],
        labels: [],
        bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
        warnings: [],
      },
    },
  };
}

/** 10x10 mm square keepout at the origin, tracks forbidden on F.Cu. */
function keepout(overrides: Partial<PcbKeepout> = {}): PcbKeepout {
  return {
    id: "k1",
    name: "K1",
    enabled: true,
    lockedAt: null,
    layers: ["F.Cu"],
    pointsMm: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    restrictions: {
      tracks: true,
      vias: false,
      pads: false,
      copperPour: false,
      footprints: false,
    },
    ...overrides,
  };
}

function freeHole(id: string, xMm: number, yMm: number): PcbFreeHole {
  return { id, centerMm: { x: xMm, y: yMm }, drillMm: 1.2, lockedAt: null };
}

function freePad(id: string, xMm: number, yMm: number): PcbFreePad {
  return {
    id,
    centerMm: { x: xMm, y: yMm },
    rotationDeg: 0,
    padType: "smd",
    shape: "rect",
    widthMm: 1,
    heightMm: 1,
    drillMm: null,
    layer: "F.Cu",
    netId: null,
    solderMaskExpansionMm: null,
    solderPasteExpansionMm: null,
    lockedAt: null,
  };
}

function netClass(id: string, clearanceMm: number): PcbNetClass {
  return {
    id,
    name: id,
    traceWidthMm: 0.25,
    clearanceMm,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#d4d4d8",
    defaultViaProtection: "tented",
  };
}

/**
 * The obstacle builder resolves every inflation through the ONE rule resolver
 * of the context it is given (rule-semantics contract §9, live-parity contract
 * 07 §5). The default class carries clearance 0 so the board tier is what the
 * geometry assertions below measure; `wide` (0.8 mm) is assigned to `net-b` to
 * exercise the neighbour-class tier, and the three board pair kinds are
 * deliberately DISTINCT so a rect proves which kind it used.
 */
function boardFor(
  opts: {
    drcRules?: PcbDrcRule[];
    perNetClassAssignments?: Record<string, string>;
  } = {},
): PcbBoardSettings {
  return boardWithRules({
    clearance: {
      traceToTraceMm: 0.2,
      traceToPadMm: 0.25,
      traceToViaMm: 0.3,
    },
    netClasses: [netClass("default", 0), netClass("wide", 0.8)],
    layerCount: 4,
    outline: {
      kind: "rect",
      widthMm: 200,
      heightMm: 200,
      centerMm: { x: 0, y: 0 },
    },
    ...(opts.perNetClassAssignments
      ? { perNetClassAssignments: opts.perNetClassAssignments }
      : {}),
    ...(opts.drcRules ? { drcRules: opts.drcRules } : {}),
  });
}

/** Scoped to `net-b`, so it applies wherever the route is (no area scope). */
function netScopedRule(id: string, mm: number): PcbDrcRule {
  return {
    id,
    name: id,
    enabled: true,
    priority: 10,
    scopes: [{ kind: "net", netIds: ["net-b"] }],
    constraint: { kind: "clearance", mm },
  };
}

/**
 * Scoped to an area that CONTAINS the obstacle trace (y ∈ [-1, 1], x ∈ [-1,
 * 11]) — so it applies at the obstacle's evaluation point but says nothing
 * about where the route itself may be.
 */
function areaScopedRule(id: string, mm: number): PcbDrcRule {
  return {
    id,
    name: id,
    enabled: true,
    priority: 10,
    scopes: [
      {
        kind: "area",
        polygonMm: [
          { x: -1, y: -1 },
          { x: 11, y: -1 },
          { x: 11, y: 1 },
          { x: -1, y: 1 },
        ],
      },
    ],
    constraint: { kind: "clearance", mm },
  };
}

/** The context the router and the gate share — built from one projection. */
function ctxFor(parts: Partial<DesignerPcbProjection> = {}) {
  return buildDrcItems(
    projection({
      board: parts.board ?? boardFor(),
      netNames: parts.netNames ?? { "net-a": "A", "net-b": "B" },
      ...parts,
    }),
  );
}

const BASE = {
  layer: "F.Cu" as const,
  netId: "net-a" as string | null,
  routeWidthMm: 0.3,
};

/**
 * The rect edge must be a SUPERSET of the exact envelope, by at most the one
 * nanometre outward rounding costs (07 §5).
 */
function expectOutward(
  actual: number,
  exactNm: number,
  side: "min" | "max",
): void {
  if (side === "min") {
    expect(actual).toBeLessThanOrEqual(exactNm);
    expect(actual).toBeGreaterThanOrEqual(exactNm - 1);
  } else {
    expect(actual).toBeGreaterThanOrEqual(exactNm);
    expect(actual).toBeLessThanOrEqual(exactNm + 1);
  }
}

function byId(rects: ObstacleRectNm[], id: string): ObstacleRectNm {
  const hit = rects.find((r) => r.id === id);
  if (!hit) throw new Error(`no obstacle rect ${id} in [${rects.map((r) => r.id)}]`);
  return hit;
}

describe("buildRouteObstacles — traces", () => {
  test("emits one rect per segment with the resolved inflation", () => {
    const ctx = ctxFor({
      traces: [
        trace("t1", [
          { x: 0, y: 0 },
          { x: 10 * NM, y: 0 },
          { x: 10 * NM, y: 5 * NM },
        ]),
      ],
    });
    const rects = buildRouteObstacles({ ...BASE, ctx });
    expect(rects.map((r) => r.id)).toEqual(["trace:t1:0", "trace:t1:1"]);
    // required = clearance 0.2 + otherHalf 0.1 + routeHalf 0.15 = 0.45 mm
    const seg0 = byId(rects, "trace:t1:0");
    expectOutward(seg0.minX, -450_000, "min");
    expectOutward(seg0.minY, -450_000, "min");
    expectOutward(seg0.maxX, 10 * NM + 450_000, "max");
    expectOutward(seg0.maxY, 450_000, "max");
  });

  test("skips other-layer and same-net traces", () => {
    const ctx = ctxFor({
      traces: [
        trace("back", [{ x: 0, y: 0 }, { x: NM, y: 0 }], { layer: "B.Cu" }),
        trace("mine", [{ x: 0, y: 0 }, { x: NM, y: 0 }], { netId: "net-a" }),
        trace("nullnet", [{ x: 0, y: 0 }, { x: NM, y: 0 }]),
      ],
    });
    const rects = buildRouteObstacles({ ...BASE, ctx });
    // null-net trace is NOT skipped (unknown net must stay an obstacle).
    expect(rects.map((r) => r.id)).toEqual(["trace:nullnet:0"]);
  });

  test("null session net treats even named nets as obstacles", () => {
    const ctx = ctxFor({
      traces: [
        trace("t", [{ x: 0, y: 0 }, { x: NM, y: 0 }], { netId: "net-a" }),
      ],
    });
    expect(
      buildRouteObstacles({ ...BASE, ctx, netId: null }),
    ).toHaveLength(1);
  });

  test("`extra` pending copper blocks like committed copper", () => {
    const ctx = ctxFor();
    const rects = buildRouteObstacles({
      ...BASE,
      ctx,
      extra: {
        traces: [
          trace("pending:trace:0", [
            { x: 0, y: 0 },
            { x: 10 * NM, y: 0 },
          ]),
        ],
        vias: [via("pending:via:0", 20, 0)],
      },
    });
    expect(rects.map((r) => r.id).sort()).toEqual([
      "trace:pending:trace:0:0",
      "via:pending:via:0",
    ]);
  });

  test("`excludeTraceIds` drops the subject of the search", () => {
    const ctx = ctxFor({
      traces: [trace("t1", [{ x: 0, y: 0 }, { x: NM, y: 0 }])],
    });
    expect(
      buildRouteObstacles({
        ...BASE,
        ctx,
        excludeTraceIds: new Set(["t1"]),
      }),
    ).toEqual([]);
  });
});

describe("buildRouteObstacles — pads", () => {
  test("pad rect is the EXACT rotated bounds, not an un-swapped union", () => {
    // 1×2 mm pad rotated 90° → world copper 2×1: half extents (1, 0.5).
    // Inflate by padClearance 0.25 + routeHalf 0.15 = 0.4 mm.
    const ctx = ctxFor({
      placements: [
        placement("u1", { x: 10, y: 10 }, [pad("1", 0, 0)], { rotationDeg: 90 }),
      ],
    });
    const rects = buildRouteObstacles({ ...BASE, ctx });
    expect(rects).toHaveLength(1);
    const r = byId(rects, "pad:u1|1");
    expectOutward(r.minX, 10 * NM - (1_000_000 + 400_000), "min");
    expectOutward(r.maxX, 10 * NM + 1_000_000 + 400_000, "max");
    // The un-swapped model would have given ±(0.5 + 0.4) mm here.
    expectOutward(r.minY, 10 * NM - (500_000 + 400_000), "min");
    expectOutward(r.maxY, 10 * NM + 500_000 + 400_000, "max");
  });

  test("same-net pads and excluded pads stay routable; a B.Cu SMD pad skips on F.Cu", () => {
    const ctx = ctxFor({
      placements: [
        placement("u1", { x: 0, y: 0 }, [pad("1", 0, 0), pad("2", 3, 0)]),
        placement("u2", { x: 20, y: 0 }, [pad("1", 0, 0)], { layer: "B.Cu" }),
        placement("u3", { x: 40, y: 0 }, [pad("1", 0, 0)]),
      ],
      padNets: { "u1|1": "net-a" },
    });
    const rects = buildRouteObstacles({
      ...BASE,
      ctx,
      excludePadIds: new Set(["u3|1"]),
    });
    // u1|1 same-net skipped, u2 on B.Cu skipped, u3|1 excluded → only u1|2.
    expect(rects.map((r) => r.id)).toEqual(["pad:u1|2"]);
  });

  test("a THROUGH-HOLE pad blocks on B.Cu even though its placement is on F.Cu", () => {
    const ctx = ctxFor({
      placements: [
        placement("u1", { x: 5, y: 5 }, [
          pad("1", 0, 0, 1.6, 1.6, { drillDiameterMm: 0.8 }),
        ]),
      ],
    });
    expect(
      buildRouteObstacles({ ...BASE, ctx, layer: "B.Cu" }).map((r) => r.id),
    ).toEqual(["pad:u1|1"]);
  });

  test("a free pad is an ordinary pad obstacle", () => {
    const ctx = ctxFor({ freePads: [freePad("fp1", 5, 5)] });
    const rects = buildRouteObstacles({ ...BASE, ctx });
    expect(rects.map((r) => r.id)).toEqual(["pad:free:fp1"]);
    // half 0.5 + padClearance 0.25 + routeHalf 0.15 = 0.9 mm.
    expectOutward(byId(rects, "pad:free:fp1").maxX, 5 * NM + 900_000, "max");
  });

  test("mirrored placement flips pad x before rotation", () => {
    const ctx = ctxFor({
      placements: [
        placement("u1", { x: 0, y: 0 }, [pad("1", 2, 0, 1, 1)], {
          layer: "B.Cu",
          mirrored: true,
        }),
      ],
    });
    const r = byId(
      buildRouteObstacles({ ...BASE, ctx, layer: "B.Cu" }),
      "pad:u1|1",
    );
    // Pad center mirrors to x = -2 mm; half 0.5 + inflate 0.4.
    expectOutward(r.minX, -2 * NM - 900_000, "min");
    expectOutward(r.maxX, -2 * NM + 900_000, "max");
  });
});

describe("buildRouteObstacles — vias and non-plated holes", () => {
  test("vias block every layer of their span; same-net vias are transparent", () => {
    const ctx = ctxFor({ vias: [via("v1", 5, 5), via("v2", 9, 9, "net-a")] });
    const rects = buildRouteObstacles({ ...BASE, ctx, layer: "In1.Cu" });
    expect(rects.map((r) => r.id)).toEqual(["via:v1"]);
    // The `traceToVia` pair kind, not the trace-to-trace one (§9): board
    // traceToViaMm is 0.3, traceToTraceMm 0.2.
    // half = d/2 0.4 + clearance 0.3 + routeHalf 0.15 = 0.85 mm
    expectOutward(rects[0]!.minX, 5 * NM - 850_000, "min");
    expectOutward(rects[0]!.maxX, 5 * NM + 850_000, "max");
  });

  test("a free (non-plated) hole is a rect inflated by copperToHole", () => {
    const ctx = ctxFor({ freeHoles: [freeHole("h1", 5, 5)] });
    const rects = buildRouteObstacles({ ...BASE, ctx });
    expect(rects.map((r) => r.id)).toEqual(["hole:h1"]);
    // drill half 0.6 + copperToHole (falls back to copperToBoardEdgeMm 0.5)
    // + routeHalf 0.15 = 1.25 mm.
    expectOutward(rects[0]!.maxX, 5 * NM + 1_250_000, "max");
  });

  test("a large copperToHole puts the hole rect OUTSIDE the clearance bound", () => {
    // With a 5 mm copper-to-hole rule an NPTH 3 mm off the corridor is a real
    // conflict the gate reports. Since S9 the BUILDER carries the halo
    // (broad-phase contract 08 §8) — `max(maxClearanceBoundMm,
    // maxHoleBoundMm) + routeHalf` — so the hole becomes a rect from either
    // window, and a caller that under-pads no longer loses it.
    const board = boardWithRules({
      clearance: { traceToTraceMm: 0.2, traceToPadMm: 0.25, copperToHoleMm: 5 },
      netClasses: [netClass("default", 0), netClass("wide", 0.8)],
      layerCount: 4,
    });
    const ctx = ctxFor({ board, freeHoles: [freeHole("h1", 5, 3)] });
    expect(ctx.maxHoleBoundMm).toBeGreaterThan(ctx.maxClearanceBoundMm);

    const corridor = (padMm: number) => ({
      minX: 0 - padMm,
      minY: 0 - padMm,
      maxX: 10 + padMm,
      maxY: 0 + padMm,
    });
    const routeWidthMm = 0.3;
    const padFor = (reachMm: number) => 1 + reachMm + routeWidthMm;

    // A clearance-sized window: the builder's own halo still reaches the hole.
    expect(
      buildRouteObstacles({
        ...BASE,
        ctx,
        routeWidthMm,
        withinBounds: corridor(padFor(ctx.maxClearanceBoundMm)),
      }).map((r) => r.id),
    ).toEqual(["hole:h1"]);

    // The obstacle reach (max of the two bounds): the hole rect is there.
    const reachMm = Math.max(ctx.maxClearanceBoundMm, ctx.maxHoleBoundMm);
    const rects = buildRouteObstacles({
      ...BASE,
      ctx,
      routeWidthMm,
      withinBounds: corridor(padFor(reachMm)),
    });
    expect(rects.map((r) => r.id)).toEqual(["hole:h1"]);

    // Not vacuous: the gate refuses a run along the corridor either way.
    const verdict = blockingViolations(
      ctx,
      runLiveDrc({
        ctx,
        pending: {
          traces: [
            {
              id: "pending:trace:0",
              netId: "net-a",
              netClassId: "default",
              layer: "F.Cu",
              widthMm: routeWidthMm,
              pointsNm: [
                { x: 0, y: 0 },
                { x: 10 * NM, y: 0 },
              ],
              segmentMode: "manhattan-45",
            },
          ],
          vias: [],
        },
      }),
    );
    expect(verdict.map((v) => v.code)).toContain("COPPER_TO_HOLE");
    // …and the rect the padded window found covers that run.
    expect(
      segmentIntersectsRectNm({ x: 0, y: 0 }, { x: 10 * NM, y: 0 }, rects[0]!),
    ).toBe(true);
  });

  test("a via's own barrel hole is not a second rect (its copper already is one)", () => {
    const ctx = ctxFor({ vias: [via("v1", 5, 5)] });
    expect(
      buildRouteObstacles({ ...BASE, ctx }).map((r) => r.id),
    ).toEqual(["via:v1"]);
  });
});

describe("buildRouteObstacles — resolved clearance tiers", () => {
  test("the neighbour net's CLASS raises the inflation", () => {
    const ctx = ctxFor({
      board: boardFor({ perNetClassAssignments: { "net-b": "wide" } }),
      traces: [
        trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }], { netId: "net-b" }),
      ],
    });
    // implicit = max(board 0.2, class(net-a) 0, class(net-b) 0.8) = 0.8
    // inflate = 0.8 + otherHalf 0.1 + routeHalf 0.15 = 1.05 mm
    expectOutward(
      buildRouteObstacles({ ...BASE, ctx })[0]!.maxY,
      1_050_000,
      "max",
    );
  });

  test("a net-scoped rule relaxes the rect below the board tier", () => {
    // A `net` scope holds wherever the route is, so the router honours it in
    // full — the outside-areas floor drops it too, and the rect shrinks.
    const ctx = ctxFor({
      board: boardFor({
        drcRules: [netScopedRule("relax-b", 0.05)],
        perNetClassAssignments: { "net-b": "wide" },
      }),
      traces: [
        trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }], { netId: "net-b" }),
      ],
    });
    // The explicit tier wins outright — the 0.8 class does not survive it.
    // inflate = 0.05 + otherHalf 0.1 + routeHalf 0.15 = 0.30 mm
    expectOutward(
      buildRouteObstacles({ ...BASE, ctx })[0]!.maxY,
      300_000,
      "max",
    );
  });

  test("a net-scoped TIGHTENING rule widens the rect", () => {
    const ctx = ctxFor({
      board: boardFor({ drcRules: [netScopedRule("tighten-b", 1.5)] }),
      traces: [
        trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }], { netId: "net-b" }),
      ],
    });
    // 1.5 + otherHalf 0.1 + routeHalf 0.15 = 1.75 mm
    expectOutward(
      buildRouteObstacles({ ...BASE, ctx })[0]!.maxY,
      1_750_000,
      "max",
    );
  });

  test("an AREA relaxation around the obstacle cannot shrink the rect below the outside-areas value", () => {
    // Astra run 1 #4: the rect is resolved AT THE OBSTACLE, and the obstacle
    // sits inside the relaxing area — but the ROUTE may not, so the value that
    // holds outside every area is the floor.
    const ctx = ctxFor({
      board: boardFor({
        drcRules: [areaScopedRule("area-relax", 0.05)],
        perNetClassAssignments: { "net-b": "wide" },
      }),
      traces: [
        trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }], { netId: "net-b" }),
      ],
    });
    // Not the rule's 0.05: max(0.05 at the obstacle, 0.8 outside areas)
    // = 0.8 + 0.1 + 0.15 = 1.05 mm.
    expectOutward(
      buildRouteObstacles({ ...BASE, ctx })[0]!.maxY,
      1_050_000,
      "max",
    );
  });

  test("an area TIGHTENING covering PART of a segment splits it and inflates the covered end", () => {
    // The rect used to be resolved once at the segment MIDPOINT, so an area
    // that covers only one end was silently dropped: the midpoint fell
    // outside, the rect stayed at the low tier, and a path that avoided every
    // rect was still refused by the gate over the covered end.
    const partial: PcbDrcRule = {
      id: "area-part",
      name: "Area part",
      enabled: true,
      priority: 10,
      scopes: [
        {
          kind: "area",
          polygonMm: [
            { x: 8, y: -1 },
            { x: 12, y: -1 },
            { x: 12, y: 2 },
            { x: 8, y: 2 },
          ],
        },
      ],
      constraint: { kind: "clearance", mm: 1 },
    };
    const ctx = ctxFor({
      board: boardFor({ drcRules: [partial] }),
      traces: [
        trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }], { netId: "net-b" }),
      ],
    });
    const rects = buildRouteObstacles({ ...BASE, ctx });
    // Split at x = 8: the uncovered half keeps the 0.2 board tier
    // (0.2 + 0.1 + 0.15 = 0.45 mm), the covered half takes the rule's 1 mm
    // (1 + 0.1 + 0.15 = 1.25 mm).
    expect(rects).toHaveLength(2);
    const uncovered = rects.find((r) => r.minX < 0)!;
    const covered = rects.find((r) => r.minX > 0)!;
    expectOutward(uncovered.maxY, 450_000, "max");
    expectOutward(covered.maxY, 1_250_000, "max");
    // The covered rect starts at the ring, not at the segment's midpoint.
    expectOutward(covered.minX, 8 * NM - 1_250_000, "min");
    // A route at y = 0.7 through x ∈ [9, 11] — legal against the old rects,
    // refused by the gate — now intersects the covered rect.
    expect(
      segmentIntersectsRectNm(
        { x: 9 * NM, y: 700_000 },
        { x: 11 * NM, y: 700_000 },
        covered,
      ),
    ).toBe(true);
  });

  test("an area TIGHTENING around the obstacle still widens the rect", () => {
    const ctx = ctxFor({
      board: boardFor({ drcRules: [areaScopedRule("area-tighten", 1.5)] }),
      traces: [
        trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }], { netId: "net-b" }),
      ],
    });
    // The at-the-obstacle term is the larger one: 1.5 + 0.1 + 0.15 = 1.75 mm.
    expectOutward(
      buildRouteObstacles({ ...BASE, ctx })[0]!.maxY,
      1_750_000,
      "max",
    );
  });

  test("boundary contact stays above the inclusive short tier at a 0 mm rule", () => {
    // Astra run 1 #5: with every tier at 0 the inflation would be half-widths
    // only, and touching the rect's edge would be a short. The
    // `SHORT_EPS_MM + 1 nm` floor keeps the rect strictly wider than that.
    const zeroBoard = boardWithRules({
      clearance: { traceToTraceMm: 0, traceToPadMm: 0, traceToViaMm: 0 },
      netClasses: [netClass("default", 0)],
      layerCount: 4,
    });
    const ctx = ctxFor({
      board: zeroBoard,
      traces: [
        trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }], { netId: "net-b" }),
      ],
    });
    const r = buildRouteObstacles({ ...BASE, ctx })[0]!;
    // half-widths alone would be 0.1 + 0.15 = 0.25 mm; the floor adds
    // SHORT_EPS_MM + 1 nm = 101 nm on top of that.
    expect(r.maxY).toBeGreaterThan(250_000);
    expectOutward(r.maxY, 250_101, "max");
  });

  test("a pad rule scoped to traceToPad leaves trace rects alone", () => {
    const padOnly: PcbDrcRule = {
      id: "pad-only",
      name: "Pad only",
      enabled: true,
      priority: 10,
      scopes: [{ kind: "pairKind", pairKinds: ["traceToPad"] }],
      constraint: { kind: "clearance", mm: 1 },
    };
    const ctx = ctxFor({
      board: boardFor({ drcRules: [padOnly] }),
      traces: [trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }])],
      placements: [placement("u1", { x: 20, y: 0 }, [pad("1", 0, 0)])],
    });
    const rects = buildRouteObstacles({ ...BASE, ctx });
    // trace keeps the board tier: 0.2 + 0.1 + 0.15 = 0.45 mm
    expectOutward(byId(rects, "trace:t1:0").maxY, 450_000, "max");
    // pad takes the rule: half 1.0 + 1 + routeHalf 0.15 = 2.15 mm
    expectOutward(byId(rects, "pad:u1|1").maxY, 2_150_000, "max");
  });
});

describe("buildRouteObstacles — keepouts", () => {
  test("one ring-bounds rect per tracks keepout on the routing layer", () => {
    const ctx = ctxFor({ keepouts: [keepout()] });
    expect(buildRouteObstacles({ ...BASE, ctx }).map((r) => r.id)).toEqual([
      "keepout:k1",
    ]);
  });

  test("inflation is exactly routeWidthMm / 2 (a keepout has clearance 0)", () => {
    const ctx = ctxFor({ keepouts: [keepout()] });
    const r = buildRouteObstacles({ ...BASE, ctx })[0]!;
    // routeWidthMm 0.3 → half 0.15 mm = 150_000 nm; no clearance term.
    expectOutward(r.minX, -150_000, "min");
    expectOutward(r.minY, -150_000, "min");
    expectOutward(r.maxX, 10 * NM + 150_000, "max");
    expectOutward(r.maxY, 10 * NM + 150_000, "max");
  });

  test("a keepout whose layers exclude the routing layer emits nothing", () => {
    const ctx = ctxFor({ keepouts: [keepout({ layers: ["B.Cu"] })] });
    expect(buildRouteObstacles({ ...BASE, ctx })).toHaveLength(0);
  });

  test("restrictions.tracks off emits nothing", () => {
    const ctx = ctxFor({
      keepouts: [
        keepout({
          restrictions: {
            tracks: false,
            vias: true,
            pads: true,
            copperPour: true,
            footprints: true,
          },
        }),
      ],
    });
    expect(buildRouteObstacles({ ...BASE, ctx })).toHaveLength(0);
  });

  test("keepout rects are net-agnostic (same-net routing is still blocked)", () => {
    const ctx = ctxFor({ keepouts: [keepout()] });
    expect(
      buildRouteObstacles({ ...BASE, ctx, netId: "net-a" }).map((r) => r.id),
    ).toEqual(["keepout:k1"]);
  });

  test("a disabled keepout is dropped by the ONE derivation, so it emits nothing", () => {
    const ctx = ctxFor({ keepouts: [keepout({ enabled: false })] });
    expect(buildRouteObstacles({ ...BASE, ctx })).toHaveLength(0);
  });
});

describe("buildRouteObstacles — determinism", () => {
  test("output is identical under permuted inputs", () => {
    const traces = [
      trace("a", [{ x: 0, y: 0 }, { x: NM, y: 0 }]),
      trace("b", [{ x: 0, y: NM }, { x: NM, y: NM }]),
    ];
    const vias = [via("v1", 3, 3), via("v2", 4, 4)];
    const keepouts = [keepout({ id: "kb" }), keepout({ id: "ka" })];
    const one = buildRouteObstacles({
      ...BASE,
      ctx: ctxFor({ traces, vias, keepouts }),
    });
    const two = buildRouteObstacles({
      ...BASE,
      ctx: ctxFor({
        traces: [traces[1]!, traces[0]!],
        vias: [vias[1]!, vias[0]!],
        keepouts: [keepouts[1]!, keepouts[0]!],
      }),
    });
    expect(one).toEqual(two);
    // Coincident rings tie-break on id inside the shared canonical order.
    expect(
      one.filter((r) => r.id.startsWith("keepout:")).map((r) => r.id),
    ).toEqual(["keepout:ka", "keepout:kb"]);
  });
});

describe("buildRouteObstacles — keepout rect is a superset of the exact predicate", () => {
  /** Concave, rotated ring: an L with a 45° cut, non-integer coordinates. */
  const concave = keepout({
    id: "kc",
    pointsMm: [
      { x: 0.1234567, y: 0.2 },
      { x: 7.7, y: 0.2 },
      { x: 7.7, y: 3.3333 },
      { x: 3.3, y: 3.3333 },
      { x: 3.3, y: 7.9 },
      { x: 0.1234567, y: 6.6 },
    ],
  });

  test("every segment the predicate flags intersects the rect (probe grid)", () => {
    const routeWidthMm = 0.3;
    const ctx = ctxFor({ keepouts: [concave] });
    const [rect] = buildRouteObstacles({ ...BASE, ctx, routeWidthMm });
    expect(rect?.id).toBe("keepout:kc");
    let flagged = 0;
    for (let x = -1; x <= 9; x += 0.37) {
      for (let y = -1; y <= 9; y += 0.41) {
        const a = { x, y };
        const b = { x: x + 0.9, y: y + 0.35 };
        const affected = keepoutAffects(ctx.keepouts[0]!, {
          kind: "trace",
          layer: "F.Cu",
          pointsMm: [a, b],
          widthMm: routeWidthMm,
        });
        if (!affected) continue;
        flagged += 1;
        const aNm = { x: Math.round(a.x * 1e6), y: Math.round(a.y * 1e6) };
        const bNm = { x: Math.round(b.x * 1e6), y: Math.round(b.y * 1e6) };
        expect(segmentIntersectsRectNm(aNm, bNm, rect!)).toBe(true);
      }
    }
    expect(flagged).toBeGreaterThan(50);
  });

  test("non-integer bounds round OUTWARD (floor min, ceil max)", () => {
    const ctx = ctxFor({ keepouts: [concave] });
    const [rect] = buildRouteObstacles({ ...BASE, ctx, routeWidthMm: 0.3 });
    // 0.1234567 − 0.15 = −0.0265433 mm → floor → −26544 nm (nearest would be −26543).
    expect(rect!.minX).toBe(-26544);
    // 7.9 + 0.15 = 8.05 mm exactly representable up to float noise → ceil never undershoots.
    expect(rect!.maxY).toBeGreaterThanOrEqual(8_050_000);
    expect(rect!.maxX).toBeGreaterThanOrEqual(7_850_000);
  });
});

/**
 * The superset statement of 07 §5, as a property: a path that avoids every rect
 * on this layer passes the gate's clearance, short, hole and keepout tiers. The
 * paths are generated legal-BY-CONSTRUCTION (rejected until they miss every
 * rect), so a counterexample means the inflation is too small, not that the
 * router found a bad path.
 */
describe("buildRouteObstacles — avoiding every rect passes the gate", () => {
  const GATE_CODES: ReadonlySet<DrcRuleCode> = new Set<DrcRuleCode>([
    "NET_SHORT_CIRCUIT",
    "TRACE_TO_TRACE_CLEARANCE",
    "TRACE_TO_PAD_CLEARANCE",
    "TRACE_TO_VIA_CLEARANCE",
    "COPPER_TO_HOLE",
    "KEEPOUT_VIOLATION",
  ]);

  test("100 random legal-by-construction paths are clean", () => {
    const routeWidthMm = 0.3;
    // An area TIGHTENING that covers only PART of `t1` and does NOT contain
    // its midpoint (0, 0) — exactly the case a single per-segment midpoint
    // resolution drops, leaving rects too small over the covered end.
    const halfCover: PcbDrcRule = {
      id: "area-half",
      name: "Area half",
      enabled: true,
      priority: 10,
      scopes: [
        {
          kind: "area",
          polygonMm: [
            { x: 5, y: -4 },
            { x: 25, y: -4 },
            { x: 25, y: 4 },
            { x: 5, y: 4 },
          ],
        },
      ],
      constraint: { kind: "clearance", mm: 1.2 },
    };
    const ctx = ctxFor({
      board: boardFor({
        drcRules: [halfCover],
        perNetClassAssignments: { "net-b": "wide" },
      }),
      traces: [
        trace("t1", [
          { x: -20 * NM, y: 0 },
          { x: 20 * NM, y: 0 },
        ], { netId: "net-b" }),
        trace("t2", [
          { x: 0, y: -20 * NM },
          { x: 0, y: 20 * NM },
        ]),
      ],
      placements: [
        placement("u1", { x: -12, y: 8 }, [pad("1", 0, 0, 1, 2)], {
          rotationDeg: 90,
        }),
        placement("u2", { x: 12, y: -8 }, [
          pad("1", 0, 0, 1.6, 1.6, { drillDiameterMm: 0.8 }),
        ]),
      ],
      vias: [via("v1", 7, 7, "net-b"), via("v2", -7, -7)],
      freeHoles: [freeHole("h1", 14, 14)],
      freePads: [freePad("fp1", -14, -14)],
      keepouts: [
        keepout({
          id: "kk",
          pointsMm: [
            { x: -6, y: 10 },
            { x: 6, y: 10 },
            { x: 6, y: 16 },
            { x: -6, y: 16 },
          ],
        }),
      ],
      netNames: { "net-a": "A", "net-b": "B", "net-r": "R" },
    });
    const rects = buildRouteObstacles({
      ctx,
      layer: "F.Cu",
      netId: "net-r",
      routeWidthMm,
    });
    expect(rects.length).toBeGreaterThan(5);

    // Deterministic LCG — no Math.random anywhere in this repo's tests.
    let seed = 0x2f6e2b1;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const spanNm = 36 * NM;
    const pointNm = () => ({
      x: Math.round((rand() - 0.5) * spanNm),
      y: Math.round((rand() - 0.5) * spanNm),
    });
    /**
     * Half the probes hug the copper instead of crossing the whole board: a
     * short, nearly parallel run within ±3 mm of the horizontal obstacle. A
     * uniform sample almost never lands in the few-tenths-of-a-millimetre band
     * where an under-inflated rect and the gate disagree, so without this the
     * property is satisfied vacuously.
     */
    const grazingNm = (): [PointNm, PointNm] => {
      const y = Math.round((rand() - 0.5) * 6 * NM);
      const x0 = Math.round((rand() - 0.5) * 36 * NM);
      const lengthNm = Math.round((0.5 + rand() * 8) * NM);
      const dy = Math.round((rand() - 0.5) * 0.8 * NM);
      return [
        { x: x0, y },
        { x: x0 + lengthNm, y: y + dy },
      ];
    };

    let checked = 0;
    for (let attempt = 0; attempt < 40_000 && checked < 100; attempt += 1) {
      const [a, b] =
        attempt % 2 === 0
          ? grazingNm()
          : ([pointNm(), pointNm()] as [PointNm, PointNm]);
      if (a.x === b.x && a.y === b.y) continue;
      if (rects.some((r) => segmentIntersectsRectNm(a, b, r))) continue;
      checked += 1;
      const verdict = blockingViolations(
        ctx,
        runLiveDrc({
          ctx,
          pending: {
            traces: [
              {
                id: `pending:trace:${checked}`,
                netId: "net-r",
                netClassId: "default",
                layer: "F.Cu",
                widthMm: routeWidthMm,
                pointsNm: [a, b],
                segmentMode: "manhattan-45",
              },
            ],
            vias: [],
          },
        }),
      ).filter((v) => GATE_CODES.has(v.code));
      expect(
        verdict.map((v) => `${v.code} ${v.measuredMm} < ${v.requiredMm}`),
      ).toEqual([]);
    }
    expect(checked).toBe(100);
  });
});
