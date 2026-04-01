import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseKicadSymbolLib } from "./kicad-symbol-parser";

describe("KiCad symbol parser format coverage", () => {
  test("parses real S32K376 symbol library with units, graphics, and hidden pins", () => {
    const content = readFileSync(
      join(import.meta.dir, "../../../../../data/S32K376NHT1MJBST/S32K376NHT1MJBST.kicad_sym"),
      "utf-8",
    );

    const result = parseKicadSymbolLib(content);
    const symbol = result.symbols[0]!;

    expect(result.symbols).toHaveLength(1);
    expect(symbol.name).toBe("S32K376NHT1MJBST");
    expect(symbol.units).toBe(3);
    expect(symbol.pins).toHaveLength(289);
    expect(symbol.pins.filter((pin) => pin.hidden).length).toBeGreaterThan(0);
    expect(symbol.bodyGraphics.length).toBeGreaterThanOrEqual(3);
    expect(new Set(symbol.bodyGraphics.map((graphic) => graphic.unit))).toContain(3);
    expect(symbol.warnings).toHaveLength(0);
  });
});
