import { describe, expect, test } from "bun:test";
import { migrateVisibleLayers } from "../../../modules/designer/frontend/pcb/pcb-layer-visibility";

describe("migrateVisibleLayers", () => {
  test("preserves known ids, drops unknown ids, dedupes", () => {
    const out = migrateVisibleLayers([
      "F.Cu",
      "Bogus",
      "B.Cu",
      "F.Cu",
      "Edge.Cuts",
    ]);
    expect(out).toEqual(["F.Cu", "B.Cu", "Edge.Cuts", "Drill", "Metadata"]);
  });

  test("backfills new default-visible ids on legacy payloads", () => {
    // Pre-Phase-1 visibleLayers shape — no Drill / Metadata.
    const out = migrateVisibleLayers([
      "F.Cu",
      "B.Cu",
      "F.SilkS",
      "B.SilkS",
      "Edge.Cuts",
    ]);
    expect(out).toContain("Drill");
    expect(out).toContain("Metadata");
    expect(out).toContain("F.Cu");
    expect(out).toContain("Edge.Cuts");
  });

  test("accepts new ids without flagging them unknown", () => {
    const out = migrateVisibleLayers([
      "F.Cu",
      "In1.Cu",
      "In2.Cu",
      "F.Mask",
      "B.Mask",
      "F.Paste",
      "B.Paste",
      "Drill",
      "Metadata",
    ]);
    expect(out).toContain("In1.Cu");
    expect(out).toContain("In2.Cu");
    expect(out).toContain("F.Mask");
    expect(out).toContain("F.Paste");
  });
});
