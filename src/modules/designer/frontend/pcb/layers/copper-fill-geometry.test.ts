import { describe, expect, test } from "vitest";
import * as THREE from "three";
import type {
  PcbFreePad,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import type { FootprintRenderSourcePad } from "../../../../../shared/rendering";
import {
  buildCopperFillPourShapes,
  resolveCopperFillClearanceMm,
  type CopperFillPourParams,
} from "./copper-fill-geometry";

const outline = {
  kind: "rect" as const,
  widthMm: 20,
  heightMm: 10,
  centerMm: { x: 0, y: 0 },
};

const noTraces: ReadonlyArray<PcbTrace> = [];
const noVias: ReadonlyArray<PcbVia> = [];
const emptyPadNets: ReadonlyMap<string, string> = new Map();

function pad(
  id: string,
  centerMm: { x: number; y: number },
  widthMm: number,
  heightMm: number,
  overrides: Partial<FootprintRenderSourcePad> = {},
): FootprintRenderSourcePad {
  return {
    id,
    number: id,
    shape: "rect",
    centerMm,
    widthMm,
    heightMm,
    rotationDeg: 0,
    layer: "F.Cu",
    ...overrides,
  };
}

function placement(
  pads: FootprintRenderSourcePad[],
  overrides: Partial<PcbPlacedPart> = {},
): PcbPlacedPart {
  return {
    id: "U1-pcb",
    partId: "U1",
    componentId: "component-1",
    reference: "U1",
    positionMm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp-1",
      name: "SOIC",
      mountType: "smd",
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "SOIC",
        pads,
        graphics: [],
        labels: [],
        bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
        warnings: [],
      },
    },
    ...overrides,
  };
}

function via(overrides: Partial<PcbVia> = {}): PcbVia {
  return {
    id: "v1",
    netId: null,
    netClassId: "default",
    centerMm: { x: 0, y: 0 },
    diameterMm: 0.6,
    drillMm: 0.3,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    ...overrides,
  };
}

function freePad(overrides: Partial<PcbFreePad> = {}): PcbFreePad {
  return {
    id: "fp1",
    centerMm: { x: 0, y: 0 },
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
    ...overrides,
  };
}

// --- pour measurement helpers ----------------------------------------------

function ringArea(pts: THREE.Vector2[]): number {
  let acc = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    acc += p.x * q.y - q.x * p.y;
  }
  return Math.abs(acc) / 2;
}

function pourArea(shapes: THREE.Shape[]): number {
  let total = 0;
  for (const shape of shapes) {
    const { shape: outer, holes } = shape.extractPoints(1);
    total += ringArea(outer);
    for (const hole of holes) total -= ringArea(hole);
  }
  return total;
}

function holeCount(shapes: THREE.Shape[]): number {
  return shapes.reduce((n, s) => n + s.holes.length, 0);
}

/** Every vertex of every hole across all pour islands (mm). */
function holeVertices(shapes: THREE.Shape[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const shape of shapes) {
    for (const hole of shape.extractPoints(1).holes) out.push(...hole);
  }
  return out;
}

/**
 * Hole-ring vertices PLUS each edge midpoint. The polygonal round-offset's
 * chords lie inside the ideal Minkowski offset, so the worst clearance under-cut
 * is at edge midpoints — vertices alone (which sit on the offset boundary) miss
 * it.
 */
function holeEdgeSamples(shapes: THREE.Shape[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const shape of shapes) {
    for (const hole of shape.extractPoints(1).holes) {
      for (let i = 0; i < hole.length; i += 1) {
        const a = hole[i]!;
        const b = hole[(i + 1) % hole.length]!;
        out.push(a);
        out.push(new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2));
      }
    }
  }
  return out;
}

/** Euclidean distance from a point to an axis-aligned rect (0 if inside). */
function distPointToRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): number {
  const dx = Math.max(Math.abs(px - cx) - hw, 0);
  const dy = Math.max(Math.abs(py - cy) - hh, 0);
  return Math.hypot(dx, dy);
}

function buildPour(p: Partial<CopperFillPourParams> = {}): THREE.Shape[] {
  return buildCopperFillPourShapes({
    layer: "F.Cu",
    outline,
    placements: [],
    traces: noTraces,
    vias: noVias,
    pourNetId: null,
    padNetIds: emptyPadNets,
    clearanceMm: 0.5,
    copperToBoardEdgeMm: 0.5,
    // Default off so geometry is predictable; specific tests opt in.
    cornerRadiusMm: 0,
    minThicknessMm: 0,
    ...p,
  });
}

describe("copper fill geometry", () => {
  test("uses a conservative zone-pour clearance floor", () => {
    expect(
      resolveCopperFillClearanceMm({
        traceToTraceMm: 0.2,
        traceToPadMm: 0.25,
        padToPadMm: 0.25,
        traceToViaMm: 0.2,
        viaToViaMm: 0.3,
        copperToBoardEdgeMm: 0.5,
      }),
    ).toBe(0.5);
    expect(
      resolveCopperFillClearanceMm({
        traceToTraceMm: 0.2,
        traceToPadMm: 0.6,
        padToPadMm: 0.25,
        traceToViaMm: 0.2,
        viaToViaMm: 0.3,
        copperToBoardEdgeMm: 0.5,
      }),
    ).toBe(0.6);
  });

  test("empty board floods to the edge-clearance inset", () => {
    const shapes = buildPour();
    expect(shapes).toHaveLength(1);
    expect(holeCount(shapes)).toBe(0);
    // 20×10 inset by 0.5 all round = 19×9 = 171 mm².
    expect(pourArea(shapes)).toBeCloseTo(171, 0);
  });

  test("different-net pad carves a clearance hole in the pour", () => {
    const shapes = buildPour({
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
    });
    expect(holeCount(shapes)).toBeGreaterThanOrEqual(1);
    expect(pourArea(shapes)).toBeLessThan(171); // pad + clearance removed
  });

  test("same-net pad merges into the pour (no clearance hole)", () => {
    const shapes = buildPour({
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
      pourNetId: "GND",
      padNetIds: new Map([["U1-pcb|1", "GND"]]),
    });
    expect(holeCount(shapes)).toBe(0);
    expect(pourArea(shapes)).toBeCloseTo(171, 0);
  });

  test("drill apertures are subtracted even for a same-net via", () => {
    const shapes = buildPour({
      vias: [via({ netId: "GND", centerMm: { x: 0, y: 0 } })],
      pourNetId: "GND",
    });
    // Via copper merges, but the plated hole must always read.
    expect(holeCount(shapes)).toBeGreaterThanOrEqual(1);
  });

  test("a disconnected island below the area limit is pruned", () => {
    // No same-net anchor → the single island must clear the area threshold.
    expect(buildPour({ minIslandAreaMm2: 1_000_000 })).toHaveLength(0);
  });

  test("an island connected to a same-net anchor survives the area limit", () => {
    const shapes = buildPour({
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
      pourNetId: "GND",
      padNetIds: new Map([["U1-pcb|1", "GND"]]),
      minIslandAreaMm2: 1_000_000,
    });
    expect(shapes.length).toBeGreaterThanOrEqual(1);
  });

  test("B.Cu placement pads participate in the B.Cu pour", () => {
    const shapes = buildPour({
      layer: "B.Cu",
      placements: [
        placement([pad("1", { x: 3, y: 0 }, 1, 1)], { layer: "B.Cu" }),
      ],
    });
    expect(holeCount(shapes)).toBeGreaterThanOrEqual(1);
  });

  test("aesthetic corner fillet trims the pour corners (clearance-safe)", () => {
    const sharp = buildPour();
    const filleted = buildPour({ cornerRadiusMm: 0.5 });
    // Rounding only removes copper at convex corners → strictly smaller.
    expect(pourArea(filleted)).toBeLessThan(pourArea(sharp));
    expect(pourArea(filleted)).toBeGreaterThan(pourArea(sharp) - 2);
  });

  test("every pour edge sample stays >= clearance from different-net copper", () => {
    const shapes = buildPour({
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
      clearanceMm: 0.5,
    });
    // Sample edge MIDPOINTS, not just vertices: the polygonal halo's chords cut
    // inside the ideal offset, so the worst under-cut is mid-edge. The kernel
    // over-clears by the arc-chord compensation, so even midpoints stay >=
    // clearance (tol = 0.1 µm grid). Without that compensation this fails.
    const samples = holeEdgeSamples(shapes);
    expect(samples.length).toBeGreaterThan(0);
    const minDist = Math.min(
      ...samples.map((v) => distPointToRect(v.x, v.y, 0, 0, 0.5, 0.5)),
    );
    expect(minDist).toBeGreaterThanOrEqual(0.5 - 0.001);
  });

  test("a board cutout keeps the pour >= copper-to-edge clearance (offset eps)", () => {
    // Roundrect cutout with radius 0 = a rect (exact straight edges, no
    // tessellation inscribe error), so only the offset's rounded corners carry
    // chord error. The edge offset over-clears by the same compensation, so even
    // corner-arc midpoints stay >= the 0.5 mm copper-to-edge clearance.
    const shapes = buildPour({
      copperToBoardEdgeMm: 0.5,
      cutouts: [
        {
          id: "cut1",
          shape: {
            kind: "roundrect",
            widthMm: 4,
            heightMm: 3,
            centerMm: { x: 0, y: 0 },
            cornerRadiusMm: 0,
          },
        },
      ],
    });
    const samples = holeEdgeSamples(shapes);
    expect(samples.length).toBeGreaterThan(0);
    // Cutout half-extents 2 × 1.5, centred at origin.
    const minDist = Math.min(
      ...samples.map((v) => distPointToRect(v.x, v.y, 0, 0, 2, 1.5)),
    );
    expect(minDist).toBeGreaterThanOrEqual(0.5 - 0.001);
  });

  test("fails CLOSED (empty), never floods, when diff-net obstacles collapse", () => {
    // Control: a real different-net via yields a poured board (with a moat).
    const ok = buildPour({ vias: [via({ netId: "OTHER" })], pourNetId: "GND" });
    expect(ok.length).toBeGreaterThan(0);
    // A degenerate (zero-extent) diff-net via is the fail-OPEN trigger class: the
    // obstacle union collapses to [] just as a Clipper throw would. The guard
    // must blank the pour, NOT flood the board un-clearanced. (Depends on Clipper
    // collapsing a zero-area ring to [] — the same behavior the kernel's
    // "degenerate ring → no shape" test relies on.)
    const shapes = buildPour({
      vias: [via({ diameterMm: 0, drillMm: 0, netId: "OTHER" })],
      pourNetId: "GND",
    });
    expect(shapes).toHaveLength(0);
  });

  test("a different-net free pad carves a clearance hole in the pour", () => {
    const shapes = buildPour({
      freePads: [freePad({ centerMm: { x: 0, y: 0 }, netId: "OTHER" })],
      pourNetId: "GND",
    });
    expect(holeCount(shapes)).toBeGreaterThanOrEqual(1);
    expect(pourArea(shapes)).toBeLessThan(171);
    const verts = holeVertices(shapes);
    const minDist = Math.min(
      ...verts.map((v) => distPointToRect(v.x, v.y, 0, 0, 0.5, 0.5)),
    );
    expect(minDist).toBeGreaterThanOrEqual(0.5 - 0.05);
  });

  test("a same-net free pad merges into the pour (no clearance hole)", () => {
    const shapes = buildPour({
      freePads: [freePad({ netId: "GND" })],
      pourNetId: "GND",
    });
    expect(holeCount(shapes)).toBe(0);
  });

  test("pad copper rotates with a 45° placement in the pour", () => {
    const shapes = buildPour({
      placements: [
        placement([pad("1", { x: 3, y: 0 }, 1, 1)], { rotationDeg: 45 }),
      ],
    });
    // Pad local (3,0) rotated 45° about the placement origin → (3/√2, 3/√2).
    const c = 3 / Math.SQRT2;
    const verts = holeVertices(shapes);
    expect(verts.length).toBeGreaterThan(0);
    const centroid = verts.reduce(
      (acc, v) => ({
        x: acc.x + v.x / verts.length,
        y: acc.y + v.y / verts.length,
      }),
      { x: 0, y: 0 },
    );
    expect(centroid.x).toBeCloseTo(c, 1);
    expect(centroid.y).toBeCloseTo(c, 1);
  });
});
