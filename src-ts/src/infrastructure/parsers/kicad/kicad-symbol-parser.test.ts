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

  test("detects hidden pins in real multi-unit symbol", () => {
    const content = readFileSync(
      join(import.meta.dir, "../../../../../data/S32K376NHT1MJBST/S32K376NHT1MJBST.kicad_sym"),
      "utf-8",
    );
    const result = parseKicadSymbolLib(content);
    const sym = result.symbols[0]!;

    expect(sym.units).toBe(3);
    expect(sym.pins.some((pin) => pin.hidden)).toBe(true);
    expect(sym.bodyGraphics.some((graphic) => graphic.unit === 3)).toBe(true);
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
});
