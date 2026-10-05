import { buildManhattanPathThroughAnchors } from "../../../../shared/schematic-routing/manhattan";
import { expect, it } from "vitest";
import { duplicateSchematicPositionNm, snapWireWaypointNm } from "./grid";

it("duplication uses the selected policy without rewriting the source", () => {
  const point = { x: -11_160_000, y: -3_305_000 };
  expect(duplicateSchematicPositionNm(point, true)).toEqual({
    x: -8_890_000,
    y: -1_270_000,
  });
  expect(duplicateSchematicPositionNm(point, false)).toEqual({
    x: -8_620_000,
    y: -765_000,
  });
  expect(point).toEqual({ x: -11_160_000, y: -3_305_000 });
});

it("absorbs a sub-pixel corner jog without moving an off-grid pin", () => {
  const source = { x: -11_160_000, y: -3_305_000 };
  const cursor = { x: -15_114_000, y: -3_327_700 };
  for (const zoom of [9, 40, 100]) {
    for (const grid of [0, 1_270_000]) {
      const corner = snapWireWaypointNm(cursor, source, grid, zoom);
      const target = { x: corner.x, y: -722_000 };
      expect(
        buildManhattanPathThroughAnchors([source, corner, target]),
      ).toEqual([source, { x: corner.x, y: source.y }, target]);
    }
  }
  expect(source).toEqual({ x: -11_160_000, y: -3_305_000 });
});
it("keeps intentional free-placement offsets outside gesture tolerance", () => {
  expect(
    snapWireWaypointNm(
      { x: -15_114_000, y: -3_405_000 },
      { x: -11_160_000, y: -3_305_000 },
      0,
      9,
    ),
  ).toEqual({ x: -15_114_000, y: -3_405_000 });
});
