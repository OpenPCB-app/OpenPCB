import { describe, expect, test } from "bun:test";
import { planCandidatePlacements } from "../../../modules/designer/backend/pcb/autolayout-candidate-plan";
import type { PcbPlacedPart } from "../../../sdks/designer";

const part = (id: string): PcbPlacedPart =>
  ({
    id,
    partId: `part-${id}`,
    componentId: "cmp",
    reference: id,
    positionMm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {},
  }) as unknown as PcbPlacedPart;

describe("planCandidatePlacements rounding", () => {
  test("move keeps sub-um and negative coordinates at integer nm", () => {
    const result = planCandidatePlacements(
      [
        {
          kind: "pcb_move_placement",
          op: {
            type: "pcb_move_placement",
            placementId: "U1",
            positionMm: { x: -12.3456784, y: 0.0004567 },
          },
        },
      ],
      (id) => (id === "U1" ? part(id) : null),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements[0]!.positionMm).toEqual({
      x: -12.345678,
      y: 0.000457,
    });
  });
});
