/**
 * Pure render-model → SVG string. No DOM, no React, no Three.js — safe to
 * run on Bun and inside cache fills. Used by the library `/preview.svg`
 * endpoints to serve thumbnails for the grid view.
 *
 * Coordinate system: the render model is in millimeters with +Y up
 * (schematic / KiCad convention). SVG is +Y down. We emit a `viewBox` in mm,
 * apply `transform="scale(1,-1)"` on the inner group, and translate so the
 * symbol bounds map onto the viewBox origin.
 */

import type {
  BoundsMm,
  FootprintRenderModel,
  PointMm,
  PreviewGraphic,
  SymbolRenderModel,
  SymbolRenderModelPin,
  FootprintRenderSourcePad,
} from "@openpcb/rendering-core";

export interface SymbolSvgOptions {
  /** Render pin labels (name + number) — noisy at thumbnail scale. Default false. */
  includeLabels?: boolean;
  /** Padding around bounds, in mm. Default 1.5 mm. */
  paddingMm?: number;
  /** Stroke color CSS value. Default `currentColor` so the caller theming wins. */
  strokeColor?: string;
  /** Stroke width override (mm). Default uses primitive's own strokeWidthMm with a sane floor. */
  minStrokeWidthMm?: number;
  /**
   * Treat rectangle graphics declared as `fill: "solid"` as outline-only.
   * Defaults to true for symbols — KiCad symbol bodies are conventionally
   * drawn with a background fill that doesn't obscure pin labels inside the
   * body. Filling them with the stroke color hides everything underneath.
   * Polyline (diode triangle, mosfet arrow) and circle (junction dot) fills
   * are left untouched.
   */
  outlineOnlyBodyRects?: boolean;
}

export interface FootprintSvgOptions {
  includeLabels?: boolean;
  paddingMm?: number;
  /** Pad fill color. Default a yellow-amber to match the in-app footprint view. */
  padColor?: string;
  /** Outline / silkscreen color. */
  strokeColor?: string;
  minStrokeWidthMm?: number;
}

const DEFAULT_PADDING_MM = 1.5;
const DEFAULT_MIN_STROKE_MM = 0.12;
const DEFAULT_PAD_COLOR = "#d4a017";
const DEFAULT_FOOTPRINT_STROKE = "#94a3b8";

// ---------- public entry points ----------

export function renderSymbolToSvg(
  model: SymbolRenderModel,
  options: SymbolSvgOptions = {},
): string {
  const padding = options.paddingMm ?? DEFAULT_PADDING_MM;
  const strokeColor = options.strokeColor ?? "currentColor";
  const minStroke = options.minStrokeWidthMm ?? DEFAULT_MIN_STROKE_MM;
  const includeLabels = options.includeLabels ?? false;
  const outlineOnlyBodyRects = options.outlineOnlyBodyRects ?? true;

  const bounds = resolveBounds(
    model.bounds,
    collectSymbolPoints(model),
    padding,
  );
  const { viewBox, innerTransform } = svgFrame(bounds);

  const parts: string[] = [];
  for (const g of model.graphics) {
    parts.push(graphicToSvg(g, strokeColor, minStroke, outlineOnlyBodyRects));
  }
  for (const pin of model.pins) {
    parts.push(symbolPinToSvg(pin, strokeColor, minStroke));
  }
  if (includeLabels) {
    for (const label of model.labels) {
      parts.push(
        labelToSvg(label.at, label.text, label.fontSizeMm, strokeColor),
      );
    }
  }

  return wrapSvg(viewBox, innerTransform, parts.join(""), {
    role: "symbol",
    name: model.name,
  });
}

export function renderFootprintToSvg(
  model: FootprintRenderModel,
  options: FootprintSvgOptions = {},
): string {
  const padding = options.paddingMm ?? DEFAULT_PADDING_MM;
  const padColor = options.padColor ?? DEFAULT_PAD_COLOR;
  const strokeColor = options.strokeColor ?? DEFAULT_FOOTPRINT_STROKE;
  const minStroke = options.minStrokeWidthMm ?? DEFAULT_MIN_STROKE_MM;
  const includeLabels = options.includeLabels ?? false;

  const bounds = resolveBounds(
    model.bounds,
    collectFootprintPoints(model),
    padding,
  );
  const { viewBox, innerTransform } = svgFrame(bounds);

  const parts: string[] = [];
  for (const g of model.graphics) {
    // Footprint silkscreen/courtyard rects stay solid-when-told. There's no
    // KiCad "background body" idiom on the PCB layer.
    parts.push(graphicToSvg(g, strokeColor, minStroke, false));
  }
  for (const pad of model.pads) {
    parts.push(padToSvg(pad, padColor));
  }
  if (includeLabels) {
    for (const label of model.labels) {
      parts.push(
        labelToSvg(label.at, label.text, label.fontSizeMm, strokeColor),
      );
    }
  }

  return wrapSvg(viewBox, innerTransform, parts.join(""), {
    role: "footprint",
    name: model.name,
  });
}

// ---------- bounds + viewBox ----------

function resolveBounds(
  given: BoundsMm | null,
  fallbackPoints: PointMm[],
  paddingMm: number,
): BoundsMm {
  // Always union provided bounds with every primitive endpoint we know about.
  // Some KiCad-derived symbol bounds describe only the body rect and omit
  // pin extents — without this union the SVG viewBox clips pin stubs.
  const fromPoints = boundsFromPoints(fallbackPoints);
  let b: BoundsMm;
  if (
    given &&
    isFinite(given.minX) &&
    isFinite(given.minY) &&
    isFinite(given.maxX) &&
    isFinite(given.maxY)
  ) {
    b = {
      minX: Math.min(given.minX, fromPoints.minX),
      minY: Math.min(given.minY, fromPoints.minY),
      maxX: Math.max(given.maxX, fromPoints.maxX),
      maxY: Math.max(given.maxY, fromPoints.maxY),
    };
  } else {
    b = fromPoints;
  }
  // Degenerate (single-point or zero-size) bounds — pad to a visible square.
  if (b.maxX - b.minX < 0.5 || b.maxY - b.minY < 0.5) {
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    b = { minX: cx - 1, minY: cy - 1, maxX: cx + 1, maxY: cy + 1 };
  }
  return {
    minX: b.minX - paddingMm,
    minY: b.minY - paddingMm,
    maxX: b.maxX + paddingMm,
    maxY: b.maxY + paddingMm,
  };
}

function boundsFromPoints(points: PointMm[]): BoundsMm {
  if (points.length === 0) {
    return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function svgFrame(bounds: BoundsMm): {
  viewBox: string;
  innerTransform: string;
} {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  // viewBox is in mm, origin at top-left. We flip Y inside the group and
  // translate so model-space (bounds.minX, bounds.maxY) lands at (0,0).
  return {
    viewBox: `0 0 ${num(width)} ${num(height)}`,
    innerTransform: `translate(${num(-bounds.minX)} ${num(bounds.maxY)}) scale(1 -1)`,
  };
}

// ---------- point collection (for missing bounds) ----------

function collectSymbolPoints(model: SymbolRenderModel): PointMm[] {
  const pts: PointMm[] = [];
  for (const g of model.graphics) pushGraphicPoints(g, pts);
  for (const pin of model.pins) {
    pts.push(pin.anchor, pin.bodyEnd);
  }
  return pts;
}

function collectFootprintPoints(model: FootprintRenderModel): PointMm[] {
  const pts: PointMm[] = [];
  for (const g of model.graphics) pushGraphicPoints(g, pts);
  for (const pad of model.pads) {
    const halfW = pad.widthMm / 2;
    const halfH = pad.heightMm / 2;
    pts.push(
      { x: pad.centerMm.x - halfW, y: pad.centerMm.y - halfH },
      { x: pad.centerMm.x + halfW, y: pad.centerMm.y + halfH },
    );
  }
  return pts;
}

function pushGraphicPoints(g: PreviewGraphic, out: PointMm[]): void {
  switch (g.kind) {
    case "line":
      out.push(g.a, g.b);
      return;
    case "rect":
      out.push({ x: g.x, y: g.y }, { x: g.x + g.width, y: g.y + g.height });
      return;
    case "circle":
      out.push(
        { x: g.center.x - g.radiusMm, y: g.center.y - g.radiusMm },
        { x: g.center.x + g.radiusMm, y: g.center.y + g.radiusMm },
      );
      return;
    case "arc3":
      out.push(g.start, g.mid, g.end);
      return;
    case "polyline":
      for (const p of g.points) out.push(p);
      return;
    case "bezier":
      for (const p of g.points) out.push(p);
      return;
  }
}

// ---------- primitive rendering ----------

function graphicToSvg(
  g: PreviewGraphic,
  stroke: string,
  minStrokeMm: number,
  outlineOnlyBodyRects: boolean,
): string {
  const sw = Math.max(g.strokeWidthMm, minStrokeMm);
  switch (g.kind) {
    case "line":
      return `<line x1="${num(g.a.x)}" y1="${num(g.a.y)}" x2="${num(g.b.x)}" y2="${num(g.b.y)}" stroke="${stroke}" stroke-width="${num(sw)}" stroke-linecap="round" />`;
    case "rect": {
      const fill =
        g.fill === "solid" && !outlineOnlyBodyRects ? stroke : "none";
      return `<rect x="${num(g.x)}" y="${num(g.y)}" width="${num(g.width)}" height="${num(g.height)}" stroke="${stroke}" stroke-width="${num(sw)}" fill="${fill}" />`;
    }
    case "circle": {
      const fill = g.fill === "solid" ? stroke : "none";
      return `<circle cx="${num(g.center.x)}" cy="${num(g.center.y)}" r="${num(g.radiusMm)}" stroke="${stroke}" stroke-width="${num(sw)}" fill="${fill}" />`;
    }
    case "arc3":
      return arcToSvgPath(g.start, g.mid, g.end, sw, stroke);
    case "polyline": {
      const d = polylinePath(g.points, g.closed);
      const fill = g.fill === "solid" ? stroke : "none";
      return `<path d="${d}" stroke="${stroke}" stroke-width="${num(sw)}" stroke-linejoin="round" stroke-linecap="round" fill="${fill}" />`;
    }
    case "bezier": {
      const [p0, p1, p2, p3] = g.points;
      const d = `M ${num(p0.x)} ${num(p0.y)} C ${num(p1.x)} ${num(p1.y)} ${num(p2.x)} ${num(p2.y)} ${num(p3.x)} ${num(p3.y)}`;
      return `<path d="${d}" stroke="${stroke}" stroke-width="${num(sw)}" fill="none" />`;
    }
  }
}

function arcToSvgPath(
  start: PointMm,
  mid: PointMm,
  end: PointMm,
  strokeMm: number,
  stroke: string,
): string {
  // 3-point arc → circumscribed circle → SVG `A` command with the correct
  // large-arc and sweep flags. Falls back to a polyline if the points are
  // collinear (degenerate circle).
  const c = circleFromThreePoints(start, mid, end);
  if (!c) {
    const d = `M ${num(start.x)} ${num(start.y)} L ${num(mid.x)} ${num(mid.y)} L ${num(end.x)} ${num(end.y)}`;
    return `<path d="${d}" stroke="${stroke}" stroke-width="${num(strokeMm)}" fill="none" />`;
  }
  const cross =
    (mid.x - start.x) * (end.y - start.y) -
    (mid.y - start.y) * (end.x - start.x);
  const sweepFlag = cross > 0 ? 0 : 1;
  // large-arc = does the arc through `mid` cover more than 180°?
  const angSE = signedAngle(c, start, end);
  const angSM = signedAngle(c, start, mid);
  const angME = signedAngle(c, mid, end);
  const direct = Math.abs(angSE);
  const viaMid = Math.abs(angSM) + Math.abs(angME);
  const largeArcFlag = viaMid > direct + 1e-6 ? 1 : 0;
  const d = `M ${num(start.x)} ${num(start.y)} A ${num(c.r)} ${num(c.r)} 0 ${largeArcFlag} ${sweepFlag} ${num(end.x)} ${num(end.y)}`;
  return `<path d="${d}" stroke="${stroke}" stroke-width="${num(strokeMm)}" fill="none" stroke-linecap="round" />`;
}

function circleFromThreePoints(
  a: PointMm,
  b: PointMm,
  c: PointMm,
): { x: number; y: number; r: number } | null {
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  const cx = c.x;
  const cy = c.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;
  const r = Math.hypot(ax - ux, ay - uy);
  return { x: ux, y: uy, r };
}

function signedAngle(
  c: { x: number; y: number },
  p: PointMm,
  q: PointMm,
): number {
  const ang1 = Math.atan2(p.y - c.y, p.x - c.x);
  const ang2 = Math.atan2(q.y - c.y, q.x - c.x);
  let diff = ang2 - ang1;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

function polylinePath(points: readonly PointMm[], closed: boolean): string {
  if (points.length === 0) return "";
  const segs: string[] = [];
  const first = points[0]!;
  segs.push(`M ${num(first.x)} ${num(first.y)}`);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    segs.push(`L ${num(p.x)} ${num(p.y)}`);
  }
  if (closed) segs.push("Z");
  return segs.join(" ");
}

function symbolPinToSvg(
  pin: SymbolRenderModelPin,
  stroke: string,
  minStrokeMm: number,
): string {
  const sw = Math.max(0.15, minStrokeMm);
  const line = `<line x1="${num(pin.anchor.x)}" y1="${num(pin.anchor.y)}" x2="${num(pin.bodyEnd.x)}" y2="${num(pin.bodyEnd.y)}" stroke="${stroke}" stroke-width="${num(sw)}" stroke-linecap="round" />`;
  const dot = `<circle cx="${num(pin.anchor.x)}" cy="${num(pin.anchor.y)}" r="0.18" fill="${stroke}" />`;
  return line + dot;
}

function padToSvg(pad: FootprintRenderSourcePad, fill: string): string {
  const cx = pad.centerMm.x;
  const cy = pad.centerMm.y;
  const w = pad.widthMm;
  const h = pad.heightMm;
  if (pad.shape === "circle") {
    const r = Math.min(w, h) / 2;
    return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${fill}" />`;
  }
  // Default: axis-aligned (or rotated) rectangle. Roundrect uses
  // roundrectRatio when present (KiCad standard).
  const ratio = pad.shape === "roundrect" ? (pad.roundrectRatio ?? 0.25) : 0;
  const rx = ratio > 0 ? Math.min(w, h) * ratio : 0;
  const ry = rx;
  const rot = pad.rotationDeg;
  const rectAttrs = `x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}" rx="${num(rx)}" ry="${num(ry)}" fill="${fill}"`;
  if (Math.abs(rot) < 1e-3) {
    return `<g transform="translate(${num(cx)} ${num(cy)})"><rect ${rectAttrs} /></g>`;
  }
  return `<g transform="translate(${num(cx)} ${num(cy)}) rotate(${num(rot)})"><rect ${rectAttrs} /></g>`;
}

function labelToSvg(
  at: PointMm,
  text: string,
  fontSizeMm: number,
  color: string,
): string {
  // Labels live inside the Y-flipped group; flip back so glyphs read upright.
  return `<g transform="translate(${num(at.x)} ${num(at.y)}) scale(1 -1)"><text x="0" y="0" font-size="${num(fontSizeMm)}" fill="${color}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${escapeXml(text)}</text></g>`;
}

// ---------- SVG envelope ----------

function wrapSvg(
  viewBox: string,
  innerTransform: string,
  body: string,
  meta: { role: string; name: string },
): string {
  // `<img src="…svg">` does not inherit CSS `currentColor` from the parent —
  // the SVG document has its own `color` property which defaults to black.
  // Embed an OS-theme-adaptive style block so thumbnails read correctly on
  // both light and dark backgrounds. App theme can override by passing an
  // explicit strokeColor in render options (defeats the media query).
  const style =
    "svg{color:#475569}" +
    "@media (prefers-color-scheme: dark){svg{color:#cbd5e1}}";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img" ` +
    `aria-label="${escapeXml(meta.role)}: ${escapeXml(meta.name)}">` +
    `<style>${style}</style>` +
    `<g transform="${innerTransform}" fill="none" vector-effect="non-scaling-stroke">${body}</g>` +
    `</svg>`
  );
}

// ---------- utilities ----------

function num(n: number): string {
  // 3 decimals is plenty at 0.001 mm precision; trims viewBox/path bloat.
  if (!isFinite(n)) return "0";
  const fixed = n.toFixed(3);
  // Drop trailing zeros and trailing dots.
  return fixed.replace(/\.?0+$/, "");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
