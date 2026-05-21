import { describe, expect, test } from "bun:test";
import { parseKicadProject } from "./kicad-project-parser";

describe("parseKicadProject", () => {
  test("parses minimal project file", () => {
    const source = JSON.stringify({
      meta: { filename: "blinky.kicad_pro", version: 1 },
      net_settings: {
        classes: [
          {
            name: "Default",
            clearance: 0.2,
            track_width: 0.25,
            via_diameter: 0.8,
            via_drill: 0.4,
          },
        ],
      },
    });
    const result = parseKicadProject(source);
    expect(result.name).toBe("blinky");
    expect(result.netClasses).toHaveLength(1);
    expect(result.netClasses[0]).toMatchObject({
      name: "Default",
      clearanceMm: 0.2,
      trackWidthMm: 0.25,
      viaDiameterMm: 0.8,
      viaDrillMm: 0.4,
    });
    expect(result.warnings).toEqual([]);
  });

  test("preserves unknown net-class rules as opaque metadata + warning", () => {
    const source = JSON.stringify({
      net_settings: {
        classes: [
          {
            name: "DiffPair",
            clearance: 0.2,
            track_width: 0.25,
            diff_pair_gap: 0.15,
            uvia_diameter: 0.3,
          },
        ],
      },
    });
    const result = parseKicadProject(source);
    expect(result.netClasses[0].unknownRules).toEqual({
      diff_pair_gap: 0.15,
      uvia_diameter: 0.3,
    });
    expect(
      result.warnings.some((w) => w.code === "net_class_unknown_rules"),
    ).toBe(true);
  });

  test("flags inner-copper-layer preset references", () => {
    const source = JSON.stringify({
      board: {
        layer_presets: [
          { name: "Inner Only", visible_layers: ["In1.Cu", "In2.Cu"] },
        ],
      },
    });
    const result = parseKicadProject(source);
    expect(result.warnings.some((w) => w.code === "layer_count_deferred")).toBe(
      true,
    );
  });

  test("rejects malformed JSON", () => {
    expect(() => parseKicadProject("not json")).toThrow(/Failed to parse/);
  });

  test("returns empty net classes when section absent", () => {
    const result = parseKicadProject(JSON.stringify({}));
    expect(result.netClasses).toEqual([]);
    expect(result.layerCount).toBeNull();
  });
});
