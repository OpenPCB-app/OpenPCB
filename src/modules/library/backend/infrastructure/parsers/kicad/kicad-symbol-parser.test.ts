import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseKicadSymbolLib } from "./kicad-symbol-parser";

const FIXTURES_DIR = join(import.meta.dir, "__fixtures__");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("KiCad symbol parser", () => {
  test("parses simple resistor symbol", () => {
    const content = readFixture("simple_resistor.kicad_sym");
    const result = parseKicadSymbolLib(content);

    expect(result.symbols.length).toBe(1);
    const sym = result.symbols[0]!;
    expect(sym.name).toBe("R");
    expect(sym.pins.length).toBe(2);
    expect(sym.pins[0]!.electricalType).toBe("passive");
    expect(sym.pins[0]!.number).toBe("1");
    expect(sym.pins[1]!.number).toBe("2");
    expect(sym.properties["Reference"]).toBe("R");
    expect(sym.warnings.length).toBe(0);
  });

  test("parses simple capacitor symbol", () => {
    const content = readFixture("simple_capacitor.kicad_sym");
    const result = parseKicadSymbolLib(content);

    expect(result.symbols.length).toBe(1);
    const sym = result.symbols[0]!;
    expect(sym.name).toBe("C");
    expect(sym.pins.length).toBe(2);
    expect(sym.properties["Reference"]).toBe("C");
    expect(sym.properties["Footprint"]).toBe("");
  });

  test("parses multi-unit opamp with 3 units", () => {
    const content = readFixture("multi_unit_opamp.kicad_sym");
    const result = parseKicadSymbolLib(content);

    expect(result.symbols.length).toBe(1);
    const sym = result.symbols[0]!;
    expect(sym.name).toBe("LM358");
    expect(sym.units).toBe(3);
    expect(sym.properties["Reference"]).toBe("U");

    // Unit 1: +, -, output (pins 3, 2, 1)
    const unit1Pins = sym.pins.filter((p) => p.unit === 1);
    expect(unit1Pins.length).toBe(3);
    expect(
      unit1Pins.some((p) => p.name === "+" && p.electricalType === "input"),
    ).toBe(true);
    expect(
      unit1Pins.some((p) => p.name === "-" && p.electricalType === "input"),
    ).toBe(true);
    expect(unit1Pins.some((p) => p.electricalType === "output")).toBe(true);

    // Unit 2: another set of +, -, output (pins 5, 6, 7)
    const unit2Pins = sym.pins.filter((p) => p.unit === 2);
    expect(unit2Pins.length).toBe(3);

    // Unit 3: power pins (V+, V-)
    const unit3Pins = sym.pins.filter((p) => p.unit === 3);
    expect(unit3Pins.length).toBe(2);
    expect(unit3Pins.some((p) => p.electricalType === "power_in")).toBe(true);
    expect(sym.bodyGraphics.every((graphic) => graphic.unit >= 0)).toBe(true);
  });

  test("parses LM317T-style 3-pin regulator fixture", () => {
    const content = readFixture("lm317t_regulator.kicad_sym");
    const result = parseKicadSymbolLib(content);

    expect(result.symbols.length).toBe(1);
    const sym = result.symbols[0]!;
    expect(sym.name).toBe("LM317T");
    expect(sym.pins).toHaveLength(3);
    expect(sym.pins.map((pin) => pin.number)).toEqual(["1", "2", "3"]);
    expect(sym.pins.map((pin) => pin.rotation)).toEqual([0, 180, 90]);
    expect(sym.bodyGraphics).toHaveLength(1);
    expect(sym.warnings).toHaveLength(0);
  });

  test("parses unsupported three-side IC fixture", () => {
    const content = readFixture("three_side_ic.kicad_sym");
    const result = parseKicadSymbolLib(content);

    expect(result.symbols.length).toBe(1);
    const sym = result.symbols[0]!;
    expect(sym.name).toBe("THREESIDE");
    expect(sym.pins).toHaveLength(4);
    expect(new Set(sym.pins.map((pin) => pin.rotation))).toEqual(
      new Set([0, 180, 90]),
    );
    expect(sym.bodyGraphics).toHaveLength(1);
    expect(sym.warnings).toHaveLength(0);
  });

  test("parses graphics-only fallback fixture", () => {
    const content = readFixture("graphics_only.kicad_sym");
    const result = parseKicadSymbolLib(content);

    expect(result.symbols.length).toBe(1);
    const sym = result.symbols[0]!;
    expect(sym.name).toBe("GRAPHICSONLY");
    expect(sym.pins).toHaveLength(0);
    expect(sym.bodyGraphics).toHaveLength(2);
    expect(sym.warnings).toHaveLength(0);
  });

  test("warns on unsupported graphic construct", () => {
    const content = readFixture("unsupported_construct.kicad_sym");
    const result = parseKicadSymbolLib(content);

    expect(result.symbols.length).toBe(1);
    const sym = result.symbols[0]!;
    expect(sym.pins.length).toBe(1);

    // Should have a warning for the unsupported element
    expect(sym.warnings.length).toBeGreaterThan(0);
    const unsupportedWarning = sym.warnings.find(
      (w) => w.code === "unsupported_construct",
    );
    expect(unsupportedWarning).toBeDefined();
    expect(unsupportedWarning!.message).toContain("future_graphic_element");
  });

  test("preserves raw source for provenance", () => {
    const content = readFixture("simple_resistor.kicad_sym");
    const result = parseKicadSymbolLib(content);
    const sym = result.symbols[0]!;

    expect(sym.rawSource).toBeTruthy();
    expect(sym.rawSource).toContain("symbol");
    expect(sym.rawSource).toContain("pin");
  });

  test("parses checked-in multi-unit symbol fixture", () => {
    const content = readFixture("multi_unit_opamp.kicad_sym");
    const result = parseKicadSymbolLib(content);
    const sym = result.symbols[0]!;

    expect(sym.name).toBe("LM358");
    expect(sym.units).toBe(3);
    expect(sym.pins).toHaveLength(8);
    expect(sym.warnings).toHaveLength(0);
  });

  test("extracts version and generator", () => {
    const content = readFixture("simple_resistor.kicad_sym");
    const result = parseKicadSymbolLib(content);

    expect(result.version).toBe(20231120);
    expect(result.generator).toBe("openpcb_test");
  });

  test("rejects non-symbol-lib file", () => {
    expect(() => parseKicadSymbolLib("(footprint test)")).toThrow(
      "Not a valid KiCad symbol library file",
    );
  });

  test("canonical serialization is deterministic", () => {
    const content = readFixture("simple_resistor.kicad_sym");
    const result1 = parseKicadSymbolLib(content);
    const result2 = parseKicadSymbolLib(content);
    expect(result1.symbols[0]!.rawSource).toBe(result2.symbols[0]!.rawSource);
  });

  test("reads (effects (font (size W H))) on pins and properties", () => {
    // simple_resistor fixture has size 1.27 on every text element.
    const content = readFixture("simple_resistor.kicad_sym");
    const sym = parseKicadSymbolLib(content).symbols[0]!;
    expect(sym.pins[0]!.nameFontSizeMm).toBeCloseTo(1.27, 5);
    expect(sym.pins[0]!.numberFontSizeMm).toBeCloseTo(1.27, 5);
    expect(sym.referenceFontSizeMm).toBeCloseTo(1.27, 5);
    expect(sym.valueFontSizeMm).toBeCloseTo(1.27, 5);
  });

  test("missing effects → font sizes are undefined (caller falls back to KLC default)", () => {
    const content = `(kicad_symbol_lib
      (version 20231120) (generator "test")
      (symbol "X"
        (property "Reference" "U" (at 0 0 0))
        (property "Value" "X" (at 0 -2.54 0))
        (symbol "X_1_1"
          (pin passive line (at 0 3.81 270) (length 1.27) (name "A") (number "1"))
        )
      ))`;
    const sym = parseKicadSymbolLib(content).symbols[0]!;
    expect(sym.pins[0]!.nameFontSizeMm).toBeUndefined();
    expect(sym.pins[0]!.numberFontSizeMm).toBeUndefined();
    expect(sym.referenceFontSizeMm).toBeUndefined();
    expect(sym.valueFontSizeMm).toBeUndefined();
  });

  test("non-default font sizes survive parsing", () => {
    const content = `(kicad_symbol_lib
      (version 20231120) (generator "test")
      (symbol "Y"
        (property "Reference" "U" (at 0 0 0) (effects (font (size 0.762 0.762))))
        (symbol "Y_1_1"
          (pin passive line (at 0 3.81 270) (length 1.27)
            (name "A" (effects (font (size 0.5 0.5))))
            (number "1" (effects (font (size 0.6 0.6)))))
        )
      ))`;
    const sym = parseKicadSymbolLib(content).symbols[0]!;
    expect(sym.referenceFontSizeMm).toBeCloseTo(0.762, 5);
    expect(sym.pins[0]!.nameFontSizeMm).toBeCloseTo(0.5, 5);
    expect(sym.pins[0]!.numberFontSizeMm).toBeCloseTo(0.6, 5);
  });
});
