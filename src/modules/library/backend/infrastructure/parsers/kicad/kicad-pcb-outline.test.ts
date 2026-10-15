import { describe, expect, test } from "bun:test";
import { parseKicadPcb } from "./kicad-pcb-parser";

// H14 S2 / §3.10.1: every Edge.Cuts primitive, board and footprint, with arcs
// and circles kept exact; chaining into loops is the planner's job.

const HEADER = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))`;

function edges(body: string) {
  return parseKicadPcb(`${HEADER} ${body} )`).edgeCuts;
}

describe("parseKicadPcb — Edge.Cuts primitives", () => {
  test("keeps every loop: an arc-cornered outer, a rect cutout and a circle", () => {
    const result = edges(`
      (gr_line (start 2 0) (end 48 0) (layer "Edge.Cuts"))
      (gr_arc (start 48 0) (mid 49.4142 0.5858) (end 50 2) (layer "Edge.Cuts"))
      (gr_line (start 50 2) (end 50 30) (layer "Edge.Cuts"))
      (gr_line (start 50 30) (end 0 30) (layer "Edge.Cuts"))
      (gr_line (start 0 30) (end 0 2) (layer "Edge.Cuts"))
      (gr_arc (start 0 2) (mid 0.5858 0.5858) (end 2 0) (layer "Edge.Cuts"))
      (gr_rect (start 10 10) (end 14 12) (layer "Edge.Cuts"))
      (gr_circle (center 30 15) (end 31.5 15) (layer "Edge.Cuts"))
      (gr_line (start 0 0) (end 9 9) (layer "F.SilkS"))
    `);
    expect(result.map((e) => e.kind)).toEqual([
      "line", "arc", "line", "line", "line", "arc",
      "line", "line", "line", "line",
      "circle",
    ]);
    expect(result[1]).toMatchObject({
      kind: "arc",
      start: { xMm: 48, yMm: 0 },
      mid: { xMm: 49.4142, yMm: 0.5858 },
      end: { xMm: 50, yMm: 2 },
    });
    expect(result[10]).toMatchObject({
      kind: "circle",
      center: { xMm: 30, yMm: 15 },
      edge: { xMm: 31.5, yMm: 15 },
    });
    // The rect is a closed chain of four lines sharing its source.
    const rect = result.slice(6, 10);
    expect(rect.every((e) => e.source.token === "gr_rect")).toBe(true);
    expect(rect[3]).toMatchObject({
      start: { xMm: 10, yMm: 12 },
      end: { xMm: 10, yMm: 10 },
    });
    expect(result.every((e) => e.source.footprintIndex === null)).toBe(true);
  });

  test("a gr_poly with a contour arc becomes a closed line/arc chain", () => {
    const result = edges(`
      (gr_poly (pts (xy 0 0) (xy 10 0) (arc (start 10 0) (mid 15 5) (end 10 10)) (xy 0 10))
        (layer "Edge.Cuts"))
    `);
    expect(result.map((e) => e.kind)).toEqual(["line", "arc", "line", "line"]);
    expect(result[2]).toMatchObject({
      start: { xMm: 10, yMm: 10 },
      end: { xMm: 0, yMm: 10 },
    });
    // Closing edge back to the first vertex.
    expect(result[3]).toMatchObject({
      start: { xMm: 0, yMm: 10 },
      end: { xMm: 0, yMm: 0 },
    });
  });

  test("footprint Edge.Cuts primitives stay footprint-local and name their footprint", () => {
    const result = edges(`
      (gr_rect (start 0 0) (end 40 30) (layer "Edge.Cuts"))
      (footprint "Conn:NoSlot" (layer "F.Cu") (at 5 5)
        (property "Reference" "J9" (at 0 0) (layer "F.SilkS")))
      (footprint "Conn:USB_C" (layer "F.Cu") (at 20 15 90)
        (property "Reference" "J1" (at 0 0) (layer "F.SilkS"))
        (fp_line (start -0.3 -1) (end 0.3 -1) (stroke (width 0.05)) (layer "Edge.Cuts"))
        (fp_arc (start 0.3 -1) (mid 0.6 -0.7) (end 0.3 -0.4) (layer "Edge.Cuts"))
        (fp_circle (center 2 2) (end 2.5 2) (layer "Edge.Cuts"))
        (fp_line (start 9 9) (end 8 8) (layer "F.SilkS")))
    `);
    const fromFootprint = result.filter((e) => e.source.footprintIndex !== null);
    expect(fromFootprint.map((e) => [e.kind, e.source.token])).toEqual([
      ["line", "fp_line"],
      ["arc", "fp_arc"],
      ["circle", "fp_circle"],
    ]);
    expect(fromFootprint[0]!.source).toMatchObject({
      footprintIndex: 1,
      reference: "J1",
    });
    expect(fromFootprint[0]).toMatchObject({
      start: { xMm: -0.3, yMm: -1 },
      end: { xMm: 0.3, yMm: -1 },
    });
  });

  test("a legacy angle-only gr_arc yields no primitive (the census still counts it)", () => {
    expect(
      edges(`(gr_arc (start 0 0) (end 1 0) (angle 90) (layer "Edge.Cuts"))`),
    ).toEqual([]);
  });
});
