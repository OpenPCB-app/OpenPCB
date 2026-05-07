import { describe, expect, test } from "bun:test";
import { computeRatsnest } from "../../../modules/designer/backend/pcb/ratsnest";
import type { NetPadCorrelation } from "../../../modules/designer/backend/pcb/net-pad-correlation";
import type { PcbNetClass } from "../../../sdks/designer";

const NET_CLASSES: PcbNetClass[] = [
  {
    id: "default",
    name: "Default",
    traceWidthMm: 0.25,
    clearanceMm: 0.2,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#e5e7eb",
  },
];

const ctx = { netNames: new Map<string, string>(), netClasses: NET_CLASSES };

describe("computeRatsnest", () => {
  test("returns empty for net with <2 pads", () => {
    const correlation: NetPadCorrelation = {
      netPads: new Map([
        [
          "net1",
          [{ placementId: "p1", padNumber: "1", worldMm: { x: 0, y: 0 } }],
        ],
      ]),
      warnings: [],
    };
    expect(computeRatsnest(correlation, ctx)).toEqual([]);
  });

  test("MST of triangle picks 2 shortest edges", () => {
    // Triangle: A(0,0) — B(3,0) — C(0,4)
    // Edges: A-B=3, A-C=4, B-C=5  → MST should pick A-B and A-C
    const correlation: NetPadCorrelation = {
      netPads: new Map([
        [
          "n1",
          [
            { placementId: "A", padNumber: "1", worldMm: { x: 0, y: 0 } },
            { placementId: "B", padNumber: "1", worldMm: { x: 3, y: 0 } },
            { placementId: "C", padNumber: "1", worldMm: { x: 0, y: 4 } },
          ],
        ],
      ]),
      warnings: [],
    };
    const segments = computeRatsnest(correlation, ctx);
    expect(segments).toHaveLength(2);
    const placements = segments
      .map((s) => `${s.fromMm.x},${s.fromMm.y}->${s.toMm.x},${s.toMm.y}`)
      .sort();
    // First MST edge: A->B (closest to seed A)
    // Second MST edge: A->C (next closest to {A,B})
    expect(placements).toContain("0,0->3,0");
    expect(placements).toContain("0,0->0,4");
  });

  test("two separate nets produce independent MSTs", () => {
    const correlation: NetPadCorrelation = {
      netPads: new Map([
        [
          "vcc",
          [
            { placementId: "A", padNumber: "1", worldMm: { x: 0, y: 0 } },
            { placementId: "B", padNumber: "1", worldMm: { x: 1, y: 0 } },
          ],
        ],
        [
          "gnd",
          [
            { placementId: "A", padNumber: "2", worldMm: { x: 0, y: 5 } },
            { placementId: "B", padNumber: "2", worldMm: { x: 1, y: 5 } },
            { placementId: "C", padNumber: "2", worldMm: { x: 2, y: 5 } },
          ],
        ],
      ]),
      warnings: [],
    };
    const segments = computeRatsnest(correlation, ctx);
    // 1 segment for vcc + 2 segments for gnd = 3
    expect(segments).toHaveLength(3);
    expect(segments.filter((s) => s.netId === "vcc")).toHaveLength(1);
    expect(segments.filter((s) => s.netId === "gnd")).toHaveLength(2);
  });
});
