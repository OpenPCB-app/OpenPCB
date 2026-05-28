import { describe, expect, it } from "vitest";
import { formatBoardCoord, formatBoardPoint } from "./coords";

describe("formatBoardCoord", () => {
  it("converts nm to mm with 2 decimals", () => {
    expect(formatBoardCoord(48_000_000)).toBe("48.00");
    expect(formatBoardCoord(5_500_000)).toBe("5.50");
  });

  it("suppresses -0.00 and near-zero", () => {
    expect(formatBoardCoord(0)).toBe("0.00");
    expect(formatBoardCoord(-1_000)).toBe("0.00");
  });

  it("handles negative coordinates", () => {
    expect(formatBoardCoord(-12_340_000)).toBe("-12.34");
  });
});

describe("formatBoardPoint", () => {
  it("formats a point with mm suffix", () => {
    expect(formatBoardPoint({ x: 42_500_000, y: 5_000_000 })).toBe(
      "42.50 · 5.00 mm",
    );
  });
});
