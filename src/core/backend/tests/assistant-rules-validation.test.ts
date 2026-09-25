import { describe, expect, test } from "bun:test";
import {
  applyNetClassPatches,
  clearanceProblems,
  uniqueId,
} from "../../../modules/assistant/backend/tools/rules-validation";
import type { PcbNetClass } from "../../../sdks";

const base = (over: Partial<PcbNetClass>): PcbNetClass =>
  ({
    id: "default",
    name: "Default",
    traceWidthMm: 0.25,
    clearanceMm: 0.2,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#888",
    defaultViaProtection: "none",
    ...over,
  }) as PcbNetClass;

describe("net class patches", () => {
  test("a new class never takes an id another class already has", () => {
    const existing = [base({}), base({ id: "high-speed", name: "HS" })];
    const out = applyNetClassPatches(existing, [
      { name: "High Speed", traceWidthMm: 0.2, clearanceMm: 0.2, viaDiameterMm: 0.6, viaDrillMm: 0.3 },
    ]);
    expect(out.problems).toEqual([]);
    expect(out.classes.map((c) => c.id)).toEqual(["default", "high-speed", "high-speed-2"]);
  });

  test("new classes copy presentation, not another class's electrical metadata", () => {
    const existing = [base({ voltageV: 48, currentA: 3, diffPairGapMm: 0.1 })];
    const out = applyNetClassPatches(existing, [
      { name: "Signal", traceWidthMm: 0.2, clearanceMm: 0.2, viaDiameterMm: 0.6, viaDrillMm: 0.3 },
    ]);
    const created = out.classes[1]!;
    expect(created.voltageV).toBeUndefined();
    expect(created.currentA).toBeUndefined();
    expect(created.diffPairGapMm).toBeUndefined();
    expect(created.color).toBe("#888");
  });

  test("two patches on one class, an explicit colliding id, and bad geometry are all reported", () => {
    const existing = [base({})];
    const twice = applyNetClassPatches(existing, [
      { name: "Default", traceWidthMm: 0.3 },
      { id: "default", name: "Default", clearanceMm: 0.3 },
    ]);
    expect(twice.problems.join(" ")).toContain("changed twice");
    const bad = applyNetClassPatches(existing, [
      { name: "Bad", traceWidthMm: -1, clearanceMm: 0.2, viaDiameterMm: 0.3, viaDrillMm: 0.5 },
    ]);
    expect(bad.problems.join(" ")).toContain("traceWidthMm must be a number > 0");
    expect(bad.problems.join(" ")).toContain("smaller than viaDiameterMm");
  });

  test("an existing class that is already odd does not block unrelated edits", () => {
    const existing = [base({}), base({ id: "legacy", name: "Legacy", clearanceMm: 0 })];
    const out = applyNetClassPatches(existing, [{ name: "Default", traceWidthMm: 0.3 }]);
    expect(out.problems).toEqual([]);
  });

  test("helpers", () => {
    expect(uniqueId("gnd", new Set(["gnd", "gnd-2"]))).toBe("gnd-3");
    expect(clearanceProblems({ traceToTraceMm: 0, traceToPadMm: 0.2 })).toEqual([
      "clearance traceToTraceMm must be a number > 0",
    ]);
  });
});
