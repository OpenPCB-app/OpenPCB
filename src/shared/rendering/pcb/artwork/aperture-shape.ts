/**
 * The aperture SHAPE model — one description of a flashed artwork object,
 * shared by the Gerber writer (which formats it as a `%ADD` / `%AM`) and by the
 * artwork model the DFM checks judge (DFM contract 11 §1.3).
 *
 * It lives in `shared/` and NOT beside the Gerber writer because the mask
 * openings the checks measure and the mask openings the fab receives must be
 * the same objects. A shape here carries no D-code and no formatting: those
 * belong to `export/apertures.ts`, which re-exports the type for its own
 * importers.
 */
import type { PcbPointMm } from "../../../../sdks/designer";
import {
  shapeRingAroundOrigin,
  type ShapeInput,
} from "../../../pcb-geometry/pad-outline";
import type { PadCopperShape } from "../../../pcb-geometry/pad-annular";

export type ApertureShape =
  // `rotationDeg` absent (or a multiple of 90°, with the caller's orthogonal
  // width / height swap already applied) ⇒ a standard aperture. Any other
  // angle ⇒ a rotated aperture macro (see `export/apertures.ts`).
  | { kind: "circle"; diameterMm: number }
  | { kind: "rect"; widthMm: number; heightMm: number; rotationDeg?: number }
  | { kind: "obround"; widthMm: number; heightMm: number; rotationDeg?: number }
  | {
      kind: "roundrect";
      widthMm: number;
      heightMm: number;
      radiusMm: number;
      rotationDeg?: number;
    };

/**
 * THE corner radius of a `roundrect` pad, clamped exactly as the copper ring
 * builder (`pad-outline.ts` `roundRectRing`) and the S11 annular-ring kernel
 * (`pad-annular.ts` `roundrectRadiusMm`) clamp it: a ratio above 0.5 cannot
 * round a corner past the half-width / half-height without eating the pad.
 * The Gerber writer used to apply `ratio · min(w, h)` with NO half-dimension
 * clamp, so for a ratio > 0.5 the artwork was a different shape from the
 * copper DRC judged.
 */
export function roundrectRadiusMm(
  widthMm: number,
  heightMm: number,
  ratio: number,
): number {
  return Math.min(ratio * Math.min(widthMm, heightMm), widthMm / 2, heightMm / 2);
}

/**
 * Mask / paste expansion of `deltaMm` PER SIDE (contract 10 §6.2): `circle`
 * and `oval` grow both dimensions by `2d` (a Euclidean offset); `roundrect`
 * grows both dimensions by `2d` AND its corner radius by `d` (also Euclidean);
 * `rect` grows both dimensions by `2d` and keeps SHARP corners — KiCad's
 * convention for rectangular pads, whose corners therefore overshoot a true
 * Euclidean offset by `d·(√2 − 1)`, deliberately. A rotated macro inflates the
 * same dimensions and keeps its angle.
 */
export function inflateShape(
  shape: ApertureShape,
  deltaMm: number,
): ApertureShape {
  const d = deltaMm * 2;
  switch (shape.kind) {
    case "circle":
      return { kind: "circle", diameterMm: shape.diameterMm + d };
    case "rect":
      return {
        kind: "rect",
        widthMm: shape.widthMm + d,
        heightMm: shape.heightMm + d,
        ...(shape.rotationDeg === undefined
          ? {}
          : { rotationDeg: shape.rotationDeg }),
      };
    case "obround":
      return {
        kind: "obround",
        widthMm: shape.widthMm + d,
        heightMm: shape.heightMm + d,
        ...(shape.rotationDeg === undefined
          ? {}
          : { rotationDeg: shape.rotationDeg }),
      };
    case "roundrect":
      return {
        kind: "roundrect",
        widthMm: shape.widthMm + d,
        heightMm: shape.heightMm + d,
        radiusMm: shape.radiusMm + deltaMm,
        ...(shape.rotationDeg === undefined
          ? {}
          : { rotationDeg: shape.rotationDeg }),
      };
  }
}

/**
 * THE aperture of one pad copper shape (contract 10 §6.2). The shape's
 * `rotationDeg` is the pad's COMPOSED world rotation with the mirror already
 * conjugated into it (`placement ± pad`), and every S11 pad outline is
 * symmetric about both of its local axes, so the mirror itself changes no
 * aperture dimension — only that angle does.
 *
 * A multiple of 90° keeps the standard `C` / `R` / `O` / roundrect-macro
 * aperture with the orthogonal width / height swap; any other angle becomes a
 * rotated aperture macro. `custom` has no true outline in the render source
 * and is not an export input, so it returns null and the caller warns.
 */
export function apertureFromShape(
  shape: PadCopperShape,
  rotationDeg: number,
): ApertureShape | null {
  const angle = ((rotationDeg % 360) + 360) % 360;
  const orthogonal = angle % 90 === 0;
  const swap = orthogonal && (angle === 90 || angle === 270);
  const w = swap ? shape.heightMm : shape.widthMm;
  const h = swap ? shape.widthMm : shape.heightMm;
  const rot = orthogonal ? {} : { rotationDeg: angle };
  switch (shape.shape) {
    // A `circle` pad is a disc of `widthMm` — the ONE interpretation (§7).
    case "circle":
      return { kind: "circle", diameterMm: shape.widthMm };
    case "oval":
      return { kind: "obround", widthMm: w, heightMm: h, ...rot };
    case "roundrect": {
      const r = roundrectRadiusMm(w, h, shape.roundrectRatio ?? 0.25);
      // Degrade to a plain rect when the corner radius rounds to zero —
      // otherwise the roundrect macro emits zero-diameter corner circles
      // that some parsers reject.
      if (r < 1e-6) return { kind: "rect", widthMm: w, heightMm: h, ...rot };
      return { kind: "roundrect", widthMm: w, heightMm: h, radiusMm: r, ...rot };
    }
    // Trapezoid is a KiCad-imported pad shape the importer already degrades to
    // its bounding rectangle at the source, which is what every other consumer
    // (DRC, connectivity, the pour) sees too.
    case "rect":
    case "trapezoid":
      return { kind: "rect", widthMm: w, heightMm: h, ...rot };
    default:
      return null;
  }
}

/** The `pad-outline.ts` ring input an aperture shape corresponds to. */
function ringInput(shape: ApertureShape): ShapeInput {
  switch (shape.kind) {
    case "circle":
      return {
        shape: "circle",
        widthMm: shape.diameterMm,
        heightMm: shape.diameterMm,
        rotationDeg: 0,
      };
    case "obround":
      return {
        shape: "oval",
        widthMm: shape.widthMm,
        heightMm: shape.heightMm,
        rotationDeg: shape.rotationDeg ?? 0,
      };
    case "roundrect": {
      // `roundRectRing` re-derives the radius as `ratio · min(w, h)` clamped to
      // the half-dimensions, so inverting the ratio here reproduces `radiusMm`
      // exactly. A degenerate dimension has no ratio; a zero one keeps the
      // sharp rect the builder would fall back to anyway.
      const minDim = Math.min(shape.widthMm, shape.heightMm);
      return {
        shape: "roundrect",
        widthMm: shape.widthMm,
        heightMm: shape.heightMm,
        rotationDeg: shape.rotationDeg ?? 0,
        roundrectRatio: minDim > 0 ? shape.radiusMm / minDim : 0,
      };
    }
    case "rect":
      return {
        shape: "rect",
        widthMm: shape.widthMm,
        heightMm: shape.heightMm,
        rotationDeg: shape.rotationDeg ?? 0,
      };
  }
}

/**
 * The polygon ring of a flashed aperture centred at `centerMm`, built by the
 * SAME `pad-outline.ts` builders a pad copper ring uses (DFM contract 11 §1.3):
 * a 48-segment circumscribed circle / oval, six arcs per roundrect corner, a
 * sharp rect. A mask opening therefore circumscribes its true shape exactly as
 * a pad ring does (≤ 0.21 %·r), which is the tolerance the DFM checks state.
 */
export function apertureShapeRing(
  shape: ApertureShape,
  centerMm: PcbPointMm,
): PcbPointMm[] {
  return shapeRingAroundOrigin(ringInput(shape)).map((p) => ({
    x: p.x + centerMm.x,
    y: p.y + centerMm.y,
  }));
}
