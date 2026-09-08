import { describe, expect, test } from "bun:test";
import { buildRouteObstacles } from "../../../shared/pcb-routing/route-obstacles";
import { segmentIntersectsRectNm } from "../../../shared/pcb-routing/collision";
import { createRuleResolver } from "../../../shared/drc/rule-resolver";
import { keepoutAffects } from "../../../shared/pcb-areas/keepout-predicates";
import type {
  PcbDrcRule,
  PcbKeepout,
  PcbNetClass,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../sdks/designer";
import { boardWithRules } from "./helpers/drc-fixtures";

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

function pad(number: string, xMm: number, yMm: number, wMm = 1, hMm = 2) {
  return {
    id: `pad-${number}`,
    number,
    shape: "rect" as const,
    centerMm: { x: xMm, y: yMm },
    widthMm: wMm,
    heightMm: hMm,
    rotationDeg: 0,
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
 * (rule-semantics contract §9). The default class carries clearance 0 so the
 * board tier is what the geometry assertions below measure; `wide` (0.8 mm) is
 * assigned to `net-b` to exercise the neighbour-class tier, and the three
 * board pair kinds are deliberately DISTINCT so a rect proves which kind it
 * used.
 */
function resolverFor(
  opts: {
    drcRules?: PcbDrcRule[];
    perNetClassAssignments?: Record<string, string>;
  } = {},
) {
  return createRuleResolver(
    boardWithRules({
      clearance: {
        traceToTraceMm: 0.2,
        traceToPadMm: 0.25,
        traceToViaMm: 0.3,
      },
      netClasses: [netClass("default", 0), netClass("wide", 0.8)],
      layerCount: 4,
      ...(opts.perNetClassAssignments
        ? { perNetClassAssignments: opts.perNetClassAssignments }
        : {}),
      ...(opts.drcRules ? { drcRules: opts.drcRules } : {}),
    }),
    { "net-a": "A", "net-b": "B" },
    { validCopperLayers: ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"] },
  );
}

const RESOLVER = resolverFor();

const BASE = {
  traces: [] as PcbTrace[],
  placements: [] as PcbPlacedPart[],
  vias: [] as PcbVia[],
  layer: "F.Cu" as const,
  netId: "net-a" as string | null,
  padNetMap: new Map<string, string>(),
  resolver: RESOLVER,
  routeWidthMm: 0.3,
};

describe("buildRouteObstacles — traces", () => {
  test("emits one rect per segment with live-DRC required inflation", () => {
    const t = trace("t1", [
      { x: 0, y: 0 },
      { x: 10 * NM, y: 0 },
      { x: 10 * NM, y: 5 * NM },
    ]);
    const rects = buildRouteObstacles({ ...BASE, traces: [t] });
    expect(rects).toHaveLength(2);
    // required = clearance 0.2 + otherHalf 0.1 + routeHalf 0.15 = 0.45 mm
    const seg0 = rects.find((r) => r.id === "trace:t1:0")!;
    expect(seg0.minX).toBe(-450_000);
    expect(seg0.minY).toBe(-450_000);
    expect(seg0.maxX).toBe(10 * NM + 450_000);
    expect(seg0.maxY).toBe(450_000);
  });

  test("skips other-layer and same-net traces (live-DRC parity)", () => {
    const rects = buildRouteObstacles({
      ...BASE,
      traces: [
        trace("back", [{ x: 0, y: 0 }, { x: NM, y: 0 }], { layer: "B.Cu" }),
        trace("mine", [{ x: 0, y: 0 }, { x: NM, y: 0 }], { netId: "net-a" }),
        trace("nullnet", [{ x: 0, y: 0 }, { x: NM, y: 0 }]),
      ],
    });
    // null-net trace is NOT skipped (unknown net must stay an obstacle).
    expect(rects.map((r) => r.id)).toEqual(["trace:nullnet:0"]);
  });

  test("null session net treats even same-named nets as obstacles", () => {
    const rects = buildRouteObstacles({
      ...BASE,
      netId: null,
      traces: [trace("t", [{ x: 0, y: 0 }, { x: NM, y: 0 }], { netId: "net-a" })],
    });
    expect(rects).toHaveLength(1);
  });
});

describe("buildRouteObstacles — pads", () => {
  test("pad rect is the union of swapped and un-swapped models at 90°", () => {
    // 1×2 mm pad rotated 90°: swapped extents (1, 0.5), un-swapped (0.5, 1)
    // → union (1, 1). Inflate by padClearance 0.25 + routeHalf 0.15 = 0.4.
    const rects = buildRouteObstacles({
      ...BASE,
      placements: [
        placement("u1", { x: 10, y: 10 }, [pad("1", 0, 0)], { rotationDeg: 90 }),
      ],
    });
    expect(rects).toHaveLength(1);
    const r = rects[0]!;
    expect(r.id).toBe("pad:u1|1");
    expect(r.minX).toBe(10 * NM - (1_000_000 + 400_000));
    expect(r.maxX).toBe(10 * NM + 1_000_000 + 400_000);
    expect(r.minY).toBe(10 * NM - (1_000_000 + 400_000));
    expect(r.maxY).toBe(10 * NM + 1_000_000 + 400_000);
  });

  test("same-net pads and excluded pads stay routable; B.Cu placements skip on F.Cu", () => {
    const padNetMap = new Map([["u1|1", "net-a"]]);
    const rects = buildRouteObstacles({
      ...BASE,
      padNetMap,
      placements: [
        placement("u1", { x: 0, y: 0 }, [pad("1", 0, 0), pad("2", 3, 0)]),
        placement("u2", { x: 20, y: 0 }, [pad("1", 0, 0)], { layer: "B.Cu" }),
        placement("u3", { x: 40, y: 0 }, [pad("1", 0, 0)]),
      ],
      excludePadIds: new Set(["u3|1"]),
    });
    // u1|1 same-net skipped, u2 on B.Cu skipped, u3|1 excluded → only u1|2.
    expect(rects.map((r) => r.id)).toEqual(["pad:u1|2"]);
  });

  test("mirrored placement flips pad x before rotation", () => {
    const rects = buildRouteObstacles({
      ...BASE,
      placements: [
        placement("u1", { x: 0, y: 0 }, [pad("1", 2, 0, 1, 1)], {
          layer: "B.Cu",
          mirrored: true,
        }),
      ],
      layer: "B.Cu",
    });
    const r = rects[0]!;
    // Pad center mirrors to x = -2 mm; half 0.5 + inflate 0.4.
    expect(r.minX).toBe(-2 * NM - 900_000);
    expect(r.maxX).toBe(-2 * NM + 900_000);
  });
});

describe("buildRouteObstacles — vias", () => {
  test("vias block every layer; same-net vias are transparent", () => {
    const rects = buildRouteObstacles({
      ...BASE,
      layer: "In1.Cu",
      vias: [via("v1", 5, 5), via("v2", 9, 9, "net-a")],
    });
    expect(rects.map((r) => r.id)).toEqual(["via:v1"]);
    const r = rects[0]!;
    // The `traceToVia` pair kind, not the trace-to-trace one (§9): board
    // traceToViaMm is 0.3, traceToTraceMm 0.2.
    // half = d/2 0.4 + clearance 0.3 + routeHalf 0.15 = 0.85 mm
    expect(r.minX).toBe(5 * NM - 850_000);
    expect(r.maxX).toBe(5 * NM + 850_000);
  });
});

describe("buildRouteObstacles — resolved clearance tiers", () => {
  test("the neighbour net's CLASS raises the inflation", () => {
    const resolver = resolverFor({
      perNetClassAssignments: { "net-b": "wide" },
    });
    const rects = buildRouteObstacles({
      ...BASE,
      resolver,
      traces: [
        trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }], {
          netId: "net-b",
        }),
      ],
    });
    // implicit = max(board 0.2, class(net-a) 0, class(net-b) 0.8) = 0.8
    // inflate = 0.8 + otherHalf 0.1 + routeHalf 0.15 = 1.05 mm
    expect(rects[0]!.maxY).toBe(1_050_000);
  });

  test("a net-scoped rule relaxes it below the board tier", () => {
    const relax: PcbDrcRule = {
      id: "relax-b",
      name: "Relax B",
      enabled: true,
      priority: 10,
      scopes: [{ kind: "net", netIds: ["net-b"] }],
      constraint: { kind: "clearance", mm: 0.05 },
    };
    const resolver = resolverFor({
      drcRules: [relax],
      perNetClassAssignments: { "net-b": "wide" },
    });
    const rects = buildRouteObstacles({
      ...BASE,
      resolver,
      traces: [
        trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }], {
          netId: "net-b",
        }),
      ],
    });
    // The explicit tier wins outright — the 0.8 class does not survive it.
    // inflate = 0.05 + 0.1 + 0.15 = 0.30 mm
    expect(rects[0]!.maxY).toBe(300_000);
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
    const rects = buildRouteObstacles({
      ...BASE,
      resolver: resolverFor({ drcRules: [padOnly] }),
      traces: [trace("t1", [{ x: 0, y: 0 }, { x: 10 * NM, y: 0 }])],
      placements: [placement("u1", { x: 20, y: 0 }, [pad("1", 0, 0)])],
    });
    const seg = rects.find((r) => r.id === "trace:t1:0")!;
    const padRect = rects.find((r) => r.id === "pad:u1|1")!;
    // trace keeps the board tier: 0.2 + 0.1 + 0.15 = 0.45 mm
    expect(seg.maxY).toBe(450_000);
    // pad takes the rule: half 1.0 + 1 + routeHalf 0.15 = 2.15 mm
    expect(padRect.maxY).toBe(2_150_000);
  });
});

describe("buildRouteObstacles — keepouts", () => {
  test("one ring-bounds rect per tracks keepout on the routing layer", () => {
    const rects = buildRouteObstacles({ ...BASE, keepouts: [keepout()] });
    expect(rects.map((r) => r.id)).toEqual(["keepout:k1"]);
  });

  test("inflation is exactly routeWidthMm / 2 (a keepout has clearance 0)", () => {
    const rects = buildRouteObstacles({ ...BASE, keepouts: [keepout()] });
    const r = rects[0]!;
    // routeWidthMm 0.3 → half 0.15 mm = 150_000 nm; no clearance term.
    expect(r.minX).toBe(-150_000);
    expect(r.minY).toBe(-150_000);
    expect(r.maxX).toBe(10 * NM + 150_000);
    expect(r.maxY).toBe(10 * NM + 150_000);
  });

  test("a keepout whose layers exclude the routing layer emits nothing", () => {
    const rects = buildRouteObstacles({
      ...BASE,
      keepouts: [keepout({ layers: ["B.Cu"] })],
    });
    expect(rects).toHaveLength(0);
  });

  test("restrictions.tracks off emits nothing", () => {
    const rects = buildRouteObstacles({
      ...BASE,
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
    expect(rects).toHaveLength(0);
  });

  test("keepout rects are net-agnostic (same-net routing is still blocked)", () => {
    const rects = buildRouteObstacles({
      ...BASE,
      netId: "net-a",
      keepouts: [keepout()],
    });
    expect(rects.map((r) => r.id)).toEqual(["keepout:k1"]);
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
    const one = buildRouteObstacles({ ...BASE, traces, vias, keepouts });
    const two = buildRouteObstacles({
      ...BASE,
      traces: [traces[1]!, traces[0]!],
      vias: [vias[1]!, vias[0]!],
      keepouts: [keepouts[1]!, keepouts[0]!],
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
    const [rect] = buildRouteObstacles({ ...BASE, routeWidthMm, keepouts: [concave] });
    expect(rect?.id).toBe("keepout:kc");
    let flagged = 0;
    for (let x = -1; x <= 9; x += 0.37) {
      for (let y = -1; y <= 9; y += 0.41) {
        const a = { x, y };
        const b = { x: x + 0.9, y: y + 0.35 };
        const affected = keepoutAffects(concave, {
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
    const [rect] = buildRouteObstacles({
      ...BASE,
      routeWidthMm: 0.3,
      keepouts: [concave],
    });
    // 0.1234567 − 0.15 = −0.0265433 mm → floor → −26544 nm (nearest would be −26543).
    expect(rect!.minX).toBe(-26544);
    // 7.9 + 0.15 = 8.05 mm exactly representable up to float noise → ceil never undershoots.
    expect(rect!.maxY).toBeGreaterThanOrEqual(8_050_000);
    expect(rect!.maxX).toBeGreaterThanOrEqual(7_850_000);
  });

  test("a disabled keepout passed directly still blocks (the builder trusts the effective list, fail-closed)", () => {
    const rects = buildRouteObstacles({
      ...BASE,
      keepouts: [keepout({ enabled: false })],
    });
    expect(rects.map((r) => r.id)).toEqual(["keepout:k1"]);
  });
});

