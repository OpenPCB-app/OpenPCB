/**
 * THE silkscreen artwork model (DFM contract 11 §1.2): everything the fab
 * receives on the legend layers, built once from the PCB projection. The Gerber
 * writer emits this model and the DFM checks judge it; neither may re-derive a
 * stroke or a transform, or the board would be checked against artwork it never
 * ships.
 *
 * Before S12 the writer owned its own (much smaller) silk geometry: footprint
 * graphics and reference designators were never exported at all, and an overlay
 * `rect` / `circle` / `polygon` exported as the two points it is STORED as —
 * a diagonal line where the canvas drew a closed shape.
 *
 * WIDTH RULE (§1.2): every stroke this model emits has a POSITIVE width. A
 * footprint graphic whose authored width is unusable — zero, negative or
 * non-finite, all of which occur in the stock KiCad libraries as
 * `(stroke (width 0))` — reads as `DEFAULT_FOOTPRINT_STROKE_MM`, the same
 * 0.12 mm `kicad-import` gives a graphic with no width at all; an overlay
 * shape reads as the canvas default. Text has no authored thickness and is
 * always `max(0.1, 0.15 · size)`.
 */
import type {
  PcbOverlayShape,
  PcbOverlayText,
  PcbPlacedPart,
  PcbPointMm,
} from "../../../../sdks/designer";
import { placementMirrorX } from "../../../../sdks/designer/pcb-helpers";
import { transformPadCenterMm } from "../../../pcb-geometry/pad-geometry";
import {
  arcChordPoints,
  arcSegmentCount,
  ellipseChordRing,
} from "../../../pcb-geometry/arc-chords";
import type { PreviewGraphic, PreviewLabel } from "../../types";
import {
  isRefdesLabel,
  placementLabelText,
  uprightLabelRotationDeg,
} from "../footprint-labels";
import { isFilledOverlay, overlayShapePolyline } from "./overlay-shapes";
import { textToStrokes } from "./stroke-font";

export type SilkFace = "top" | "bottom";

/** What a stroke or region came from — the DRC anchor is derived from it. */
export type SilkSource =
  | { kind: "placement"; placementId: string; graphicIndex: number }
  | { kind: "placement"; placementId: string; labelId: string }
  | { kind: "overlayShape"; shapeId: string }
  | { kind: "overlayText"; textId: string };

/**
 * A polyline drawn with a ROUND aperture of diameter `widthMm` — round caps and
 * joins, exactly what `D02` / `D01` with a circle aperture produce.
 */
export interface SilkStroke {
  face: SilkFace;
  pointsMm: PcbPointMm[];
  widthMm: number;
  source: SilkSource;
}

/** A filled polygon (`G36` / `G37`). The ring repeats its first point. */
export interface SilkRegion {
  face: SilkFace;
  ring: PcbPointMm[];
  source: SilkSource;
}

/** Both lists are already in EMISSION order (contract §1.2 / §1.4). */
export interface SilkArtwork {
  strokes: SilkStroke[];
  regions: SilkRegion[];
}

export interface SilkArtworkInput {
  placements: readonly PcbPlacedPart[];
  overlayShapes: readonly PcbOverlayShape[];
  overlayTexts: readonly PcbOverlayText[];
}

/**
 * The import whitelist admits both spellings (KiCad 7 `*.SilkS`, KiCad 8+
 * `*.Silkscreen`), so the artwork must too — a footprint ingested from a
 * KiCad 8 board would otherwise silently lose its silk.
 */
const SILK_LAYER_FACE: Readonly<Record<string, SilkFace>> = {
  "F.SilkS": "top",
  "F.Silkscreen": "top",
  "B.SilkS": "bottom",
  "B.Silkscreen": "bottom",
};

/** Overlay text and every label are drawn at this fraction of the cap height. */
const TEXT_STROKE_RATIO = 0.15;
const MIN_TEXT_STROKE_MM = 0.1;
const DEFAULT_OVERLAY_STROKE_MM = 0.15;
/**
 * Width of a footprint silk graphic whose authored `strokeWidthMm` is unusable
 * — absent, zero, negative or non-finite. `(stroke (width 0))` is real stock
 * KiCad-library data, and `kicad-import` already reads a MISSING width as
 * 0.12 mm (`build-preview-models.ts`), so an unusable one reads the same way.
 *
 * The alternative is worse in both directions: a zero width reaches the Gerber
 * as `%ADD10C,0*%` (an aperture the fab cannot image) or throws in the
 * coordinate formatter, and `FAB_SILK_WIDTH` — the check that exists to catch a
 * too-thin pen — says nothing about it, because 0 is not "below" anything the
 * comparison understands. Normalising here gives the artwork a positive width
 * AND puts the graphic in front of the fab row (0.12 < JLCPCB's 0.15).
 */
const DEFAULT_FOOTPRINT_STROKE_MM = 0.12;
/** de Casteljau steps for a `bezier` graphic (a stated limit, contract §10). */
const BEZIER_STEPS = 16;

function textStrokeWidthMm(fontSizeMm: number): number {
  // A non-finite size would carry NaN straight into the aperture.
  if (!Number.isFinite(fontSizeMm)) return MIN_TEXT_STROKE_MM;
  return Math.max(MIN_TEXT_STROKE_MM, TEXT_STROKE_RATIO * fontSizeMm);
}

/** A usable positive width, or the fallback the caller declares. */
function usableWidthMm(widthMm: unknown, fallbackMm: number): number {
  return typeof widthMm === "number" && Number.isFinite(widthMm) && widthMm > 0
    ? widthMm
    : fallbackMm;
}

function silkFaceOf(layer: string | undefined): SilkFace | null {
  if (layer === undefined) return null;
  return SILK_LAYER_FACE[layer] ?? null;
}

function flipFace(face: SilkFace): SilkFace {
  return face === "top" ? "bottom" : "top";
}

/**
 * Footprint artwork is LIBRARY data: a corrupt arc or an absurd font size can
 * put a NaN in the flattened polyline, and the Gerber coordinate formatter
 * throws on a non-finite value. Silk was never exported before S12, so this is
 * new exposure — drop the offending stroke instead of failing the whole export.
 * Overlay geometry keeps its pre-S12 behaviour (it is board data the editor
 * validates, and the writer already emitted it verbatim).
 */
function allFinite(points: readonly PcbPointMm[]): boolean {
  return points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * Build the model. Order IS the writer's aperture-allocation order (§1.4), so a
 * board with only overlay lines / polylines / texts exports byte-identically to
 * S11: overlay shapes, overlay texts, then placements in array order, each
 * placement's graphics before its labels.
 */
export function buildSilkArtwork(input: SilkArtworkInput): SilkArtwork {
  const out: SilkArtwork = { strokes: [], regions: [] };
  for (const shape of input.overlayShapes) {
    pushOverlayShape(out, shape);
  }
  for (const text of input.overlayTexts) {
    pushOverlayText(out, text);
  }
  for (const placement of input.placements) {
    pushPlacement(out, placement);
  }
  return out;
}

// =========================================================================
// Overlay sources
// =========================================================================

function pushOverlayShape(out: SilkArtwork, shape: PcbOverlayShape): void {
  const face = silkFaceOf(shape.layer);
  if (!face) return;
  const pointsMm = overlayShapePolyline(shape);
  if (!pointsMm || pointsMm.length < 2) return;
  const source: SilkSource = { kind: "overlayShape", shapeId: shape.id };
  out.strokes.push({
    face,
    pointsMm,
    // A persisted row predating the field — or one carrying an unusable width
    // — keeps the canvas default.
    widthMm: usableWidthMm(shape.strokeWidthMm, DEFAULT_OVERLAY_STROKE_MM),
    source,
  });
  if (isFilledOverlay(shape) && pointsMm.length >= 4) {
    out.regions.push({ face, ring: pointsMm, source });
  }
}

function pushOverlayText(out: SilkArtwork, text: PcbOverlayText): void {
  const face = silkFaceOf(text.layer);
  if (!face) return;
  const polylines = textToStrokes(text.text, {
    originMm: text.positionMm,
    sizeMm: text.fontSizeMm,
    rotationDeg: text.rotationDeg,
    mirror: text.mirror,
    justify: text.justify,
    anchorY: "middle",
  });
  const widthMm = textStrokeWidthMm(text.fontSizeMm);
  const source: SilkSource = { kind: "overlayText", textId: text.id };
  for (const poly of polylines) {
    if (poly.length < 2) continue;
    out.strokes.push({ face, pointsMm: poly, widthMm, source });
  }
}

// =========================================================================
// Placement sources
// =========================================================================

/**
 * A placement has TWO independent geometric facts (contract §1.1), never one:
 * `mirrorX` reflects every footprint-local point and mirrors text, while
 * `sideFlip` moves the footprint's `F.*` artwork onto the bottom face. A
 * `mirrored: true` placement on `F.Cu` is reflected and its silk stays on top.
 */
function pushPlacement(out: SilkArtwork, placement: PcbPlacedPart): void {
  const preview = placement.footprint.preview;
  if (!preview) return;
  const mirrorX = placementMirrorX(placement);
  const sideFlip = placement.layer === "B.Cu";
  const toWorld = (p: PcbPointMm): PcbPointMm => {
    const t = transformPadCenterMm(p, placement.rotationDeg, mirrorX);
    return {
      x: placement.positionMm.x + t.x,
      y: placement.positionMm.y + t.y,
    };
  };

  preview.graphics.forEach((graphic, graphicIndex) => {
    const base = silkFaceOf(graphic.layer);
    if (!base) return;
    const flat = flattenGraphic(graphic);
    if (!flat || flat.pointsMm.length < 2) return;
    const face = sideFlip ? flipFace(base) : base;
    const pointsMm = flat.pointsMm.map(toWorld);
    if (!allFinite(pointsMm)) return;
    const source: SilkSource = {
      kind: "placement",
      placementId: placement.id,
      graphicIndex,
    };
    out.strokes.push({
      face,
      pointsMm,
      widthMm: usableWidthMm(
        graphic.strokeWidthMm,
        DEFAULT_FOOTPRINT_STROKE_MM,
      ),
      source,
    });
    if (flat.filled && pointsMm.length >= 4) {
      out.regions.push({ face, ring: pointsMm, source });
    }
  });

  for (const label of preview.labels) {
    const base = silkFaceOf(label.layer);
    if (!base) continue;
    pushLabel(out, placement, label, sideFlip ? flipFace(base) : base, mirrorX);
  }
}

/**
 * One label's strokes. `M·R(θ) = R(−θ)·M` is why a mirrored placement
 * CONJUGATES the label's own rotation instead of negating the sum — the same
 * composition a pad's copper gets (contract 10 §3).
 */
function pushLabel(
  out: SilkArtwork,
  placement: PcbPlacedPart,
  label: PreviewLabel,
  face: SilkFace,
  mirrorX: boolean,
): void {
  const text = placementLabelText(label, placement.reference);
  if (text.length === 0) return;
  // Keep-upright is authored only for refdes silk; value / user text is left
  // exactly as imported, on the canvas and in the artwork alike.
  const labelRotationDeg = isRefdesLabel(label)
    ? uprightLabelRotationDeg(label.rotationDeg, placement.rotationDeg, mirrorX)
    : label.rotationDeg;
  const anchor = transformPadCenterMm(
    label.at,
    placement.rotationDeg,
    mirrorX,
  );
  const polylines = textToStrokes(text, {
    originMm: {
      x: placement.positionMm.x + anchor.x,
      y: placement.positionMm.y + anchor.y,
    },
    sizeMm: label.fontSizeMm,
    rotationDeg: mirrorX
      ? placement.rotationDeg - labelRotationDeg
      : placement.rotationDeg + labelRotationDeg,
    mirror: mirrorX,
    justify: label.anchorX,
    anchorY: label.anchorY,
  });
  const widthMm = textStrokeWidthMm(label.fontSizeMm);
  const source: SilkSource = {
    kind: "placement",
    placementId: placement.id,
    labelId: label.id,
  };
  for (const poly of polylines) {
    if (poly.length < 2 || !allFinite(poly)) continue;
    out.strokes.push({ face, pointsMm: poly, widthMm, source });
  }
}

// =========================================================================
// Graphic flattening (footprint-local mm)
// =========================================================================

interface FlatGraphic {
  pointsMm: PcbPointMm[];
  /** The polyline is a closed ring that also carries a filled interior. */
  filled: boolean;
}

function flattenGraphic(graphic: PreviewGraphic): FlatGraphic | null {
  switch (graphic.kind) {
    case "line":
      return { pointsMm: [graphic.a, graphic.b], filled: false };
    case "rect": {
      const { x, y, width: w, height: h } = graphic;
      return {
        // Same corner order the canvas strokes (`preview/geometry.ts`).
        pointsMm: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
          { x, y },
        ],
        filled: graphic.fill === "solid",
      };
    }
    case "circle": {
      const r = graphic.radiusMm;
      if (!(r > 0)) return null;
      // The S2 chord kernel, unbiased: the vertices sit ON the true circle, so
      // the flattened silk neither over- nor under-states the printed ink.
      const ring = ellipseChordRing(
        graphic.center,
        r,
        r,
        arcSegmentCount(r, 2 * Math.PI, "inscribed"),
        "inscribed",
      );
      return { pointsMm: [...ring, ring[0]!], filled: graphic.fill === "solid" };
    }
    case "arc3":
      return { pointsMm: arc3Points(graphic), filled: false };
    case "polyline": {
      const pts = [...graphic.points];
      if (pts.length < 2) return null;
      if (graphic.closed) pts.push(pts[0]!);
      return {
        pointsMm: pts,
        filled: graphic.closed && graphic.fill === "solid",
      };
    }
    case "bezier": {
      const [p0, p1, p2, p3] = graphic.points;
      const pts: PcbPointMm[] = [];
      for (let i = 0; i <= BEZIER_STEPS; i += 1) {
        pts.push(cubicBezierPoint(i / BEZIER_STEPS, p0, p1, p2, p3));
      }
      return { pointsMm: pts, filled: false };
    }
  }
}

const TWO_PI = 2 * Math.PI;

function normAngle(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

/** Circle through three points, or null when they are (nearly) collinear. */
function circumcircle(
  a: PcbPointMm,
  b: PcbPointMm,
  c: PcbPointMm,
): { center: PcbPointMm; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - ux, a.y - uy);
  if (!Number.isFinite(r) || r <= 0) return null;
  return { center: { x: ux, y: uy }, r };
}

/**
 * A three-point arc as its circumcircle sampled by the S2 kernel, sweeping in
 * the direction that passes through `mid`. A degenerate (collinear, or
 * non-finite) arc3 is the polyline through its three points — never a dropped
 * stroke and never an unbounded sample loop.
 */
function arc3Points(graphic: {
  start: PcbPointMm;
  mid: PcbPointMm;
  end: PcbPointMm;
}): PcbPointMm[] {
  const { start, mid, end } = graphic;
  const finite = [start, mid, end].every(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  const circle = finite ? circumcircle(start, mid, end) : null;
  if (!circle) return [start, mid, end];
  const { center, r } = circle;
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const am = Math.atan2(mid.y - center.y, mid.x - center.x);
  const ae = Math.atan2(end.y - center.y, end.x - center.x);
  const ccwToEnd = normAngle(ae - a0);
  const ccwToMid = normAngle(am - a0);
  const a1 = ccwToMid <= ccwToEnd ? a0 + ccwToEnd : a0 - (TWO_PI - ccwToEnd);
  const steps = arcSegmentCount(r, a1 - a0, "inscribed");
  return [
    start,
    ...arcChordPoints(center, r, a0, a1, steps, "inscribed", end),
  ];
}

function cubicBezierPoint(
  t: number,
  p0: PcbPointMm,
  p1: PcbPointMm,
  p2: PcbPointMm,
  p3: PcbPointMm,
): PcbPointMm {
  const u = 1 - t;
  return {
    x:
      u * u * u * p0.x +
      3 * u * u * t * p1.x +
      3 * u * t * t * p2.x +
      t * t * t * p3.x,
    y:
      u * u * u * p0.y +
      3 * u * u * t * p1.y +
      3 * u * t * t * p2.y +
      t * t * t * p3.y,
  };
}
