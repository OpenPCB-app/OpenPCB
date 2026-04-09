import { describe, expect, it } from "vitest";
import { convertParsedKicadFootprintToDraft } from "./import-utils";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";

describe("convertParsedKicadFootprintToDraft", () => {
  it("converts parser array-shaped graphics into editable graphics", () => {
    const parsed: ParsedKicadFootprint = {
      name: "BGA289",
      description: "Large BGA",
      tags: ["bga"],
      pads: [
        {
          number: "A1",
          type: "smd",
          shape: "circle",
          position: { x: -0.4, y: -0.4 },
          size: { width: 0.45, height: 0.45 },
          rotation: 0,
          layers: ["F.Cu", "F.Mask", "F.Paste"],
        },
      ],
      graphics: [
        {
          type: "line",
          layer: "F.Fab",
          data: { start: [7, 7], end: [-7, 7], width: 0.127 },
        },
        {
          type: "circle",
          layer: "F.SilkS",
          data: { center: [-8, 8], end: [-7.5, 8], width: 0.12 },
        },
        {
          type: "text",
          layer: "F.Fab",
          data: {
            __args: ["reference", "REF**"],
            at: [0, 0, 0],
            effects: [["font", ["size", 1, 1]]],
          },
        },
      ],
      model3dRefs: [
        {
          path: "${KICAD8_3DMODEL_DIR}/Package_BGA.3dshapes/BGA289.step",
          resolvedFileName: "BGA289.step",
          offset: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      ],
      attributes: { type: "smd" },
      warnings: [],
      rawSource: "(footprint BGA289 ...)",
    };

    const draft = convertParsedKicadFootprintToDraft(parsed, "BGA289.kicad_mod");

    expect(draft.metadata.name).toBe("BGA289");
    expect(draft.pads).toHaveLength(1);
    expect(draft.graphics).toHaveLength(3);
    expect(draft.graphics[0]).toMatchObject({
      type: "line",
      start: { x: 7, y: 7 },
      end: { x: -7, y: 7 },
      strokeWidth: 0.127,
    });
    expect(draft.graphics[1]).toMatchObject({
      type: "circle",
      center: { x: -8, y: 8 },
      radius: 0.5,
    });
    expect(draft.graphics[2]).toMatchObject({
      type: "text",
      content: "REF**",
      position: { x: 0, y: 0 },
      fontSize: 1,
    });
    expect(draft.importPreservation?.model3dReferences[0]?.resolvedFileName).toBe("BGA289.step");
  });

  it("warns when custom pads are downgraded", () => {
    const parsed: ParsedKicadFootprint = {
      name: "CustomPad",
      description: "Custom pad footprint",
      tags: [],
      pads: [
        {
          number: "1",
          type: "smd",
          shape: "custom",
          position: { x: 0, y: 0 },
          size: { width: 1, height: 1 },
          rotation: 0,
          layers: ["F.Cu"],
        },
      ],
      graphics: [],
      model3dRefs: [],
      attributes: { type: "smd" },
      warnings: [],
      rawSource: "(footprint CustomPad ...)",
    };

    const draft = convertParsedKicadFootprintToDraft(parsed, "CustomPad.kicad_mod");

    expect(draft.pads[0]?.shape).toBe("rect");
    expect(
      draft.importPreservation?.warnings.some((warning) => warning.code === "custom_pad_degraded"),
    ).toBe(true);
  });
});
