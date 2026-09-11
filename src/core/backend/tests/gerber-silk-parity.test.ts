/**
 * Export parity for the ARTWORK layers: the legend and mask files the fab
 * receives ARE the artwork model the DFM checks judge (DFM contract 11 §1.5).
 *
 * For every golden and the synthetic fixture below, the test emits the two
 * legend files and the two mask files, parses them back — strokes, regions,
 * flashes and the aperture table — and compares them 1:1 AND IN ORDER against
 * `buildSilkArtwork` / `buildMaskOpenings` for that face. A missing stroke, an
 * extra flash, a reordered opening and a wrong stroke width all fail.
 *
 * What each half proves. The STROKE / REGION half is fully independent: the
 * expected vertices come from the model and the actual ones from the file, so
 * every transform (mirror, side flip, keep-upright, chord sampling) is checked
 * against nothing but the emitted bytes. The MASK half proves ORDER and
 * IDENTITY — that flash *i* of the file is opening *i* of the model with that
 * opening's shape. It reads an aperture's parameters back through a fresh
 * `ApertureTable`, i.e. it trusts the shape→`%ADD`/`%AM` FORMATTER (a pure,
 * bijective map) while checking everything the model decides. Whether the
 * formatter itself obeys contract 10 §6.2 is `gerber-pad-parity.test.ts`'s
 * independent question, and it stays independent.
 *
 * Tolerances: 2e-6 mm per vertex (Gerber's 1 nm coordinate grid rounds by at
 * most 5e-7) and 1e-6 mm per aperture dimension (`gerberDim` keeps six
 * decimals).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildGerberLayer } from "../../../modules/designer/backend/export/gerber/writer";
import { ApertureTable } from "../../../modules/designer/backend/export/apertures";
import { buildCopperRecords } from "../../../shared/pcb-connectivity";
import {
  freePadCopperShape,
  padCopperShape,
  placementPads,
} from "../../../shared/pcb-geometry/pad-geometry";
import {
  freePadItemKey,
  padItemKey,
} from "../../../shared/pcb-connectivity/copper-items";
import type { PadCopperShape } from "../../../shared/pcb-geometry/pad-annular";
import {
  apertureShapeRing,
  type ApertureShape,
} from "../../../shared/rendering/pcb/artwork/aperture-shape";
import {
  buildMaskOpenings,
  type MaskOpening,
} from "../../../shared/rendering/pcb/artwork/mask-artwork";
import {
  buildSilkArtwork,
  type SilkArtwork,
  type SilkFace,
} from "../../../shared/rendering/pcb/artwork/silk-artwork";
import { textToStrokes } from "../../../shared/rendering/pcb/artwork/stroke-font";
import {
  parseGerber,
  type GerberPrimitive,
  type ParsedGerber,
} from "./helpers/gerber-parse";
import { fixtureToProjection } from "./helpers/drc-golden";
import { freePad, pad, projection } from "./helpers/drc-fixtures";
import type {
  DesignerPcbProjection,
  PcbPlacedPart,
  PcbPointMm,
} from "../../../sdks/designer";
import type { PreviewGraphic, PreviewLabel } from "../../../shared/rendering/types";

const GOLDEN_DIR = join(import.meta.dir, "fixtures/drc/golden");
const VERTEX_TOL_MM = 2e-6;
const DIM_TOL_MM = 1e-6;

const FACES: ReadonlyArray<{ face: SilkFace; silk: "silk.top" | "silk.bottom"; mask: "mask.top" | "mask.bottom" }> = [
  { face: "top", silk: "silk.top", mask: "mask.top" },
  { face: "bottom", silk: "silk.bottom", mask: "mask.bottom" },
];

// =========================================================================
// Expectation builders (the model, read straight)
// =========================================================================

function silkModel(proj: DesignerPcbProjection): SilkArtwork {
  return buildSilkArtwork({
    placements: proj.placements,
    overlayShapes: proj.overlayShapes,
    overlayTexts: proj.overlayTexts,
  });
}

function maskModel(proj: DesignerPcbProjection): MaskOpening[] {
  const records = buildCopperRecords({
    layerCount: proj.board.layerCount,
    placements: proj.placements,
    padNetIds: new Map(Object.entries(proj.padNets ?? {})),
    freePads: proj.freePads,
    traces: proj.traces,
    vias: proj.vias,
  });
  const padShapes = new Map<string, PadCopperShape>();
  for (const placement of proj.placements) {
    const occurrence = new Map<string, number>();
    for (const p of placementPads(placement)) {
      const n = occurrence.get(p.number) ?? 0;
      occurrence.set(p.number, n + 1);
      padShapes.set(
        padItemKey(placement.id, p.number, n),
        padCopperShape(placement, p),
      );
    }
  }
  for (const fp of proj.freePads) {
    padShapes.set(freePadItemKey(fp.id), freePadCopperShape(fp));
  }
  return buildMaskOpenings({
    solderMaskExpansionMm: proj.board.solderMaskExpansionMm,
    layerCount: proj.board.layerCount,
    placements: proj.placements,
    freePads: proj.freePads,
    vias: proj.vias,
    records,
    padShapes,
  });
}

/**
 * An aperture shape's `%AM` / `%ADD` parameters, read back through the parser —
 * the same reduction the file's own aperture went through, so the two are
 * comparable primitive by primitive.
 */
function primitivesOfShape(shape: ApertureShape): GerberPrimitive[] {
  const table = new ApertureTable();
  const code = table.allocate(shape, "SolderMask");
  const text = [...table.emitMacros(), ...table.emitDefinitions()].join("\r\n");
  return parseGerber(text).apertures.get(code)!.primitives;
}

function expectPointsClose(
  actual: ReadonlyArray<{ xMm: number; yMm: number }>,
  expected: ReadonlyArray<PcbPointMm>,
  label: string,
): void {
  expect(`${label} vertices: ${actual.length}`).toBe(
    `${label} vertices: ${expected.length}`,
  );
  for (let i = 0; i < expected.length; i += 1) {
    expect(Math.abs(actual[i]!.xMm - expected[i]!.x)).toBeLessThanOrEqual(
      VERTEX_TOL_MM,
    );
    expect(Math.abs(actual[i]!.yMm - expected[i]!.y)).toBeLessThanOrEqual(
      VERTEX_TOL_MM,
    );
  }
}

function expectPrimitivesClose(
  actual: readonly GerberPrimitive[],
  expected: readonly GerberPrimitive[],
  label: string,
): void {
  expect(`${label} primitives: ${actual.length}`).toBe(
    `${label} primitives: ${expected.length}`,
  );
  for (let i = 0; i < expected.length; i += 1) {
    const a = actual[i]!;
    const e = expected[i]!;
    expect(`${label}[${i}] ${a.kind}`).toBe(`${label}[${i}] ${e.kind}`);
    expect(Math.abs(a.cxMm - e.cxMm)).toBeLessThanOrEqual(DIM_TOL_MM);
    expect(Math.abs(a.cyMm - e.cyMm)).toBeLessThanOrEqual(DIM_TOL_MM);
    if (a.kind === "circle" && e.kind === "circle") {
      expect(Math.abs(a.diameterMm - e.diameterMm)).toBeLessThanOrEqual(
        DIM_TOL_MM,
      );
    } else if (a.kind === "rect" && e.kind === "rect") {
      expect(Math.abs(a.widthMm - e.widthMm)).toBeLessThanOrEqual(DIM_TOL_MM);
      expect(Math.abs(a.heightMm - e.heightMm)).toBeLessThanOrEqual(DIM_TOL_MM);
      expect(Math.abs(a.rotationDeg - e.rotationDeg)).toBeLessThanOrEqual(
        DIM_TOL_MM,
      );
    }
  }
}

// =========================================================================
// The parity assertions
// =========================================================================

function assertLegendMatchesModel(
  proj: DesignerPcbProjection,
  name: string,
): void {
  const artwork = silkModel(proj);
  for (const { face, silk } of FACES) {
    const parsed: ParsedGerber = parseGerber(buildGerberLayer(proj, silk, []));
    const strokes = artwork.strokes.filter((s) => s.face === face);
    const regions = artwork.regions.filter((r) => r.face === face);
    expect(`${name}/${silk}: ${parsed.strokes.length} strokes`).toBe(
      `${name}/${silk}: ${strokes.length} strokes`,
    );
    expect(`${name}/${silk}: ${parsed.regions.length} regions`).toBe(
      `${name}/${silk}: ${regions.length} regions`,
    );
    strokes.forEach((stroke, i) => {
      const actual = parsed.strokes[i]!;
      expectPointsClose(actual.points, stroke.pointsMm, `${name}/${silk}[${i}]`);
      const aperture = parsed.apertures.get(actual.apertureCode);
      expect(aperture?.aperFunction).toBe("NonConductor");
      const prim = aperture!.primitives;
      expect(prim.length).toBe(1);
      expect(prim[0]!.kind).toBe("circle");
      const diameterMm =
        prim[0]!.kind === "circle" ? prim[0]!.diameterMm : Number.NaN;
      expect(Math.abs(diameterMm - stroke.widthMm)).toBeLessThanOrEqual(
        DIM_TOL_MM,
      );
    });
    regions.forEach((region, i) => {
      const actual = parsed.regions[i]!;
      // A legend file never switches polarity: every region is printed ink.
      expect(actual.polarity).toBe("dark");
      expectPointsClose(
        actual.points,
        region.ring,
        `${name}/${silk} region[${i}]`,
      );
    });
  }
}

function assertMaskMatchesModel(
  proj: DesignerPcbProjection,
  name: string,
): void {
  const openings = maskModel(proj);
  for (const { face, mask } of FACES) {
    const parsed = parseGerber(buildGerberLayer(proj, mask, []));
    const expected = openings.filter((o) => o.face === face);
    expect(`${name}/${mask}: ${parsed.flashes.length} flashes`).toBe(
      `${name}/${mask}: ${expected.length} flashes`,
    );
    expected.forEach((opening, i) => {
      const flash = parsed.flashes[i]!;
      expect(Math.abs(flash.xMm - opening.centerMm.x)).toBeLessThanOrEqual(
        DIM_TOL_MM,
      );
      expect(Math.abs(flash.yMm - opening.centerMm.y)).toBeLessThanOrEqual(
        DIM_TOL_MM,
      );
      const aperture = parsed.apertures.get(flash.code);
      expect(aperture?.aperFunction).toBe("SolderMask");
      expectPrimitivesClose(
        aperture!.primitives,
        primitivesOfShape(opening.shape),
        `${name}/${mask}[${i}]`,
      );
    });
  }
}

// =========================================================================
// Goldens
// =========================================================================

const goldens = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
  .sort();

describe("Gerber artwork parity — the legend and mask ARE the model", () => {
  test("the golden corpus is present", () => {
    expect(goldens.length).toBeGreaterThan(0);
  });

  for (const file of goldens) {
    const name = file.replace(/\.json$/, "");
    test(`${name}: legend and mask files match the artwork model`, () => {
      const proj = fixtureToProjection(
        JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf8")),
      );
      assertLegendMatchesModel(proj, name);
      assertMaskMatchesModel(proj, name);
    });
  }
});

// =========================================================================
// Synthetic projection — every artwork source the goldens do not carry
// =========================================================================

function silkPlacement(
  id: string,
  opts: {
    layer: PcbPlacedPart["layer"];
    mirrored: boolean;
    rotationDeg: number;
    positionMm: PcbPointMm;
    reference: string;
    graphics: PreviewGraphic[];
    labels: PreviewLabel[];
  },
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c",
    reference: opts.reference,
    positionMm: opts.positionMm,
    rotationDeg: opts.rotationDeg,
    mirrored: opts.mirrored,
    layer: opts.layer,
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
        graphics: opts.graphics,
        labels: opts.labels,
        bounds: null,
        warnings: [],
      },
    },
  };
}

/** Every footprint graphic kind, all on `F.SilkS`. */
const SILK_GRAPHICS: PreviewGraphic[] = [
  {
    kind: "line",
    a: { x: -1, y: -1 },
    b: { x: 1, y: -1 },
    strokeWidthMm: 0.12,
    layer: "F.SilkS",
  },
  {
    kind: "rect",
    x: -1.5,
    y: -1.5,
    width: 3,
    height: 3,
    fill: "none",
    strokeWidthMm: 0.12,
    layer: "F.SilkS",
  },
  {
    kind: "circle",
    center: { x: 0, y: 0 },
    radiusMm: 0.9,
    fill: "solid",
    strokeWidthMm: 0.1,
    layer: "F.SilkS",
  },
  {
    kind: "arc3",
    start: { x: -2, y: 0 },
    mid: { x: 0, y: 2 },
    end: { x: 2, y: 0 },
    strokeWidthMm: 0.15,
    layer: "F.SilkS",
  },
  {
    kind: "polyline",
    points: [
      { x: 0, y: 2.5 },
      { x: 1, y: 3.5 },
      { x: -1, y: 3.5 },
    ],
    closed: true,
    fill: "solid",
    strokeWidthMm: 0.11,
    layer: "F.SilkS",
  },
  {
    kind: "bezier",
    points: [
      { x: -2, y: -2 },
      { x: -1, y: -3 },
      { x: 1, y: -3 },
      { x: 2, y: -2 },
    ],
    strokeWidthMm: 0.13,
    layer: "F.SilkS",
  },
  // A fab-layer graphic is NOT silk and must not reach the legend.
  {
    kind: "line",
    a: { x: -3, y: -3 },
    b: { x: 3, y: -3 },
    strokeWidthMm: 0.1,
    layer: "F.Fab",
  },
];

function refdesLabel(): PreviewLabel {
  return {
    id: "ref",
    text: "REF**",
    at: { x: 0, y: 2 },
    fontSizeMm: 0.8,
    rotationDeg: 0,
    anchorX: "center",
    anchorY: "middle",
    layer: "F.SilkS",
    role: "reference",
  };
}

function syntheticProjection(): DesignerPcbProjection {
  return projection({
    placements: [
      // Mirrored but on the FRONT: reflected in X, silk stays on the top face,
      // and the 180° placement rotation drives keep-upright.
      silkPlacement("A", {
        layer: "F.Cu",
        mirrored: true,
        rotationDeg: 180,
        positionMm: { x: 10, y: 10 },
        reference: "U7",
        graphics: SILK_GRAPHICS,
        labels: [refdesLabel()],
      }),
      // On the BACK: mirrored AND side-flipped, so its `F.SilkS` artwork lands
      // on the bottom legend.
      silkPlacement("B", {
        layer: "B.Cu",
        mirrored: false,
        rotationDeg: 45,
        positionMm: { x: -12, y: 6 },
        reference: "R3",
        graphics: SILK_GRAPHICS,
        labels: [refdesLabel(), { ...refdesLabel(), id: "b", layer: "B.SilkS" }],
      }),
    ],
    overlayShapes: [
      {
        id: "os-rect",
        layer: "F.SilkS",
        kind: "rect",
        pointsMm: [
          { x: 20, y: 20 },
          { x: 24, y: 23 },
        ],
        strokeWidthMm: 0.2,
        fill: "solid",
        lockedAt: null,
      },
      {
        id: "os-circle",
        layer: "F.SilkS",
        kind: "circle",
        pointsMm: [
          { x: 30, y: 20 },
          { x: 32, y: 20 },
        ],
        strokeWidthMm: 0.18,
        fill: "none",
        lockedAt: null,
      },
      {
        id: "os-poly",
        layer: "B.SilkS",
        kind: "polygon",
        pointsMm: [
          { x: 0, y: 30 },
          { x: 4, y: 30 },
          { x: 2, y: 34 },
        ],
        strokeWidthMm: 0.15,
        fill: "solid",
        lockedAt: null,
      },
    ],
    overlayTexts: [
      {
        id: "ot-1",
        layer: "B.SilkS",
        positionMm: { x: 5, y: -5 },
        text: "Rev B",
        fontSizeMm: 1.4,
        rotationDeg: 15,
        mirror: true,
        justify: "right",
        lockedAt: null,
      },
    ],
    freePads: [
      // A DRILLED `smd` pad: the pad opening on its own face, the drill relief
      // on the far one (DFM contract 11 §1.3, the 06 §9 fix).
      freePad("fp_smd", {
        padType: "smd",
        shape: "rect",
        center: { x: -20, y: -20 },
        widthMm: 1.2,
        heightMm: 1.2,
        drillMm: 0.6,
        layer: "F.Cu",
      }),
      // A `hole` pad whose SLOT reaches past the declared pad size: the pad
      // opening plus a slot relief, on both faces.
      freePad("fp_hole", {
        padType: "hole",
        shape: "circle",
        center: { x: -26, y: -20 },
        widthMm: 1.4,
        heightMm: 1.4,
        drillMm: 1,
        drillSlot: { widthMm: 1, lengthMm: 3, angleDeg: 30 },
        layer: "F.Cu",
      }),
    ],
  });
}

describe("Gerber artwork parity — synthetic sources the goldens lack", () => {
  const proj = syntheticProjection();

  test("legend and mask files match the artwork model", () => {
    assertLegendMatchesModel(proj, "synthetic");
    assertMaskMatchesModel(proj, "synthetic");
  });

  test("the two placement predicates are independent", () => {
    const artwork = silkModel(proj);
    const fromA = (face: SilkFace): number =>
      artwork.strokes.filter(
        (s) =>
          s.face === face &&
          s.source.kind === "placement" &&
          s.source.placementId === "A",
      ).length;
    const fromB = (face: SilkFace): number =>
      artwork.strokes.filter(
        (s) =>
          s.face === face &&
          s.source.kind === "placement" &&
          s.source.placementId === "B",
      ).length;
    // A is mirrored but on F.Cu: no side flip, everything stays on top.
    expect(fromA("top")).toBeGreaterThan(0);
    expect(fromA("bottom")).toBe(0);
    // B is on B.Cu: its `F.SilkS` graphics flip to the bottom face, and its
    // one `B.SilkS` label flips to the top.
    expect(fromB("bottom")).toBeGreaterThan(0);
    expect(fromB("top")).toBeGreaterThan(0);
  });

  test("a refdes label carries the PLACEMENT's designator, kept upright", () => {
    const artwork = silkModel(proj);
    const labelStrokes = artwork.strokes.filter(
      (s) => s.source.kind === "placement" && "labelId" in s.source,
    );
    expect(labelStrokes.length).toBeGreaterThan(0);
    // `REF**` never reaches the fab: the stroke count is the rendered
    // designator's, and the keep-upright rule turns the 180° placement's label
    // back to a world rotation of 0.
    const upright = textToStrokes("U7", {
      originMm: { x: 10, y: 8 },
      sizeMm: 0.8,
      rotationDeg: 0,
      mirror: true,
      justify: "center",
      anchorY: "middle",
    }).filter((poly) => poly.length >= 2);
    const fromA = labelStrokes.filter(
      (s) => s.source.kind === "placement" && s.source.placementId === "A",
    );
    expect(fromA.length).toBe(upright.length);
    fromA.forEach((stroke, i) => {
      stroke.pointsMm.forEach((p, k) => {
        expect(Math.abs(p.x - upright[i]![k]!.x)).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(p.y - upright[i]![k]!.y)).toBeLessThanOrEqual(1e-9);
      });
    });
  });

  test("a drilled `smd` free pad relieves its FAR face only with the drill", () => {
    const openings = maskModel(proj).filter(
      (o) => o.anchor.kind === "freePad" && o.anchor.freePadId === "fp_smd",
    );
    const top = openings.filter((o) => o.face === "top");
    const bottom = openings.filter((o) => o.face === "bottom");
    expect(top.length).toBe(1);
    expect(top[0]!.shape.kind).toBe("rect");
    expect(top[0]!.copper).toBe(true);
    expect(bottom.length).toBe(1);
    // drill 0.6 + 2 × the board's 0.075 mm expansion.
    expect(bottom[0]!.shape).toEqual({ kind: "circle", diameterMm: 0.75 });
    expect(bottom[0]!.copper).toBe(false);
    expect(bottom[0]!.netId).toBe(null);
  });

  test("a slotted `hole` free pad opens pad + slot relief on both faces", () => {
    const openings = maskModel(proj).filter(
      (o) => o.anchor.kind === "freePad" && o.anchor.freePadId === "fp_hole",
    );
    expect(openings.map((o) => o.face)).toEqual([
      "top",
      "top",
      "bottom",
      "bottom",
    ]);
    // The pad shape first, then the drill relief — the slot axis is not
    // orthogonal, so the relief is a rotated obround.
    expect(openings[0]!.shape.kind).toBe("circle");
    const relief = openings[1]!.shape;
    expect(relief.kind).toBe("obround");
    if (relief.kind !== "obround") throw new Error("unreachable");
    // A 3 mm slot of a 1 mm tool, plus the board's 0.075 mm expansion per side:
    // across = 1.15, along = (3 − 1) + 1.15. The axis is not orthogonal, so the
    // relief keeps its angle and becomes a rotated macro.
    expect(Math.abs(relief.widthMm - 3.15)).toBeLessThanOrEqual(DIM_TOL_MM);
    expect(Math.abs(relief.heightMm - 1.15)).toBeLessThanOrEqual(DIM_TOL_MM);
    expect(Math.abs((relief.rotationDeg ?? 0) - 30)).toBeLessThanOrEqual(1e-9);
    // Every opening of an NPTH pad exposes no copper.
    expect(openings.every((o) => !o.copper)).toBe(true);
  });
});

// =========================================================================
// `apertureShapeRing` — the polygon the DFM checks measure an opening by
// =========================================================================

function bbox(ring: readonly PcbPointMm[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return {
    minX: Math.min(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)),
    maxX: Math.max(...ring.map((p) => p.x)),
    maxY: Math.max(...ring.map((p) => p.y)),
  };
}

describe("apertureShapeRing — an opening's ring circumscribes its shape", () => {
  const at: PcbPointMm = { x: 3, y: -2 };

  test("each kind uses the pad-outline builder it corresponds to", () => {
    // 48-segment circle / oval (two 24-chord caps, endpoints included), six
    // arcs per roundrect corner, a sharp rect (DFM contract 11 §1.3).
    expect(apertureShapeRing({ kind: "circle", diameterMm: 1 }, at).length).toBe(
      48,
    );
    expect(
      apertureShapeRing({ kind: "obround", widthMm: 2, heightMm: 1 }, at).length,
    ).toBe(50);
    expect(
      apertureShapeRing(
        { kind: "roundrect", widthMm: 2, heightMm: 1, radiusMm: 0.2 },
        at,
      ).length,
    ).toBe(28);
    expect(
      apertureShapeRing({ kind: "rect", widthMm: 2, heightMm: 1 }, at).length,
    ).toBe(4);
  });

  test("a circle's vertices sit on the circumscribing radius, about the centre", () => {
    const ring = apertureShapeRing({ kind: "circle", diameterMm: 1 }, at);
    const expected = 0.5 / Math.cos(Math.PI / 48);
    for (const p of ring) {
      expect(
        Math.abs(Math.hypot(p.x - at.x, p.y - at.y) - expected),
      ).toBeLessThanOrEqual(1e-12);
    }
    // sec(π/48) − 1 ≈ 0.215 %·r — the bias §1.3 states as the checks' tolerance.
    expect(expected / 0.5 - 1).toBeLessThan(0.0022);
    expect(expected / 0.5 - 1).toBeGreaterThan(0.0021);
  });

  test("every ring encloses its true shape and is centred on the flash point", () => {
    const shapes: ApertureShape[] = [
      { kind: "circle", diameterMm: 1 },
      { kind: "obround", widthMm: 2, heightMm: 1 },
      { kind: "obround", widthMm: 1, heightMm: 2 },
      { kind: "roundrect", widthMm: 2, heightMm: 1, radiusMm: 0.2 },
      { kind: "rect", widthMm: 2, heightMm: 1 },
    ];
    for (const shape of shapes) {
      const w = shape.kind === "circle" ? shape.diameterMm : shape.widthMm;
      const h = shape.kind === "circle" ? shape.diameterMm : shape.heightMm;
      const box = bbox(apertureShapeRing(shape, at));
      // Centred on the flash point…
      expect(Math.abs((box.minX + box.maxX) / 2 - at.x)).toBeLessThanOrEqual(
        1e-12,
      );
      expect(Math.abs((box.minY + box.maxY) / 2 - at.y)).toBeLessThanOrEqual(
        1e-12,
      );
      // …and never smaller than the shape it stands for: an opening the checks
      // measure must not under-state the void the fab actually cuts.
      expect(box.maxX - box.minX).toBeGreaterThanOrEqual(w - 1e-12);
      expect(box.maxY - box.minY).toBeGreaterThanOrEqual(h - 1e-12);
    }
  });

  test("a rotation turns the ring, and a zero corner radius is a sharp rect", () => {
    const rotated = apertureShapeRing(
      { kind: "rect", widthMm: 2, heightMm: 1, rotationDeg: 90 },
      { x: 0, y: 0 },
    );
    // A 90° turn maps (1, 0.5) → (−0.5, 1): the bbox transposes.
    const box = bbox(rotated);
    expect(box.maxX - box.minX).toBeCloseTo(1, 12);
    expect(box.maxY - box.minY).toBeCloseTo(2, 12);
    // `roundRectRing` falls back to four corners when the radius vanishes, so
    // the ring can never carry zero-radius corner arcs.
    expect(
      apertureShapeRing(
        { kind: "roundrect", widthMm: 2, heightMm: 1, radiusMm: 0 },
        { x: 0, y: 0 },
      ).length,
    ).toBe(4);
  });
});
