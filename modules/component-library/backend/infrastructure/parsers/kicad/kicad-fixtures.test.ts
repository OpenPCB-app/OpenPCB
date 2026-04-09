import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const FIXTURES_DIR = join(import.meta.dir, "__fixtures__");

describe("kicad fixture corpus", () => {
  // Test that all expected fixture files exist
  const expectedFiles = [
    "C_0603_1608Metric.kicad_mod",
    "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder.kicad_mod",
    "CP_Elec_6.3x5.4_Nichicon.kicad_mod",
    "simple_resistor.kicad_sym",
    "simple_capacitor.kicad_sym",
    "multi_unit_opamp.kicad_sym",
    "unsupported_construct.kicad_sym",
    "missing_3d_footprint.kicad_mod",
  ];

  for (const file of expectedFiles) {
    test(`fixture exists: ${file}`, () => {
      const path = join(FIXTURES_DIR, file);
      expect(existsSync(path)).toBe(true);
    });
  }

  test("footprint fixtures start with (footprint", () => {
    const modFiles = expectedFiles.filter((f) => f.endsWith(".kicad_mod"));
    for (const file of modFiles) {
      const content = readFileSync(join(FIXTURES_DIR, file), "utf-8");
      expect(content.trimStart().startsWith("(footprint")).toBe(true);
    }
  });

  test("symbol fixtures start with (kicad_symbol_lib", () => {
    const symFiles = expectedFiles.filter((f) => f.endsWith(".kicad_sym"));
    for (const file of symFiles) {
      const content = readFileSync(join(FIXTURES_DIR, file), "utf-8");
      expect(content.trimStart().startsWith("(kicad_symbol_lib")).toBe(true);
    }
  });

  test("nominal and hand-solder footprints reference same 3D model body", () => {
    const nominal = readFileSync(
      join(FIXTURES_DIR, "C_0603_1608Metric.kicad_mod"),
      "utf-8",
    );
    const handSolder = readFileSync(
      join(
        FIXTURES_DIR,
        "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder.kicad_mod",
      ),
      "utf-8",
    );
    // Both should reference C_0603_1608Metric.step (same body)
    const modelPattern = /Capacitor_SMD\.3dshapes\/C_0603_1608Metric\.step/;
    expect(modelPattern.test(nominal)).toBe(true);
    expect(modelPattern.test(handSolder)).toBe(true);
  });

  test("Nichicon footprint references manufacturer-specific 3D model", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "CP_Elec_6.3x5.4_Nichicon.kicad_mod"),
      "utf-8",
    );
    expect(content).toContain("CP_Elec_6.3x5.4_Nichicon.step");
  });

  test("missing_3d_footprint references non-existent model", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "missing_3d_footprint.kicad_mod"),
      "utf-8",
    );
    expect(content).toContain("DOES_NOT_EXIST.step");
  });

  test("multi_unit_opamp has 3 units (2 signal + 1 power)", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "multi_unit_opamp.kicad_sym"),
      "utf-8",
    );
    expect(content).toContain("LM358_1_1");
    expect(content).toContain("LM358_2_1");
    expect(content).toContain("LM358_3_1");
  });

  test("unsupported_construct has unknown element for warning test", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "unsupported_construct.kicad_sym"),
      "utf-8",
    );
    expect(content).toContain("future_graphic_element");
  });
});
