/**
 * THE expansion of a board overlay shape's stored `pointsMm` into the polyline
 * it is drawn as (DFM contract 11 §1.2). The canvas (`OverlayLayer.tsx`) and
 * the silkscreen artwork model read the SAME function, so what the user sees,
 * what DRC judges and what the fab receives are one shape — before S12 the
 * Gerber writer exported a `rect` / `circle` / `polygon` as its two stored
 * points, i.e. a diagonal line where the canvas drew a closed shape.
 */
import type { PcbOverlayShape, PcbPointMm } from "../../../../sdks/designer";

/** Chord count of a `circle` overlay — the canvas constant, kept verbatim. */
const CIRCLE_STEPS = 48;

export function overlayShapePolyline(
  shape: PcbOverlayShape,
): PcbPointMm[] | null {
  const p = shape.pointsMm;
  if (p.length < 2) return null;
  switch (shape.kind) {
    case "line":
      return [p[0]!, p[1]!];
    case "polyline":
      return [...p];
    case "polygon": {
      const out = [...p];
      if (
        out[0]!.x !== out[out.length - 1]!.x ||
        out[0]!.y !== out[out.length - 1]!.y
      ) {
        out.push(out[0]!);
      }
      return out;
    }
    case "rect": {
      const a = p[0]!;
      const b = p[1]!;
      return [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
        { x: a.x, y: a.y },
      ];
    }
    case "circle": {
      const center = p[0]!;
      const edge = p[1]!;
      const dx = edge.x - center.x;
      const dy = edge.y - center.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      if (radius <= 0) return null;
      const out: PcbPointMm[] = [];
      for (let i = 0; i <= CIRCLE_STEPS; i++) {
        const a = (i / CIRCLE_STEPS) * Math.PI * 2;
        out.push({
          x: center.x + Math.cos(a) * radius,
          y: center.y + Math.sin(a) * radius,
        });
      }
      return out;
    }
  }
}

/**
 * Does the shape carry a filled interior? Only the closed kinds can — the SDK
 * doc on `PcbOverlayShape.fill` says so, and the canvas builds its fill mesh
 * from the same predicate.
 */
export function isFilledOverlay(shape: PcbOverlayShape): boolean {
  if (shape.fill !== "solid") return false;
  return shape.kind === "rect" || shape.kind === "circle" || shape.kind === "polygon";
}
