import { describe, expect, test } from "bun:test";
import { nearestRatsnestPad } from "../../../modules/designer/frontend/pcb/tools/route-target";
import type { RatsnestSegment } from "../../../sdks/designer";

function seg(
  netId: string,
  from: { pl: string; pad: string; x: number; y: number },
  to: { pl: string; pad: string; x: number; y: number },
): RatsnestSegment {
  return {
    netId,
    netClassId: "default",
    fromMm: { x: from.x, y: from.y },
    toMm: { x: to.x, y: to.y },
    from: { kind: "pad", placementId: from.pl, padNumber: from.pad },
    to: { kind: "pad", placementId: to.pl, padNumber: to.pad },
  };
}

const RATSNEST: RatsnestSegment[] = [
  seg(
    "net-a",
    { pl: "u1", pad: "1", x: 0, y: 0 },
    { pl: "u2", pad: "3", x: 10, y: 0 },
  ),
  seg(
    "net-a",
    { pl: "u2", pad: "3", x: 10, y: 0 },
    { pl: "u3", pad: "2", x: 20, y: 5 },
  ),
  seg(
    "net-b",
    { pl: "u9", pad: "1", x: 1, y: 1 },
    { pl: "u9", pad: "2", x: 2, y: 2 },
  ),
];

describe("nearestRatsnestPad", () => {
  test("returns the closest pad on the requested net only", () => {
    const hit = nearestRatsnestPad({
      ratsnest: RATSNEST,
      netId: "net-a",
      fromMm: { x: 2, y: 0 },
    });
    // u9 pads (net-b) are closer to (2,0) than u1|1 but on another net.
    expect(hit).toEqual({ padId: "u1|1", centerMm: { x: 0, y: 0 } });
  });

  test("excluded pads are skipped", () => {
    const hit = nearestRatsnestPad({
      ratsnest: RATSNEST,
      netId: "net-a",
      fromMm: { x: 2, y: 0 },
      excludePadIds: new Set(["u1|1"]),
    });
    expect(hit?.padId).toBe("u2|3");
  });

  test("pads appearing in multiple segments are deduplicated", () => {
    const hit = nearestRatsnestPad({
      ratsnest: RATSNEST,
      netId: "net-a",
      fromMm: { x: 10, y: 0.5 },
    });
    expect(hit?.padId).toBe("u2|3");
  });

  test("equidistant pads tie-break on pad id", () => {
    const ratsnest = [
      seg(
        "net-a",
        { pl: "b", pad: "1", x: -5, y: 0 },
        { pl: "a", pad: "1", x: 5, y: 0 },
      ),
    ];
    const hit = nearestRatsnestPad({
      ratsnest,
      netId: "net-a",
      fromMm: { x: 0, y: 0 },
    });
    expect(hit?.padId).toBe("a|1");
  });

  test("a free-pad endpoint keys as freepad:<id>", () => {
    const ratsnest: RatsnestSegment[] = [
      {
        netId: "net-c",
        netClassId: "default",
        fromMm: { x: 0, y: 0 },
        toMm: { x: 10, y: 0 },
        from: { kind: "freePad", freePadId: "tp1" },
        to: { kind: "pad", placementId: "u1", padNumber: "1" },
      },
    ];
    const hit = nearestRatsnestPad({
      ratsnest,
      netId: "net-c",
      fromMm: { x: 1, y: 0 },
    });
    expect(hit).toEqual({ padId: "freepad:tp1", centerMm: { x: 0, y: 0 } });
  });

  test("no pads on net or all excluded yields null", () => {
    expect(
      nearestRatsnestPad({
        ratsnest: RATSNEST,
        netId: "net-z",
        fromMm: { x: 0, y: 0 },
      }),
    ).toBeNull();
    expect(
      nearestRatsnestPad({
        ratsnest: RATSNEST,
        netId: "net-b",
        fromMm: { x: 0, y: 0 },
        excludePadIds: new Set(["u9|1", "u9|2"]),
      }),
    ).toBeNull();
  });
});
