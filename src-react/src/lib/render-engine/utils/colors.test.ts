import { describe, expect, it } from "vitest";
import { DEFAULT_NORMALIZED_RGB, parseShaderColor } from "./colors";

describe("parseShaderColor", () => {
  it("parses 6-digit hex colors", () => {
    expect(parseShaderColor("#8040ff")).toEqual([128 / 255, 64 / 255, 1]);
  });

  it("parses 3-digit hex colors", () => {
    expect(parseShaderColor("#0f8")).toEqual([0, 1, 136 / 255]);
  });

  it("parses rgb() colors", () => {
    expect(parseShaderColor("rgb(12, 34, 56)")).toEqual([
      12 / 255,
      34 / 255,
      56 / 255,
    ]);
  });

  it("parses rgba() colors and ignores alpha for shaders", () => {
    expect(parseShaderColor("rgba(255, 128, 0, 0.25)")).toEqual([
      1,
      128 / 255,
      0,
    ]);
  });

  it("uses the provided fallback for invalid formats", () => {
    expect(parseShaderColor("not-a-color", [0.1, 0.2, 0.3])).toEqual([
      0.1, 0.2, 0.3,
    ]);
  });

  it("falls back to the default shader color", () => {
    expect(parseShaderColor("hsl(0, 0%, 0%)")).toEqual(DEFAULT_NORMALIZED_RGB);
  });
});
