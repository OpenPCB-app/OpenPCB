/**
 * Aperture definitions used by Gerber X2. A layer's aperture table is
 * collected lazily during the layer build (dedup by canonical key)
 * and emitted in the file header before any draw operations.
 *
 * Standard apertures supported here:
 *  - Circle   (`C`) — pads, vias, trace round caps, drill outlines.
 *  - Rectangle (`R`) — rectangular SMD pads.
 *  - Oblong   (`O`) — oblong (oval) SMD pads.
 *
 * Rounded rectangles use an aperture macro (`AM`) generated on the fly
 * per (w,h,r) tuple. Polygon and custom-shape pads will also use macros
 * when they arrive (post-v0).
 *
 * ROTATION (manufacturability contract 10 §6.2). A standard `R` / `O`
 * aperture is axis-aligned, so only a composed pad rotation that is a
 * multiple of 90° can be expressed by one — with the width / height swap the
 * CALLER has already applied for 90° / 270°. Any other angle is emitted as an
 * aperture MACRO with the rotation baked into its primitives, which is what
 * KiCad's own plotter does for a rotated pad. Rotation is CCW in degrees about
 * the macro origin (the aperture centre), so a `21` centre-line primitive
 * placed at (0, 0) rotates in place and every off-origin primitive centre
 * (an oval cap, a roundrect corner) must be PRE-ROTATED by the same angle —
 * the spec warns that a primitive rotates about the macro origin, not about
 * its own centre. `%LR` is deliberately not used: it is a stateful graphics
 * transform many fab front-ends still ignore.
 */

import { gerberDim } from "./units";
// The aperture SHAPE model moved to `shared/` in S12 (DFM contract 11 §1.3):
// the mask openings the DFM checks measure and the ones the fab receives are
// the same objects, so the shape cannot be owned by the export module. This
// file owns only the D-code table and the Gerber FORMATTING of a shape.
import {
  inflateShape,
  roundrectRadiusMm,
  type ApertureShape,
} from "../../../../shared/rendering/pcb/artwork/aperture-shape";

export { inflateShape, roundrectRadiusMm, type ApertureShape };

/** Normalised CCW rotation of an aperture, in [0, 360). */
function rotationOf(shape: ApertureShape): number {
  if (shape.kind === "circle") return 0;
  const raw = shape.rotationDeg ?? 0;
  return ((raw % 360) + 360) % 360;
}

/** A shape that no standard aperture can express (a non-orthogonal rotation). */
function needsRotationMacro(shape: ApertureShape): boolean {
  return rotationOf(shape) % 90 !== 0;
}

/**
 * X2 aperture-function attribute (informational, but JLCPCB and other
 * fabs read these when present). Drives `%TA.AperFunction,…*%` emission
 * immediately before the matching `%ADD…*%`.
 *
 * Spec values used here:
 *  - SMDPad,CuDef        — SMD copper pad, copper-defined.
 *  - ComponentPad         — through-hole copper pad (PTH).
 *  - WasherPad            — "A pad around a non-plated hole without electrical
 *                           function." (Ucamco, The Gerber Layer Format
 *                           Specification revision 2022.02, §5.6.10 aperture
 *                           attribute `.AperFunction`.) The same section says
 *                           washer pads carry no `.P` object attribute, so the
 *                           writer omits `%TO.P` for them.
 *  - ViaPad               — copper annulus around a via drill.
 *  - Conductor            — trace segment.
 *  - Profile              — board outline (Edge.Cuts only).
 *  - NonConductor         — silkscreen / fab notes.
 *  - SolderMask           — mask aperture.
 *  - SolderPaste          — paste aperture.
 */
export type AperFunction =
  | "SMDPad,CuDef"
  | "ComponentPad"
  | "WasherPad"
  | "ViaPad"
  | "Conductor"
  | "Profile"
  | "NonConductor"
  | "SolderMask"
  | "SolderPaste";

export interface AllocatedAperture {
  code: number; // D-code, starts at 10
  shape: ApertureShape;
  aperFunction: AperFunction;
}

export class ApertureTable {
  private next = 10;
  private byKey = new Map<string, AllocatedAperture>();
  /** Aperture macros (rounded rect) keyed by macro name. */
  private macros = new Map<string, string>();

  /**
   * Allocate or reuse an aperture matching (shape, aperFunction).
   * Returns the stable D-code.
   */
  allocate(shape: ApertureShape, aperFunction: AperFunction): number {
    const key = canonicalKey(shape, aperFunction);
    const existing = this.byKey.get(key);
    if (existing) return existing.code;
    const code = this.next++;
    this.byKey.set(key, { code, shape, aperFunction });
    if (needsRotationMacro(shape)) {
      this.ensureRotatedMacro(shape, rotationOf(shape));
    } else if (shape.kind === "roundrect") {
      this.ensureRoundrectMacro(shape.widthMm, shape.heightMm, shape.radiusMm);
    }
    return code;
  }

  /** Aperture macros sorted by insertion order (for stable diffs). */
  emitMacros(): string[] {
    return Array.from(this.macros.values());
  }

  /** Aperture definitions including `%TA.AperFunction*%` attributes. */
  emitDefinitions(): string[] {
    const lines: string[] = [];
    // Stable order by D-code so two identical inputs produce byte-identical
    // output (golden-file compliance tests rely on this).
    const sorted = Array.from(this.byKey.values()).sort(
      (a, b) => a.code - b.code,
    );
    for (const a of sorted) {
      lines.push(`%TA.AperFunction,${a.aperFunction}*%`);
      lines.push(formatAperture(a));
      lines.push(`%TD*%`);
    }
    return lines;
  }

  private ensureRoundrectMacro(
    widthMm: number,
    heightMm: number,
    radiusMm: number,
  ): void {
    const name = roundrectMacroName(widthMm, heightMm, radiusMm);
    if (this.macros.has(name)) return;
    // Roundrect macro: central rectangle plus four edge rectangles for the
    // straight sections, plus four corner circles. Polarity 1 (exposure on).
    const r = clampRoundrectRadius(widthMm, heightMm, radiusMm);
    const w = widthMm;
    const h = heightMm;
    // Center rectangle covers the full width minus the corner radii bands:
    //   - Horizontal strip: width=w,        height=h-2r, centered
    //   - Vertical strip:   width=w-2r,     height=h,    centered
    const hStripH = Math.max(0, h - 2 * r);
    const vStripW = Math.max(0, w - 2 * r);
    const cx = 0;
    const cy = 0;
    const lines: string[] = [];
    lines.push(`%AM${name}*`);
    if (hStripH > 0) {
      lines.push(
        `21,1,${gerberDim(w)},${gerberDim(hStripH)},${gerberDim(cx)},${gerberDim(cy)},0*`,
      );
    }
    if (vStripW > 0) {
      lines.push(
        `21,1,${gerberDim(vStripW)},${gerberDim(h)},${gerberDim(cx)},${gerberDim(cy)},0*`,
      );
    }
    // Four corner circles at ±(w/2-r), ±(h/2-r). Circle primitive (code 1):
    //   1,<exposure>,<diameter>,<center.x>,<center.y>
    const cornerOffsets: Array<[number, number]> = [
      [-(w / 2 - r), -(h / 2 - r)],
      [+(w / 2 - r), -(h / 2 - r)],
      [-(w / 2 - r), +(h / 2 - r)],
      [+(w / 2 - r), +(h / 2 - r)],
    ];
    for (const [ox, oy] of cornerOffsets) {
      lines.push(`1,1,${gerberDim(2 * r)},${gerberDim(ox)},${gerberDim(oy)}*`);
    }
    lines.push("%");
    // Gerber files use CRLF throughout; macro lines must use the same
    // terminator as the rest of the file or strict parsers (Ucamco
    // reference, KiCad-import) reject the mixed-encoding macro block.
    this.macros.set(name, lines.join("\r\n"));
  }

  /**
   * Aperture macro for a shape rotated by a non-orthogonal angle. Primitives
   * rotate about the MACRO ORIGIN, so every off-origin centre is pre-rotated
   * by the same angle and the primitive's own rotation parameter is used only
   * for the axis-aligned bodies (`21` centre lines).
   */
  private ensureRotatedMacro(shape: ApertureShape, angleDeg: number): void {
    const name = rotatedMacroName(shape, angleDeg);
    if (this.macros.has(name)) return;
    const lines: string[] = [`%AM${name}*`];
    const a = gerberDim(angleDeg);
    switch (shape.kind) {
      case "circle":
        // A disc is rotation-invariant; it never reaches this path.
        return;
      case "rect":
        lines.push(
          `21,1,${gerberDim(shape.widthMm)},${gerberDim(shape.heightMm)},0,0,${a}*`,
        );
        break;
      case "obround": {
        const w = shape.widthMm;
        const h = shape.heightMm;
        const tool = Math.min(w, h);
        const span = Math.max(w, h) - tool;
        if (span > 0) {
          // Straight part: the full stadium minus its two caps.
          const bodyW = w > h ? span : w;
          const bodyH = w > h ? h : span;
          lines.push(
            `21,1,${gerberDim(bodyW)},${gerberDim(bodyH)},0,0,${a}*`,
          );
        }
        // Cap centres: the long axis is X when w > h, else Y — a pad-local
        // vector, so it is rotated by the same angle before it is written.
        const half = span / 2;
        const local: Array<[number, number]> =
          w > h
            ? [
                [-half, 0],
                [half, 0],
              ]
            : [
                [0, -half],
                [0, half],
              ];
        for (const [lx, ly] of local) {
          const [cx, cy] = rotatePoint(lx, ly, angleDeg);
          lines.push(
            `1,1,${gerberDim(tool)},${gerberDim(cx)},${gerberDim(cy)}*`,
          );
        }
        break;
      }
      case "roundrect": {
        const w = shape.widthMm;
        const h = shape.heightMm;
        const r = clampRoundrectRadius(w, h, shape.radiusMm);
        const hStripH = Math.max(0, h - 2 * r);
        const vStripW = Math.max(0, w - 2 * r);
        if (hStripH > 0) {
          lines.push(`21,1,${gerberDim(w)},${gerberDim(hStripH)},0,0,${a}*`);
        }
        if (vStripW > 0) {
          lines.push(`21,1,${gerberDim(vStripW)},${gerberDim(h)},0,0,${a}*`);
        }
        for (const [ox, oy] of roundrectCornerOffsets(w, h, r)) {
          const [cx, cy] = rotatePoint(ox, oy, angleDeg);
          lines.push(
            `1,1,${gerberDim(2 * r)},${gerberDim(cx)},${gerberDim(cy)}*`,
          );
        }
        break;
      }
    }
    lines.push("%");
    this.macros.set(name, lines.join("\r\n"));
  }
}

/** Rotate a macro-frame point by `deg` CCW about the macro origin. */
function rotatePoint(x: number, y: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

function roundrectCornerOffsets(
  w: number,
  h: number,
  r: number,
): Array<[number, number]> {
  return [
    [-(w / 2 - r), -(h / 2 - r)],
    [+(w / 2 - r), -(h / 2 - r)],
    [-(w / 2 - r), +(h / 2 - r)],
    [+(w / 2 - r), +(h / 2 - r)],
  ];
}

/** Macro names must start with a letter and be unique per parameter tuple. */
function dimKey(mm: number): string {
  return gerberDim(mm).replace(".", "p").replace("-", "m");
}

function rotatedMacroName(shape: ApertureShape, angleDeg: number): string {
  const a = dimKey(angleDeg);
  switch (shape.kind) {
    case "circle":
      return `C_${dimKey(shape.diameterMm)}`;
    case "rect":
      return `ROT_R_${dimKey(shape.widthMm)}_${dimKey(shape.heightMm)}_${a}`;
    case "obround":
      return `ROT_O_${dimKey(shape.widthMm)}_${dimKey(shape.heightMm)}_${a}`;
    case "roundrect":
      return `ROT_RR_${dimKey(shape.widthMm)}_${dimKey(shape.heightMm)}_${dimKey(
        shape.radiusMm,
      )}_${a}`;
  }
}

function canonicalKey(shape: ApertureShape, fn: AperFunction): string {
  // The rotation is part of the aperture's identity: two pads that differ only
  // in a non-orthogonal angle are two different macros. Key strings are
  // internal (never emitted), so appending it changes no output byte for the
  // unrotated shapes.
  const rot = `|${gerberDim(rotationOf(shape))}`;
  switch (shape.kind) {
    case "circle":
      return `c|${gerberDim(shape.diameterMm)}|${fn}`;
    case "rect":
      return `r|${gerberDim(shape.widthMm)}|${gerberDim(shape.heightMm)}${rot}|${fn}`;
    case "obround":
      return `o|${gerberDim(shape.widthMm)}|${gerberDim(shape.heightMm)}${rot}|${fn}`;
    case "roundrect":
      return `rr|${gerberDim(shape.widthMm)}|${gerberDim(shape.heightMm)}|${gerberDim(shape.radiusMm)}${rot}|${fn}`;
  }
}

function formatAperture(a: AllocatedAperture): string {
  const s = a.shape;
  if (needsRotationMacro(s)) {
    return `%ADD${a.code}${rotatedMacroName(s, rotationOf(s))}*%`;
  }
  switch (s.kind) {
    case "circle":
      return `%ADD${a.code}C,${gerberDim(s.diameterMm)}*%`;
    case "rect":
      return `%ADD${a.code}R,${gerberDim(s.widthMm)}X${gerberDim(s.heightMm)}*%`;
    case "obround":
      return `%ADD${a.code}O,${gerberDim(s.widthMm)}X${gerberDim(s.heightMm)}*%`;
    case "roundrect": {
      const name = roundrectMacroName(s.widthMm, s.heightMm, s.radiusMm);
      return `%ADD${a.code}${name}*%`;
    }
  }
}

function roundrectMacroName(
  widthMm: number,
  heightMm: number,
  radiusMm: number,
): string {
  // Macro names must start with a letter and be unique per parameter
  // combination. Use a deterministic, alphanumeric key based on dimensions.
  const wKey = gerberDim(widthMm).replace(".", "p");
  const hKey = gerberDim(heightMm).replace(".", "p");
  const rKey = gerberDim(radiusMm).replace(".", "p");
  return `RR_${wKey}_${hKey}_${rKey}`;
}

function clampRoundrectRadius(w: number, h: number, r: number): number {
  const maxR = Math.min(w, h) / 2;
  return Math.max(0, Math.min(r, maxR));
}
