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
import * as fs from "node:fs";
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
import { buildProjectionPours } from "../../../shared/rendering/copper-fill/projection-pours";
import type { DesignerPcbProjection, PcbPointMm } from "../../../sdks/designer";
import { fixtureToProjection } from "./helpers/drc-golden";
import { insidePrimitives, parseGerber } from "./helpers/gerber-parse";

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
  // These fixtures carry no unassigned copper, so the tier net IS the net.
  const ctx = buildDrcContext(proj);
  const zone = ctx.copperZones.find((z) => z.id === "board:F.Cu")!;
  return pourParamsForZone(
    zone,
    proj.board.designRules,
    ctx.keepouts,
    ctx.copperZones,
    zonePourNets(proj.board, ctx.netNames),
  ).clearanceForItem({ ...item, tierNetId: item.netId });
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

// --- OPENPCB-67 §3.8: one physical pour result -------------------------------

/** Even-odd point-in-ring, independent of the code under test. */
function inRing(ring: ReadonlyArray<{ xMm: number; yMm: number }>, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a.yMm > y !== b.yMm > y &&
      x < ((b.xMm - a.xMm) * (y - a.yMm)) / (b.yMm - a.yMm) + a.xMm
    ) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * Is `(x, y)` dark in a PARSED copper layer? The writer emits the pour regions
 * first (dark outer contours, clear holes, in order) and every flash and
 * stroke after them in `%LPD%`, so the image is "the last region that contains
 * the point decides, then any flash or stroke darkens".
 */
function isDarkAt(gerber: string, x: number, y: number): boolean {
  const parsed = parseGerber(gerber);
  let dark = false;
  for (const region of parsed.regions) {
    if (inRing(region.points, x, y)) dark = region.polarity === "dark";
  }
  if (dark) return true;
  for (const flash of parsed.flashes) {
    const ap = parsed.apertures.get(flash.code);
    if (ap && insidePrimitives(ap.primitives, x - flash.xMm, y - flash.yMm)) {
      return true;
    }
  }
  for (const stroke of parsed.strokes) {
    const tool = parsed.apertures.get(stroke.apertureCode)?.primitives[0];
    if (!tool || tool.kind !== "circle") continue;
    for (let i = 1; i < stroke.points.length; i += 1) {
      const a = stroke.points[i - 1]!;
      const b = stroke.points[i]!;
      const dx = b.xMm - a.xMm;
      const dy = b.yMm - a.yMm;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - a.xMm) * dx + (y - a.yMm) * dy) / len2));
      if (Math.hypot(x - (a.xMm + t * dx), y - (a.yMm + t * dy)) <= tool.diameterMm / 2) {
        return true;
      }
    }
  }
  return false;
}

const gndBoardZone = {
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
};

const netClass = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  traceWidthMm: 0.25,
  clearanceMm: 0.2,
  viaDiameterMm: 0.8,
  viaDrillMm: 0.4,
  color: "#ccc",
  defaultViaProtection: "tented",
  ...extra,
});

const VIA_R = 0.4;

/**
 * (a) An UNASSIGNED via at the origin, joined by a B.Cu trace to a pad of a
 * 230 V net, under an F.Cu GND board zone. The via's tier net is HV only
 * through the B.Cu trace, so only a fill that sees EVERY trace — not the
 * poured layer's own — keeps the F.Cu plane at the IPC-2221B 171–250 V
 * external-uncoated (B2) spacing of 1.25 mm from it.
 */
function tierViaFixture(withBottomTrace: boolean): DesignerPcbProjection {
  return fixtureToProjection({
    schemaVersion: 2,
    layerCount: 2,
    outline: { kind: "rect", widthMm: 30, heightMm: 20, centerMm: { x: 0, y: 0 } },
    netNames: { gnd: "GND", hv: "HV" },
    netClasses: [netClass("default"), netClass("hv", { voltageV: 230 })],
    perNetClassAssignments: { hv: "hv" },
    freePads: [
      {
        id: "p_hv",
        padType: "smd",
        shape: "rect",
        centerMm: { x: 6, y: 0 },
        widthMm: 1.5,
        heightMm: 1.5,
        rotationDeg: 0,
        drillMm: null,
        layer: "B.Cu",
        netId: "hv",
        lockedAt: null,
      },
    ],
    traces: withBottomTrace
      ? [
          {
            id: "t_b",
            netId: null,
            layer: "B.Cu",
            widthMm: 0.3,
            pointsNm: [
              [0, 0],
              [6_000_000, 0],
            ],
          },
        ]
      : [],
    vias: [{ id: "v_u", netId: null, centerMm: [0, 0], diameterMm: 2 * VIA_R, drillMm: 0.4 }],
    zones: [gndBoardZone],
  });
}

/** A same-net (GND) via inside the F.Cu GND board zone. */
function gndViaFixture(): DesignerPcbProjection {
  return fixtureToProjection({
    schemaVersion: 2,
    layerCount: 2,
    outline: { kind: "rect", widthMm: 30, heightMm: 20, centerMm: { x: 0, y: 0 } },
    netNames: { gnd: "GND" },
    vias: [{ id: "v_g", netId: "gnd", centerMm: [0, 0], diameterMm: 2 * VIA_R, drillMm: 0.4 }],
    zones: [gndBoardZone],
  });
}

/**
 * (b) Board clearances AND the pour tier at 0.2 mm; the WIDE net class asks
 * 0.4 mm. Two 2×2 mm F.Cu pads under a GND board zone: `p_wide` at x = 10 (a
 * WIDE net), `p_sig` at x = −10 (default class).
 */
function netClassFixture(): DesignerPcbProjection {
  const pad = (id: string, x: number, netId: string) => ({
    id,
    padType: "smd",
    shape: "rect",
    centerMm: { x, y: 0 },
    widthMm: 2,
    heightMm: 2,
    rotationDeg: 0,
    drillMm: null,
    layer: "F.Cu",
    netId,
    lockedAt: null,
  });
  return fixtureToProjection({
    schemaVersion: 2,
    layerCount: 2,
    outline: { kind: "rect", widthMm: 40, heightMm: 30, centerMm: { x: 0, y: 0 } },
    minimums: { traceWidthMm: 0.05 },
    clearance: {
      traceToTraceMm: 0.2,
      traceToPadMm: 0.2,
      padToPadMm: 0.2,
      traceToViaMm: 0.2,
      viaToViaMm: 0.2,
      copperToBoardEdgeMm: 0.5,
      pourToCopperMm: 0.2,
    },
    netNames: { gnd: "GND", sig: "SIG", wide: "WIDE" },
    netClasses: [
      netClass("default", { clearanceMm: 0.2 }),
      netClass("wide", { clearanceMm: 0.4 }),
    ],
    perNetClassAssignments: { wide: "wide" },
    freePads: [pad("p_wide", 10, "wide"), pad("p_sig", -10, "sig")],
    zones: [gndBoardZone],
  });
}

describe("OPENPCB-67 §3.8 — one physical pour result (oracles on the parsed Gerber)", () => {
  test("(a) an unassigned via keeps the clearance its B.Cu-joined tier net asks", () => {
    const top = buildGerberLayer(tierViaFixture(true), "copper.top", []);
    // Inside the 1.25 mm B2 band: clear on both axes.
    expect(isDarkAt(top, -(VIA_R + 1.0), 0)).toBe(false);
    expect(isDarkAt(top, 0, VIA_R + 1.0)).toBe(false);
    expect(isDarkAt(top, 0, VIA_R + 1.2)).toBe(false);
    // Beyond it: the plane is back.
    expect(isDarkAt(top, -(VIA_R + 1.4), 0)).toBe(true);
    // Discriminating: without the B.Cu trace the via is plain unassigned copper
    // and the plane comes much closer — a fill that dropped other layers'
    // traces would draw THIS board for the fixture above.
    const alone = buildGerberLayer(tierViaFixture(false), "copper.top", []);
    expect(isDarkAt(alone, -(VIA_R + 0.6), 0)).toBe(true);
  });

  test("(a') a same-net via has no clearance ring in the plane", () => {
    const top = buildGerberLayer(gndViaFixture(), "copper.top", []);
    for (const [x, y] of [
      [VIA_R + 0.05, 0],
      [-(VIA_R + 0.05), 0],
      [0, VIA_R + 0.05],
      [0, -(VIA_R + 0.05)],
    ] as const) {
      expect(isDarkAt(top, x, y)).toBe(true);
    }
  });

  test("(b) a net-class clearance reaches the fill (full board settings, no Pick)", () => {
    const top = buildGerberLayer(netClassFixture(), "copper.top", []);
    // 0.3 mm off the WIDE pad's right / top edge: inside its 0.4 mm class halo.
    expect(isDarkAt(top, 11 + 0.3, 0)).toBe(false);
    expect(isDarkAt(top, 10, 1 + 0.3)).toBe(false);
    expect(isDarkAt(top, 11 + 0.45, 0)).toBe(true);
    // The default-class pad at the same offset IS poured up to (0.2 mm tier).
    expect(isDarkAt(top, -11 - 0.3, 0)).toBe(true);
  });

  test("(c) grep gate: one kernel argument builder", () => {
    const root = path.resolve(import.meta.dir, "../../..");
    const allowedFill = new Set([
      "shared/rendering/copper-fill/copper-fill-geometry.ts",
      "shared/rendering/copper-fill/projection-pours.ts",
      "shared/pcb-connectivity/board-connectivity.ts",
    ]);
    const offenders: string[] = [];
    let scanned = 0;
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) {
          continue;
        }
        const rel = path.relative(root, full).split(path.sep).join("/");
        scanned += 1;
        const text = fs.readFileSync(full, "utf8");
        if (/\bbuildCopperFill(Islands|PourPaths)\(/.test(text) && !allowedFill.has(rel)) {
          offenders.push(`${rel}: calls the pour kernel`);
        }
        if (
          /copperToBoardEdgeMm:\s*[\w.?]*clearance\.copperToBoardEdgeMm/.test(text) &&
          rel !== "shared/rendering/copper-fill/projection-pours.ts"
        ) {
          offenders.push(`${rel}: builds the kernel's board-wide params`);
        }
      }
    };
    walk(root);
    // Not vacuous: the walk really reached the consumers it guards.
    expect(scanned).toBeGreaterThan(500);
    expect(offenders).toEqual([]);
  });
});

describe("OPENPCB-67 §3.8 — regression guards (consumers vs buildProjectionPours)", () => {
  test("DRC's pourResults deep-equal buildProjectionPours of the same projection", async () => {
    const proj = await loadProjection();
    const ctx = buildDrcContext(proj);
    const pours = buildProjectionPours(
      { ...proj, padNets: proj.padNets ?? {} },
      { nets: zonePourNets(proj.board, proj.netNames) },
    );
    expect(pours.length).toBeGreaterThan(3);
    expect(ctx.pourResults().map((p) => ({ id: p.zone.id, result: p.result }))).toEqual(
      pours.map((p) => ({ id: p.zone.id, result: p.result })),
    );
  });

  test("snapshot islands carry exactly the buildProjectionPours copper per layer", async () => {
    const proj = await loadProjection();
    const pours = buildProjectionPours(
      { ...proj, padNets: proj.padNets ?? {} },
      { nets: zonePourNets(proj.board, proj.netNames) },
    );
    const expected = new Map<string, { count: number; area: number }>();
    for (const { zone, result } of pours) {
      if (result.status !== "ok") continue;
      const entry = expected.get(zone.layer) ?? { count: 0, area: 0 };
      entry.count += result.islands.length;
      entry.area += islandsArea(result.islands.map((island) => island.rings));
      expected.set(zone.layer, entry);
    }
    const actual = new Map<string, { count: number; area: number }>();
    for (const island of buildSnapshotPourIslands(proj)) {
      const entry = actual.get(island.layer) ?? { count: 0, area: 0 };
      entry.count += 1;
      entry.area += islandsArea([island.rings]);
      actual.set(island.layer, entry);
    }
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [layer, { count, area }] of expected) {
      expect(actual.get(layer)!.count).toBe(count);
      expect(actual.get(layer)!.area).toBeCloseTo(area, 6);
    }
  });
});
