/**
 * "One copper" (copper-pour contract §9): the Gerber, the cloud snapshot, the
 * connectivity graph and the DRC pour check must all be talking about the SAME
 * islands. Each consumer reaches the kernel by a different route, so a drift in
 * any one of them — a forgotten keepout, a re-derived pad→net map, a second
 * fill with different params — shows up here as an area or a ring mismatch,
 * not as a silently different board.
 *
 * The fixture is the `golden-pours-2l` golden board: precedence, a same-net
 * overlap with different clearances, a zone hole, a thermal over a rotated pad,
 * `padConnection: "none"`, a keepout, an NPTH and free pads.
 */
import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { buildDrcContext } from "../../../modules/designer/backend/drc/drc-context";
import { buildGerberLayer } from "../../../modules/designer/backend/export/gerber/writer";
import { buildSnapshotPourIslands } from "../../../modules/designer/backend/pcb/board-snapshot-pours";
import {
  pourParamsForZone,
  zonePourNets,
} from "../../../shared/pcb-areas";
import {
  buildCopperFillIslands,
  unionPourIslands,
} from "../../../shared/rendering/copper-fill/copper-fill-geometry";
import type { DesignerPcbProjection, PcbPointMm } from "../../../sdks/designer";
import { fixtureToProjection } from "./helpers/drc-golden";

const FIXTURE = path.resolve(
  import.meta.dir,
  "fixtures/drc/golden/golden-pours-2l.json",
);

async function loadProjection(): Promise<DesignerPcbProjection> {
  return fixtureToProjection(JSON.parse(await Bun.file(FIXTURE).text()));
}

/** Shoelace area of a ring (mm², unsigned). */
function ringArea(ring: ReadonlyArray<PcbPointMm>): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** `|outer| − Σ|holes|` over a list of islands. */
function islandsArea(
  islands: ReadonlyArray<ReadonlyArray<ReadonlyArray<PcbPointMm>>>,
): number {
  let sum = 0;
  for (const rings of islands) {
    rings.forEach((ring, i) => {
      sum += i === 0 ? ringArea(ring) : -ringArea(ring);
    });
  }
  return sum;
}

/**
 * Net copper area of a Gerber layer's `G36…G37` regions: dark (`%LPD%`) regions
 * add, clear (`%LPC%`) regions subtract. Coordinates are the X2 4.6 integer
 * form, a 1 nm grid — finer than the kernel's own 0.1 µm output grid, so the
 * round-trip through the file loses nothing.
 */
function gerberRegionArea(gerber: string): number {
  let clear = false;
  let ring: PcbPointMm[] | null = null;
  let total = 0;
  for (const line of gerber.split("\r\n")) {
    if (line === "%LPC*%") clear = true;
    else if (line === "%LPD*%") clear = false;
    else if (line === "G36*") ring = [];
    else if (line === "G37*") {
      if (ring && ring.length >= 3) {
        total += clear ? -ringArea(ring) : ringArea(ring);
      }
      ring = null;
    } else if (ring) {
      const m = /^X(-?\d+)Y(-?\d+)D0[12]\*$/.exec(line);
      if (m) ring.push({ x: Number(m[1]) / 1e6, y: Number(m[2]) / 1e6 });
    }
  }
  return total;
}

/** A direct kernel call for one effective zone, bypassing every consumer. */
function directFill(proj: DesignerPcbProjection, zoneId: string) {
  const ctx = buildDrcContext(proj);
  const zone = ctx.copperZones.find((z) => z.id === zoneId)!;
  return buildCopperFillIslands({
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
}

/** Every consumer's view of the pours, as comparable plain data. */
function consumerViews(proj: DesignerPcbProjection) {
  const ctx = buildDrcContext(proj);
  const pours = ctx.pourResults();
  return {
    drc: pours.map(({ zone, result }) => ({
      zoneId: zone.id,
      status: result.status,
      islands: result.status === "ok" ? result.islands : [],
    })),
    connectivity: ctx
      .copperItems()
      .filter((item) => item.kind === "pour")
      .map((item) => ({ key: item.key, rings: item.rings })),
    snapshot: buildSnapshotPourIslands(proj).map((island) => ({
      islandId: island.islandId,
      layer: island.layer,
      pourNetId: island.pourNetId,
      rings: island.rings,
    })),
    gerberTop: gerberRegionArea(buildGerberLayer(proj, "copper.top", [])),
    gerberBottom: gerberRegionArea(buildGerberLayer(proj, "copper.bottom", [])),
  };
}

/** The same projection with every primitive array reversed. */
function permuted(proj: DesignerPcbProjection): DesignerPcbProjection {
  return {
    ...proj,
    placements: [...proj.placements].reverse(),
    traces: [...proj.traces].reverse(),
    vias: [...proj.vias].reverse(),
    freePads: [...proj.freePads].reverse(),
    freeHoles: [...proj.freeHoles].reverse(),
    zones: [...proj.zones].reverse(),
    keepouts: [...proj.keepouts].reverse(),
  };
}

describe("pour consumers agree on one copper (§9)", () => {
  test("the Gerber layer's net region area is the union of the ok islands", async () => {
    const proj = await loadProjection();
    const ctx = buildDrcContext(proj);
    for (const [layer, kind] of [
      ["F.Cu", "copper.top"],
      ["B.Cu", "copper.bottom"],
    ] as const) {
      const rings = ctx
        .pourResults()
        .filter((p) => p.zone.layer === layer && p.result.status === "ok")
        .flatMap((p) => p.result.islands.map((island) => island.rings));
      // The artwork carries the UNION, not the pours one after the other.
      const expected = islandsArea(unionPourIslands(rings).map((island) => island.rings));
      expect(expected).toBeGreaterThan(0);
      expect(gerberRegionArea(buildGerberLayer(proj, kind, []))).toBeCloseTo(
        expected,
        6,
      );
    }
  });

  test("snapshot island areas match the kernel islands zone by zone", async () => {
    const proj = await loadProjection();
    const ctx = buildDrcContext(proj);
    const byLayer = new Map<string, number>();
    for (const { zone, result } of ctx.pourResults()) {
      if (result.status !== "ok") continue;
      const area = islandsArea(result.islands.map((island) => island.rings));
      byLayer.set(zone.layer, (byLayer.get(zone.layer) ?? 0) + area);
    }
    const snapshot = new Map<string, number>();
    for (const island of buildSnapshotPourIslands(proj)) {
      snapshot.set(
        island.layer,
        (snapshot.get(island.layer) ?? 0) + islandsArea([island.rings]),
      );
    }
    // Every layer the kernel poured is in the snapshot with the same area — the
    // snapshot re-winds and re-quantises rings but must not change the copper.
    expect([...snapshot.keys()].sort()).toEqual([...byLayer.keys()].sort());
    for (const [layer, area] of byLayer) {
      expect(snapshot.get(layer)!).toBeCloseTo(area, 6);
    }
  });

  test("connectivity's pour nodes ARE the kept islands of the net-bound zones", async () => {
    const proj = await loadProjection();
    const ctx = buildDrcContext(proj);
    const expected: Array<{ key: string; rings: PcbPointMm[][] }> = [];
    let pourIndex = 0;
    for (const { zone, result } of ctx.pourResults()) {
      if (zone.netId === null) continue;
      result.islands.forEach((island, index) => {
        expected.push({
          key: `pour:${zone.layer}:${zone.netId}:${pourIndex}:${index}`,
          rings: island.rings,
        });
      });
      pourIndex += 1;
    }
    const items = ctx
      .copperItems()
      .filter((item) => item.kind === "pour")
      .map((item) => ({ key: item.key, rings: item.rings }));
    expect(items).toEqual(expected);
    // Not vacuous: the fixture pours on both layers.
    expect(items.length).toBeGreaterThan(5);
  });

  test("pourResults is exactly a direct kernel call with the same params", async () => {
    const proj = await loadProjection();
    const ctx = buildDrcContext(proj);
    for (const { zone, result } of ctx.pourResults()) {
      expect(result).toEqual(directFill(proj, zone.id));
    }
  });

  test("permuting every input array changes nothing anywhere", async () => {
    const proj = await loadProjection();
    expect(JSON.stringify(consumerViews(permuted(proj)))).toBe(
      JSON.stringify(consumerViews(proj)),
    );
  });
});

// --- S6: the pour resolves through the rule resolver (rule-semantics §6) ----

/** A 2-layer board with a GND plane on F.Cu and two different-net obstacles. */
function ruleFixture(extra: Record<string, unknown> = {}): DesignerPcbProjection {
  return fixtureToProjection({
    schemaVersion: 2,
    layerCount: 2,
    outline: {
      kind: "rect",
      widthMm: 40,
      heightMm: 30,
      centerMm: { x: 0, y: 0 },
    },
    minimums: { traceWidthMm: 0.05 },
    // Per-kind board clearances, BOTH above the 0.5 mm pour default, so the
    // pad kind and the trace kind must resolve to different numbers.
    clearance: {
      traceToTraceMm: 0.8,
      traceToPadMm: 0.6,
      padToPadMm: 0.25,
      traceToViaMm: 0.25,
      viaToViaMm: 0.3,
      copperToBoardEdgeMm: 0.5,
    },
    netNames: { gnd: "GND", sig: "SIG", hv: "HV" },
    netClasses: [
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
    ],
    perNetClassAssignments: { hv: "hv" },
    freePads: [
      {
        id: "p_sig",
        padType: "smd",
        shape: "rect",
        centerMm: { x: -10, y: 0 },
        widthMm: 2,
        heightMm: 2,
        rotationDeg: 0,
        drillMm: null,
        layer: "F.Cu",
        netId: "sig",
        lockedAt: null,
      },
      {
        id: "p_hv",
        padType: "smd",
        shape: "rect",
        centerMm: { x: 10, y: 0 },
        widthMm: 2,
        heightMm: 2,
        rotationDeg: 0,
        drillMm: null,
        layer: "F.Cu",
        netId: "hv",
        lockedAt: null,
      },
    ],
    traces: [
      {
        id: "t_sig",
        netId: "sig",
        layer: "F.Cu",
        widthMm: 0.3,
        pointsNm: [
          [0, -5_000_000],
          [0, 5_000_000],
        ],
      },
    ],
    zones: [
      {
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
      },
    ],
    ...extra,
  });
}

/** `clearanceForItem` of the board zone, for one obstacle. */
function pourClearance(
  proj: DesignerPcbProjection,
  item: { kind: "trace" | "pad" | "via"; netId: string | null; pointMm: PcbPointMm },
): number {
  const ctx = buildDrcContext(proj);
  const zone = ctx.copperZones.find((z) => z.id === "board:F.Cu")!;
  return pourParamsForZone(
    zone,
    proj.board.designRules,
    ctx.keepouts,
    ctx.copperZones,
    zonePourNets(proj.board, ctx.netNames),
  ).clearanceForItem(item);
}

/** Smallest distance from any poured vertex to an axis-aligned rect (mm). */
function gapToRect(
  proj: DesignerPcbProjection,
  center: PcbPointMm,
  halfWidthMm: number,
  halfHeightMm: number,
): number {
  const fill = directFill(proj, "board:F.Cu");
  if (fill.status !== "ok") throw new Error("pour failed");
  let min = Infinity;
  for (const island of fill.islands) {
    for (const ring of island.rings) {
      for (const p of ring) {
        const dx = Math.max(Math.abs(p.x - center.x) - halfWidthMm, 0);
        const dy = Math.max(Math.abs(p.y - center.y) - halfHeightMm, 0);
        min = Math.min(min, Math.hypot(dx, dy));
      }
    }
  }
  return min;
}

describe("S6 — the pour resolves through the rule resolver (§6)", () => {
  test("the board tier is per obstacle kind, not one maximum", () => {
    const proj = ruleFixture();
    // pourToPad = max(pourToCopperMm ?? 0.5, traceToPadMm 0.6) = 0.6
    expect(
      pourClearance(proj, {
        kind: "pad",
        netId: "sig",
        pointMm: { x: -10, y: 0 },
      }),
    ).toBeCloseTo(0.6, 9);
    // pourToTrace = max(0.5, traceToTraceMm 0.8) = 0.8
    expect(
      pourClearance(proj, { kind: "trace", netId: "sig", pointMm: { x: 0, y: 0 } }),
    ).toBeCloseTo(0.8, 9);
    // The fill really keeps the pad at 0.6 — the old single maximum was 0.8.
    const gap = gapToRect(proj, { x: -10, y: 0 }, 1, 1);
    expect(gap).toBeGreaterThanOrEqual(0.6 - 1e-6);
    expect(gap).toBeLessThan(0.65);
  });

  test("a net class tightens the halo of its own pad", () => {
    const proj = ruleFixture();
    // class(HV) = 0.8 > pourToPad 0.6.
    expect(
      pourClearance(proj, { kind: "pad", netId: "hv", pointMm: { x: 10, y: 0 } }),
    ).toBeCloseTo(0.8, 9);
    const gap = gapToRect(proj, { x: 10, y: 0 }, 1, 1);
    expect(gap).toBeGreaterThanOrEqual(0.8 - 1e-6);
    expect(gap).toBeLessThan(0.85);
  });

  test("an UNSCOPED relaxing rule leaves every fill untouched (§6 rule 1)", () => {
    const relaxed = ruleFixture({
      drcRules: [
        {
          id: "global-relax",
          name: "relax everything",
          enabled: true,
          priority: 100,
          scopes: [],
          constraint: { kind: "clearance", mm: 0.1 },
        },
      ],
    });
    // No `pairKind` scope naming a pour kind ⇒ the rule cannot reach a pour.
    expect(
      pourClearance(relaxed, {
        kind: "pad",
        netId: "sig",
        pointMm: { x: -10, y: 0 },
      }),
    ).toBeCloseTo(0.6, 9);
    expect(JSON.stringify(consumerViews(relaxed))).toBe(
      JSON.stringify(consumerViews(ruleFixture())),
    );
  });

  test("an explicitly pour-scoped rule relaxes and tightens the fill", () => {
    const relaxed = ruleFixture({
      drcRules: [
        {
          id: "pad-relax",
          name: "relax pours around pads",
          enabled: true,
          priority: 10,
          scopes: [{ kind: "pairKind", pairKinds: ["pourToPad"] }],
          constraint: { kind: "clearance", mm: 0.2 },
        },
      ],
    });
    // First match wins and MAY relax — even below the class tier (§4.2).
    expect(
      pourClearance(relaxed, {
        kind: "pad",
        netId: "hv",
        pointMm: { x: 10, y: 0 },
      }),
    ).toBeCloseTo(0.2, 9);
    // The trace kind is untouched by a pad-scoped rule.
    expect(
      pourClearance(relaxed, {
        kind: "trace",
        netId: "sig",
        pointMm: { x: 0, y: 0 },
      }),
    ).toBeCloseTo(0.8, 9);
    const gap = gapToRect(relaxed, { x: 10, y: 0 }, 1, 1);
    expect(gap).toBeGreaterThanOrEqual(0.2 - 1e-6);
    expect(gap).toBeLessThan(0.25);

    const tightened = ruleFixture({
      drcRules: [
        {
          id: "sig-tighten",
          name: "keep the plane away from SIG traces",
          enabled: true,
          priority: 10,
          scopes: [
            { kind: "pairKind", pairKinds: ["pourToTrace"] },
            { kind: "net", netIds: ["sig"] },
          ],
          constraint: { kind: "clearance", mm: 1.2 },
        },
      ],
    });
    expect(
      pourClearance(tightened, {
        kind: "trace",
        netId: "sig",
        pointMm: { x: 0, y: 0 },
      }),
    ).toBeCloseTo(1.2, 9);
  });

  test("an area-scoped relaxation never reaches a fill (§6 rule 2)", () => {
    const proj = ruleFixture({
      drcRules: [
        {
          id: "bga-relax",
          name: "relax inside the BGA area",
          enabled: true,
          priority: 10,
          scopes: [
            { kind: "pairKind", pairKinds: ["pourToPad"] },
            {
              kind: "area",
              polygonMm: [
                { x: -13, y: -3 },
                { x: -7, y: -3 },
                { x: -7, y: 3 },
                { x: -13, y: 3 },
              ],
            },
          ],
          constraint: { kind: "clearance", mm: 0.1 },
        },
      ],
    });
    // The pad sits INSIDE the area, but a pour has no evaluation point: the
    // masks-0 term of `clearancePour` dominates, so the halo stays at 0.6.
    expect(
      pourClearance(proj, {
        kind: "pad",
        netId: "sig",
        pointMm: { x: -10, y: 0 },
      }),
    ).toBeCloseTo(0.6, 9);
  });

  test("every consumer sees the pour-scoped rule identically", () => {
    const proj = ruleFixture({
      drcRules: [
        {
          id: "pad-relax",
          name: "relax pours around pads",
          enabled: true,
          priority: 10,
          scopes: [{ kind: "pairKind", pairKinds: ["pourToPad"] }],
          constraint: { kind: "clearance", mm: 0.2 },
        },
      ],
      computeRatsnest: true,
    });
    const ctx = buildDrcContext(proj);
    // DRC's memoized fill IS a direct kernel call with the same params, and
    // the Gerber artwork is the union of exactly those islands.
    for (const { zone, result } of ctx.pourResults()) {
      expect(result).toEqual(directFill(proj, zone.id));
    }
    const rings = ctx
      .pourResults()
      .filter((p) => p.zone.layer === "F.Cu" && p.result.status === "ok")
      .flatMap((p) => p.result.islands.map((island) => island.rings));
    const expected = islandsArea(
      unionPourIslands(rings).map((island) => island.rings),
    );
    expect(expected).toBeGreaterThan(0);
    expect(gerberRegionArea(buildGerberLayer(proj, "copper.top", []))).toBeCloseTo(
      expected,
      6,
    );
    // …and the snapshot carries the same copper.
    const snapshot = buildSnapshotPourIslands(proj)
      .filter((island) => island.layer === "F.Cu")
      .map((island) => islandsArea([island.rings]))
      .reduce((a, b) => a + b, 0);
    const kernel = rings.length > 0 ? islandsArea(rings) : 0;
    expect(snapshot).toBeCloseTo(kernel, 6);
    // Connectivity's pour nodes are those islands too.
    expect(
      ctx.copperItems().filter((item) => item.kind === "pour").length,
    ).toBe(rings.length);
  });
});
