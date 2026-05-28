import type { DesignerSchematicPreview } from "@sdks/designer";

/**
 * Pure transform from a stored {@link DesignerSchematicPreview} (symbol vector
 * graphics in mm + wire polylines in nm) into auto-fit SVG geometry for the
 * Home-screen thumbnail. No React / canvas / R3F — just math, so it is unit
 * testable. Returns `null` for empty designs (no placed parts).
 *
 * Coordinate pipeline mirrors `SchematicCanvas.partLocalToWorldMm`: each part's
 * local-mm point is mirrored, rotated, then translated by the part position.
 * Schematic world-Y points up, so SVG-Y is negated to match the editor.
 */

type PreviewPart = DesignerSchematicPreview["parts"][number];
type Graphic = PreviewPart["graphics"][number];
type PreviewPrimitive = DesignerSchematicPreview["primitives"][number];

const NM_PER_MM = 1_000_000;

/** Affine transform shared by symbol graphics/pins (mirror) and primitives
 *  (no mirror). Position is in nm; everything else is local mm. */
interface Transform {
  positionNm: { x: number; y: number };
  rotationDeg: number;
  mirrored: boolean;
}

interface Pt {
  x: number;
  y: number;
}

export interface SchematicPreviewGeometry {
  viewBox: string;
  /** Symbol body lines/rects/polylines/arcs/beziers as SVG path `d` strings. */
  paths: { d: string; fill: boolean }[];
  circles: { cx: number; cy: number; r: number; fill: boolean }[];
  /** Wire polylines as SVG `points` attribute strings ("x,y x,y …"). */
  wires: string[];
  /** Connection points (pin anchors + primitive origins) in SVG space. */
  dots: Pt[];
}

// Local-space (mm) primitive geometry, mirrored from the editor's
// SchematicPrimitivesLayer (core/ may not import from modules/). Connection
// point is at local (0, 0); rotation pivots around it.
const PRIMITIVE_SEGMENTS: Record<PreviewPrimitive["kind"], Array<[Pt, Pt]>> = {
  gnd: [
    [
      { x: 0, y: 0 },
      { x: 0, y: -2.032 },
    ],
    [
      { x: -2.032, y: -2.032 },
      { x: 2.032, y: -2.032 },
    ],
    [
      { x: -1.219, y: -2.794 },
      { x: 1.219, y: -2.794 },
    ],
    [
      { x: -0.61, y: -3.556 },
      { x: 0.61, y: -3.556 },
    ],
  ],
  pwr: [
    [
      { x: 0, y: 0 },
      { x: 0, y: 1.27 },
    ],
    [
      { x: -1.27, y: 1.27 },
      { x: 1.27, y: 1.27 },
    ],
    [
      { x: -1.27, y: 1.27 },
      { x: 0, y: 2.794 },
    ],
    [
      { x: 0, y: 2.794 },
      { x: 1.27, y: 1.27 },
    ],
  ],
  net_portal: [
    [
      { x: 0, y: 0 },
      { x: -0.812, y: 1.016 },
    ],
    [
      { x: -0.812, y: 1.016 },
      { x: -4.47, y: 1.016 },
    ],
    [
      { x: -4.47, y: 1.016 },
      { x: -4.47, y: -1.016 },
    ],
    [
      { x: -4.47, y: -1.016 },
      { x: -0.812, y: -1.016 },
    ],
    [
      { x: -0.812, y: -1.016 },
      { x: 0, y: 0 },
    ],
  ],
};

class Bounds {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  add(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }
  get valid(): boolean {
    return Number.isFinite(this.minX) && Number.isFinite(this.minY);
  }
}

/** Local-mm point → SVG-space point (world transform + Y flip). */
function toSvg(t: Transform, localX: number, localY: number): Pt {
  const scaleX = t.mirrored ? -1 : 1;
  const sx = localX * scaleX;
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const wx = sx * cos - localY * sin + t.positionNm.x / NM_PER_MM;
  const wy = sx * sin + localY * cos + t.positionNm.y / NM_PER_MM;
  // `+ 0` normalizes -0 → 0 so dot coordinates compare cleanly.
  return { x: wx + 0, y: -wy + 0 };
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

function polylinePath(pts: Pt[], close: boolean, b: Bounds): string {
  const d = pts
    .map((p, i) => {
      b.add(p.x, p.y);
      return `${i === 0 ? "M" : "L"}${fmt(p.x)} ${fmt(p.y)}`;
    })
    .join(" ");
  return close ? `${d} Z` : d;
}

/** Sample a 3-point circular arc into a polyline (robust + simple vs SVG A). */
function sampleArc3(part: PreviewPart, g: Graphic & { kind: "arc3" }): Pt[] {
  const a = toSvg(part, g.start.x, g.start.y);
  const m = toSvg(part, g.mid.x, g.mid.y);
  const c = toSvg(part, g.end.x, g.end.y);
  // Circumcenter of the three transformed points (SVG space).
  const d = 2 * (a.x * (m.y - c.y) + m.x * (c.y - a.y) + c.x * (a.y - m.y));
  if (Math.abs(d) < 1e-9) return [a, m, c];
  const a2 = a.x * a.x + a.y * a.y;
  const m2 = m.x * m.x + m.y * m.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (m.y - c.y) + m2 * (c.y - a.y) + c2 * (a.y - m.y)) / d;
  const uy = (a2 * (c.x - m.x) + m2 * (a.x - c.x) + c2 * (m.x - a.x)) / d;
  const center = { x: ux, y: uy };
  const r = Math.hypot(a.x - ux, a.y - uy);
  const ang = (p: Pt) => Math.atan2(p.y - center.y, p.x - center.x);
  let a0 = ang(a);
  const am = ang(m);
  let a1 = ang(c);
  // Ensure the sweep passes through the midpoint angle.
  const norm = (x: number) =>
    ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const rel = norm(a1 - a0);
  const relM = norm(am - a0);
  if (relM > rel) a1 = a0 + (rel - 2 * Math.PI);
  else a1 = a0 + rel;
  const steps = 16;
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) });
  }
  return out;
}

function sampleBezier(
  part: PreviewPart,
  g: Graphic & { kind: "bezier" },
): Pt[] {
  const p = g.points.map((pt) => toSvg(part, pt.x, pt.y));
  const out: Pt[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x:
        u * u * u * p[0]!.x +
        3 * u * u * t * p[1]!.x +
        3 * u * t * t * p[2]!.x +
        t * t * t * p[3]!.x,
      y:
        u * u * u * p[0]!.y +
        3 * u * u * t * p[1]!.y +
        3 * u * t * t * p[2]!.y +
        t * t * t * p[3]!.y,
    });
  }
  return out;
}

export function buildSchematicPreviewGeometry(
  preview: DesignerSchematicPreview,
): SchematicPreviewGeometry | null {
  if (preview.parts.length === 0) return null;

  const b = new Bounds();
  const paths: SchematicPreviewGeometry["paths"] = [];
  const circles: SchematicPreviewGeometry["circles"] = [];
  const wires: string[] = [];
  const dots: Pt[] = [];

  for (const part of preview.parts) {
    for (const pin of part.pins ?? []) {
      const anchor = toSvg(part, pin.anchor.x, pin.anchor.y);
      const bodyEnd = toSvg(part, pin.bodyEnd.x, pin.bodyEnd.y);
      paths.push({ d: polylinePath([anchor, bodyEnd], false, b), fill: false });
      dots.push(anchor);
    }
    for (const g of part.graphics) {
      switch (g.kind) {
        case "line":
          paths.push({
            d: polylinePath(
              [toSvg(part, g.a.x, g.a.y), toSvg(part, g.b.x, g.b.y)],
              false,
              b,
            ),
            fill: false,
          });
          break;
        case "rect": {
          const corners: Pt[] = [
            toSvg(part, g.x, g.y),
            toSvg(part, g.x + g.width, g.y),
            toSvg(part, g.x + g.width, g.y + g.height),
            toSvg(part, g.x, g.y + g.height),
          ];
          paths.push({
            d: polylinePath(corners, true, b),
            fill: g.fill === "solid",
          });
          break;
        }
        case "circle": {
          const c = toSvg(part, g.center.x, g.center.y);
          b.add(c.x - g.radiusMm, c.y - g.radiusMm);
          b.add(c.x + g.radiusMm, c.y + g.radiusMm);
          circles.push({
            cx: c.x,
            cy: c.y,
            r: g.radiusMm,
            fill: g.fill === "solid",
          });
          break;
        }
        case "polyline":
          paths.push({
            d: polylinePath(
              g.points.map((p) => toSvg(part, p.x, p.y)),
              g.closed,
              b,
            ),
            fill: g.fill === "solid",
          });
          break;
        case "arc3":
          paths.push({
            d: polylinePath(sampleArc3(part, g), false, b),
            fill: false,
          });
          break;
        case "bezier":
          paths.push({
            d: polylinePath(sampleBezier(part, g), false, b),
            fill: false,
          });
          break;
      }
    }
  }

  for (const wire of preview.wires) {
    if (wire.pointsNm.length < 2) continue;
    const pts = wire.pointsNm.map((p) => {
      const x = p.x / NM_PER_MM;
      const y = -p.y / NM_PER_MM;
      b.add(x, y);
      return `${fmt(x)},${fmt(y)}`;
    });
    wires.push(pts.join(" "));
  }

  for (const primitive of preview.primitives ?? []) {
    const t: Transform = { ...primitive, mirrored: false };
    for (const [a, b0] of PRIMITIVE_SEGMENTS[primitive.kind]) {
      paths.push({
        d: polylinePath([toSvg(t, a.x, a.y), toSvg(t, b0.x, b0.y)], false, b),
        fill: false,
      });
    }
    // Connection point sits at local (0, 0); rotation pivots around it.
    dots.push(toSvg(t, 0, 0));
  }

  if (!b.valid) return null;

  const w = Math.max(b.maxX - b.minX, 0.001);
  const h = Math.max(b.maxY - b.minY, 0.001);
  const maxDim = Math.max(w, h);
  const pad = maxDim * 0.06 + 0.5;
  const viewBox = `${fmt(b.minX - pad)} ${fmt(b.minY - pad)} ${fmt(
    w + pad * 2,
  )} ${fmt(h + pad * 2)}`;

  return { viewBox, paths, circles, wires, dots };
}
