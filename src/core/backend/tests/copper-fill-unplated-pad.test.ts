/**
 * A non-plated pad's copper ring never anchors a pour (manufacturability
 * contract 10 §2.4, S11 R1 #6).
 *
 * The ring is MECHANICAL: the connectivity kernel keys such a record per copper
 * layer and gives every one of those items a NULL net, so no graph component
 * can contain it — a front trace and a back trace touching the two rings of one
 * hole are not connected. A ring the graph can never join must therefore not be
 * welded to the plane either: the fill has to treat it as ordinary
 * different-net copper (a full clearance halo, no thermal spokes, no membership
 * key), whatever `padNets` says about it.
 *
 * A numbered `np_thru_hole` pad bound to a net IS a design error — the DRC
 * reports it as `NPTH_PAD_NET` and keeps its airwire — but the pour must not
 * "fix" it by shorting the plane to a mechanical washer.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCopperFillIslands,
  type CopperFillIsland,
  type CopperFillPourParams,
} from "../../../shared/rendering/copper-fill/copper-fill-geometry";
import { freePadItemKey, padItemKey } from "../../../shared/pcb-connectivity";
import type { PcbBoardOutline } from "../../../sdks/designer";
import { freePad, pad, placement } from "./helpers/drc-fixtures";

const outline: PcbBoardOutline = {
  kind: "rect",
  widthMm: 40,
  heightMm: 40,
  centerMm: { x: 20, y: 20 },
};

const POUR_TO_COPPER_MM = 0.5;

/**
 * A GND plane over a 40 x 40 board carrying (a) an M3-style mounting pad at
 * (12, 20) — 4.0 mm copper ring around a 3.2 mm drill on `*.Cu` — and (b) a
 * plain GND SMD pad at (28, 20) that always joins the plane.
 */
function pourWithMountingPad(plated: boolean): CopperFillPourParams {
  const mountingPad = pad("1", { x: 0, y: 0 }, 4, 4, {
    shape: "circle",
    drillDiameterMm: 3.2,
    layer: "*.Cu",
    ...(plated ? {} : { plated: false }),
  });
  return {
    layer: "F.Cu",
    layerCount: 2,
    outline,
    placements: [
      placement("MH1", {
        positionMm: { x: 12, y: 20 },
        pads: [mountingPad],
      }),
    ],
    traces: [],
    vias: [],
    freePads: [
      freePad("tp", {
        center: { x: 28, y: 20 },
        widthMm: 2,
        heightMm: 2,
        netId: "gnd",
        layer: "F.Cu",
      }),
    ],
    pourNetId: "gnd",
    // The mounting pad is NUMBERED and bound to GND — the `NPTH_PAD_NET`
    // design error. The pour must still keep its distance when it is unplated.
    padNetIds: new Map([["MH1|1", "gnd"]]),
    clearanceMm: POUR_TO_COPPER_MM,
    clearanceForItem: () => POUR_TO_COPPER_MM,
    copperToBoardEdgeMm: 0.5,
    cornerRadiusMm: 0,
    minThicknessMm: 0,
    minIslandAreaMm2: 0,
    padConnection: "thermal",
    thermalReliefGapMm: 0.4,
    thermalSpokeWidthMm: 0.4,
  };
}

function islandsOf(params: CopperFillPourParams): CopperFillIsland[] {
  const result = buildCopperFillIslands(params);
  expect(result.status).toBe("ok");
  return result.islands;
}

/** Nearest distance from `p` to any island ring vertex or edge (mm). */
function distanceToRings(
  island: CopperFillIsland,
  px: number,
  py: number,
): number {
  let best = Infinity;
  for (const ring of island.rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / lenSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

const MOUNTING_KEY = padItemKey("MH1", "1", 0);

describe("an unplated pad's ring never joins the pour", () => {
  test("unplated: full clearance halo, no membership key, no thermal spokes", () => {
    const islands = islandsOf(pourWithMountingPad(false));
    expect(islands).toHaveLength(1);
    const island = islands[0]!;

    // Not a member — the kernel could never put it in the plane's component.
    expect(island.memberKeys).not.toContain(MOUNTING_KEY);
    // …but the plane is still anchored, so `ISOLATED_COPPER_ISLAND` (which
    // fires only on an island whose component holds NO same-net copper) has a
    // member to find.
    expect(island.memberKeys).toContain(freePadItemKey("tp"));

    // A clearance void around the ring: the copper stops `pourToCopperMm`
    // from the 2.0 mm ring radius. A thermal relief would leave spokes
    // crossing that gap; here the nearest copper on the pad's local X axis
    // sits at 2.0 + 0.5 (allow the kernel's 0.1 µm quantisation guard).
    expect(island.rings.length).toBeGreaterThan(1);
    const gap = distanceToRings(island, 12, 20);
    expect(gap).toBeGreaterThan(2 + POUR_TO_COPPER_MM - 1e-3);
    // Every spoke direction is clear: a spoke would put copper at 2.05 mm.
    const spokeDirs: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of spokeDirs) {
      expect(
        distanceToRings(island, 12 + dx * 2.2, 20 + dy * 2.2),
      ).toBeGreaterThan(0.2);
    }
  });

  test("plated: the same pad thermals into the plane as before", () => {
    const islands = islandsOf(pourWithMountingPad(true));
    expect(islands).toHaveLength(1);
    const island = islands[0]!;
    expect(island.memberKeys).toContain(MOUNTING_KEY);
    expect(island.memberKeys).toContain(freePadItemKey("tp"));
    // The thermal relief gap is 0.4 mm, not the 0.5 mm pour clearance, and it
    // is crossed by spokes — so copper reaches much closer to the pad centre
    // than the unplated halo allowed.
    expect(distanceToRings(island, 12, 20)).toBeLessThan(2 + POUR_TO_COPPER_MM);
  });
});
