/**
 * SI contract 14 §3 / §6 — the ONE length-match target helper. The batch check
 * and the route / tune HUD gauge share it; `exclude` is what makes the gauge's
 * "longest OTHER member" the same rule rather than a second copy.
 */
import { describe, expect, test } from "bun:test";
import { resolveLengthTarget } from "../../../shared/drc/si/length-target";
import type { PcbLengthMatchGroup } from "../../../sdks/designer";

const group = (
  target: PcbLengthMatchGroup["target"],
  netIds: string[],
): PcbLengthMatchGroup => ({
  id: "g1",
  name: "DDR_A",
  netIds,
  target,
  toleranceMm: 0.5,
});

const lengths = (entries: [string, number][]) => new Map(entries);

describe("resolveLengthTarget — absolute", () => {
  test("returns the stated millimetre value, whatever the members measure", () => {
    const g = group({ kind: "absolute", mm: 42.5 }, ["a", "b"]);
    expect(resolveLengthTarget(g, lengths([]))).toEqual({ targetMm: 42.5 });
    expect(resolveLengthTarget(g, lengths([["a", 10]]), { exclude: "a" })).toEqual({
      targetMm: 42.5,
    });
  });
});

describe("resolveLengthTarget — longest", () => {
  const g = group({ kind: "longest" }, ["a", "b", "c"]);

  test("the longest DEFINED member, self included", () => {
    expect(resolveLengthTarget(g, lengths([["a", 10], ["b", 12.5], ["c", 11]]))).toEqual({
      targetMm: 12.5,
    });
  });

  test("undefined members are absent from the map and never set the target", () => {
    expect(resolveLengthTarget(g, lengths([["a", 10], ["b", 12.5]]))).toEqual({ targetMm: 12.5 });
  });

  test("fewer than two defined members has no target to compare against", () => {
    expect(resolveLengthTarget(g, lengths([["b", 12.5]]))).toBeNull();
    expect(resolveLengthTarget(g, lengths([]))).toBeNull();
  });

  test("a net outside the group never contributes", () => {
    expect(resolveLengthTarget(g, lengths([["a", 10], ["z", 99]]))).toBeNull();
    expect(resolveLengthTarget(g, lengths([["a", 10], ["b", 11], ["z", 99]]))).toEqual({
      targetMm: 11,
    });
  });

  test("exclude gives the longest OTHER member", () => {
    const map = lengths([["a", 10], ["b", 12.5], ["c", 11]]);
    expect(resolveLengthTarget(g, map, { exclude: "b" })).toEqual({ targetMm: 11 });
    expect(resolveLengthTarget(g, map, { exclude: "a" })).toEqual({ targetMm: 12.5 });
  });

  test("exclude drops the two-member floor — one remaining member is a comparison", () => {
    expect(resolveLengthTarget(g, lengths([["a", 10], ["b", 12.5]]), { exclude: "a" })).toEqual({
      targetMm: 12.5,
    });
    // …but nothing remaining is still no target.
    expect(resolveLengthTarget(g, lengths([["a", 10]]), { exclude: "a" })).toBeNull();
  });

  test("a repeated net id is one member, not two", () => {
    const dup = group({ kind: "longest" }, ["a", "a"]);
    expect(resolveLengthTarget(dup, lengths([["a", 10]]))).toBeNull();
  });

  test("an empty group has no target", () => {
    expect(resolveLengthTarget(group({ kind: "longest" }, []), lengths([["a", 10]]))).toBeNull();
  });
});
