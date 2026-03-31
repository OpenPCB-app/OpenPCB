import { describe, expect, it } from "vitest";
import {
  SCHEMATIC_ROUND_TRIP_TOLERANCE_NM,
  canvasToScreen,
  domEventToScreen,
  isWithinRoundTripTolerance,
  mmToNm,
  nmToMm,
  schematicToScreen,
  screenToSchematic,
  snapToGrid,
} from "./viewport";
import type { Viewport } from "../types";

describe("viewport transforms", () => {
  const viewports: Viewport[] = [
    { offsetX: 0, offsetY: 0, zoom: 1 },
    { offsetX: 320.5, offsetY: -145.25, zoom: 0.75 },
    { offsetX: -1200, offsetY: 888, zoom: 2.4 },
  ];

  const worldPoints = [
    { x: 0, y: 0 },
    { x: 1_270_000, y: -635_000 },
    { x: -6_350_000.125, y: 9_000_000.75 },
  ];

  it("round-trips schematic -> screen -> schematic within tolerance", () => {
    for (const viewport of viewports) {
      for (const point of worldPoints) {
        const screen = schematicToScreen(point.x, point.y, viewport);
        const roundTrip = screenToSchematic(screen.x, screen.y, viewport);

        expect(
          isWithinRoundTripTolerance(
            roundTrip,
            point,
            SCHEMATIC_ROUND_TRIP_TOLERANCE_NM,
          ),
        ).toBe(true);
      }
    }
  });

  it("converts dom pointer coordinates to screen coordinates", () => {
    const point = domEventToScreen(455.25, 310.75, { left: 400.25, top: 100.5 });
    expect(point).toEqual({ x: 55, y: 210.25 });
    expect(canvasToScreen(point.x, point.y)).toEqual(point);
  });

  it("snaps world nanometer values to 50mil grid", () => {
    const fiftyMilNm = 1_270_000;
    const snapped = snapToGrid({ x: 1_500_000, y: 2_000_000 }, fiftyMilNm);
    expect(snapped).toEqual({ x: 1_270_000, y: 2_540_000 });
  });

  it("converts millimeters and nanometers consistently", () => {
    expect(mmToNm(1.27)).toBe(1_270_000);
    expect(nmToMm(1_270_000)).toBe(1.27);
  });

  it("throws on invalid zoom and invalid grid size", () => {
    expect(() => screenToSchematic(1, 1, { offsetX: 0, offsetY: 0, zoom: 0 })).toThrow(
      /zoom/,
    );
    expect(() => schematicToScreen(1, 1, { offsetX: 0, offsetY: 0, zoom: -1 })).toThrow(
      /zoom/,
    );
    expect(() => snapToGrid({ x: 0, y: 0 }, 0)).toThrow(/gridSize/);
  });
});
