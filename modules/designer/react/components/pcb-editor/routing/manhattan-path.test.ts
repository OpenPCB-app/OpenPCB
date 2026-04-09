import { describe, expect, it } from "vitest";
import { calculateManhattanPath, snapPointToGrid } from "./manhattan-path";

describe("calculateManhattanPath", () => {
  it("returns no segments for identical points", () => {
    expect(
      calculateManhattanPath(
        { x: 1, y: 2 },
        { x: 1, y: 2 },
        "horizontal_first",
        0.25,
        "F.Cu",
        "net-1",
      ),
    ).toEqual([]);
  });

  it("returns one segment for straight routes", () => {
    expect(
      calculateManhattanPath(
        { x: 10, y: 5 },
        { x: 25, y: 5 },
        "horizontal_first",
        0.3,
        "B.Cu",
        "net-1",
      ),
    ).toEqual([
      {
        id: "",
        start: { x: 10, y: 5 },
        end: { x: 25, y: 5 },
        width: 0.3,
        layer: "B.Cu",
        net: "net-1",
      },
    ]);
  });

  it("routes horizontal-first diagonals through the horizontal elbow", () => {
    expect(
      calculateManhattanPath(
        { x: 10, y: 20 },
        { x: 40, y: 60 },
        "horizontal_first",
        0.25,
        "F.Cu",
        "net-1",
      ),
    ).toEqual([
      {
        id: "",
        start: { x: 10, y: 20 },
        end: { x: 40, y: 20 },
        width: 0.25,
        layer: "F.Cu",
        net: "net-1",
      },
      {
        id: "",
        start: { x: 40, y: 20 },
        end: { x: 40, y: 60 },
        width: 0.25,
        layer: "F.Cu",
        net: "net-1",
      },
    ]);
  });

  it("routes vertical-first diagonals through the vertical elbow", () => {
    expect(
      calculateManhattanPath(
        { x: 10, y: 20 },
        { x: 40, y: 60 },
        "vertical_first",
        0.25,
        "F.Cu",
        "net-1",
      ),
    ).toEqual([
      {
        id: "",
        start: { x: 10, y: 20 },
        end: { x: 10, y: 60 },
        width: 0.25,
        layer: "F.Cu",
        net: "net-1",
      },
      {
        id: "",
        start: { x: 10, y: 60 },
        end: { x: 40, y: 60 },
        width: 0.25,
        layer: "F.Cu",
        net: "net-1",
      },
    ]);
  });
});

describe("snapPointToGrid", () => {
  it("snaps to the nearest grid intersection", () => {
    expect(snapPointToGrid({ x: 10.24, y: 19.74 }, 0.5)).toEqual({
      x: 10,
      y: 19.5,
    });
  });
});
