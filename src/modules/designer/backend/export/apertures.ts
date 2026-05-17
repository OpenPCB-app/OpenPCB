import { gerberDim } from "./units";

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
 */

export type ApertureShape =
  | { kind: "circle"; diameterMm: number }
  | { kind: "rect"; widthMm: number; heightMm: number }
  | { kind: "obround"; widthMm: number; heightMm: number }
  | { kind: "roundrect"; widthMm: number; heightMm: number; radiusMm: number };

/**
 * X2 aperture-function attribute (informational, but JLCPCB and other
 * fabs read these when present). Drives `%TA.AperFunction,…*%` emission
 * immediately before the matching `%ADD…*%`.
 *
 * Spec values used here:
 *  - SMDPad,CuDef        — SMD copper pad, copper-defined.
 *  - ComponentPad         — through-hole copper pad (PTH).
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
    if (shape.kind === "roundrect") {
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
}

function canonicalKey(shape: ApertureShape, fn: AperFunction): string {
  switch (shape.kind) {
    case "circle":
      return `c|${gerberDim(shape.diameterMm)}|${fn}`;
    case "rect":
      return `r|${gerberDim(shape.widthMm)}|${gerberDim(shape.heightMm)}|${fn}`;
    case "obround":
      return `o|${gerberDim(shape.widthMm)}|${gerberDim(shape.heightMm)}|${fn}`;
    case "roundrect":
      return `rr|${gerberDim(shape.widthMm)}|${gerberDim(shape.heightMm)}|${gerberDim(shape.radiusMm)}|${fn}`;
  }
}

function formatAperture(a: AllocatedAperture): string {
  const s = a.shape;
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
