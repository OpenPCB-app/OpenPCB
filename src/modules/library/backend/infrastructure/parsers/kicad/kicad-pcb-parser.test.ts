import { describe, expect, test } from "bun:test";
import { parseKicadPcb } from "./kicad-pcb-parser";

const HEADER = `(kicad_pcb (version 20231120) (generator pcbnew)`;
const TWO_LAYER_LAYERS = `
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user)
    (33 "F.Adhes" user)
    (44 "Edge.Cuts" user)
  )`;
const FOUR_LAYER_LAYERS = `
  (layers
    (0 "F.Cu" signal)
    (1 "In1.Cu" power)
    (2 "In2.Cu" signal)
    (31 "B.Cu" signal)
    (44 "Edge.Cuts" user)
  )`;

describe("parseKicadPcb", () => {
  test("derives 2-layer count from layers block", () => {
    const result = parseKicadPcb(`${HEADER} ${TWO_LAYER_LAYERS} )`);
    expect(result.copperLayerCount).toBe(2);
    expect(
      result.layers.find((l) => l.canonicalName === "Edge.Cuts"),
    ).toBeTruthy();
  });

  test("derives 4-layer count including In*.Cu", () => {
    const result = parseKicadPcb(`${HEADER} ${FOUR_LAYER_LAYERS} )`);
    expect(result.copperLayerCount).toBe(4);
  });

  test("parses footprint with refdes, value, and pads", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (footprint "Resistor_SMD:R_0805_2012Metric" (layer "F.Cu") (at 10 20 0)
        (property "Reference" "R1" (at 0 0 0))
        (property "Value" "10k" (at 0 0 0))
        (pad "1" smd rect (at -0.95 0 0) (size 1 1.25) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "VCC"))
        (pad "2" smd rect (at 0.95 0 0) (size 1 1.25) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "GND"))
        (model "ref.step")
      )
    )`;
    const result = parseKicadPcb(src);
    expect(result.footprints).toHaveLength(1);
    const fp = result.footprints[0]!;
    expect(fp.libId).toBe("Resistor_SMD:R_0805_2012Metric");
    expect(fp.reference).toBe("R1");
    expect(fp.value).toBe("10k");
    expect(fp.at).toEqual({ xMm: 10, yMm: 20 });
    expect(fp.pads).toHaveLength(2);
    expect(fp.pads[0]?.number).toBe("1");
    expect(fp.pads[0]?.netOrdinal).toBe(1);
    expect(fp.modelRefs).toEqual(["ref.step"]);
  });

  test("parses segment trace with resolved netName", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 1 "VCC")
      (segment (start 1 2) (end 5 2) (width 0.25) (layer "F.Cu") (net 1) (uuid "u1"))
    )`;
    const result = parseKicadPcb(src);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      start: { xMm: 1, yMm: 2 },
      end: { xMm: 5, yMm: 2 },
      widthMm: 0.25,
      layer: "F.Cu",
      netOrdinal: 1,
      netName: "VCC",
    });
  });

  test("parses through-via with resolved netName", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 3 "GND")
      (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 3) (uuid "v1"))
    )`;
    const result = parseKicadPcb(src);
    expect(result.vias).toHaveLength(1);
    expect(result.vias[0]).toMatchObject({
      at: { xMm: 10, yMm: 10 },
      sizeMm: 0.8,
      drillMm: 0.4,
      layers: ["F.Cu", "B.Cu"],
      netOrdinal: 3,
      netName: "GND",
      type: "through",
    });
  });

  test("tessellates arc track into chord segments", () => {
    // Quarter-arc from (10,0) → (0,10) via mid (~7.07, 7.07) around origin
    // (radius 10). Expected: many chord segments, originatedFromArc true.
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 5 "SDA")
      (arc (start 10 0) (mid 7.071 7.071) (end 0 10) (width 0.25) (layer "F.Cu") (net 5))
    )`;
    const result = parseKicadPcb(src);
    expect(result.segments.length).toBeGreaterThanOrEqual(8);
    for (const seg of result.segments) {
      expect(seg.originatedFromArc).toBe(true);
      expect(seg.netName).toBe("SDA");
      expect(seg.layer).toBe("F.Cu");
    }
    // First chord starts at (10,0), last chord ends at (0,10).
    expect(result.segments[0]?.start).toEqual({ xMm: 10, yMm: 0 });
    const last = result.segments[result.segments.length - 1]!;
    expect(last.end.xMm).toBeCloseTo(0);
    expect(last.end.yMm).toBeCloseTo(10);
  });

  test("falls back to fp_text reference/value (KiCad 6)", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (footprint "Resistor_SMD:R_0805_2012Metric" (layer "F.Cu") (at 10 20 0)
        (fp_text reference "R7" (at 0 0 0) (layer "F.SilkS"))
        (fp_text value "100k" (at 0 0 0) (layer "F.Fab"))
      )
    )`;
    const result = parseKicadPcb(src);
    expect(result.footprints[0]).toMatchObject({
      reference: "R7",
      value: "100k",
    });
  });

  test("collects net ordinals + names", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 1 "VCC")
      (net 2 "GND")
    )`;
    const result = parseKicadPcb(src);
    expect(result.nets).toHaveLength(3);
    expect(result.nets[1]).toMatchObject({ ordinal: 1, name: "VCC" });
  });

  test("computes board outline bounding box from Edge.Cuts gr_lines", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (gr_line (start 0 0) (end 100 0) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 100 0) (end 100 80) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 100 80) (end 0 80) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 0 80) (end 0 0) (layer "Edge.Cuts") (width 0.05))
    )`;
    const result = parseKicadPcb(src);
    expect(result.boardOutline).toEqual({
      minXMm: 0,
      minYMm: 0,
      maxXMm: 100,
      maxYMm: 80,
    });
  });

  test("parses zone with net_name, layer, and polygon outline", () => {
    const src = `${HEADER}
      ${TWO_LAYER_LAYERS}
      (net 0 "")
      (net 2 "GND")
      (zone (net 2) (net_name "GND") (layer "F.Cu") (hatch edge 0.508) (fill yes (mode solid)) (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))
    )`;
    const result = parseKicadPcb(src);
    expect(result.zoneCount).toBe(1);
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0]).toMatchObject({
      netName: "GND",
      layer: "F.Cu",
      fillType: "solid",
    });
    expect(result.zones[0]?.polygonPointsMm).toHaveLength(4);
  });

  test("warns when board outline missing", () => {
    const result = parseKicadPcb(`${HEADER} ${TWO_LAYER_LAYERS} )`);
    expect(result.boardOutline).toBeNull();
    expect(
      result.warnings.some((w) => w.code === "board_outline_missing"),
    ).toBe(true);
  });

  test("rejects non-pcb file", () => {
    expect(() => parseKicadPcb("(kicad_sch (version 20231120))")).toThrow(
      /Not a .kicad_pcb/,
    );
  });
});
