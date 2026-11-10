import { describe, expect, test } from "bun:test";
import { parseKicadPcb } from "./kicad-pcb-parser";

// H14 S2: graphics, footprint identity, net-name-only tokens, no-net copper,
// copper counted by name, board setup values.

const HEADER = `(kicad_pcb (version 20240108) (generator "pcbnew") (generator_version "8.0")`;
const LAYERS = `
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (37 "F.SilkS" user "F.Silkscreen")
    (44 "Edge.Cuts" user)
  )`;

function pcb(body: string, layers = LAYERS): ReturnType<typeof parseKicadPcb> {
  return parseKicadPcb(`${HEADER} ${layers} ${body} )`);
}

describe("parseKicadPcb — board graphics (H14 §3.10.3)", () => {
  test("parses every gr_* kind with layer, stroke, fill and points", () => {
    const result = pcb(`
      (gr_line (start 0 0) (end 10 0) (stroke (width 0.15) (type default)) (layer "F.SilkS") (uuid "l1"))
      (gr_rect (start 1 1) (end 4 3) (stroke (width 0.1) (type solid)) (fill solid) (layer "F.Fab"))
      (gr_circle (center 5 5) (end 6 5) (width 0.2) (layer "B.SilkS"))
      (gr_arc (start 0 0) (mid 1 1) (end 2 0) (stroke (width 0.1)) (layer "Dwgs.User"))
      (gr_poly (pts (xy 0 0) (xy 3 0) (xy 3 3)) (stroke (width 0.1)) (fill none) (layer "F.Cu"))
    `);
    expect(result.graphics.map((g) => [g.token, g.kind, g.layer])).toEqual([
      ["gr_line", "line", "F.SilkS"],
      ["gr_rect", "rect", "F.Fab"],
      ["gr_circle", "circle", "B.SilkS"],
      ["gr_arc", "arc", "Dwgs.User"],
      ["gr_poly", "poly", "F.Cu"],
    ]);
    const [line, rect, circle, arc, poly] = result.graphics;
    expect(line).toMatchObject({ strokeWidthMm: 0.15, fill: false, uuid: "l1" });
    expect(line!.points).toEqual([
      { xMm: 0, yMm: 0 },
      { xMm: 10, yMm: 0 },
    ]);
    expect(rect).toMatchObject({ fill: true, strokeWidthMm: 0.1 });
    expect(circle).toMatchObject({ strokeWidthMm: 0.2 });
    expect(circle!.points).toEqual([
      { xMm: 5, yMm: 5 },
      { xMm: 6, yMm: 5 },
    ]);
    expect(arc!.points).toHaveLength(3);
    expect(poly!.points).toHaveLength(3);
  });

  test("reads every text style field OpenPCB may drop", () => {
    const result = pcb(`
      (gr_text "Ampnics" (at 143.75 143.5 90) (layer "F.SilkS" knockout) (uuid "t1")
        (effects (font (face "Arial") (size 1.5 1.2) (thickness 0.3) (bold yes) (italic yes))
          (justify left bottom mirror)))
      (gr_text "plain" (at 1 2) (layer "B.SilkS")
        (effects (font (size 1 1) (thickness 0.15))))
    `);
    const [styled, plain] = result.graphics;
    expect(styled!.points).toEqual([{ xMm: 143.75, yMm: 143.5 }]);
    expect(styled!.text).toEqual({
      value: "Ampnics",
      sizeMm: { h: 1.5, w: 1.2 },
      thicknessMm: 0.3,
      justifyH: "left",
      justifyV: "bottom",
      mirror: true,
      knockout: true,
      hidden: false,
      rotationDeg: 90,
      bold: true,
      italic: true,
      font: "Arial",
    });
    expect(plain!.text).toMatchObject({
      justifyH: "center",
      justifyV: "center",
      mirror: false,
      knockout: false,
      bold: false,
      italic: false,
      font: null,
      rotationDeg: 0,
    });
  });

  test("hidden text: bare `hide` atom (KiCad ≤ 7) and `(hide yes)` (KiCad 8)", () => {
    const result = pcb(`
      (gr_text "a" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1)) hide))
      (gr_text "b" (at 0 0) (layer "F.SilkS") (hide yes) (effects (font (size 1 1))))
      (gr_text "hide" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1))))
    `);
    expect(result.graphics.map((g) => g.text?.hidden)).toEqual([
      true,
      true,
      false,
    ]);
  });

  test("legacy angle-only gr_arc (no mid) is not read as a graphic", () => {
    const result = pcb(
      `(gr_arc (start 0 0) (end 1 0) (angle 90) (layer "F.SilkS") (width 0.1))`,
    );
    expect(result.graphics).toEqual([]);
  });
});

describe("parseKicadPcb — footprint identity (H14 §3.6.3)", () => {
  const FOOTPRINT = `
    (net 0 "")
    (net 1 "GND")
    (footprint "MountingHole:MH_3.2" (layer "F.Cu") (uuid "fp-uuid") (at 10 20 90)
      (property "Reference" "H1" (at 0 -3 90) (layer "F.SilkS") (uuid "p1")
        (effects (font (size 1 1) (thickness 0.15))))
      (property "Value" "MH" (at 0 3 90) (layer "F.Fab") (hide yes)
        (effects (font (size 1 1) (thickness 0.15))))
      (property "Datasheet" "")
      (path "/aaaa/bbbb")
      (sheetname "Root")
      (sheetfile "root.kicad_sch")
      (attr through_hole board_only exclude_from_pos_files exclude_from_bom dnp)
      (locked yes)
      (fp_circle (center 0 0) (end 1.6 0) (stroke (width 0.12)) (layer "F.SilkS"))
      (fp_text user "\${REFERENCE}" (at 0 0 90) (layer "F.Fab") (effects (font (size 1 1))))
      (pad "1" thru_hole circle (at 0 0 90) (size 6 6) (drill 3.2) (layers "*.Cu" "*.Mask")
        (net 1 "GND") (pinfunction "MH") (pintype "passive") (uuid "pad-uuid"))
      (pad "" np_thru_hole circle (at 2 0) (size 1 1) (drill 1) (layers "*.Cu" "*.Mask"))
    )`;

  test("reads uuid, schematic path, sheet name/file, attr flags and lock", () => {
    const [fp] = pcb(FOOTPRINT).footprints;
    expect(fp).toMatchObject({
      reference: "H1",
      sourceIndex: 0,
      uuid: "fp-uuid",
      path: "/aaaa/bbbb",
      sheetName: "Root",
      sheetFile: "root.kicad_sch",
      locked: true,
      attr: {
        type: "through_hole",
        boardOnly: true,
        excludeFromPosFiles: true,
        excludeFromBom: true,
        dnp: true,
      },
    });
  });

  test("pads carry pin function, pin type, uuid and their net name", () => {
    const [fp] = pcb(FOOTPRINT).footprints;
    expect(fp!.pads[0]).toMatchObject({
      number: "1",
      netOrdinal: 1,
      netName: "GND",
      pinFunction: "MH",
      pinType: "passive",
      uuid: "pad-uuid",
    });
    // Unnumbered peg without a net token.
    expect(fp!.pads[1]).toMatchObject({
      number: "",
      padType: "np_thru_hole",
      netOrdinal: null,
      netName: null,
      pinFunction: null,
    });
  });

  test("footprint graphics: fp_* and drawn property texts, footprint-local", () => {
    const [fp] = pcb(FOOTPRINT).footprints;
    expect(
      fp!.graphics.map((g) => [g.token, g.kind, g.layer, g.propertyName]),
    ).toEqual([
      ["property", "text", "F.SilkS", "Reference"],
      ["property", "text", "F.Fab", "Value"],
      ["fp_circle", "circle", "F.SilkS", undefined],
      ["fp_text", "text", "F.Fab", undefined],
    ]);
    expect(fp!.graphics[1]!.text?.hidden).toBe(true);
    expect(fp!.graphics[3]!.text?.value).toBe("${REFERENCE}");
    expect(fp!.graphics[0]!.text?.rotationDeg).toBe(90);
  });

  test("an absent attr reads as no type and no flags", () => {
    const [fp] = pcb(`(footprint "X:Y" (layer "F.Cu") (at 0 0))`).footprints;
    expect(fp!.attr).toEqual({
      type: null,
      boardOnly: false,
      excludeFromPosFiles: false,
      excludeFromBom: false,
      dnp: false,
      flags: [],
    });
    expect(fp!.path).toBeNull();
    expect(fp!.locked).toBe(false);
  });

  test("sourceIndex counts footprints the parser skips", () => {
    const result = pcb(`
      (footprint (layer "F.Cu") (at 0 0))
      (footprint "A:B" (layer "F.Cu") (at 1 1))
    `);
    expect(result.footprints).toHaveLength(1);
    expect(result.footprints[0]!.sourceIndex).toBe(1);
  });
});

describe("parseKicadPcb — nets on copper items (H14 §3.8)", () => {
  test("a segment, arc and via without a net token are kept as no-net copper", () => {
    const result = pcb(`
      (segment (start 0 0) (end 5 0) (width 0.25) (layer "F.Cu") (uuid "s1"))
      (arc (start 10 0) (mid 7.071 7.071) (end 0 10) (width 0.25) (layer "F.Cu"))
      (via (at 1 1) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu"))
    `);
    expect(result.segments[0]).toMatchObject({
      netOrdinal: null,
      netName: null,
    });
    expect(result.segments.length).toBeGreaterThan(1);
    expect(
      result.segments.every((s) => s.netOrdinal === null && s.netName === null),
    ).toBe(true);
    expect(result.vias).toHaveLength(1);
    expect(result.vias[0]).toMatchObject({ netOrdinal: null, netName: null });
  });

  test("the name-only `(net \"X\")` token binds by name, never as an ordinal", () => {
    const result = pcb(`
      (net 5 "FIVE")
      (net "SDA")
      (segment (start 0 0) (end 5 0) (width 0.25) (layer "F.Cu") (net "SDA"))
      (segment (start 0 1) (end 5 1) (width 0.25) (layer "F.Cu") (net "5"))
      (via (at 1 1) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net "GND"))
      (zone (net "GND") (layer "F.Cu") (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))
    `);
    expect(result.nets).toEqual([
      { ordinal: 5, name: "FIVE" },
      { ordinal: null, name: "SDA" },
    ]);
    expect(result.segments.map((s) => [s.netOrdinal, s.netName])).toEqual([
      [null, "SDA"],
      [null, "5"],
    ]);
    expect(result.vias[0]).toMatchObject({ netOrdinal: null, netName: "GND" });
    expect(result.zones[0]).toMatchObject({ netOrdinal: null, netName: "GND" });
  });

  test("an ordinal the net table does not declare keeps its ordinal, no name", () => {
    const result = pcb(`
      (net 0 "")
      (segment (start 0 0) (end 5 0) (width 0.25) (layer "F.Cu") (net 9))
    `);
    expect(result.segments[0]).toMatchObject({ netOrdinal: 9, netName: null });
  });
});

describe("parseKicadPcb — layers and setup (H14 §3.9)", () => {
  test("counts copper layers by canonical name, whatever their type", () => {
    const result = pcb(
      "",
      `(layers
        (0 "F.Cu" signal)
        (1 "In1.Cu" mixed)
        (2 "In2.Cu" jumper)
        (31 "B.Cu" signal)
        (40 "Dwgs.User" user "Power plane notes")
        (44 "Edge.Cuts" user))`,
    );
    expect(result.copperLayerCount).toBe(4);
  });

  test("reads generator_version", () => {
    expect(pcb("").generatorVersion).toBe("8.0");
  });

  test("reads setup mask / paste values and plot-params viasonmask", () => {
    const result = pcb(`
      (setup
        (pad_to_mask_clearance 0.05)
        (solder_mask_min_width 0.1)
        (pad_to_paste_clearance -0.03)
        (pad_to_paste_clearance_ratio -0.1)
        (allow_soldermask_bridges_in_footprints yes)
        (pcbplotparams (layerselection 0x00010fc_ffffffff) (viasonmask no)))
    `);
    expect(result.setup).toEqual({
      padToMaskClearanceMm: 0.05,
      padToPasteClearanceMm: -0.03,
      padToPasteClearanceRatio: -0.1,
      solderMaskMinWidthMm: 0.1,
      allowSoldermaskBridgesInFootprints: true,
      tenting: null,
      viasOnMask: false,
    });
  });

  test("absent setup tokens stay null — no KiCad default is invented", () => {
    expect(pcb("").setup).toEqual({
      padToMaskClearanceMm: null,
      padToPasteClearanceMm: null,
      padToPasteClearanceRatio: null,
      solderMaskMinWidthMm: null,
      allowSoldermaskBridgesInFootprints: null,
      tenting: null,
      viasOnMask: null,
    });
  });

  test.each([
    ["(tenting front back)", { front: true, back: true }],
    ["(tenting front)", { front: true, back: false }],
    ["(tenting none)", { front: false, back: false }],
    ["(tenting (front yes) (back no))", { front: true, back: false }],
  ])("reads newer-KiCad tenting %s", (token, expected) => {
    expect(pcb(`(setup ${token})`).setup.tenting).toEqual(expected);
  });
});
