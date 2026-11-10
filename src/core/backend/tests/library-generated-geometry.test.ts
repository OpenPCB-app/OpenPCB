import { describe, expect, test } from "bun:test";
import {
  ALL_FAMILIES,
  generateFootprint,
} from "../../../shared/rendering/ipc7351b";
import {
  defaultValues,
  getTemplate,
  PARAMETRIC_TEMPLATES,
  type ParamValues,
} from "../../../shared/rendering/parametric";
import type { FootprintRenderSourcePad } from "../../../shared/rendering/types";
import {
  assertGeneratedGeometry,
  generatedGeometryDefects,
} from "../../../modules/library/backend/import/generated-geometry";
import {
  resolveGeneratedFootprint,
  UnqualifiedGeneratorError,
} from "../../../modules/library/backend/import/resolve-generated-footprint";
import { installedIpcQualification } from "../../../modules/library/shared/generator-qualification";

const LEGACY_INSTALLED = installedIpcQualification() === null;

function pad(
  id: string,
  number: string,
  x: number,
  y: number,
  extra: Partial<FootprintRenderSourcePad> & Record<string, unknown> = {},
): FootprintRenderSourcePad {
  return {
    id,
    number,
    shape: "rect",
    centerMm: { x, y },
    widthMm: 1,
    heightMm: 1,
    rotationDeg: 0,
    layer: "F.Cu",
    ...extra,
  } as FootprintRenderSourcePad;
}

function kinds(pads: readonly FootprintRenderSourcePad[]): string[] {
  return generatedGeometryDefects(pads).map((defect) => defect.kind);
}

// The four schema-valid overlapping sets reproduced in rendering-core's
// parametric-geometry.test.ts (the all-"" mounting array among them).
const OVERLAPPING: readonly { template: string; values: ParamValues }[] = [
  { template: "pin-header", values: { rows: 1, pinsPerRow: 4, pitchMm: 1.27, mount: "tht", orientation: "vertical" } },
  { template: "pin-header", values: { rows: 1, pinsPerRow: 4, pitchMm: 0.5, mount: "smd", orientation: "vertical" } },
  { template: "screw-terminal", values: { poles: 2, pitchMm: 2.54, drillMm: 2.5 } },
  { template: "mounting-array", values: { rows: 1, cols: 2, pitchXMm: 1, pitchYMm: 1, drillMm: 8, plated: true } },
];

const VALID_MOUNTING_ARRAYS: readonly ParamValues[] = [
  { rows: 2, cols: 2, pitchXMm: 20, pitchYMm: 20, drillMm: 3.2, plated: false },
  { rows: 2, cols: 2, pitchXMm: 20, pitchYMm: 20, drillMm: 3.2, plated: true },
  { rows: 3, cols: 2, pitchXMm: 10, pitchYMm: 15, drillMm: 2.2, plated: true },
];

describe("template reproductions", () => {
  for (const { template, values } of OVERLAPPING) {
    test(`${template} ${JSON.stringify(values)} is rejected`, () => {
      const source = getTemplate(template)!.generate(values).source;
      const defects = generatedGeometryDefects(source.pads);
      expect(defects.some((defect) => defect.kind === "pad-overlap")).toBe(true);
      expect(() => assertGeneratedGeometry(source)).toThrow(
        UnqualifiedGeneratorError,
      );
      expect(() =>
        resolveGeneratedFootprint({
          generator: { kind: "template", templateId: template, params: values },
        }),
      ).toThrow("overlap");
    });
  }

  test("the all-\"\" mounting array overlap is caught on copper AND on the holes", () => {
    const source = getTemplate("mounting-array")!.generate(OVERLAPPING[3]!.values)
      .source;
    const defects = generatedGeometryDefects(source.pads);
    expect(defects.map((defect) => defect.kind).sort()).toEqual([
      "drill-overlap",
      "pad-overlap",
    ]);
    expect(defects[0]!.padIds).toEqual(["hole-1", "hole-2"]);
    expect(defects[0]!.padNumbers).toEqual(["", ""]);
  });

  for (const values of VALID_MOUNTING_ARRAYS) {
    test(`valid all-"" mounting array ${JSON.stringify(values)} is accepted`, () => {
      const source = getTemplate("mounting-array")!.generate(values).source;
      expect(source.pads.every((p) => p.number === "")).toBe(true);
      expect(generatedGeometryDefects(source.pads)).toEqual([]);
      expect(() =>
        resolveGeneratedFootprint({
          generator: { kind: "template", templateId: "mounting-array", params: values },
        }),
      ).not.toThrow();
    });
  }

  test("every template's defaults generate clean geometry", () => {
    for (const template of PARAMETRIC_TEMPLATES) {
      const values = defaultValues(template.schema);
      expect(generatedGeometryDefects(template.generate(values).source.pads)).toEqual([]);
    }
  });

  test("the message names at most five defects", () => {
    const source = getTemplate("pin-header")!.generate({
      rows: 1,
      pinsPerRow: 20,
      pitchMm: 0.5,
      mount: "tht",
      orientation: "vertical",
    }).source;
    let message = "";
    try {
      assertGeneratedGeometry(source);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/; and \d+ more\. Regenerate it/);
    expect(message.split("; ").length).toBe(6);
  });
});

describe("pad numbering", () => {
  test("a repeated non-empty number on separate copper is a defect", () => {
    const defects = generatedGeometryDefects([
      pad("a", "1", 0, 0),
      pad("b", "1", 5, 0),
      pad("c", "2", 10, 0),
    ]);
    expect(defects).toEqual([
      { kind: "duplicate-pad-number", padIds: ["a", "b"], padNumbers: ["1", "1"] },
    ]);
  });

  test("a same-number stack (EP with in-pad vias, both sides) is allowed", () => {
    expect(
      kinds([
        pad("ep", "5", 0, 0, { widthMm: 3, heightMm: 3 }),
        pad("via-1", "5", -0.8, 0, {
          shape: "circle",
          widthMm: 0.6,
          heightMm: 0.6,
          drillDiameterMm: 0.3,
        }),
        pad("via-2", "5", 0.8, 0, {
          shape: "circle",
          widthMm: 0.6,
          heightMm: 0.6,
          drillDiameterMm: 0.3,
        }),
        pad("ep-back", "5", 0, 0, { widthMm: 2, heightMm: 2, layer: "B.Cu" }),
        pad("pin", "1", 3, 0),
      ]),
    ).toEqual([]);
  });

  test("empty-number pads are exempt from duplicates but not from overlap", () => {
    expect(kinds([pad("h1", "", 0, 0), pad("h2", "", 10, 0)])).toEqual([]);
    expect(kinds([pad("h1", "", 0, 0), pad("h2", "", 0.5, 0)])).toEqual([
      "pad-overlap",
    ]);
  });

  test("non-positive sizes are defects and skip the pair checks", () => {
    expect(
      kinds([
        pad("zero", "1", 0, 0, { widthMm: 0 }),
        pad("nan", "2", 0, 0, { heightMm: Number.NaN }),
        pad("ok", "3", 0, 0),
      ]),
    ).toEqual(["non-positive-size", "non-positive-size"]);
  });
});

describe("exact copper and drill gaps", () => {
  test("pads on different copper layers do not overlap each other", () => {
    expect(
      kinds([pad("top", "1", 0, 0), pad("bottom", "2", 0, 0, { layer: "B.Cu" })]),
    ).toEqual([]);
  });

  test("rounded corners are measured exactly, not by their bounds", () => {
    const round = { shape: "roundrect" as const, roundrectRatio: 0.5 };
    // Bounds overlap by 0.2 on both axes; the discs are 0.131 apart.
    expect(kinds([pad("a", "1", 0, 0, round), pad("b", "2", 0.8, 0.8, round)])).toEqual(
      [],
    );
    expect(kinds([pad("a", "1", 0, 0), pad("b", "2", 0.8, 0.8)])).toEqual([
      "pad-overlap",
    ]);
  });

  test("touching copper counts as overlap", () => {
    expect(kinds([pad("a", "1", 0, 0), pad("b", "2", 1, 0)])).toEqual([
      "pad-overlap",
    ]);
  });

  test("structural drill offset: holes overlap while the copper does not", () => {
    // Fields the pinned pad type lacks are read structurally.
    expect(
      kinds([
        pad("a", "1", 0, 0, { drillDiameterMm: 0.5, drillOffsetMm: { x: 2, y: 0 } }),
        pad("b", "2", 3, 0, { drillDiameterMm: 0.5, drillOffsetMm: { x: -1, y: 0 } }),
      ]),
    ).toEqual(["drill-overlap"]);
  });

  test("structural drill slot: the routed stadium is measured, not its tool disc", () => {
    const slotted = (id: string, number: string, x: number) =>
      pad(id, number, x, 0, {
        shape: "oval",
        widthMm: 1,
        heightMm: 3,
        drillDiameterMm: 0.5,
        drillSlotMm: { widthMm: 0.5, heightMm: 2.5 },
        rotationDeg: 90,
      });
    // Rotated 90°: the slots run along X; centres 2.2 apart, slot length 2.5.
    expect(kinds([slotted("a", "1", 0), slotted("b", "2", 2.2)])).toEqual([
      "pad-overlap",
      "drill-overlap",
    ]);
  });
});

test.if(LEGACY_INSTALLED)(
  "legacy IPC outputs: only QFN carries a geometric defect (the rest need the fingerprint policy)",
  () => {
    const families = new Set<string>();
    for (const family of ALL_FAMILIES) {
      for (const size of family.sizes) {
        for (const density of ["most", "nominal", "least"] as const) {
          const pads = generateFootprint(family.id, size.label, density).source.pads;
          if (generatedGeometryDefects(pads).length > 0) families.add(family.id);
        }
      }
    }
    expect([...families]).toEqual(["qfn"]);
  },
);
