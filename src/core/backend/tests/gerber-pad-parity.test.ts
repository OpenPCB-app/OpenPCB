/**
 * Export parity: the artwork the fab receives IS the geometry DRC judged
 * (manufacturability contract 10 §6.5).
 *
 * For every golden and every emitted layer file the test parses the Gerber
 * back — its `%AM` macros, its `%ADD` aperture table and every `D03` flash —
 * and compares it, 1:1 and IN ORDER, against the instances the contract says
 * that file must carry: copper from the S1 pad records resolved to that copper
 * layer (plus the via annuli), mask from the same records inflated per §6.2
 * PLUS the drill-derived relief of copper-less unplated pads, paste from the
 * SMD records inflated by the paste expansion. A pad flashed on the wrong
 * face, a missing flash and an extra flash all fail.
 *
 * The expected shapes are built HERE from the records, as an independent
 * reading of §6.2 — never by calling the writer's own aperture helper.
 *
 * Why membership sampling and not a vertex-by-vertex polygon compare: an
 * aperture is a union of convex primitives (a roundrect macro is two strips
 * and four corner circles), and `record.ring` CIRCUMSCRIBES its arcs by
 * sec(π/48) ≈ 0.21 %·r — three orders of magnitude past the 2e-6 mm tolerance
 * §6.5 demands. Membership in a union of convex sets is exact, so the two
 * regions are compared by probing 2e-6 mm inside and outside the expected
 * boundary along 256 radial directions: agreement there IS boundary agreement
 * within 2e-6 mm for these (centre-star-shaped) shapes. The only error source
 * is Gerber's 1 nm coordinate / 6-decimal parameter rounding, ≤ 1.5e-6 mm in
 * total.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildGerberLayer } from "../../../modules/designer/backend/export/gerber/writer";
import { buildExcellonDrill } from "../../../modules/designer/backend/export/excellon/writer";
import { buildDrcItems } from "../../../shared/drc/drc-context";
import {
  buildCopperRecords,
  freePadItemKey,
  padItemKey,
  type PadCopperRecord,
} from "../../../shared/pcb-connectivity";
import type { PadCopperShape } from "../../../shared/pcb-geometry/pad-annular";
import {
  freePadCopperShape,
  padCopperShape,
  placementPads,
} from "../../../shared/pcb-geometry/pad-geometry";
import {
  footprintPadDrill,
  type FootprintPadDrill,
} from "../../../shared/rendering/pcb/pcb-drills";
import { freePadCopperLayers } from "../../../shared/rendering/pad-copper-layers";
import { freePadDrill } from "../../../shared/rendering/pcb/pcb-drills";
import { copperLayersForCount } from "../../../sdks/designer/stackup";
import type {
  DesignerPcbProjection,
  PcbCopperLayerId,
  PcbPointMm,
  PcbVia,
} from "../../../sdks/designer/types";
import { fixtureToProjection } from "./helpers/drc-golden";
import {
  insidePrimitives,
  parseGerber,
  type GerberPrimitive,
} from "./helpers/gerber-parse";

const GOLDEN_DIR = join(import.meta.dir, "fixtures/drc/golden");
const TOL_MM = 2e-6;
const BOUNDARY_SAMPLES = 256;

// ---------------------------------------------------------------------------
// The expected aperture of a pad, per contract §6.2 — an independent reading.
// ---------------------------------------------------------------------------

type ExpShape =
  | { kind: "circle"; diameterMm: number }
  | { kind: "rect"; widthMm: number; heightMm: number; rotationDeg: number }
  | { kind: "obround"; widthMm: number; heightMm: number; rotationDeg: number }
  | {
      kind: "roundrect";
      widthMm: number;
      heightMm: number;
      radiusMm: number;
      rotationDeg: number;
    };

interface Instance {
  label: string;
  shape: ExpShape;
  centerMm: PcbPointMm;
}

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** §6.2: a multiple of 90° keeps the axis-aligned aperture (with the swap). */
function expectedAperture(
  shape: PadCopperShape,
  rotationDeg: number,
): ExpShape | null {
  const angle = norm360(rotationDeg);
  const orthogonal = angle % 90 === 0;
  const swap = orthogonal && (angle === 90 || angle === 270);
  const w = swap ? shape.heightMm : shape.widthMm;
  const h = swap ? shape.widthMm : shape.heightMm;
  const rotationOut = orthogonal ? 0 : angle;
  switch (shape.shape) {
    // §7: a `circle` pad is a disc of `widthMm`, whatever `heightMm` says.
    case "circle":
      return { kind: "circle", diameterMm: shape.widthMm };
    case "oval":
      return {
        kind: "obround",
        widthMm: w,
        heightMm: h,
        rotationDeg: rotationOut,
      };
    case "rect":
    case "trapezoid":
      return {
        kind: "rect",
        widthMm: w,
        heightMm: h,
        rotationDeg: rotationOut,
      };
    case "roundrect": {
      const ratio = shape.roundrectRatio ?? 0.25;
      // The SAME clamp `roundRectRing` and the annular-ring kernel apply.
      const r = Math.min(ratio * Math.min(w, h), w / 2, h / 2);
      if (r < 1e-6) {
        return {
          kind: "rect",
          widthMm: w,
          heightMm: h,
          rotationDeg: rotationOut,
        };
      }
      return {
        kind: "roundrect",
        widthMm: w,
        heightMm: h,
        radiusMm: r,
        rotationDeg: rotationOut,
      };
    }
    default:
      return null;
  }
}

/** §6.2 inflation: +2d on both dims; roundrect radius +d; rect stays sharp. */
function inflate(shape: ExpShape, deltaMm: number): ExpShape {
  const d = deltaMm * 2;
  switch (shape.kind) {
    case "circle":
      return { kind: "circle", diameterMm: shape.diameterMm + d };
    case "rect":
      return {
        ...shape,
        widthMm: shape.widthMm + d,
        heightMm: shape.heightMm + d,
      };
    case "obround":
      return {
        ...shape,
        widthMm: shape.widthMm + d,
        heightMm: shape.heightMm + d,
      };
    case "roundrect":
      return {
        ...shape,
        widthMm: shape.widthMm + d,
        heightMm: shape.heightMm + d,
        radiusMm: shape.radiusMm + deltaMm,
      };
  }
}

function minDim(shape: ExpShape): number {
  return shape.kind === "circle"
    ? shape.diameterMm
    : Math.min(shape.widthMm, shape.heightMm);
}

/** Mask relief of a copper-less unplated drill (§6.4). */
function drillRelief(drill: FootprintPadDrill, expansionMm: number): ExpShape {
  const across = drill.drillMm + 2 * expansionMm;
  if (!drill.slot) return { kind: "circle", diameterMm: across };
  const dx = drill.slot.b.x - drill.slot.a.x;
  const dy = drill.slot.b.y - drill.slot.a.y;
  const along = Math.hypot(dx, dy) + across;
  const angle = norm360((Math.atan2(dy, dx) * 180) / Math.PI);
  if (angle % 90 === 0) {
    const swap = angle === 90 || angle === 270;
    return {
      kind: "obround",
      widthMm: swap ? across : along,
      heightMm: swap ? along : across,
      rotationDeg: 0,
    };
  }
  return {
    kind: "obround",
    widthMm: along,
    heightMm: across,
    rotationDeg: angle,
  };
}

// ---------------------------------------------------------------------------
// Membership + boundary sampling of an expected shape.
// ---------------------------------------------------------------------------

function toWorldDir(shape: ExpShape, x: number, y: number): [number, number] {
  const deg = shape.kind === "circle" ? 0 : shape.rotationDeg;
  if (deg === 0) return [x, y];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

/** Local-frame boundary point at parameter `t ∈ [0, 1)`, for each shape. */
function localBoundaryPoint(shape: ExpShape, t: number): [number, number] {
  const a = t * 2 * Math.PI;
  if (shape.kind === "circle") {
    const r = shape.diameterMm / 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
  const hw = shape.widthMm / 2;
  const hh = shape.heightMm / 2;
  // Ray from the centre in direction `a`, intersected with the outline. Every
  // S11 aperture is convex and contains its centre, so this is well defined.
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const rectHit = (halfW: number, halfH: number): number => {
    const tx = Math.abs(dx) < 1e-15 ? Infinity : halfW / Math.abs(dx);
    const ty = Math.abs(dy) < 1e-15 ? Infinity : halfH / Math.abs(dy);
    return Math.min(tx, ty);
  };
  if (shape.kind === "rect") {
    const s = rectHit(hw, hh);
    return [dx * s, dy * s];
  }
  const r = shape.kind === "roundrect" ? shape.radiusMm : Math.min(hw, hh);
  const coreW = shape.kind === "roundrect" ? hw - r : hw - r;
  const coreH = shape.kind === "roundrect" ? hh - r : hh - r;
  // Ray vs the Minkowski sum of the (coreW × coreH) box and a disc of `r`:
  // bisect on the offset distance, which is monotone along the ray.
  let lo = 0;
  let hi = Math.hypot(hw, hh) + r + 1;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    const qx = Math.max(Math.abs(dx * mid) - coreW, 0);
    const qy = Math.max(Math.abs(dy * mid) - coreH, 0);
    if (Math.hypot(qx, qy) <= r) lo = mid;
    else hi = mid;
  }
  return [dx * lo, dy * lo];
}

/**
 * Assert the emitted aperture covers exactly the expected region: at 256
 * radial boundary directions, `TOL_MM` inside is covered and `TOL_MM` outside
 * is not.
 */
function expectRegionsMatch(
  primitives: readonly GerberPrimitive[],
  flash: { xMm: number; yMm: number },
  expected: Instance,
): void {
  // The flash point itself: 1 nm coordinate rounding is the only error.
  expect(Math.abs(flash.xMm - expected.centerMm.x)).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(flash.yMm - expected.centerMm.y)).toBeLessThanOrEqual(1e-6);
  const offX = expected.centerMm.x - flash.xMm;
  const offY = expected.centerMm.y - flash.yMm;
  for (let i = 0; i < BOUNDARY_SAMPLES; i += 1) {
    const [lx, ly] = localBoundaryPoint(expected.shape, i / BOUNDARY_SAMPLES);
    const len = Math.hypot(lx, ly);
    if (!(len > 0)) continue;
    const scaleIn = (len - TOL_MM) / len;
    const scaleOut = (len + TOL_MM) / len;
    const [inX, inY] = toWorldDir(expected.shape, lx * scaleIn, ly * scaleIn);
    const [outX, outY] = toWorldDir(
      expected.shape,
      lx * scaleOut,
      ly * scaleOut,
    );
    const covered = insidePrimitives(primitives, inX + offX, inY + offY);
    const clear = insidePrimitives(primitives, outX + offX, outY + offY);
    if (!covered || clear) {
      throw new Error(
        `${expected.label}: aperture differs from the expected ${expected.shape.kind} ` +
          `at boundary sample ${i} (inside covered=${covered}, outside covered=${clear})`,
      );
    }
  }
  // A sanity probe at the centre: the region is never empty.
  expect(insidePrimitives(primitives, offX, offY)).toBe(true);
  // Nothing outside the expected bounding circle may be covered.
  const reach =
    (expected.shape.kind === "circle"
      ? expected.shape.diameterMm
      : Math.hypot(expected.shape.widthMm, expected.shape.heightMm)) / 2;
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * 2 * Math.PI;
    const far = reach + 0.01;
    expect(
      insidePrimitives(
        primitives,
        Math.cos(a) * far + offX,
        Math.sin(a) * far + offY,
      ),
    ).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// The expected instance list of one file.
// ---------------------------------------------------------------------------

const COPPER_ORDER: readonly PcbCopperLayerId[] = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
];

function viaTouchesLayer(via: PcbVia, layer: PcbCopperLayerId): boolean {
  const from = COPPER_ORDER.indexOf(via.fromLayer);
  const to = COPPER_ORDER.indexOf(via.toLayer);
  const at = COPPER_ORDER.indexOf(layer);
  if (from === -1 || to === -1 || at === -1) {
    return layer === via.fromLayer || layer === via.toLayer;
  }
  return at >= Math.min(from, to) && at <= Math.max(from, to);
}

interface PadIndex {
  records: PadCopperRecord[];
  shapes: Map<string, PadCopperShape>;
  maskOnlyDrills: FootprintPadDrill[];
}

function padIndex(proj: DesignerPcbProjection): PadIndex {
  const records = buildCopperRecords({
    layerCount: proj.board.layerCount,
    placements: proj.placements,
    padNetIds: new Map(Object.entries(proj.padNets ?? {})),
    freePads: proj.freePads,
    traces: proj.traces,
    vias: proj.vias,
  }).pads;
  const key = (record: PadCopperRecord): string =>
    record.anchor.kind === "pad"
      ? padItemKey(
          record.anchor.placementId,
          record.anchor.padNumber,
          record.occurrence,
        )
      : freePadItemKey(record.anchor.freePadId);
  const recorded = new Set(records.map(key));
  const shapes = new Map<string, PadCopperShape>();
  const maskOnlyDrills: FootprintPadDrill[] = [];
  for (const placement of proj.placements) {
    const seen = new Map<string, number>();
    for (const pad of placementPads(placement)) {
      const occurrence = seen.get(pad.number) ?? 0;
      seen.set(pad.number, occurrence + 1);
      const k = padItemKey(placement.id, pad.number, occurrence);
      shapes.set(k, padCopperShape(placement, pad));
      if (recorded.has(k)) continue;
      const drill = footprintPadDrill(pad, placement);
      if (drill && !drill.plated) maskOnlyDrills.push(drill);
    }
  }
  for (const freePad of proj.freePads) {
    shapes.set(freePadItemKey(freePad.id), freePadCopperShape(freePad));
  }
  return { records, shapes, maskOnlyDrills };
}

function recordShape(index: PadIndex, record: PadCopperRecord): PadCopperShape {
  const key =
    record.anchor.kind === "pad"
      ? padItemKey(
          record.anchor.placementId,
          record.anchor.padNumber,
          record.occurrence,
        )
      : freePadItemKey(record.anchor.freePadId);
  const shape = index.shapes.get(key);
  if (!shape) throw new Error(`no shape for record ${key}`);
  return shape;
}

function recordLabel(record: PadCopperRecord): string {
  return record.anchor.kind === "pad"
    ? `${record.anchor.placementId}|${record.anchor.padNumber}#${record.occurrence}`
    : `freePad:${record.anchor.freePadId}`;
}

function expectedCopper(
  proj: DesignerPcbProjection,
  index: PadIndex,
  layer: PcbCopperLayerId,
): Instance[] {
  const out: Instance[] = [];
  for (const via of proj.vias) {
    if (!viaTouchesLayer(via, layer)) continue;
    out.push({
      label: `via:${via.id}`,
      shape: { kind: "circle", diameterMm: via.diameterMm },
      centerMm: via.centerMm,
    });
  }
  for (const record of index.records) {
    if (!record.resolvedLayers.includes(layer)) continue;
    const shape = expectedAperture(
      recordShape(index, record),
      record.rotationDeg,
    );
    if (!shape) continue;
    out.push({ label: recordLabel(record), shape, centerMm: record.center });
  }
  return out;
}

function expectedMask(
  proj: DesignerPcbProjection,
  index: PadIndex,
  side: "top" | "bottom",
): Instance[] {
  const layer: PcbCopperLayerId = side === "top" ? "F.Cu" : "B.Cu";
  const expansion = proj.board.solderMaskExpansionMm ?? 0.05;
  const out: Instance[] = [];
  for (const record of index.records) {
    if (record.anchor.kind !== "pad") continue;
    if (!record.resolvedLayers.includes(layer)) continue;
    const base = expectedAperture(
      recordShape(index, record),
      record.rotationDeg,
    );
    if (!base) continue;
    out.push({
      label: `mask ${recordLabel(record)}`,
      shape: inflate(base, expansion),
      centerMm: record.center,
    });
  }
  // Copper-less unplated footprint drills open the mask on BOTH faces (§6.4).
  for (const drill of index.maskOnlyDrills) {
    out.push({
      label: "mask npth relief",
      shape: drillRelief(drill, expansion),
      centerMm: drill.centerMm,
    });
  }
  const stackup = new Set(copperLayersForCount(proj.board.layerCount));
  for (const pad of proj.freePads) {
    const opens =
      pad.padType === "hole"
        ? layer === "F.Cu" || layer === "B.Cu"
        : freePadCopperLayers(pad, stackup).layers.includes(layer);
    if (!opens) {
      // S12 (DFM contract 11 §1.3, 06 §9): a face the pad shape is NOT flashed
      // on has nothing that could cover the pad's drill, so a drilled `smd` /
      // `conn` pad relieves it there unconditionally — otherwise the far face
      // keeps solder mask stretched over an open NPTH.
      const drill = freePadDrill(pad);
      if (!drill) continue;
      out.push({
        label: `mask freePad:${pad.id} far-face drill relief`,
        shape: drillRelief(
          {
            centerMm: pad.centerMm,
            drillMm: drill.drillMm,
            ...(drill.slot ? { slot: drill.slot } : {}),
            plated: false,
          },
          pad.solderMaskExpansionMm ?? expansion,
        ),
        centerMm: pad.centerMm,
      });
      continue;
    }
    const base = expectedAperture(freePadCopperShape(pad), pad.rotationDeg);
    if (!base) continue;
    const flashed = inflate(base, pad.solderMaskExpansionMm ?? expansion);
    out.push({
      label: `mask freePad:${pad.id}`,
      shape: flashed,
      centerMm: pad.centerMm,
    });
    // A drilled free pad's drill relief when the FLASHED opening does not cover
    // the drill — a routed slot always (the declared size is one hit's), or a
    // round drill the flash does not span. Contract 10 §6.4, Astra run 2b #3,
    // widened in S12 (R1) from `hole` to EVERY pad type — `freePadDrill` has no
    // pad-type gate, so a slotted `smd` paddle keeps mask stretched over its own
    // routed void exactly as a `hole` pad would — and again (Astra run 2 #2) to
    // measure the containment against the opening as EXPANDED: a negative
    // expansion shrinks a 1 x 1 pad over a 0.8 drill to 0.6 x 0.6, which the
    // declared shape says covers the drill and the artwork does not. This
    // reading is independent of the model's — it is stated here in the words of
    // the contract, not derived from `uncoveredFreePadDrill`.
    const flashSpan =
      flashed.kind === "circle"
        ? flashed.diameterMm
        : Math.min(flashed.widthMm, flashed.heightMm);
    const drill = freePadDrill(pad);
    const covered =
      !drill || (!drill.slot && drill.drillMm <= flashSpan + 1e-9);
    if (drill && !covered) {
      out.push({
        label: `mask freePad:${pad.id} drill relief`,
        shape: drillRelief(
          {
            centerMm: pad.centerMm,
            drillMm: drill.drillMm,
            ...(drill.slot ? { slot: drill.slot } : {}),
            plated: false,
          },
          pad.solderMaskExpansionMm ?? expansion,
        ),
        centerMm: pad.centerMm,
      });
    }
  }
  for (const via of proj.vias) {
    if (via.protection !== "none") continue;
    if (!viaTouchesLayer(via, layer)) continue;
    out.push({
      label: `mask via:${via.id}`,
      shape: { kind: "circle", diameterMm: via.diameterMm + expansion * 2 },
      centerMm: via.centerMm,
    });
  }
  return out;
}

function expectedPaste(
  proj: DesignerPcbProjection,
  index: PadIndex,
  side: "top" | "bottom",
): Instance[] {
  const layer: PcbCopperLayerId = side === "top" ? "F.Cu" : "B.Cu";
  const expansion = proj.board.solderPasteExpansionMm ?? 0;
  const freePadById = new Map(proj.freePads.map((p) => [p.id, p]));
  const out: Instance[] = [];
  for (const record of index.records) {
    if (record.drillMm > 0 || !record.plated) continue;
    if (!record.resolvedLayers.includes(layer)) continue;
    if (
      record.anchor.kind === "freePad" &&
      freePadById.get(record.anchor.freePadId)?.padType !== "smd"
    ) {
      continue;
    }
    const base = expectedAperture(
      recordShape(index, record),
      record.rotationDeg,
    );
    if (!base) continue;
    if (expansion === 0) {
      out.push({
        label: `paste ${recordLabel(record)}`,
        shape: base,
        centerMm: record.center,
      });
      continue;
    }
    const grown = inflate(base, expansion);
    if (!(minDim(grown) > 0)) continue;
    out.push({
      label: `paste ${recordLabel(record)}`,
      shape: grown,
      centerMm: record.center,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOLDEN_NAMES = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

function loadGolden(name: string): DesignerPcbProjection {
  const raw = JSON.parse(
    readFileSync(join(GOLDEN_DIR, `${name}.json`), "utf8"),
  ) as unknown;
  return fixtureToProjection(raw);
}

/** Every emitted pad-bearing file of a board, as (kind, expected) pairs. */
function fileMatrix(
  proj: DesignerPcbProjection,
  index: PadIndex,
): Array<{
  layer: Parameters<typeof buildGerberLayer>[1];
  expected: Instance[];
}> {
  const kindOf: Record<string, Parameters<typeof buildGerberLayer>[1]> = {
    "F.Cu": "copper.top",
    "In1.Cu": "copper.inner1",
    "In2.Cu": "copper.inner2",
    "B.Cu": "copper.bottom",
  };
  const out: Array<{
    layer: Parameters<typeof buildGerberLayer>[1];
    expected: Instance[];
  }> = [];
  for (const layer of copperLayersForCount(proj.board.layerCount)) {
    out.push({
      layer: kindOf[layer]!,
      expected: expectedCopper(proj, index, layer),
    });
  }
  for (const side of ["top", "bottom"] as const) {
    out.push({
      layer: side === "top" ? "mask.top" : "mask.bottom",
      expected: expectedMask(proj, index, side),
    });
    out.push({
      layer: side === "top" ? "paste.top" : "paste.bottom",
      expected: expectedPaste(proj, index, side),
    });
  }
  return out;
}

describe("Gerber pad parity — the artwork is the copper DRC judged", () => {
  test("every golden is covered", () => {
    // Seven goldens today; a new one must be picked up automatically.
    expect(GOLDEN_NAMES.length).toBeGreaterThanOrEqual(7);
  });

  for (const name of GOLDEN_NAMES) {
    test(`${name}: every flash of every layer matches its record`, () => {
      const proj = loadGolden(name);
      const index = padIndex(proj);
      const counts: Record<string, number> = {};
      for (const { layer, expected } of fileMatrix(proj, index)) {
        const gerber = buildGerberLayer(
          proj,
          layer,
          [],
          "2020-01-01T00:00:00Z",
        );
        const parsed = parseGerber(gerber);
        counts[layer] = parsed.flashes.length;
        expect(`${layer}: ${parsed.flashes.length} flashes`).toBe(
          `${layer}: ${expected.length} flashes`,
        );
        for (let i = 0; i < expected.length; i += 1) {
          const flash = parsed.flashes[i]!;
          const aperture = parsed.apertures.get(flash.code);
          expect(aperture).toBeDefined();
          expectRegionsMatch(aperture!.primitives, flash, expected[i]!);
        }
      }
      // Recorded so a change in the artwork's flash census is visible in the
      // run log rather than only in a diff.
      expect(Object.keys(counts).length).toBeGreaterThan(0);
    });

    test(`${name}: the drill files are exactly the DRC holes`, () => {
      const proj = loadGolden(name);
      const holes = buildDrcItems(proj).holes;
      const expected = holes.map((hole) =>
        drillKey(
          hole.center,
          hole.drillMm,
          hole.kind !== "npth",
          hole.slot ? hole.slot.b : undefined,
        ),
      );
      const emitted = [
        ...parseExcellon(buildExcellonDrill(proj, [], "PTH"), true),
        ...parseExcellon(buildExcellonDrill(proj, [], "NPTH"), false),
      ];
      expect(emitted.length).toBe(expected.length);
      expect([...emitted].sort()).toEqual([...expected].sort());
    });
  }
});

function round4(v: number): string {
  return v.toFixed(4);
}

function drillKey(
  center: PcbPointMm,
  drillMm: number,
  plated: boolean,
  slotEnd?: PcbPointMm,
): string {
  // A slot's DRC centreline runs a→b about the drill centre; Excellon writes
  // the same segment as `a G85 b`. Compare the unordered endpoint pair so the
  // two representations of one slot agree without depending on which end is
  // written first.
  if (slotEnd) {
    const other = { x: 2 * center.x - slotEnd.x, y: 2 * center.y - slotEnd.y };
    const ends = [
      `${round4(other.x)},${round4(other.y)}`,
      `${round4(slotEnd.x)},${round4(slotEnd.y)}`,
    ].sort();
    return `slot|${ends[0]}|${ends[1]}|${drillMm.toFixed(4)}|${plated}`;
  }
  return `hit|${round4(center.x)},${round4(center.y)}|${drillMm.toFixed(4)}|${plated}`;
}

/** Every hit of one Excellon file as the same key `drillKey` builds. */
function parseExcellon(text: string, plated: boolean): string[] {
  const out: string[] = [];
  let tool = 0;
  const tools = new Map<number, number>();
  for (const line of text.split("\r\n")) {
    const def = /^T(\d+)C([\d.]+)$/.exec(line);
    if (def) {
      tools.set(Number(def[1]), Number(def[2]));
      continue;
    }
    const sel = /^T(\d+)$/.exec(line);
    if (sel) {
      tool = Number(sel[1]);
      continue;
    }
    const slot = /^X(-?[\d.]+)Y(-?[\d.]+)G85X(-?[\d.]+)Y(-?[\d.]+)$/.exec(line);
    if (slot) {
      const a = { x: Number(slot[1]), y: Number(slot[2]) };
      const b = { x: Number(slot[3]), y: Number(slot[4]) };
      const ends = [
        `${round4(a.x)},${round4(a.y)}`,
        `${round4(b.x)},${round4(b.y)}`,
      ].sort();
      out.push(
        `slot|${ends[0]}|${ends[1]}|${(tools.get(tool) ?? 0).toFixed(4)}|${plated}`,
      );
      continue;
    }
    const hit = /^X(-?[\d.]+)Y(-?[\d.]+)$/.exec(line);
    if (hit) {
      out.push(
        `hit|${round4(Number(hit[1]))},${round4(Number(hit[2]))}|${(
          tools.get(tool) ?? 0
        ).toFixed(4)}|${plated}`,
      );
    }
  }
  return out;
}
