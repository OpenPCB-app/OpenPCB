import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseKicadFootprint } from "./kicad-footprint-parser";

describe("KiCad footprint parser format coverage", () => {
  test("parses real BGA footprint with array-shaped graphics data", () => {
    const content = readFileSync(
      join(import.meta.dir, "../../../../../data/S32K376NHT1MJBST/BGA289C80P17X17_1400X1400X152N.kicad_mod"),
      "utf-8",
    );

    const footprint = parseKicadFootprint(content);
    const firstGraphic = footprint.graphics[0]!;

    expect(footprint.name).toBe("BGA289C80P17X17_1400X1400X152N");
    expect(footprint.pads).toHaveLength(289);
    expect(footprint.graphics.length).toBeGreaterThanOrEqual(20);
    expect(firstGraphic.type).toBe("line");
    expect(firstGraphic.data.start).toEqual([7, 7]);
    expect(firstGraphic.data.end).toEqual([-7, 7]);
    expect(firstGraphic.data.width).toBe(0.127);
    expect(footprint.attributes.type).toBe("smd");
  });
});
