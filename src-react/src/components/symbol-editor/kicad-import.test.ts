import { describe, expect, it } from "vitest";
import { convertParsedKicadSymbolToDraft } from "./kicad-import";
import type { ParsedKicadSymbol } from "@/lib/api/component-api";

describe("convertParsedKicadSymbolToDraft", () => {
  it("combines multi-unit symbols into one editable view and keeps hidden pins", () => {
    const parsed: ParsedKicadSymbol = {
      name: "LM358",
      kicadId: null,
      pins: [
        {
          name: "+",
          number: "3",
          electricalType: "input",
          direction: "line",
          position: { x: -7.62, y: 2.54 },
          length: 2.54,
          rotation: 0,
          unit: 1,
          hidden: false,
        },
        {
          name: "OUT",
          number: "1",
          electricalType: "output",
          direction: "line",
          position: { x: 7.62, y: 0 },
          length: 2.54,
          rotation: 180,
          unit: 1,
          hidden: false,
        },
        {
          name: "+",
          number: "5",
          electricalType: "input",
          direction: "line",
          position: { x: -7.62, y: 2.54 },
          length: 2.54,
          rotation: 0,
          unit: 2,
          hidden: false,
        },
        {
          name: "V+",
          number: "8",
          electricalType: "power_in",
          direction: "line",
          position: { x: 7.62, y: 5.08 },
          length: 2.54,
          rotation: 180,
          unit: 2,
          hidden: true,
        },
      ],
      units: 2,
      properties: {
        Value: "LM358",
        Reference: "U",
        Description: "Dual op-amp",
      },
      bodyGraphics: [
        {
          unit: 1,
          node: [
            "rectangle",
            ["start", -5.08, -5.08],
            ["end", 5.08, 5.08],
            ["stroke", ["width", 0.254]],
            ["fill", ["type", "none"]],
          ],
        },
        {
          unit: 2,
          node: [
            "rectangle",
            ["start", -5.08, -5.08],
            ["end", 5.08, 5.08],
            ["stroke", ["width", 0.254]],
            ["fill", ["type", "none"]],
          ],
        },
      ],
      warnings: [],
      rawSource: "(symbol LM358 ...)",
    };

    const draft = convertParsedKicadSymbolToDraft(parsed, "LM358.kicad_sym");

    expect(draft.metadata.name).toBe("LM358");
    expect(draft.pins).toHaveLength(4);
    expect(draft.graphics).toHaveLength(2);
    expect(draft.importPreservation?.unitCount).toBe(2);
    expect(
      draft.importPreservation?.warnings.some((warning) => warning.code === "multi_unit_combined"),
    ).toBe(true);

    const xPositions = draft.pins.map((pin) => pin.position.x).sort((a, b) => a - b);
    expect(xPositions[xPositions.length - 1]! - xPositions[0]!).toBeGreaterThan(10_000_000);
    expect(draft.pins.some((pin) => pin.number === "8" && pin.name === "V+")).toBe(true);
  });
});
