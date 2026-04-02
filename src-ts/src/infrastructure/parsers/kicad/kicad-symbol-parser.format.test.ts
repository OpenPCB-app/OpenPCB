import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseKicadSymbolLib } from "./kicad-symbol-parser";

const FIXTURES_DIR = join(import.meta.dir, "__fixtures__");

describe("KiCad symbol parser format coverage", () => {
  test("parses checked-in multi-unit symbol library", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "multi_unit_opamp.kicad_sym"),
      "utf-8",
    );

    const result = parseKicadSymbolLib(content);
    const symbol = result.symbols[0]!;

    expect(result.symbols).toHaveLength(1);
    expect(symbol.name).toBe("LM358");
    expect(symbol.units).toBe(3);
    expect(symbol.pins).toHaveLength(8);
    expect(symbol.bodyGraphics).toEqual([]);
    expect(new Set(symbol.pins.map((pin) => pin.unit))).toEqual(new Set([1, 2, 3]));
    expect(symbol.warnings).toHaveLength(0);
  });
});
