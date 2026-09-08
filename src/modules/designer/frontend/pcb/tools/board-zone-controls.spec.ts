import { describe, expect, test } from "vitest";
import type { PcbZone } from "../../../../../sdks";
import {
  boardZoneForLayer,
  boardZoneToggleAction,
  hasEnabledBoardZone,
} from "./board-zone-controls";

function boardZone(overrides: Partial<PcbZone> = {}): PcbZone {
  return {
    id: "board:F.Cu",
    name: null,
    enabled: true,
    lockedAt: null,
    layer: "F.Cu",
    netId: null,
    netName: null,
    region: { kind: "board" },
    priority: 0,
    ...overrides,
  };
}

function polygonZone(overrides: Partial<PcbZone> = {}): PcbZone {
  return {
    id: "zone-1",
    name: null,
    enabled: true,
    lockedAt: null,
    layer: "F.Cu",
    netId: null,
    netName: null,
    region: {
      kind: "polygon",
      pointsMm: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    },
    priority: 0,
    ...overrides,
  };
}

describe("boardZoneForLayer", () => {
  test("finds the board-region row for the layer", () => {
    const zones = [boardZone(), polygonZone()];
    expect(boardZoneForLayer(zones, "F.Cu")).toBe(zones[0]);
  });

  test("ignores a board row on a different layer", () => {
    const zones = [boardZone({ id: "board:B.Cu", layer: "B.Cu" })];
    expect(boardZoneForLayer(zones, "F.Cu")).toBeNull();
  });

  test("ignores a polygon zone", () => {
    expect(boardZoneForLayer([polygonZone()], "F.Cu")).toBeNull();
  });
});

describe("boardZoneToggleAction", () => {
  test("adds a board zone when none exists", () => {
    expect(boardZoneToggleAction([], "F.Cu")).toEqual({
      kind: "add",
      layer: "F.Cu",
    });
  });

  test("updates enabled=false → true", () => {
    const row = boardZone({ enabled: false });
    expect(boardZoneToggleAction([row], "F.Cu")).toEqual({
      kind: "update",
      zoneId: "board:F.Cu",
      enabled: true,
    });
  });

  test("updates enabled=true → false", () => {
    const row = boardZone({ enabled: true });
    expect(boardZoneToggleAction([row], "F.Cu")).toEqual({
      kind: "update",
      zoneId: "board:F.Cu",
      enabled: false,
    });
  });
});

describe("hasEnabledBoardZone", () => {
  test("true when some board zone is enabled", () => {
    expect(hasEnabledBoardZone([boardZone({ enabled: true })])).toBe(true);
  });

  test("false when every board zone is disabled or absent", () => {
    expect(hasEnabledBoardZone([boardZone({ enabled: false })])).toBe(false);
    expect(hasEnabledBoardZone([polygonZone()])).toBe(false);
    expect(hasEnabledBoardZone([])).toBe(false);
  });
});
