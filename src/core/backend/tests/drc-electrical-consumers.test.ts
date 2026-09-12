/**
 * Electrical contract 13 §3.2 — "consumers by construction".
 *
 * The IPC-2221 spacing requirement is a CONSTITUENT of the rule resolver, not a
 * check of its own, so the copper pour and the route-obstacle builder inherit
 * it with no second derivation. This file measures the copper each of them
 * actually produces — the fill polygon's gap to the obstacle, the obstacle
 * rect's edge — rather than the resolver they call, because a consumer that
 * asks the resolver the wrong QUESTION (the original net instead of the tier
 * net, §4.2; a B4 column it cannot justify, §1.2) still reads a correct
 * resolver and still pours or routes too close.
 *
 * Every claim is paired with a CONTROL that differs only in the declared
 * voltage or the declared tier, so a passing assertion cannot be satisfied by
 * the ordinary pour / route tier it is meant to exceed.
 *
 * `golden-electrical-2l`'s §4.5 reversal identity lives at the bottom: the
 * effective-net union-find and the chain-short draft are the S13 code whose
 * output could depend on input array order, and the golden suite itself only
 * pins one ordering.
 */
import { describe, expect, test } from "bun:test";
import * as path from "node:path";

import { buildDrcContext } from "../../../modules/designer/backend/drc/drc-context";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { buildDrcItems } from "../../../shared/drc/drc-context";
import {
  pourParamsForZone,
  zonePourNets,
} from "../../../shared/pcb-areas/pour-params";
import {
  pointInPolygon,
  polylineToRingEdgeDistance,
} from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import { buildRouteObstacles } from "../../../shared/pcb-routing/route-obstacles";
import {
  buildCopperFillIslands,
  type CopperFillIsland,
} from "../../../shared/rendering/copper-fill/copper-fill-geometry";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbNetClass,
  PcbPointMm,
} from "../../../sdks/designer";
import type { ObstacleRectNm } from "../../../shared/pcb-routing/types";
import { boardWithRules, freePad, projection, trace } from "./helpers/drc-fixtures";
import { fixtureToProjection } from "./helpers/drc-golden";
import { polygonZoneRow } from "./helpers/pcb-zone-fixtures";

const NM = 1_000_000;
/** The measurement tolerance the brief pins: a carve may never be SHORT. */
const EPS = 1e-6;
/**
 * How far OVER the requirement a measured fill edge may sit: the kernel
 * quantises to a 0.1 µm grid and fillets convex corners, and both round the
 * copper AWAY from the obstacle. Every fill assertion below therefore has a
 * lower bound at the requirement (the claim) and an upper bound at
 * `requirement + FILL_SLOP` (so it cannot be satisfied by a wider tier).
 */
const FILL_SLOP = 0.02;

/* -------------------------------------------------------------------------- */
/* Board                                                                       */
/* -------------------------------------------------------------------------- */

function netClass(id: string, extra: Partial<PcbNetClass> = {}): PcbNetClass {
  return {
    id,
    name: id.toUpperCase(),
    traceWidthMm: 0.2,
    clearanceMm: 0.25,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#ccc",
    defaultViaProtection: "tented",
    ...extra,
  };
}

/**
 * `default` is FIRST, so it is the fallback class (`defaultNetClassId`) and
 * every net this file does not assign is UNDECLARED — assumed at the board
 * reference potential (13 §2).
 */
const DECLARED: PcbNetClass[] = [
  netClass("default"),
  netClass("hv", { voltageV: 230 }),
  netClass("hvn", { voltageV: -230 }),
  netClass("khv", { voltageV: 600 }),
];

/** The same classes with every voltage stripped — the pre-S13 control board. */
const UNDECLARED: PcbNetClass[] = DECLARED.map(({ ...c }) => {
  delete c.voltageV;
  return c;
});

function boardFor(
  opts: { declared?: boolean; coated?: boolean } = {},
): PcbBoardSettings {
  const b = boardWithRules({
    netClasses: opts.declared === false ? UNDECLARED : DECLARED,
    // `khv` is deliberately assigned to NO net: `maxVoltageTermMm` scans the
    // declared CLASSES, not the nets present on the board, and the null-route
    // test below depends on that difference.
    perNetClassAssignments: { hv1: "hv", hvn1: "hvn" },
    outline: {
      kind: "rect",
      widthMm: 60,
      heightMm: 60,
      centerMm: { x: 0, y: 0 },
    },
  });
  if (opts.coated) {
    b.designRules = {
      ...b.designRules,
      electrical: { outerConductors: "coated" },
    };
  }
  return b;
}

const NET_NAMES = { hv1: "HV1", hvn1: "HVN1", ref1: "REF1" };

/* -------------------------------------------------------------------------- */
/* Fill measurement                                                            */
/* -------------------------------------------------------------------------- */

/** The one effective zone of `proj`, filled through `pourParamsForZone`. */
function fillZone(proj: DesignerPcbProjection, zoneId: string) {
  const ctx = buildDrcContext(proj);
  const zone = ctx.copperZones.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`no effective zone ${zoneId}`);
  const result = buildCopperFillIslands({
    layerCount: proj.board.layerCount,
    outline: proj.board.outline,
    placements: proj.placements,
    traces: proj.traces,
    vias: proj.vias,
    padNetIds: new Map(Object.entries(proj.padNets ?? {})),
    copperToBoardEdgeMm: proj.board.designRules.clearance.copperToBoardEdgeMm,
    cutouts: proj.board.cutouts,
    freeHoles: proj.freeHoles,
    freePads: proj.freePads,
    ...pourParamsForZone(
      zone,
      proj.board.designRules,
      ctx.keepouts,
      ctx.copperZones,
      zonePourNets(proj.board, ctx.netNames),
    ),
  });
  if (result.status !== "ok") {
    throw new Error(`fill ${zoneId} is ${result.status}`);
  }
  return result.islands;
}

/**
 * The narrowest copper gap between the fill and a trace, mm: the smallest
 * distance from the trace CENTRELINE to any fill ring edge, less the trace's
 * half width. Every ring counts — a void around an obstacle is a HOLE ring of
 * its island, and it is the hole that carries the carve.
 */
function fillGapToPolyline(
  islands: ReadonlyArray<CopperFillIsland>,
  pointsMm: readonly PcbPointMm[],
  halfWidthMm: number,
): number {
  let best = Infinity;
  for (const { rings } of islands) {
    for (const ring of rings) {
      best = Math.min(best, polylineToRingEdgeDistance(pointsMm, ring));
    }
  }
  return best - halfWidthMm;
}

/** Is `p` inside poured copper (inside an outer ring, outside its holes)? */
function filledAt(
  islands: ReadonlyArray<CopperFillIsland>,
  p: PcbPointMm,
): boolean {
  return islands.some(
    ({ rings }) =>
      rings.length > 0 &&
      pointInPolygon(p, rings[0]!) &&
      !rings.slice(1).some((hole) => pointInPolygon(p, hole)),
  );
}

/** Axis-aligned bounds of every ring of every island. */
function fillBounds(islands: ReadonlyArray<CopperFillIsland>) {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const { rings } of islands) {
    for (const p of rings[0] ?? []) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    }
  }
  return { minX, maxX };
}

function rect(x0: number, y0: number, x1: number, y1: number): PcbPointMm[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * A 24×16 zone on `zoneNet` at F.Cu with one straight trace crossing it, plus
 * whatever extra copper the case needs. One shape, so every pour case below
 * differs ONLY in the nets and the board's declarations.
 */
function pourCase(opts: {
  zoneNet: string | null;
  traceNet: string | null;
  declared?: boolean;
  coated?: boolean;
  /** Left end of `t_cross`; the right end is always x = 8. Default −8. */
  traceFromX?: number;
  freePads?: DesignerPcbProjection["freePads"];
}): DesignerPcbProjection {
  return projection({
    board: boardFor({ declared: opts.declared, coated: opts.coated }),
    netNames: NET_NAMES,
    traces: [
      trace("t_cross", opts.traceNet, [
        [opts.traceFromX ?? -8, 0],
        [8, 0],
      ]),
    ],
    freePads: opts.freePads ?? [],
    zones: [polygonZoneRow("z", "F.Cu", opts.zoneNet, rect(-12, -8, 12, 8))],
  });
}

/** The centreline of `pourCase`'s crossing trace, for the gap measurement. */
function crossLine(fromX = -8): PcbPointMm[] {
  return [
    { x: fromX, y: 0 },
    { x: 8, y: 0 },
  ];
}

/* -------------------------------------------------------------------------- */
/* 1. The copper pour (contract 13 §3.2 row 2)                                 */
/* -------------------------------------------------------------------------- */

describe("copper pour inherits the IPC-2221 term (13 §3.2)", () => {
  test("a 230 V zone carves a 0 V trace at the IPC spacing, not the pour tier", () => {
    const declared = fillZone(
      pourCase({ zoneNet: "hv1", traceNet: "ref1" }),
      "z",
    );
    const gap = fillGapToPolyline(declared, crossLine(), 0.1);
    // Δ = 230 V, F.Cu, uncoated ⇒ B2 = 1.25 mm.
    expect(gap).toBeGreaterThanOrEqual(1.25 - EPS);
    expect(gap).toBeLessThanOrEqual(1.25 + FILL_SLOP);

    // CONTROL: the same board with no declared voltage carves at the pour tier
    // only — `max(pourToCopperMm ?? 0.5, traceToTrace 0.25)` = 0.5 mm. Proves
    // the 1.25 above is the voltage constituent and not a wide board rule.
    const control = fillZone(
      pourCase({ zoneNet: "hv1", traceNet: "ref1", declared: false }),
      "z",
    );
    const controlGap = fillGapToPolyline(control, crossLine(), 0.1);
    expect(controlGap).toBeGreaterThanOrEqual(0.5 - EPS);
    expect(controlGap).toBeLessThanOrEqual(0.5 + FILL_SLOP);
  });

  test("a SAME-net trace is joined, never moated by its own zone's voltage", () => {
    // 13 §2: a conductor has no spacing requirement to itself, so a 230 V zone
    // must not carve a void around the 230 V trace it pours onto.
    const islands = fillZone(
      pourCase({ zoneNet: "hv1", traceNet: "hv1" }),
      "z",
    );
    expect(filledAt(islands, { x: 0, y: 0 })).toBe(true);
    // And the different-net case really is a void at the same point.
    const other = fillZone(pourCase({ zoneNet: "hv1", traceNet: "ref1" }), "z");
    expect(filledAt(other, { x: 0, y: 0 })).toBe(false);
  });

  test("a null trace extending a 230 V pad is carved at 230 V along its whole length", () => {
    // The pad sits OUTSIDE the zone; the null trace starts on it and runs
    // across the pour. Its own net is null — undeclared, which against an
    // undeclared zone would carry no constituent at all — so the only thing
    // that can widen this carve is the TIER net (§4.2).
    const withPad = pourCase({
      zoneNet: "ref1",
      traceNet: null,
      traceFromX: -14,
      freePads: [freePad("fp_hv", { center: { x: -14, y: 0 }, netId: "hv1" })],
    });
    const gap = fillGapToPolyline(fillZone(withPad, "z"), crossLine(-14), 0.1);
    expect(gap).toBeGreaterThanOrEqual(1.25 - EPS);
    expect(gap).toBeLessThanOrEqual(1.25 + FILL_SLOP);

    // CONTROL: the identical board with the pad moved off the trace — nothing
    // to extend, so the null trace keeps the null tier and the pour tier.
    const apart = pourCase({
      zoneNet: "ref1",
      traceNet: null,
      traceFromX: -14,
      freePads: [freePad("fp_hv", { center: { x: -20, y: 0 }, netId: "hv1" })],
    });
    const controlGap = fillGapToPolyline(
      fillZone(apart, "z"),
      crossLine(-14),
      0.1,
    );
    expect(controlGap).toBeGreaterThanOrEqual(0.5 - EPS);
    expect(controlGap).toBeLessThanOrEqual(0.5 + FILL_SLOP);
  });

  test("`outerConductors: \"coated\"` does not narrow the carve — the fill has no mask model", () => {
    // 13 §3.2: exposure outside the DRC context is CONSERVATIVE. The judge may
    // credit B4 (230 V ⇒ 0.4 mm) on copper it can prove is covered; the fill
    // cannot prove anything, so it stays in B2 and carves 1.25 mm.
    const gap = fillGapToPolyline(
      fillZone(
        pourCase({ zoneNet: "hv1", traceNet: "ref1", coated: true }),
        "z",
      ),
      crossLine(),
      0.1,
    );
    expect(gap).toBeGreaterThanOrEqual(1.25 - EPS);
    expect(gap).toBeLessThanOrEqual(1.25 + FILL_SLOP);
    // B4 at 230 V is 0.4 mm — what the JUDGE may credit on covered copper and
    // what this fill must NOT use.
    expect(gap).toBeGreaterThan(0.4);
  });

  test("two HV zones of different nets at equal priority carve each other at the IPC spacing", () => {
    // Δ = |230 − (−230)| = 460 V ⇒ B2 = 2.5 mm, both ways (`zoneExclusions` is
    // symmetric by construction). The zones OVERLAP on x ∈ [−2, 2], so equal
    // priority leaves the contested band to neither fill.
    const zones = [
      polygonZoneRow("z_a", "F.Cu", "hv1", rect(-14, -8, 2, 8)),
      polygonZoneRow("z_b", "F.Cu", "hvn1", rect(-2, -8, 14, 8)),
    ];
    const proj = projection({
      board: boardFor(),
      netNames: NET_NAMES,
      traces: [],
      zones,
    });
    const ctx = buildDrcContext(proj);
    const nets = zonePourNets(proj.board, ctx.netNames);
    for (const id of ["z_a", "z_b"]) {
      const zone = ctx.copperZones.find((z) => z.id === id)!;
      const params = pourParamsForZone(
        zone,
        proj.board.designRules,
        ctx.keepouts,
        ctx.copperZones,
        nets,
      );
      expect(params.excludeZonesMm).toHaveLength(1);
      expect(params.excludeZonesMm![0]!.clearanceMm).toBeCloseTo(2.5, 9);
    }
    // And the copper follows: A stops 2.5 mm short of B's polygon (x = −2),
    // B starts 2.5 mm past A's (x = 2).
    const maxA = fillBounds(fillZone(proj, "z_a")).maxX;
    const minB = fillBounds(fillZone(proj, "z_b")).minX;
    expect(maxA).toBeLessThanOrEqual(-2 - 2.5 + EPS);
    expect(maxA).toBeGreaterThanOrEqual(-2 - 2.5 - FILL_SLOP);
    expect(minB).toBeGreaterThanOrEqual(2 + 2.5 - EPS);
    expect(minB).toBeLessThanOrEqual(2 + 2.5 + FILL_SLOP);

    // CONTROL: undeclared voltages leave the zone-to-zone tier alone.
    const plain = projection({
      board: boardFor({ declared: false }),
      netNames: NET_NAMES,
      traces: [],
      zones,
    });
    const plainCtx = buildDrcContext(plain);
    const plainZone = plainCtx.copperZones.find((z) => z.id === "z_a")!;
    const plainParams = pourParamsForZone(
      plainZone,
      plain.board.designRules,
      plainCtx.keepouts,
      plainCtx.copperZones,
      zonePourNets(plain.board, plainCtx.netNames),
    );
    // The pour-to-pour board tier alone: `max(pourToCopperMm ?? 0.5, …)`.
    expect(plainParams.excludeZonesMm![0]!.clearanceMm).toBeCloseTo(0.5, 9);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The route-obstacle builder (contract 13 §3.2 row 3)                       */
/* -------------------------------------------------------------------------- */

const ROUTE_HALF_MM = 0.15;
const TRACE_HALF_MM = 0.1;

function ctxFor(parts: Partial<DesignerPcbProjection>) {
  return buildDrcItems(
    projection({
      board: parts.board ?? boardFor(),
      netNames: NET_NAMES,
      ...parts,
    }),
  );
}

function byId(rects: readonly ObstacleRectNm[], id: string): ObstacleRectNm {
  const hit = rects.find((r) => r.id === id);
  if (!hit) throw new Error(`no rect ${id} in [${rects.map((r) => r.id)}]`);
  return hit;
}

/**
 * The clearance an obstacle rect encodes: its half-height above the obstacle's
 * own copper edge, less the route's half width. Rects are rounded OUTWARD by at
 * most 1 nm (07 §5), so the read-back is compared with a 1 nm tolerance.
 */
function clearanceOf(r: ObstacleRectNm, obstacleHalfMm: number): number {
  return r.maxY / NM - obstacleHalfMm - ROUTE_HALF_MM;
}

describe("route obstacles inherit the IPC-2221 term (13 §3.2)", () => {
  test("a 230 V obstacle widens a 0 V route's rect to the IPC spacing", () => {
    const rects = buildRouteObstacles({
      layer: "F.Cu",
      netId: "ref1",
      routeWidthMm: 0.3,
      ctx: ctxFor({
        traces: [
          trace("t_hv", "hv1", [
            [-5, 0],
            [5, 0],
          ]),
        ],
      }),
    });
    expect(
      clearanceOf(byId(rects, "trace:t_hv:0"), TRACE_HALF_MM),
    ).toBeCloseTo(1.25, 6);

    // CONTROL: undeclared voltages ⇒ the ordinary trace-to-trace tier (0.25).
    const plain = buildRouteObstacles({
      layer: "F.Cu",
      netId: "ref1",
      routeWidthMm: 0.3,
      ctx: ctxFor({
        board: boardFor({ declared: false }),
        traces: [
          trace("t_hv", "hv1", [
            [-5, 0],
            [5, 0],
          ]),
        ],
      }),
    });
    expect(
      clearanceOf(byId(plain, "trace:t_hv:0"), TRACE_HALF_MM),
    ).toBeCloseTo(0.25, 6);
  });

  test("a route with NO net keeps the widest term any declared class could impose", () => {
    // 13 §3.2 (c): the route may still be assigned any declared class — and any
    // TIER, once it touches a conductor (13 §4) — so the rect keeps the widest
    // requirement either constituent could reach against this obstacle: the
    // board-wide ordinary bound and `max over every declared class` of the
    // voltage term. The obstacle is UNDECLARED (`ref1`), so the widest voltage
    // partner is `khv` at 600 V ⇒ B2 = 2.5 + 0.005·100 = 3.0 mm — wider than
    // the 230 V pair above, which is what proves the voltage half is a scan and
    // not the obstacle's own term (R1 #2 added the ordinary half).
    const ctx = ctxFor({
      traces: [
        trace("t_ref", "ref1", [
          [-5, 0],
          [5, 0],
        ]),
      ],
    });
    const nullRoute = buildRouteObstacles({
      layer: "F.Cu",
      netId: null,
      routeWidthMm: 0.3,
      ctx,
    });
    const conservative = Math.max(
      ctx.maxClearanceBoundMm,
      ctx.resolver.maxVoltageTermMm("F.Cu", "ref1", true),
    );
    expect(conservative).toBeGreaterThanOrEqual(3.0);
    expect(
      clearanceOf(byId(nullRoute, "trace:t_ref:0"), TRACE_HALF_MM),
    ).toBeCloseTo(conservative, 6);

    // CONTROL: the same obstacle for a NAMED, undeclared route is an ordinary
    // pair — neither side declares, so there is no constituent at all.
    const named = buildRouteObstacles({
      layer: "F.Cu",
      netId: "ref1_other",
      routeWidthMm: 0.3,
      ctx,
    });
    expect(
      clearanceOf(byId(named, "trace:t_ref:0"), TRACE_HALF_MM),
    ).toBeCloseTo(0.25, 6);
  });

  test("a null trace extending a 230 V pad is an obstacle at the 230 V spacing", () => {
    // §3.2 (c): the builder resolves obstacles by their TIER net. The null
    // trace's own net carries no requirement; only the pad it extends does.
    const touching = buildRouteObstacles({
      layer: "F.Cu",
      netId: "ref1",
      routeWidthMm: 0.3,
      ctx: ctxFor({
        freePads: [freePad("fp_hv", { center: { x: -6, y: 0 }, netId: "hv1" })],
        traces: [
          trace("t_null", null, [
            [-6, 0],
            [5, 0],
          ]),
        ],
      }),
    });
    expect(
      clearanceOf(byId(touching, "trace:t_null:0"), TRACE_HALF_MM),
    ).toBeCloseTo(1.25, 6);

    // CONTROL: move the pad off the trace — same null net, no tier, no term.
    const apart = buildRouteObstacles({
      layer: "F.Cu",
      netId: "ref1",
      routeWidthMm: 0.3,
      ctx: ctxFor({
        freePads: [freePad("fp_hv", { center: { x: -10, y: 0 }, netId: "hv1" })],
        traces: [
          trace("t_null", null, [
            [-6, 0],
            [5, 0],
          ]),
        ],
      }),
    });
    expect(
      clearanceOf(byId(apart, "trace:t_null:0"), TRACE_HALF_MM),
    ).toBeCloseTo(0.25, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. `golden-electrical-2l` reversal identity (contract 13 §4.5)               */
/* -------------------------------------------------------------------------- */

describe("golden-electrical-2l determinism (13 §4.5)", () => {
  test("reversing every input array leaves the report byte-identical", async () => {
    const fixturePath = path.resolve(
      import.meta.dir,
      "fixtures/drc/golden/golden-electrical-2l.json",
    );
    const p = fixtureToProjection(
      JSON.parse(await Bun.file(fixturePath).text()),
    );
    const reversed: DesignerPcbProjection = {
      ...p,
      placements: [...p.placements].reverse(),
      traces: [...p.traces].reverse(),
      vias: [...p.vias].reverse(),
      freePads: [...p.freePads].reverse(),
      freeHoles: [...p.freeHoles].reverse(),
      zones: [...p.zones].reverse(),
      keepouts: [...p.keepouts].reverse(),
    };
    expect(JSON.stringify(runDrc(reversed))).toBe(JSON.stringify(runDrc(p)));
  });
});
