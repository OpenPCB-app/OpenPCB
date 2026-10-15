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

describe("parseKicadSchematic — H14 S2 instance data", () => {
  test("reads lib_name, mirror, board/BOM/DNP flags and per-project instances", () => {
    const sch = `${MINIMAL_HEADER}
      (uuid "root-uuid")
      (symbol
        (lib_id "Device:R")
        (lib_name "R_1")
        (at 50 60 90)
        (mirror y)
        (unit 2)
        (in_bom no)
        (on_board no)
        (dnp yes)
        (uuid "sym-uuid")
        (property "Reference" "R1" (at 0 0 0))
        (instances
          (project "demo"
            (path "/root-uuid" (reference "R1") (unit 2))
            (path "/root-uuid/sheet-a" (reference "R101") (unit 2)))
          (project "other" (path "/x" (reference "R7") (unit 1))))
      )
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.uuid).toBe("root-uuid");
    expect(result.symbols[0]).toMatchObject({
      libId: "Device:R",
      libName: "R_1",
      mirror: "y",
      rotationDeg: 90,
      inBom: false,
      onBoard: false,
      dnp: true,
      instances: [
        { project: "demo", path: "/root-uuid", reference: "R1", unit: 2 },
        {
          project: "demo",
          path: "/root-uuid/sheet-a",
          reference: "R101",
          unit: 2,
        },
        { project: "other", path: "/x", reference: "R7", unit: 1 },
      ],
    });
  });

  test("absent flags take KiCad's defaults; no mirror, no lib_name", () => {
    const sch = `${MINIMAL_HEADER}
      (symbol (lib_id "Device:C") (at 0 0 0) (mirror x) (property "Reference" "C1" (at 0 0 0)))
      (symbol (lib_id "Device:C") (at 0 0 0) (property "Reference" "C2" (at 0 0 0)))
    )`;
    const [c1, c2] = parseKicadSchematic(sch).symbols;
    expect(c1!.mirror).toBe("x");
    expect(c2).toMatchObject({
      libName: null,
      mirror: null,
      inBom: true,
      onBoard: true,
      dnp: false,
      instances: [],
    });
  });

  test("power symbols keep their full symbol record", () => {
    const sch = `${MINIMAL_HEADER}
      (symbol (lib_id "power:PWR_FLAG") (at 1 1 0) (on_board yes)
        (property "Reference" "#FLG01" (at 0 0 0)) (property "Value" "PWR_FLAG" (at 0 0 0)))
    )`;
    const [flag] = parseKicadSchematic(sch).powerSymbols;
    expect(flag!.symbol).toMatchObject({
      libId: "power:PWR_FLAG",
      reference: "#FLG01",
    });
  });

  test("reads sheet uuid, Sheetfile path and sheet instances", () => {
    const sch = `${MINIMAL_HEADER}
      (sheet (at 10 10) (size 20 10) (uuid "sheet-a")
        (property "Sheetname" "Power" (at 0 0 0))
        (property "Sheetfile" "sub\\\\power.kicad_sch" (at 0 0 0))
        (pin "VIN" input (at 10 12 180) (uuid "pin-1"))
        (instances (project "demo" (path "/root-uuid" (page "2")))))
    )`;
    const [sheet] = parseKicadSchematic(sch).hierarchicalSheets;
    expect(sheet).toMatchObject({
      uuid: "sheet-a",
      sheetName: "Power",
      sheetFile: "sub\\power.kicad_sch",
      sheetFilePath: "sub/power.kicad_sch",
      instances: [{ project: "demo", path: "/root-uuid", page: "2" }],
    });
    expect(sheet!.pins[0]?.name).toBe("VIN");
  });

  test("reads netclass_flag directive labels with their class", () => {
    const sch = `${MINIMAL_HEADER}
      (netclass_flag "" (length 2.54) (shape round) (at 30 40 90) (uuid "f1")
        (property "Netclass" "HighSpeed" (at 0 0 0)))
      (netclass_flag "" (length 2.54) (shape round) (at 1 2 0) (uuid "f2"))
    )`;
    expect(parseKicadSchematic(sch).netclassFlags).toEqual([
      {
        uuid: "f1",
        at: { xMm: 30, yMm: 40 },
        rotationDeg: 90,
        netclass: "HighSpeed",
        properties: { Netclass: "HighSpeed" },
      },
      {
        uuid: "f2",
        at: { xMm: 1, yMm: 2 },
        rotationDeg: 0,
        netclass: null,
        properties: {},
      },
    ]);
  });

  test("counts bus / bus_entry and reads root sheet_instances + KiCad 6 symbol_instances", () => {
    const sch = `${MINIMAL_HEADER}
      (bus (pts (xy 0 0) (xy 10 0)))
      (bus_entry (at 1 0) (size 2.54 2.54))
      (bus_entry (at 3 0) (size 2.54 2.54))
      (sheet_instances (path "/" (page "1")) (path "/sheet-a" (page "2")))
      (symbol_instances
        (path "/sym-1" (reference "R1") (unit 1) (value "10k") (footprint "R:R_0603"))
        (path "/sheet-a/sym-2" (reference "U1") (unit 2)))
    )`;
    const result = parseKicadSchematic(sch);
    expect(result.busCount).toBe(1);
    expect(result.busEntryCount).toBe(2);
    expect(result.sheetInstances).toEqual([
      { path: "/", page: "1" },
      { path: "/sheet-a", page: "2" },
    ]);
    expect(result.symbolInstances).toEqual([
      { project: null, path: "/sym-1", reference: "R1", unit: 1 },
      { project: null, path: "/sheet-a/sym-2", reference: "U1", unit: 2 },
    ]);
  });
});
