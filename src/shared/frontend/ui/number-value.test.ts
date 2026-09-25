import { describe, expect, it } from "vitest";
import {
  clampNumber,
  formatNumberValue,
  parseNumberDraft,
  roundTo,
  stepNumber,
} from "./number-value";

describe("parseNumberDraft", () => {
  it("accepts zero and negatives (T-157 class)", () => {
    expect(parseNumberDraft("0")).toEqual({ kind: "value", value: 0 });
    expect(parseNumberDraft("-0")).toEqual({ kind: "value", value: 0 });
    expect(parseNumberDraft("-2.5")).toEqual({ kind: "value", value: -2.5 });
    expect(parseNumberDraft("−3")).toEqual({ kind: "value", value: -3 });
  });

  it("keeps a trailing decimal point parseable while typing (Q5-002)", () => {
    expect(parseNumberDraft("5.")).toEqual({ kind: "value", value: 5 });
    expect(parseNumberDraft(".5")).toEqual({ kind: "value", value: 0.5 });
  });

  it("accepts a locale comma and grouping separators", () => {
    expect(parseNumberDraft("1,5")).toEqual({ kind: "value", value: 1.5 });
    expect(parseNumberDraft("1,234.5")).toEqual({ kind: "value", value: 1234.5 });
    expect(parseNumberDraft("1.234,5")).toEqual({ kind: "value", value: 1234.5 });
    expect(parseNumberDraft("1,2,3")).toEqual({ kind: "invalid", reason: "syntax" });
  });

  it("strips whitespace and a typed unit", () => {
    expect(parseNumberDraft(" 0.2 mm ", { unit: "mm" })).toEqual({ kind: "value", value: 0.2 });
    expect(parseNumberDraft("0.2MM", { unit: "mm" })).toEqual({ kind: "value", value: 0.2 });
  });

  it("reports empty, syntax errors and disallowed negatives", () => {
    expect(parseNumberDraft("   ")).toEqual({ kind: "empty" });
    expect(parseNumberDraft("abc")).toEqual({ kind: "invalid", reason: "syntax" });
    expect(parseNumberDraft("1.2.3")).toEqual({ kind: "invalid", reason: "syntax" });
    expect(parseNumberDraft("-")).toEqual({ kind: "invalid", reason: "syntax" });
    expect(parseNumberDraft("-1", { allowNegative: false })).toEqual({
      kind: "invalid",
      reason: "negative",
    });
    expect(parseNumberDraft("0", { allowNegative: false })).toEqual({ kind: "value", value: 0 });
  });
});

describe("clampNumber / roundTo", () => {
  it("clamps to min/max and rounds to precision", () => {
    expect(clampNumber(5, { min: 0, max: 3 })).toBe(3);
    expect(clampNumber(-1, { min: 0 })).toBe(0);
    expect(clampNumber(0.123456, { precision: 3 })).toBe(0.123);
    expect(clampNumber(0, { min: 0, max: 10 })).toBe(0);
  });

  it("removes float noise and negative zero", () => {
    expect(roundTo(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(roundTo(-0.0001, 2), -0)).toBe(false);
  });
});

describe("stepNumber", () => {
  it("steps by step, ×10 with large, without float noise", () => {
    expect(stepNumber(0.1, 1, { step: 0.1 })).toBe(0.2);
    expect(stepNumber(0.2, 1, { step: 0.1 })).toBe(0.3);
    expect(stepNumber(1, -1, { step: 0.5, large: true })).toBe(-4);
    expect(stepNumber(0, -1, { step: 1, min: 0 })).toBe(0);
  });
});

describe("formatNumberValue", () => {
  it("formats null as empty and keeps zero", () => {
    expect(formatNumberValue(null)).toBe("");
    expect(formatNumberValue(0)).toBe("0");
    expect(formatNumberValue(0.25, 1)).toBe("0.3");
    expect(formatNumberValue(1.5)).toBe("1.5");
  });
});
