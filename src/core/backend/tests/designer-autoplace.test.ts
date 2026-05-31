import { describe, expect, test } from "bun:test";
import { partBodyExtentNm } from "../../../modules/designer/backend/layout/body-extent";
import {
  autoplaceSchematic,
  classifyPartForLayout,
  compareRef,
  type AutoplaceNet,
  type AutoplacePart,
} from "../../../modules/designer/backend/layout/schematic-autoplace";
import type { DesignerPlacedPart } from "../../../sdks/designer/types";

const GRID = 2_000_000;
const MM = 1_000_000;

function part(
  ref: string,
  role: AutoplacePart["role"],
  pinCount: number,
  halfWmm = 2,
  halfHmm = 2,
): AutoplacePart {
  return {
    partId: `id-${ref}`,
    reference: ref,
    role,
    pinCount,
    extent: { halfW: halfWmm * MM, halfH: halfHmm * MM },
  };
}

function net(
  netId: string,
  name: string,
  refs: string[],
  isPower = false,
): AutoplaceNet {
  return { netId, name, isPower, partIds: refs.map((r) => `id-${r}`) };
}

function assertSnapped(result: ReturnType<typeof autoplaceSchematic>): void {
  for (const pos of result.positions.values()) {
    expect(pos.x % GRID).toBe(0);
    expect(pos.y % GRID).toBe(0);
  }
}

/** Strict body-AABB overlap (no padding) — the hard no-overlap invariant. */
function assertNoOverlap(
  parts: AutoplacePart[],
  result: ReturnType<typeof autoplaceSchematic>,
): void {
  const boxes = parts.map((p) => {
    const pos = result.positions.get(p.partId)!;
    return {
      ref: p.reference,
      minX: pos.x - p.extent.halfW,
      minY: pos.y - p.extent.halfH,
      maxX: pos.x + p.extent.halfW,
      maxY: pos.y + p.extent.halfH,
    };
  });
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap =
        a.minX < b.maxX &&
        a.maxX > b.minX &&
        a.minY < b.maxY &&
        a.maxY > b.minY;
      expect(overlap, `${a.ref} overlaps ${b.ref}`).toBe(false);
    }
  }
}

function dist(
  result: ReturnType<typeof autoplaceSchematic>,
  a: string,
  b: string,
): number {
  const pa = result.positions.get(`id-${a}`)!;
  const pb = result.positions.get(`id-${b}`)!;
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
}

describe("compareRef", () => {
  test("natural numeric order", () => {
    expect(compareRef("C2", "C10")).toBeLessThan(0);
    expect(compareRef("C9", "R1")).toBeLessThan(0);
    expect(compareRef("U1", "U1")).toBe(0);
  });
});

describe("classifyPartForLayout", () => {
  test("roles by prefix + pin count", () => {
    expect(classifyPartForLayout("U1", 8)).toBe("anchor");
    expect(classifyPartForLayout("J1", 4)).toBe("connector");
    expect(classifyPartForLayout("R1", 2)).toBe("passive");
    expect(classifyPartForLayout("Q1", 3)).toBe("anchor");
  });
});

describe("partBodyExtentNm", () => {
  function fakePart(
    boundsMm: { minX: number; minY: number; maxX: number; maxY: number } | null,
    rotationDeg = 0,
    pins: Array<{ x: number; y: number }> = [],
  ): DesignerPlacedPart {
    return {
      symbol: { preview: { bounds: boundsMm } },
      rotationDeg,
      pins: pins.map((p) => ({ localPositionNm: p })),
    } as unknown as DesignerPlacedPart;
  }

  test("decimal mm → exact nm half-extent (above grid floor)", () => {
    const e = partBodyExtentNm(
      fakePart({ minX: -2.54, minY: -3.81, maxX: 2.54, maxY: 3.81 }),
    );
    expect(e.halfW).toBe(2_540_000);
    expect(e.halfH).toBe(3_810_000);
  });

  test("90° rotation swaps axes", () => {
    const e = partBodyExtentNm(
      fakePart({ minX: -10, minY: -3, maxX: 10, maxY: 3 }, 90),
    );
    expect(e.halfW).toBe(3_000_000);
    expect(e.halfH).toBe(10_000_000);
  });

  test("null bounds falls back to pin AABB with grid minimum", () => {
    const e = partBodyExtentNm(
      fakePart(null, 0, [
        { x: 0, y: 0 },
        { x: 5_000_000, y: 0 },
      ]),
    );
    expect(e.halfW).toBe(5_000_000);
    expect(e.halfH).toBe(GRID); // min one grid step
  });
});

describe("autoplaceSchematic", () => {
  test("empty input yields no positions", () => {
    expect(autoplaceSchematic({ parts: [], nets: [] }).positions.size).toBe(0);
  });

  test("single part is placed and grid-snapped", () => {
    const parts = [part("U1", "anchor", 8, 5, 5)];
    const result = autoplaceSchematic({ parts, nets: [] });
    expect(result.positions.size).toBe(1);
    assertSnapped(result);
  });

  test("two connected parts cluster close and do not overlap", () => {
    const parts = [part("U1", "anchor", 4), part("R1", "passive", 2)];
    const nets = [net("n1", "SIG", ["U1", "R1"])];
    const result = autoplaceSchematic({ parts, nets });
    assertNoOverlap(parts, result);
    assertSnapped(result);
    // Connected pair sits within a couple of cells of each other.
    expect(dist(result, "U1", "R1")).toBeLessThan(60 * MM);
  });

  test("power-only parts are not collapsed into one cluster", () => {
    const parts = [part("C1", "passive", 2), part("C2", "passive", 2)];
    const nets = [
      net("nv", "VCC", ["C1", "C2"], true),
      net("ng", "GND", ["C1", "C2"], true),
    ];
    const result = autoplaceSchematic({ parts, nets });
    assertNoOverlap(parts, result);
    expect(dist(result, "C1", "C2")).toBeGreaterThan(0);
  });

  test("star topology: 1 IC + 13 passives, no overlaps, snapped", () => {
    const parts = [part("U1", "anchor", 14)];
    const nets: AutoplaceNet[] = [];
    for (let i = 1; i <= 13; i += 1) {
      parts.push(part(`R${i}`, "passive", 2));
      nets.push(net(`n${i}`, `S${i}`, ["U1", `R${i}`]));
    }
    const result = autoplaceSchematic({ parts, nets });
    expect(result.positions.size).toBe(14);
    assertNoOverlap(parts, result);
    assertSnapped(result);
  });

  test("high-fanout (>HUB_THRESHOLD) net is skipped for clustering", () => {
    const refs = ["U1", "U2", "U3", "J1", "R1", "R2", "R3", "R4"]; // 8 members
    const parts = refs.map((r) =>
      part(
        r,
        classifyPartForLayout(r, r.startsWith("U") ? 8 : 2),
        r.startsWith("U") ? 8 : 2,
      ),
    );
    const nets = [net("bus", "RESET", refs)];
    const result = autoplaceSchematic({ parts, nets });
    assertNoOverlap(parts, result);
    assertSnapped(result);
  });

  test("wide connector does not cause overlap", () => {
    const parts = [
      part("J1", "connector", 2, 20, 3), // 40mm wide
      part("R1", "passive", 2, 2, 2),
      part("R2", "passive", 2, 2, 2),
      part("U1", "anchor", 4, 5, 5),
    ];
    const nets = [
      net("n1", "A", ["J1", "U1"]),
      net("n2", "B", ["U1", "R1"]),
      net("n3", "C", ["U1", "R2"]),
    ];
    const result = autoplaceSchematic({ parts, nets });
    assertNoOverlap(parts, result);
    assertSnapped(result);
  });

  test("multiple clusters stacked do not overlap", () => {
    const parts = [
      part("U1", "anchor", 6),
      part("R1", "passive", 2),
      part("R2", "passive", 2),
      part("U2", "anchor", 6),
      part("C1", "passive", 2),
    ];
    const nets = [
      net("a1", "A", ["U1", "R1"]),
      net("a2", "B", ["U1", "R2"]),
      net("b1", "C", ["U2", "C1"]),
    ];
    const result = autoplaceSchematic({ parts, nets });
    assertNoOverlap(parts, result);
  });

  test("deterministic under shuffled parts + nets", () => {
    const parts = [
      part("U1", "anchor", 8, 5, 5),
      part("R1", "passive", 2),
      part("R2", "passive", 2),
      part("C1", "passive", 2),
      part("D1", "passive", 2),
      part("J1", "connector", 2, 6, 3),
    ];
    const nets = [
      net("n1", "OUT", ["U1", "R1"]),
      net("n2", "IN", ["U1", "R2"]),
      net("n3", "SIG", ["R1", "D1"]),
      net("nv", "VCC", ["U1", "C1"], true),
      net("ng", "GND", ["U1", "C1", "J1"], true),
    ];
    const a = autoplaceSchematic({ parts, nets });
    const b = autoplaceSchematic({
      parts: [...parts].reverse(),
      nets: [...nets].reverse(),
    });
    expect(a.positions.size).toBe(b.positions.size);
    for (const [id, pos] of a.positions) {
      expect(b.positions.get(id)).toEqual(pos);
    }
  });
});
