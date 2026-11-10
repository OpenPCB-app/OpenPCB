/**
 * H13 OP2 — footprint frame types and predicates (KF1 §3.1.2, H13 §3.2.3-3.2.4).
 *
 * Expected values are written by hand from the KF1 formulas, never recorded from
 * the code under test. KiCad sources are excerpts of `references/kicad-libs`
 * @cb8299c (Package_TO_SOT_SMD.pretty/SOT-23, Resistor_SMD.pretty/R_0603_1608Metric).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFootprintPreviewFromParsed } from "@openpcb/kicad-import";
import { parseKicadFootprint } from "@openpcb/kicad-parsers";
import { norm360 } from "../../../shared/kicad-frame/angles";
import {
  authoredFrame,
  expectedCentreV1,
  isCopperFrameInvariant,
  isQualifiedFootprintFrame,
  isVerifiedFrameClass,
  parseFootprintFrame,
  previewCopperEqual,
  previewEqual,
  rawFrameRelation,
  type RawFrameRelation,
} from "../../../shared/pcb-geometry/footprint-frame";
import type { FootprintRenderModel } from "../../../shared/rendering/types";
import {
  installedKicadTransformVersion,
  isKicadConversionQualified,
  readPreviewFrame,
} from "../../../modules/library/backend/import/frame-qualification";

type Pad = FootprintRenderModel["pads"][number] & Record<string, unknown>;

function pad(id: string, x: number, y: number, extra: Partial<Pad> = {}): Pad {
  return {
    id,
    number: id.split(":")[0]!,
    shape: "rect",
    centerMm: { x, y },
    widthMm: 1,
    heightMm: 0.6,
    rotationDeg: 0,
    ...extra,
  } as Pad;
}

function model(
  pads: Pad[],
  graphics: FootprintRenderModel["graphics"] = [],
  labels: FootprintRenderModel["labels"] = [],
): FootprintRenderModel {
  return { kind: "footprint", units: "mm", name: "T", pads, graphics, labels, bounds: null, warnings: [] };
}

function silkLine(ax: number, ay: number, bx: number, by: number): FootprintRenderModel["graphics"][number] {
  return { kind: "line", a: { x: ax, y: ay }, b: { x: bx, y: by }, strokeWidthMm: 0.12, layer: "F.SilkS" };
}

function rawLine(ax: number, ay: number, bx: number, by: number) {
  return { type: "line", layer: "F.SilkS", data: { start: [ax, ay], end: [bx, by] } };
}

const SOT23_SRC = `(footprint "SOT-23" (version 20260206) (generator "kicad-footprint-generator") (layer "F.Cu")
  (property "Reference" "REF**" (at 0 -2.4 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (fp_line (start -0.76 -1.56) (end 0.76 -1.56) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (fp_poly (pts (xy -1.3 -0.38) (xy -1.06 -0.05) (xy -1.54 -0.05)) (stroke (width 0.12) (type solid)) (fill yes) (layer "F.SilkS"))
  (pad "1" smd roundrect (at -0.9375 -0.95) (size 1.475 0.6) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (pad "2" smd roundrect (at -0.9375 0.95) (size 1.475 0.6) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (pad "3" smd roundrect (at 0.9375 0) (size 1.475 0.6) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25)))`;

const R0603_SRC = `(footprint "R_0603_1608Metric" (version 20260206) (generator "kicad-footprint-generator") (layer "F.Cu")
  (property "Reference" "REF**" (at 0 -1.43 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "R_0603_1608Metric" (at 0 1.43 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
  (fp_line (start -0.237258 -0.5225) (end 0.237258 -0.5225) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (fp_line (start -0.237258 0.5225) (end 0.237258 0.5225) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (pad "1" smd roundrect (at -0.825 0) (size 0.8 0.95) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (pad "2" smd roundrect (at 0.825 0) (size 0.8 0.95) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25)))`;

/** The installed package's version decides which frame its previews are in. */
const INSTALLED_KICAD_IMPORT = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../../node_modules/@openpcb/kicad-import/package.json"), "utf8"),
) as { version: string };
const PINNED_PRE_FRAME = INSTALLED_KICAD_IMPORT.version.startsWith("0.1.");

describe("norm360 (KF1 §3.1.2)", () => {
  test.each([
    [-1e-12, 0],
    [359.9999999999, 0],
    [-0, 0],
    [360, 0],
    [720, 0],
    [-90, 270],
    [450, 90],
    [22.5, 22.5],
    [0.1, 0.1],
    [-180, 180],
  ])("norm360(%p) === %p", (input, expected) => {
    const out = norm360(input);
    expect(Object.is(out, expected)).toBe(true);
  });

  test("fractional angles survive (no integer rounding)", () => {
    expect(norm360(-22.5)).toBe(337.5);
    expect(norm360(359.9)).toBeCloseTo(359.9, 12);
  });
});

describe("parseFootprintFrame strictness", () => {
  const ok = { frame: "openpcb-y-up", origin: "kicad-converted", transformVersion: 1, tool: "@openpcb/kicad-import" };
  test.each<[string, unknown, boolean]>([
    ["kicad-converted v1", ok, true],
    ["kicad-converted v2 (shape ok)", { ...ok, transformVersion: 2 }, true],
    ["authored v0", { frame: "openpcb-y-up", origin: "authored", transformVersion: 0, tool: "openpcb-editor" }, true],
    ["wrong frame", { ...ok, frame: "kicad-y-down" }, false],
    ["unknown origin", { ...ok, origin: "imported" }, false],
    ["missing origin", { frame: ok.frame, transformVersion: 1, tool: ok.tool }, false],
    ["kicad-converted v0", { ...ok, transformVersion: 0 }, false],
    ["authored v1", { ...ok, origin: "authored" }, false],
    ["fractional version", { ...ok, transformVersion: 1.5 }, false],
    ["string version", { ...ok, transformVersion: "1" }, false],
    ["NaN version", { ...ok, transformVersion: Number.NaN }, false],
    ["empty tool", { ...ok, tool: "" }, false],
    ["blank tool", { ...ok, tool: "   " }, false],
    ["non-string tool", { ...ok, tool: 7 }, false],
    ["tool 128 chars", { ...ok, tool: "t".repeat(128) }, true],
    ["tool 129 chars", { ...ok, tool: "t".repeat(129) }, false],
    ["null", null, false],
    ["array", [ok], false],
    ["string", "openpcb-y-up/kicad-converted/1", false],
  ])("%s", (_label, value, accepted) => {
    expect(parseFootprintFrame(value) !== null).toBe(accepted);
  });

  test("returns a fresh object with only the four KF1 keys", () => {
    const parsed = parseFootprintFrame({ ...ok, extra: "dropped" });
    expect(parsed).toEqual(ok as never);
    expect(Object.keys(parsed!).sort()).toEqual(["frame", "origin", "tool", "transformVersion"]);
  });

  test("qualification is shape/version only", () => {
    expect(isQualifiedFootprintFrame(parseFootprintFrame(ok))).toBe(true);
    expect(isQualifiedFootprintFrame(parseFootprintFrame({ ...ok, transformVersion: 2 }))).toBe(false);
    expect(isQualifiedFootprintFrame(authoredFrame("ipc-7351b"))).toBe(true);
    expect(isQualifiedFootprintFrame(null)).toBe(false);
    expect(authoredFrame("openpcb-editor")).toEqual({
      frame: "openpcb-y-up",
      origin: "authored",
      transformVersion: 0,
      tool: "openpcb-editor",
    });
  });

  test("verified classes are kicad-converted and authored only", () => {
    expect(isVerifiedFrameClass("kicad-converted")).toBe(true);
    expect(isVerifiedFrameClass("authored")).toBe(true);
    for (const cls of ["placeholder", "legacy-kicad-ydown", "ambiguous", undefined] as const) {
      expect(isVerifiedFrameClass(cls)).toBe(false);
    }
  });
});

describe("isCopperFrameInvariant", () => {
  test("SOT-23 (pads off the x axis) is not invariant", () => {
    const sot = model([pad("1:0", -0.9375, -0.95), pad("2:1", -0.9375, 0.95), pad("3:2", 0.9375, 0)]);
    expect(isCopperFrameInvariant(sot)).toBe(false);
  });

  test("0603 (pads on the x axis, quarter turns) is invariant", () => {
    expect(isCopperFrameInvariant(model([pad("1:0", -0.825, 0), pad("2:1", 0.825, 0, { rotationDeg: 90 })]))).toBe(true);
  });

  test("a 45° pad on the axis is not invariant", () => {
    expect(isCopperFrameInvariant(model([pad("1:0", -0.825, 0, { rotationDeg: 45 }), pad("2:1", 0.825, 0)]))).toBe(false);
  });

  test("paste sub-pads are ignored; degraded shapes are not invariant", () => {
    expect(isCopperFrameInvariant(model([pad("1:0", 0, 0), pad(":1", 0.3, 0.4, { role: "paste" })]))).toBe(true);
    expect(isCopperFrameInvariant(model([pad("1:0", 0, 0, { shape: "trapezoid" })]))).toBe(false);
  });

  test("the hole must sit on the axis too (offset rotated by the pad angle)", () => {
    const withOffset = (rotationDeg: number, x: number, y: number) =>
      model([pad("1:0", 1, 0, { rotationDeg, drillDiameterMm: 0.8, drillOffsetMm: { x, y } })]);
    expect(isCopperFrameInvariant(withOffset(0, 0.3, 0))).toBe(true);
    expect(isCopperFrameInvariant(withOffset(0, 0, 0.2))).toBe(false);
    // R(90)·(0.3, 0) = (0, 0.3): the hole leaves the axis.
    expect(isCopperFrameInvariant(withOffset(90, 0.3, 0))).toBe(false);
  });
});

describe("preview equality", () => {
  const base = model(
    [pad("1:0", -1, 0.5, { drillDiameterMm: 0.8 }), pad("2:1", 1, 0.5)],
    [silkLine(-1, 1, 1, 1)],
    [{ id: "a", text: "REF**", at: { x: 0, y: 2 }, fontSizeMm: 1, rotationDeg: 0, anchorX: "center", anchorY: "middle", layer: "F.SilkS" }],
  );

  test("tolerance, angle wrap and pad identity", () => {
    const nudged = model([pad("1:0", -1, 0.5 + 5e-7, { drillDiameterMm: 0.8 }), pad("2:1", 1, 0.5, { rotationDeg: 360 })]);
    expect(previewCopperEqual(base, nudged)).toBe(true);
    expect(previewCopperEqual(base, model([pad("1:0", -1, 0.5 + 2e-6, { drillDiameterMm: 0.8 }), pad("2:1", 1, 0.5)]))).toBe(false);
    expect(previewCopperEqual(base, model([pad("1:0", -1, 0.5, { drillDiameterMm: 0.8 })]))).toBe(false);
    expect(previewCopperEqual(base, model([pad("1:0", -1, 0.5), pad("2:1", 1, 0.5)]))).toBe(false);
    expect(previewCopperEqual(base, model([pad("1:0", -1, 0.5, { drillDiameterMm: 0.8, plated: false }), pad("2:1", 1, 0.5)]))).toBe(false);
  });

  test("previewEqual adds graphics and label positions, ignoring label ids", () => {
    const relabelled = model(base.pads as Pad[], base.graphics, [{ ...base.labels[0]!, id: "other-id" }]);
    expect(previewEqual(base, relabelled)).toBe(true);
    const silkMoved = model(base.pads as Pad[], [silkLine(-1, -1, 1, -1)], base.labels);
    expect(previewCopperEqual(base, silkMoved)).toBe(true);
    expect(previewEqual(base, silkMoved)).toBe(false);
    const labelMoved = model(base.pads as Pad[], base.graphics, [{ ...base.labels[0]!, at: { x: 0, y: -2 } }]);
    expect(previewEqual(base, labelMoved)).toBe(false);
  });
});

describe("expectedCentreV1 (KF1 §3.1.2, KiCad PAD::ShapePos)", () => {
  test("no offset: N·position, with −0 normalized", () => {
    expect(expectedCentreV1({ position: { x: -0.9375, y: -0.95 }, rotation: 0 })).toEqual({ x: -0.9375, y: 0.95 });
    const origin = expectedCentreV1({ position: { x: 0, y: 0 }, rotation: 90 });
    expect(Object.is(origin.y, 0)).toBe(true);
  });

  test("FRAME_PROBE pad 2: (at 1 −2 30) (offset 0.3 0.2)", () => {
    // Copper = N·at + R(30)·N·offset = (1, 2) + R(30)·(0.3, −0.2).
    // R(30)·(0.3, −0.2) = (0.3·cos30 + 0.2·sin30, 0.3·sin30 − 0.2·cos30)
    //                   = (0.2598076 + 0.1, 0.15 − 0.1732051) = (0.3598076, −0.0232051).
    const c = expectedCentreV1({ position: { x: 1, y: -2 }, rotation: 30, drillOffset: { x: 0.3, y: 0.2 } });
    expect(c.x).toBeCloseTo(1.3598076, 6);
    expect(c.y).toBeCloseTo(1.9767949, 6);
  });

  test("cardinal rotations are exact", () => {
    expect(expectedCentreV1({ position: { x: 1, y: 1 }, rotation: 90, drillOffset: { x: 0.5, y: 0 } })).toEqual({ x: 1, y: -0.5 });
  });
});

describe("rawFrameRelation", () => {
  const sotRaw = [
    { number: "1", position: { x: -0.9375, y: -0.95 }, rotation: 0 },
    { number: "2", position: { x: -0.9375, y: 0.95 }, rotation: 0 },
    { number: "3", position: { x: 0.9375, y: 0 }, rotation: 0 },
  ];
  const sotK = model(sotRaw.map((r, i) => pad(`${r.number}:${i}`, r.position.x, r.position.y)));
  const sotC = model(sotRaw.map((r, i) => pad(`${r.number}:${i}`, r.position.x, -r.position.y)));

  const r0603Raw = [
    { number: "1", position: { x: -0.825, y: 0 }, rotation: 0 },
    { number: "2", position: { x: 0.825, y: 0 }, rotation: 0 },
  ];
  const r0603Pads = [pad("1:0", -0.825, 0), pad("2:1", 0.825, 0)];
  // A one-sided silk mark: the only thing that tells K from C on symmetric copper.
  const markRaw = [rawLine(-0.5, -0.7, 0.5, -0.7)];

  test.each<[string, FootprintRenderModel | null, unknown, unknown, RawFrameRelation]>([
    ["verbatim (legacy SOT-23)", sotK, sotRaw, undefined, "verbatim"],
    ["converted-v1 (SOT-23)", sotC, sotRaw, undefined, "converted-v1"],
    ["invariant resolved by silk → verbatim", model(r0603Pads, [silkLine(-0.5, -0.7, 0.5, -0.7)]), r0603Raw, markRaw, "verbatim"],
    ["invariant resolved by silk → converted", model(r0603Pads, [silkLine(-0.5, 0.7, 0.5, 0.7)]), r0603Raw, markRaw, "converted-v1"],
    [
      "invariant (symmetric silk cannot decide)",
      model(r0603Pads, [silkLine(-0.5, -0.7, 0.5, -0.7), silkLine(-0.5, 0.7, 0.5, 0.7)]),
      r0603Raw,
      [rawLine(-0.5, -0.7, 0.5, -0.7), rawLine(-0.5, 0.7, 0.5, 0.7)],
      "invariant",
    ],
    ["invariant (no graphics)", model(r0603Pads), r0603Raw, undefined, "invariant"],
    [
      "contradictory silk fails closed",
      model(r0603Pads, [silkLine(-0.5, -0.7, 0.5, -0.7), silkLine(-0.5, 0.9, 0.5, 0.9)]),
      r0603Raw,
      [rawLine(-0.5, -0.7, 0.5, -0.7), rawLine(-0.5, -0.9, 0.5, -0.9)],
      "neither",
    ],
    ["neither (moved pad)", model([pad("1:0", -0.9375, 0.5), ...sotC.pads.slice(1)] as Pad[]), sotRaw, undefined, "neither"],
    ["neither (pad number differs)", model([pad("9:0", -0.9375, 0.95), ...sotC.pads.slice(1)] as Pad[]), sotRaw, undefined, "neither"],
    ["unusable (no raw pads)", sotC, [], undefined, "unusable"],
    ["unusable (raw not an array)", sotC, { pads: sotRaw }, undefined, "unusable"],
    ["unusable (raw pad without position)", sotC, [{ number: "1" }, ...sotRaw.slice(1)], undefined, "unusable"],
    ["unusable (preview pad id without index)", model([pad("1", -0.9375, 0.95)]), sotRaw, undefined, "unusable"],
    ["unusable (no preview)", null, sotRaw, undefined, "unusable"],
  ])("%s", (_label, preview, rawPads, rawGraphics, expected) => {
    expect(rawFrameRelation(preview, rawPads, rawGraphics)).toBe(expected);
  });

  test("converted-v1 with an offset-drill pad (FRAME_PROBE pad 2)", () => {
    const raw = [
      { number: "1", position: { x: -1, y: -2 }, rotation: 0 },
      { number: "2", position: { x: 1, y: -2 }, rotation: 30, drillOffset: { x: 0.3, y: 0.2 } },
    ];
    const preview = model([
      pad("1:0", -1, 2),
      pad("2:1", 1.3598076211, 1.9767949192, { rotationDeg: 30, drillDiameterMm: 0.8, drillOffsetMm: { x: -0.3, y: 0.2 } }),
    ]);
    expect(rawFrameRelation(preview, raw)).toBe("converted-v1");
    // The pre-0.2.0 reading (copper at `at`) is verbatim, not converted.
    const legacy = model([pad("1:0", -1, -2), pad("2:1", 1, -2, { rotationDeg: 30, drillDiameterMm: 0.8 })]);
    expect(rawFrameRelation(legacy, raw)).toBe("verbatim");
  });

  test("paste sub-pads are excluded from the relation", () => {
    const withPaste = model([...sotC.pads, pad(":3", 5, 5, { role: "paste" })] as Pad[]);
    expect(rawFrameRelation(withPaste, sotRaw)).toBe("converted-v1");
  });

  test("installed package previews relate to their own raw", () => {
    const expected = PINNED_PRE_FRAME ? "verbatim" : "converted-v1";
    for (const src of [SOT23_SRC, R0603_SRC]) {
      const parsed = parseKicadFootprint(src);
      const preview = buildFootprintPreviewFromParsed(parsed);
      // SOT-23 decides on copper; the 0603 decides on its one-sided Reference/Value text.
      expect(rawFrameRelation(preview, parsed.pads, parsed.graphics)).toBe(expected);
    }
  });
});

describe("installed-package detection (frame-qualification.ts)", () => {
  test("transform version follows the installed @openpcb/kicad-import", () => {
    if (PINNED_PRE_FRAME) {
      expect(installedKicadTransformVersion()).toBeNull();
      expect(isKicadConversionQualified()).toBe(false);
    } else {
      expect(installedKicadTransformVersion()).toBe(1);
      expect(isKicadConversionQualified()).toBe(true);
    }
  });

  test("readPreviewFrame parses the producer stamp strictly", () => {
    const stamp = { frame: "openpcb-y-up", origin: "kicad-converted", transformVersion: 1, tool: "@openpcb/kicad-import" };
    expect(readPreviewFrame({ kind: "footprint", frame: stamp })).toEqual(stamp as never);
    expect(readPreviewFrame({ kind: "footprint", frame: { ...stamp, transformVersion: "1" } })).toBeNull();
    expect(readPreviewFrame({ kind: "footprint" })).toBeNull();
    expect(readPreviewFrame(null)).toBeNull();
    expect(readPreviewFrame("frame")).toBeNull();
  });
});
