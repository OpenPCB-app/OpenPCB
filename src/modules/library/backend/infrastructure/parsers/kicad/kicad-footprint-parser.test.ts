import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseKicadFootprint } from "./kicad-footprint-parser";

const FIXTURES_DIR = join(import.meta.dir, "__fixtures__");

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

  test("parses checked-in complex footprint fixture", () => {
    const source = loadFixture("CP_Elec_6.3x5.4_Nichicon.kicad_mod");
    const fp = parseKicadFootprint(source);
    expect(fp.name).toBe("CP_Elec_6.3x5.4_Nichicon");
    expect(fp.pads.length).toBe(2);
    expect(fp.graphics.length).toBeGreaterThanOrEqual(20);
    expect(fp.attributes.type).toBe("smd");
  });

  test("captures fp_text font size, justify, and hide flag", () => {
    const src = `(footprint "T1" (layer F.Cu)
      (fp_text reference REF** (at 0 -3.5 0) (layer F.SilkS)
        (effects (font (size 1.27 1.27) (thickness 0.15)) (justify left)))
      (fp_text value "T1-Long-Value" (at 5 0 0) (layer F.Fab)
        (effects (font (size 1.0 1.0))) hide)
      (pad "1" smd rect (at 0 0) (size 1 1) (layers F.Cu)))`;
    const parsed = parseKicadFootprint(src);
    const texts = parsed.graphics.filter((g) => g.type === "text");
    expect(texts).toHaveLength(2);
    const ref = texts.find((g) => g.text?.kind === "reference");
    expect(ref?.text?.fontSizeMm).toBeCloseTo(1.27, 2);
    expect(ref?.text?.justifyH).toBe("left");
    expect(ref?.text?.hidden).toBe(false);
    expect(ref?.text?.position).toEqual({ x: 0, y: -3.5 });
    const val = texts.find((g) => g.text?.kind === "value");
    expect(val?.text?.fontSizeMm).toBeCloseTo(1.0, 2);
    expect(val?.text?.hidden).toBe(true);
    expect(val?.text?.position.x).toBe(5);
  });

  test("synthesizes text graphics from (property Reference|Value)", () => {
    const src = `(footprint "T2" (layer F.Cu)
      (property "Reference" "REF**" (at 0 -2 0) (layer F.SilkS)
        (effects (font (size 1.0 1.0))))
      (property "Value" "T2-Value" (at 0 2 0) (layer F.Fab)
        (effects (font (size 1.0 1.0))))
      (property "Footprint" "Lib:T2" (at 0 0 0) (effects (font (size 1.0 1.0))))
      (property "Datasheet" "" (at 0 0 0))
      (pad "1" smd rect (at 0 0) (size 1 1) (layers F.Cu)))`;
    const parsed = parseKicadFootprint(src);
    const texts = parsed.graphics.filter((g) => g.type === "text");
    expect(texts).toHaveLength(2);
    const kinds = texts.map((g) => g.text?.kind).sort();
    expect(kinds).toEqual(["reference", "value"]);
  });

  test("(hide yes) inside property is detected", () => {
    const src = `(footprint "T3" (layer F.Cu)
      (property "Value" "Hidden Value" (at 0 5 0) (layer F.Fab)
        (hide yes)
        (effects (font (size 1.0 1.0))))
      (pad "1" smd rect (at 0 0) (size 1 1) (layers F.Cu)))`;
    const parsed = parseKicadFootprint(src);
    const val = parsed.graphics.find((g) => g.text?.kind === "value");
    expect(val?.text?.hidden).toBe(true);
  });

  test("justify mirror is recorded", () => {
    const src = `(footprint "T4" (layer F.Cu)
      (fp_text user "X" (at 0 0 0) (layer F.SilkS)
        (effects (font (size 1.0 1.0)) (justify right mirror)))
      (pad "1" smd rect (at 0 0) (size 1 1) (layers F.Cu)))`;
    const parsed = parseKicadFootprint(src);
    const t = parsed.graphics.find((g) => g.type === "text");
    expect(t?.text?.justifyH).toBe("right");
    expect(t?.text?.mirrored).toBe(true);
  });
});
