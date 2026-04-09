import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseKicadFootprint } from "./kicad-footprint-parser";

const FIXTURES_DIR = join(import.meta.dir, "__fixtures__");

describe("KiCad footprint parser format coverage", () => {
  test("parses checked-in complex footprint with array-shaped graphics data", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "CP_Elec_6.3x5.4_Nichicon.kicad_mod"),
      "utf-8",
    );

    const footprint = parseKicadFootprint(content);
    const firstGraphic = footprint.graphics[0]!;

    expect(footprint.name).toBe("CP_Elec_6.3x5.4_Nichicon");
    expect(footprint.pads).toHaveLength(2);
    expect(footprint.graphics.length).toBeGreaterThanOrEqual(20);
    expect(firstGraphic.type).toBe("line");
    expect(firstGraphic.data.start).toEqual([-4.4375, -1.8475]);
    expect(firstGraphic.data.end).toEqual([-3.65, -1.8475]);
    expect(firstGraphic.data.stroke).toEqual([
      ["width", 0.12],
      ["type", "solid"],
    ]);
    expect(footprint.attributes.type).toBe("smd");
  });
});
