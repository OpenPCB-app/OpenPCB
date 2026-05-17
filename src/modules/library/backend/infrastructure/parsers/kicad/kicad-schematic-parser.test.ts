import { describe, expect, test } from "bun:test";
import { parseKicadSchematic } from "./kicad-schematic-parser";

const MINIMAL_HEADER = `(kicad_sch (version 20231120) (generator eeschema)`;

describe("parseKicadSchematic", () => {
  test("parses symbol instance with refdes and value", () => {
    const sch = `${MINIMAL_HEADER}
      (symbol
        (lib_id "Device:R")
        (at 50 60 0)
        (unit 1)
        (uuid "11111111-1111-1111-1111-111111111111")
        (property "Reference" "R1" (at 0 0 0))
        (property "Value" "10k" (at 0 0 0))
      )
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0]).toMatchObject({
      libId: "Device:R",
      reference: "R1",
      value: "10k",
      unit: 1,
      at: { xMm: 50, yMm: 60 },
      rotationDeg: 0,
      isPower: false,
    });
  });

  test("classifies #PWR refdes as power symbol", () => {
    const sch = `${MINIMAL_HEADER}
      (symbol
        (lib_id "power:GND")
        (at 100 100 180)
        (property "Reference" "#PWR01" (at 0 0 0))
        (property "Value" "GND" (at 0 0 0))
      )
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.symbols).toHaveLength(0);
    expect(result.powerSymbols).toHaveLength(1);
    expect(result.powerSymbols[0]).toMatchObject({
      reference: "#PWR01",
      netName: "GND",
    });
  });

  test("parses orthogonal wire with two points", () => {
    const sch = `${MINIMAL_HEADER}
      (wire (pts (xy 10 10) (xy 30 10)) (stroke (width 0)) (uuid "w1"))
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.wires).toHaveLength(1);
    expect(result.wires[0]?.points).toEqual([
      { xMm: 10, yMm: 10 },
      { xMm: 30, yMm: 10 },
    ]);
    expect(result.wires[0]?.hasDiagonal).toBe(false);
  });

  test("flags diagonal wire with warning", () => {
    const sch = `${MINIMAL_HEADER}
      (wire (pts (xy 10 10) (xy 30 25)) (stroke (width 0)) (uuid "w2"))
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.wires[0]?.hasDiagonal).toBe(true);
    expect(result.warnings.some((w) => w.code === "wire_diagonal")).toBe(true);
  });

  test("parses local label + global label with shape", () => {
    const sch = `${MINIMAL_HEADER}
      (label "SDA" (at 5 5 0) (uuid "l1"))
      (global_label "SCL" (shape input) (at 6 6 0) (uuid "g1"))
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.labels[0]?.text).toBe("SDA");
    expect(result.globalLabels[0]?.text).toBe("SCL");
    expect(result.globalLabels[0]?.shape).toBe("input");
  });

  test("flags hierarchical sheets for v1 flatten", () => {
    const sch = `${MINIMAL_HEADER}
      (sheet (at 0 0 0) (size 50 30) (uuid "s1")
        (property "Sheetname" "Power")
        (property "Sheetfile" "power.kicad_sch")
        (pin "VIN" input (at 0 5 180) (uuid "p1"))
      )
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.hierarchicalSheets).toHaveLength(1);
    expect(result.hierarchicalSheets[0]).toMatchObject({
      sheetName: "Power",
      sheetFile: "power.kicad_sch",
    });
    expect(result.hierarchicalSheets[0]?.pins[0]?.name).toBe("VIN");
    expect(
      result.warnings.some((w) => w.code === "hierarchical_sheets_flattened"),
    ).toBe(true);
  });

  test("parses junction + no_connect", () => {
    const sch = `${MINIMAL_HEADER}
      (junction (at 12 12) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      (no_connect (at 20 20) (uuid "n1"))
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.junctions[0]?.at).toEqual({ xMm: 12, yMm: 12 });
    expect(result.noConnects[0]).toEqual({ xMm: 20, yMm: 20 });
  });

  test("rejects non-schematic file", () => {
    expect(() => parseKicadSchematic("(kicad_pcb (version 20231120))")).toThrow(
      /Not a .kicad_sch/,
    );
  });

  test("preserves lib_symbols block as raw SExpr", () => {
    const sch = `${MINIMAL_HEADER}
      (lib_symbols
        (symbol "Device:R" (power) (pin_names (offset 0)))
      )
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.libSymbolsRaw).not.toBeNull();
    expect(Array.isArray(result.libSymbolsRaw)).toBe(true);
  });
});
