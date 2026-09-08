import { describe, expect, test } from "vitest";
import {
  clonePcbSelection,
  emptyPcbSelection,
  isPcbSelectionEmpty,
  pcbSelectionCount,
  pcbSelectionUnion,
  toggleKeepout,
  toggleZone,
  type PcbSelection,
} from "./pcb-selection";

describe("zone / keepout selection buckets", () => {
  test("emptyPcbSelection includes empty zone/keepout sets", () => {
    const s = emptyPcbSelection();
    expect(s.zoneIds).toEqual(new Set());
    expect(s.keepoutIds).toEqual(new Set());
  });

  test("toggleZone adds then removes", () => {
    let s = emptyPcbSelection();
    s = toggleZone(s, "zone-1");
    expect(s.zoneIds).toEqual(new Set(["zone-1"]));
    s = toggleZone(s, "zone-1");
    expect(s.zoneIds).toEqual(new Set());
  });

  test("toggleKeepout adds then removes", () => {
    let s = emptyPcbSelection();
    s = toggleKeepout(s, "keepout-1");
    expect(s.keepoutIds).toEqual(new Set(["keepout-1"]));
    s = toggleKeepout(s, "keepout-1");
    expect(s.keepoutIds).toEqual(new Set());
  });

  test("clonePcbSelection deep-copies zone/keepout buckets", () => {
    const s = toggleKeepout(toggleZone(emptyPcbSelection(), "z1"), "k1");
    const cloned = clonePcbSelection(s);
    expect(cloned).toEqual(s);
    expect(cloned.zoneIds).not.toBe(s.zoneIds);
    expect(cloned.keepoutIds).not.toBe(s.keepoutIds);
  });

  test("pcbSelectionCount includes zones and keepouts", () => {
    const s = toggleKeepout(toggleZone(emptyPcbSelection(), "z1"), "k1");
    expect(pcbSelectionCount(s)).toBe(2);
  });

  test("isPcbSelectionEmpty is false when only a zone or keepout is selected", () => {
    expect(isPcbSelectionEmpty(toggleZone(emptyPcbSelection(), "z1"))).toBe(
      false,
    );
    expect(
      isPcbSelectionEmpty(toggleKeepout(emptyPcbSelection(), "k1")),
    ).toBe(false);
    expect(isPcbSelectionEmpty(emptyPcbSelection())).toBe(true);
  });

  test("pcbSelectionUnion merges zone/keepout buckets", () => {
    const a = toggleZone(emptyPcbSelection(), "z1");
    const b = toggleKeepout(emptyPcbSelection(), "k1");
    const merged = pcbSelectionUnion(a, b);
    expect(merged.zoneIds).toEqual(new Set(["z1"]));
    expect(merged.keepoutIds).toEqual(new Set(["k1"]));
  });

  test("legacy selections without the optional buckets still work", () => {
    const legacy: PcbSelection = {
      placementIds: new Set(),
      traceIds: new Set(),
      viaIds: new Set(),
    };
    expect(isPcbSelectionEmpty(legacy)).toBe(true);
    expect(pcbSelectionCount(legacy)).toBe(0);
    const withZone = toggleZone(legacy, "z1");
    expect(withZone.zoneIds).toEqual(new Set(["z1"]));
  });
});
