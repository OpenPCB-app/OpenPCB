import { describe, expect, test } from "vitest";
import { SCHEMATIC_GRID_MM, SCHEMATIC_GRID_NM } from "@modules/designer/frontend/types";

describe("schematic grid constants", () => {
  test("grid mm and nm are consistent", () => {
    expect(SCHEMATIC_GRID_NM).toBe(SCHEMATIC_GRID_MM * 1_000_000);
  });

  test("grid mm is 0.5", () => {
    expect(SCHEMATIC_GRID_MM).toBe(0.5);
  });
});
