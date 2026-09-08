import { describe, expect, test } from "vitest";
import type { PcbPointMm, PcbZone } from "../../../../../sdks";
import {
  zoneGhostSegments,
  zoneOutlineRings,
  zoneRingSegments,
} from "./ZoneOutlineLayer";

const SQUARE: PcbPointMm[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** `[ax, ay, bx, by]` per emitted segment. */
function segments(buffer: Float32Array | null): number[][] {
  if (!buffer) return [];
  const out: number[][] = [];
  for (let i = 0; i < buffer.length; i += 6) {
    out.push([buffer[i]!, buffer[i + 1]!, buffer[i + 3]!, buffer[i + 4]!]);
  }
  return out;
}

describe("zoneRingSegments", () => {
  test("closes the ring back to the first vertex", () => {
    const segs = segments(zoneRingSegments(SQUARE));
    expect(segs).toHaveLength(4);
    expect(segs[0]).toEqual([0, 0, 10, 0]);
    expect(segs[3]).toEqual([0, 10, 0, 0]);
  });

  test("returns null below three vertices", () => {
    expect(
      zoneRingSegments([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });

  test("returns null for a non-finite vertex", () => {
    expect(zoneRingSegments([...SQUARE, { x: NaN, y: 0 }])).toBeNull();
  });
});

describe("zoneGhostSegments", () => {
  test("emits dash segments no longer than dashMm", () => {
    const dashMm = 0.6;
    for (const [ax, ay, bx, by] of segments(
      zoneGhostSegments(SQUARE, dashMm, 0.4),
    )) {
      const len = Math.hypot(bx! - ax!, by! - ay!);
      // Float32Array storage introduces ~1e-7 relative rounding.
      expect(len).toBeLessThanOrEqual(dashMm + 1e-5);
    }
  });

  test("spaces dashes by dash + gap along an edge", () => {
    const dashMm = 1;
    const gapMm = 1;
    const segs = segments(zoneGhostSegments(SQUARE, dashMm, gapMm));
    // Bottom edge (y = 0): dash starts should land on multiples of dash+gap.
    const bottomStarts = segs
      .filter(([, ay, , by]) => ay === 0 && by === 0)
      .map(([ax]) => ax!)
      .sort((a, b) => a - b);
    expect(bottomStarts.length).toBeGreaterThan(0);
    for (const start of bottomStarts) {
      // Float32Array storage introduces ~1e-6 rounding.
      expect(start % (dashMm + gapMm)).toBeCloseTo(0, 4);
    }
  });

  test("stays within the ring's bounding box", () => {
    for (const [ax, ay, bx, by] of segments(
      zoneGhostSegments(SQUARE, 0.6, 0.4),
    )) {
      for (const v of [ax!, ay!, bx!, by!]) {
        expect(v).toBeGreaterThanOrEqual(-1e-4);
        expect(v).toBeLessThanOrEqual(10 + 1e-4);
      }
    }
  });

  test("returns null below three vertices or a non-positive dash", () => {
    expect(
      zoneGhostSegments(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        0.6,
        0.4,
      ),
    ).toBeNull();
    expect(zoneGhostSegments(SQUARE, 0, 0.4)).toBeNull();
  });

  test("returns null for a non-finite vertex", () => {
    expect(zoneGhostSegments([...SQUARE, { x: 0, y: NaN }])).toBeNull();
  });
});

/**
 * Cutout rings are drawn exactly like the outer ring (copper-pour contract
 * §11): `ZoneOutlineLayer` maps this list, so what it returns is what is drawn.
 */
describe("zoneOutlineRings", () => {
  const HOLE: PcbPointMm[] = [
    { x: 3, y: 3 },
    { x: 7, y: 3 },
    { x: 7, y: 7 },
    { x: 3, y: 7 },
  ];

  function zone(region: PcbZone["region"]): PcbZone {
    return {
      id: "z1",
      name: null,
      enabled: true,
      lockedAt: null,
      layer: "F.Cu",
      netId: null,
      netName: null,
      region,
      priority: 0,
    };
  }

  test("a hole-less polygon draws exactly one ring", () => {
    expect(
      zoneOutlineRings(zone({ kind: "polygon", pointsMm: SQUARE })),
    ).toEqual([SQUARE]);
  });

  test("a cutout is drawn after the outer ring", () => {
    expect(
      zoneOutlineRings(
        zone({ kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] }),
      ),
    ).toEqual([SQUARE, HOLE]);
  });

  test("a cutout ring produces its own closed segment buffer", () => {
    expect(segments(zoneRingSegments(HOLE))).toHaveLength(4);
    expect(segments(zoneGhostSegments(HOLE)).length).toBeGreaterThan(0);
  });

  test("a board zone draws nothing", () => {
    expect(zoneOutlineRings(zone({ kind: "board" }))).toEqual([]);
  });
});
