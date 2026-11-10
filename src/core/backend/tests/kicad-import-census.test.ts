import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveProjectFiles } from "../../../modules/designer/backend/import/kicad-project/inspect";
import {
  type CensusFinding,
  type KicadSourceCensus,
  censusBoard,
  censusLossClass,
  censusSchematic,
  censusWarnings,
  mergeCensus,
} from "../../../modules/designer/backend/import/kicad-project/plan/census";

// H14 S2 / §3.6.1: the census counts SOURCE UNITS straight off the raw
// s-expression and applies the blocker trigger rule to every token OpenPCB
// cannot represent.

const PCB_HEADER = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))`;

function units(census: KicadSourceCensus, entity: string): number | undefined {
  return census.rows.find((r) => r.entity === entity)?.sourceUnits;
}

const placementKey = (i: number): string => `fp:${i}`;

describe("census — board source units", () => {
  test("one unit per top-level token; an F&B zone is ONE unit", () => {
    const census = censusBoard(`${PCB_HEADER}
      (net 0 "") (net 1 "GND")
      (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 1))
      (segment (start 1 0) (end 2 0) (width 0.2) (layer "F.Cu"))
      (zone (net 1) (net_name "GND") (layers "F&B.Cu")
        (polygon (pts (xy 0 0) (xy 9 0) (xy 9 9) (xy 0 9))))
    )`);
    expect(units(census, "pcb.segment")).toBe(2);
    expect(units(census, "pcb.zone")).toBe(1);
    expect(units(census, "pcb.net")).toBe(2);
    expect(units(census, "pcb.layers")).toBe(1);
    expect(census.rows.find((r) => r.entity === "pcb.version")?.tokenClass).toBe(
      "benign",
    );
    expect(census.findings).toEqual([]);
  });

  test("counts footprint children, pad children and pads per type", () => {
    const census = censusBoard(`${PCB_HEADER}
      (footprint "R:R" locked (layer "F.Cu") (at 0 0)
        (property "Reference" "R1" (at 0 0) (layer "F.SilkS"))
        (fp_line (start 0 0) (end 1 0) (layer "F.SilkS"))
        (pad "1" smd roundrect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste")
          (roundrect_rratio 0.25) (net 1 "GND") (uuid "a"))
        (pad "2" smd roundrect (at 1 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste")
          (roundrect_rratio 0.25) (uuid "b"))
        (pad "" np_thru_hole circle (at 2 0) (size 1 1) (drill 1) (layers "*.Cu" "*.Mask")))
    )`);
    expect(units(census, "pcb.footprint")).toBe(1);
    expect(units(census, "pcb.footprint.pad")).toBe(3);
    expect(units(census, "pcb.footprint.fp_line")).toBe(1);
    expect(units(census, "pcb.pad_type.smd")).toBe(2);
    expect(units(census, "pcb.pad_type.np_thru_hole")).toBe(1);
    expect(units(census, "pcb.pad.at")).toBe(3);
    expect(units(census, "pcb.pad.roundrect_rratio")).toBe(2);
    expect(units(census, "pcb.pad.net")).toBe(1);
    expect(units(census, "pcb.pad.drill")).toBe(1);
    expect(census.findings).toEqual([]);
  });

  test("pad modifiers become capability findings on their placement", () => {
    const census = censusBoard(`${PCB_HEADER}
      (footprint "D:D" (layer "F.Cu") (at 0 0)
        (property "Reference" "D5" (at 0 0) (layer "F.SilkS"))
        (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")
          (solder_mask_margin 0.102) (remove_unused_layers no))
        (pad "29" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (zone_connect 2)))
      (footprint "T:T" (layer "F.Cu") (at 5 5)
        (pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu")
          (remove_unused_layers yes)))
    )`);
    expect(
      census.findings.map((f) => [f.footprintIndex, f.padNumber, f.token, f.value, f.lossClass]),
    ).toEqual([
      [0, "1", "solder_mask_margin", "0.102", "capability"],
      [0, "29", "zone_connect", "2", "capability"],
      [1, "1", "remove_unused_layers", "yes", "capability"],
    ]);
    expect(units(census, "pcb.pad.remove_unused_layers")).toBe(2);
    const warnings = censusWarnings(census, { placementKey });
    expect(warnings.map((w) => [w.code, w.subject?.keys, w.blocker?.class])).toEqual([
      ["footprint_manufacturing_token_unsupported", ["fp:0"], "capability"],
      ["footprint_manufacturing_token_unsupported", ["fp:1"], "capability"],
    ]);
    expect(warnings[0]!.blocker?.predicate).toBe("footprint_changed");
    expect(warnings[0]!.details).toMatchObject({
      items: ["D5"],
      tokens: ["solder_mask_margin", "zone_connect"],
      values: ["pad 1 solder_mask_margin 0.102", "pad 29 zone_connect 2"],
    });
  });

  test("an unknown token: copper → capability, silk → cosmetic, elsewhere → info", () => {
    const census = censusBoard(`${PCB_HEADER}
      (gr_curve (pts (xy 0 0) (xy 1 1) (xy 2 1) (xy 3 0)) (layer "F.Cu"))
      (gr_text_box "x" (start 0 0) (end 5 5) (layer "F.SilkS"))
      (target plus (at 1 1) (size 2) (layer "Edge.Cuts"))
      (dimension (type aligned) (layer "Dwgs.User"))
      (generated (uuid "g") (type tuning_pattern))
      (footprint "X:Y" (layer "F.Cu") (at 0 0)
        (fp_text_box "y" (start 0 0) (end 1 1) (layer "F.Fab"))
        (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (frobnicate 3)))
    )`);
    expect(census.findings.map((f) => [f.where, f.token, f.lossClass])).toEqual([
      ["pcb", "gr_curve", "capability"],
      ["pcb", "gr_text_box", "cosmetic"],
      ["pcb", "target", "capability"],
      ["pcb", "dimension", "info"],
      ["pcb", "generated", "info"],
      ["footprint", "fp_text_box", "cosmetic"],
      // An unknown pad child inherits its pad's copper layers: fail closed.
      ["pad", "frobnicate", "capability"],
    ]);
    expect(census.unsupported).toContainEqual({ token: "gr_curve", count: 1, where: "pcb" });
    const codes = censusWarnings(census, { placementKey }).map((w) => [
      w.code,
      w.blocker?.class ?? null,
    ]);
    expect(codes).toEqual([
      ["footprint_manufacturing_token_unsupported", "capability"],
      ["footprint_cosmetic_token_unsupported", "cosmetic"],
      ["source_construct_unsupported", "capability"],
      ["source_construct_unsupported_cosmetic", "cosmetic"],
      ["source_construct_ignored", null],
    ]);
  });

  test("fp_* on copper or mask is a loss; on silk / courtyard / Edge.Cuts it is not", () => {
    const census = censusBoard(`${PCB_HEADER}
      (footprint "Ant:Ant" (layer "F.Cu") (at 0 0)
        (fp_poly (pts (xy 0 0) (xy 1 0) (xy 1 1)) (layer "F.Cu"))
        (fp_rect (start 0 0) (end 1 1) (layer "F.Mask"))
        (fp_line (start 0 0) (end 1 0) (layer "F.CrtYd"))
        (fp_line (start 0 0) (end 1 0) (layer "Edge.Cuts"))
        (fp_circle (center 0 0) (end 1 0) (layer "F.SilkS")))
    )`);
    expect(census.findings.map((f) => [f.token, f.lossClass])).toEqual([
      ["fp_poly", "capability"],
      ["fp_rect", "capability"],
    ]);
  });

  test("`representable` drops a modifier whose value OpenPCB reproduces", () => {
    const census = censusBoard(`${PCB_HEADER}
      (footprint "D:D" (layer "F.Cu") (at 0 0)
        (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (solder_mask_margin 0)))
    )`);
    const representable = (f: CensusFinding): boolean =>
      f.token === "solder_mask_margin" && Number(f.value) === 0;
    expect(censusWarnings(census, { placementKey, representable })).toEqual([]);
    expect(censusWarnings(census, { placementKey })).toHaveLength(1);
  });
});

describe("census — trigger rule", () => {
  test.each([
    ["solder_mask_margin", [], "capability"],
    ["clearance", ["F.SilkS"], "capability"],
    ["zone_connect", [], "capability"],
    ["thermal_bridge_angle", [], "capability"],
    ["net_tie_pad_groups", [], "capability"],
    ["private_layers", [], "capability"],
    ["primitives", [], "capability"],
    ["zone", [], "capability"],
    ["mystery", ["In2.Cu"], "capability"],
    ["mystery", ["*.Mask"], "capability"],
    ["mystery", ["B.Paste"], "capability"],
    ["mystery", ["Edge.Cuts"], "capability"],
    ["mystery", ["F.SilkS", "F.Cu"], "capability"],
    ["mystery", ["F.SilkS"], "cosmetic"],
    ["mystery", ["B.Fab", "F.SilkS"], "cosmetic"],
    ["mystery", ["F.SilkS", "Dwgs.User"], "info"],
    ["mystery", ["F.CrtYd"], "info"],
    ["mystery", [], "info"],
  ] as const)("%s on %j → %s", (token, layers, expected) => {
    expect(censusLossClass(token, layers)).toBe(expected);
  });
});

describe("census — schematic, weighted by sheet instances", () => {
  const SUB = `(kicad_sch (version 20231120) (generator "eeschema")
    (symbol (lib_id "Device:R") (at 0 0 0) (property "Reference" "R1" (at 0 0 0)))
    (symbol (lib_id "Device:C") (at 5 0 0) (property "Reference" "C1" (at 0 0 0)))
    (wire (pts (xy 0 0) (xy 5 0)))
    (bus (pts (xy 0 0) (xy 5 0)))
  )`;
  const ROOT = `(kicad_sch (version 20231120) (generator "eeschema")
    (symbol (lib_id "Device:R") (at 0 0 0) (property "Reference" "R9" (at 0 0 0)))
    (sheet (at 0 0) (size 10 10) (property "Sheetfile" "sub.kicad_sch" (at 0 0 0)))
    (sheet (at 20 0) (size 10 10) (property "Sheetfile" "sub.kicad_sch" (at 0 0 0)))
  )`;
  const ORPHAN = `(kicad_sch (version 20231120) (generator "eeschema")
    (symbol (lib_id "Device:L") (at 0 0 0) (property "Reference" "L1" (at 0 0 0)))
  )`;

  const census = censusSchematic({
    sheets: [
      { path: "proj/sub.kicad_sch", source: SUB },
      { path: "proj/root.kicad_sch", source: ROOT },
      { path: "proj/old.kicad_sch", source: ORPHAN },
    ],
    instanceCounts: new Map([
      ["proj/root.kicad_sch", 1],
      ["proj/sub.kicad_sch", 2],
    ]),
  });

  test("a symbol in a twice-used sheet is two units", () => {
    expect(units(census, "sch.symbol_instance")).toBe(1 + 2 * 2);
    expect(units(census, "sch.wire")).toBe(2);
    expect(units(census, "sch.sheet")).toBe(2);
  });

  test("an unreferenced sheet counts once and never enters the symbol counts", () => {
    expect(units(census, "sch.sheet_unreferenced")).toBe(1);
    expect(census.unreferencedSheets).toEqual(["proj/old.kicad_sch"]);
    const warnings = censusWarnings(census, { placementKey });
    expect(warnings.map((w) => w.code)).toEqual([
      "source_construct_ignored",
      "sheet_unreferenced",
    ]);
    expect(warnings[1]!.details).toEqual({ items: ["proj/old.kicad_sch"] });
  });

  test("unsupported schematic tokens are weighted info findings", () => {
    expect(census.findings.map((f) => [f.token, f.lossClass, f.units, f.file])).toEqual([
      ["bus", "info", 2, "proj/sub.kicad_sch"],
    ]);
    expect(census.unsupported).toEqual([{ token: "bus", count: 2, where: "sch" }]);
  });

  test("mergeCensus keeps both sides and re-sorts the rows", () => {
    const merged = mergeCensus(censusBoard(`${PCB_HEADER})`), census);
    const entities = merged.rows.map((r) => r.entity);
    expect(entities).toEqual([...entities].sort());
    expect(units(merged, "pcb.layers")).toBe(1);
    expect(units(merged, "sch.symbol_instance")).toBe(5);
    expect(merged.unreferencedSheets).toEqual(["proj/old.kicad_sch"]);
  });
});

describe("census — USBtoUART (KiCad 8)", () => {
  const files = resolveProjectFiles(
    new Uint8Array(
      readFileSync(
        path.resolve(import.meta.dir, "../../../../data/KiCad_Example_Project_USBtoUART.zip"),
      ),
    ),
  );
  const board = censusBoard(files.pcbContent);

  test("source units match the fixture's token counts (§2.3)", () => {
    expect(units(board, "pcb.segment")).toBe(183);
    expect(units(board, "pcb.via")).toBe(44);
    expect(units(board, "pcb.zone")).toBe(1);
    expect(units(board, "pcb.gr_text")).toBe(7);
    expect(units(board, "pcb.gr_line")).toBe(4);
    expect(units(board, "pcb.gr_arc")).toBe(4);
    expect(units(board, "pcb.net")).toBe(37);
    expect(units(board, "pcb.footprint")).toBe(19);
    expect(units(board, "pcb.arc")).toBeUndefined();
    expect(units(board, "pcb.pad_type.np_thru_hole")).toBe(2);
  });

  test("only the 6 mask-margin pads and the zone_connect pad are capability losses", () => {
    expect(
      board.findings.map((f) => `${f.reference}:${f.padNumber}:${f.token}`).sort(),
    ).toEqual([
      "D3:1:solder_mask_margin",
      "D3:2:solder_mask_margin",
      "D4:1:solder_mask_margin",
      "D4:2:solder_mask_margin",
      "D5:1:solder_mask_margin",
      "D5:2:solder_mask_margin",
      "U1:29:zone_connect",
    ]);
    const warnings = censusWarnings(board, { placementKey });
    expect(warnings).toHaveLength(4);
    expect(
      warnings.every(
        (w) =>
          w.code === "footprint_manufacturing_token_unsupported" &&
          w.blocker?.class === "capability",
      ),
    ).toBe(true);
  });
});
