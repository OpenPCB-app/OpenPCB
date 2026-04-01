import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseKicadFootprint } from "./kicad-footprint-parser";

const FIXTURES_DIR = join(import.meta.dir, "__fixtures__");
const DATA_DIR = join(
  import.meta.dir,
  "../../../../../data/S32K376NHT1MJBST",
);

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("kicad-footprint-parser", () => {
  test("parses C_0603_1608Metric name and description", () => {
    const fp = parseKicadFootprint(loadFixture("C_0603_1608Metric.kicad_mod"));
    expect(fp.name).toBe("C_0603_1608Metric");
    expect(fp.description).toContain("Capacitor SMD 0603");
    expect(fp.tags).toContain("capacitor");
  });

  test("parses C_0603_1608Metric pads", () => {
    const fp = parseKicadFootprint(loadFixture("C_0603_1608Metric.kicad_mod"));
    expect(fp.pads).toHaveLength(2);

    const pad1 = fp.pads[0]!;
    expect(pad1.number).toBe("1");
    expect(pad1.type).toBe("smd");
    expect(pad1.shape).toBe("roundrect");
    expect(pad1.position.x).toBeCloseTo(-0.775);
    expect(pad1.size.width).toBeCloseTo(0.9);
    expect(pad1.size.height).toBeCloseTo(0.95);
    expect(pad1.layers).toContain("F.Cu");
    expect(pad1.roundrectRatio).toBeCloseTo(0.25);

    const pad2 = fp.pads[1]!;
    expect(pad2.number).toBe("2");
    expect(pad2.position.x).toBeCloseTo(0.775);
  });

  test("parses C_0603_1608Metric 3D model ref", () => {
    const fp = parseKicadFootprint(loadFixture("C_0603_1608Metric.kicad_mod"));
    expect(fp.model3dRefs).toHaveLength(1);
    const model = fp.model3dRefs[0]!;
    expect(model.path).toContain("C_0603_1608Metric.step");
    expect(model.resolvedFileName).toBe("C_0603_1608Metric.step");
    expect(model.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(model.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("parses C_0603_1608Metric attributes as smd", () => {
    const fp = parseKicadFootprint(loadFixture("C_0603_1608Metric.kicad_mod"));
    expect(fp.attributes.type).toBe("smd");
  });

  test("parses C_0603_1608Metric graphics", () => {
    const fp = parseKicadFootprint(loadFixture("C_0603_1608Metric.kicad_mod"));
    // 2 fp_line + 2 fp_rect + 1 fp_text
    expect(fp.graphics.length).toBeGreaterThanOrEqual(4);
    const lines = fp.graphics.filter((g) => g.type === "line");
    expect(lines.length).toBe(2);
    const rects = fp.graphics.filter((g) => g.type === "rect");
    expect(rects.length).toBe(2);
  });

  test("hand-solder variant has different pad sizes but same model ref", () => {
    const fp = parseKicadFootprint(
      loadFixture("C_0603_1608Metric_Pad1.08x0.95mm_HandSolder.kicad_mod"),
    );
    expect(fp.name).toBe("C_0603_1608Metric_Pad1.08x0.95mm_HandSolder");
    expect(fp.pads).toHaveLength(2);

    // Hand-solder pads are wider than nominal (1.075 vs 0.9)
    expect(fp.pads[0]!.size.width).toBeCloseTo(1.075);

    // Same 3D model as nominal
    expect(fp.model3dRefs[0]!.resolvedFileName).toBe("C_0603_1608Metric.step");
  });

  test("parses Nichicon electrolytic footprint", () => {
    const fp = parseKicadFootprint(
      loadFixture("CP_Elec_6.3x5.4_Nichicon.kicad_mod"),
    );
    expect(fp.name).toBe("CP_Elec_6.3x5.4_Nichicon");
    expect(fp.description).toContain("Nichicon");
    expect(fp.tags).toContain("capacitor");
    expect(fp.tags).toContain("electrolytic");
    expect(fp.pads).toHaveLength(2);
    expect(fp.model3dRefs[0]!.resolvedFileName).toBe(
      "CP_Elec_6.3x5.4_Nichicon.step",
    );
  });

  test("Nichicon has circle graphic on F.Fab", () => {
    const fp = parseKicadFootprint(
      loadFixture("CP_Elec_6.3x5.4_Nichicon.kicad_mod"),
    );
    const circles = fp.graphics.filter((g) => g.type === "circle");
    expect(circles.length).toBeGreaterThanOrEqual(1);
    expect(circles[0]!.layer).toBe("F.Fab");
  });

  test("parses missing_3d_footprint with DOES_NOT_EXIST model ref", () => {
    const fp = parseKicadFootprint(
      loadFixture("missing_3d_footprint.kicad_mod"),
    );
    expect(fp.name).toBe("C_Missing3D");
    expect(fp.model3dRefs).toHaveLength(1);
    expect(fp.model3dRefs[0]!.resolvedFileName).toBe("DOES_NOT_EXIST.step");
    expect(fp.model3dRefs[0]!.path).toContain("DOES_NOT_EXIST.step");
  });

  test("stores rawSource", () => {
    const source = loadFixture("C_0603_1608Metric.kicad_mod");
    const fp = parseKicadFootprint(source);
    expect(fp.rawSource).toBe(source);
  });

  test("throws on non-footprint input", () => {
    expect(() => parseKicadFootprint("(kicad_symbol_lib ...)")).toThrow(
      /Not a valid KiCad footprint/,
    );
  });

  test("parses real data file from data/ directory", () => {
    const source = readFileSync(
      join(DATA_DIR, "BGA289C80P17X17_1400X1400X152N.kicad_mod"),
      "utf-8",
    );
    const fp = parseKicadFootprint(source);
    expect(fp.name).toBe("BGA289C80P17X17_1400X1400X152N");
    expect(fp.pads.length).toBeGreaterThanOrEqual(289);
    expect(fp.graphics.length).toBeGreaterThanOrEqual(20);
    expect(fp.attributes.type).toBe("smd");
  });
});
