import type {
  PcbCopperLayerId,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../sdks";

export type ClipperPoint = [number, number];
export type ClipperRing = ClipperPoint[];
export type ClipperPolygon = ClipperRing[];
export type ClipperMultiPolygon = ClipperPolygon[];

// Cap-segment count for trace stadium tips. Matches ARC_SEGMENTS used for pad
// corners (copper-fill-geometry.ts) so the two halo styles look identical.
const TRACE_CAP_SEGMENTS = 16;

// KiCad ARC_HIGH_DEF (~5 µm) chord-error budget when tessellating circular vias.
const VIA_MAX_ERROR_MM = 0.005;
const VIA_MIN_SEGMENTS = 16;
const VIA_MAX_SEGMENTS = 96;

const NM_TO_MM = 1 / 1_000_000;

// Monotonic top→bottom index for any copper layer, derived from the id so it
// works for every stackup up to 32 layers (P2). F.Cu = 0, In_k = k, B.Cu = a
// sentinel above every inner layer. Only relative order matters (via-span
// containment below), not absolute values.
function layerIndex(layer: PcbCopperLayerId): number {
  if (layer === "F.Cu") return 0;
  if (layer === "B.Cu") return 1_000;
  const m = /^In(\d+)\.Cu$/.exec(layer);
  return m ? Number(m[1]) : 0;
}

/**
 * Build a stadium ("oblong" / "discorectangle") polygon for one trace segment
 * A → B with half-thickness `radiusMm` (= width/2 + clearance). Returns null
 * for non-positive radius. A zero-length segment degenerates into a full disc.
 *
 * Winding is counter-clockwise. polygon-clipping accepts either winding for
 * boolean ops, but consistent winding avoids surprises in even-odd-filled
 * result topology (e.g. crossing-trace union holes).
 */
export function buildTraceSegmentStadium(
  a: PcbPointMm,
  b: PcbPointMm,
  radiusMm: number,
  capSegments: number = TRACE_CAP_SEGMENTS,
  circumscribed = false,
): ClipperRing | null {
  if (radiusMm <= 0) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    // Degenerate segment → full disc with the same effective radius.
    return buildDiscRing(a, radiusMm, capSegments * 2, circumscribed);
  }
  // Circumscribed cap (copper-pour contract §4): the flat sides are exact
  // tangents at ±90°, so the tangent chain continues from them — vertices at
  // the HALF-step angles, pushed out to `r · sec(π / 2n)`, enclose the true
  // semicircle. The inscribed cap (vertices on the arc at whole steps) under-
  // cuts a wide trace's clearance halo by `r · (1 − cos(π/n))`, 4.8 ‰ of r.
  const capRadius = circumscribed
    ? radiusMm / Math.cos(Math.PI / (2 * capSegments))
    : radiusMm;
  const capOffset = circumscribed ? 0.5 : 0;
  const capEnd = circumscribed ? capSegments + 1 : capSegments;
  const ux = dx / len;
  const uy = dy / len;
  // Left-hand perpendicular: rotate (ux,uy) by +90° → (-uy, ux).
  const px = -uy * radiusMm;
  const py = ux * radiusMm;
  const ring: ClipperRing = [];
  // Left long edge A → B (outer side, going forward).
  ring.push([a.x + px, a.y + py]);
  ring.push([b.x + px, b.y + py]);
  // Semicircular cap at B: sweep from +perp angle clockwise to −perp, going
  // around the outside (i.e. away from A). Going clockwise in xy-space keeps
  // the overall ring CCW because we're tracing the outside of the stadium.
  const angleB = Math.atan2(py, px);
  for (let i = 1; i < capEnd; i += 1) {
    const t = angleB - (Math.PI * (i - capOffset)) / capSegments;
    ring.push([b.x + Math.cos(t) * capRadius, b.y + Math.sin(t) * capRadius]);
  }
  // Right long edge B → A.
  ring.push([b.x - px, b.y - py]);
  ring.push([a.x - px, a.y - py]);
  // Semicircular cap at A: sweep from −perp clockwise to +perp around outside.
  const angleA = Math.atan2(-py, -px);
  for (let i = 1; i < capEnd; i += 1) {
    const t = angleA - (Math.PI * (i - capOffset)) / capSegments;
    ring.push([a.x + Math.cos(t) * capRadius, a.y + Math.sin(t) * capRadius]);
  }
  return ring;
}

/**
 * Regular-polygon disc approximating a circle of `radiusMm` centred on
 * `center`. Segment count derived from KiCad's chord-error formula
 *   n = π / acos(1 − maxError / r)
 * clamped to [16, 96]. Caller may pass `segmentsHint` to override the formula
 * (used by zero-length stadium degeneration to inherit a denser cap count).
 *
 * `circumscribed` pushes the sample points out to the tangent-polygon radius
 * (`r · sec(π/n)`) so the polygon ENCLOSES the true circle — what the pour needs
 * for a via obstacle, whose halo must never be short (copper-pour contract §4,
 * the same bias `padOutlineWorldMm` applies to pad arcs). The default stays
 * inscribed: connectivity and the drill artwork want the chord approximation.
 */
export function buildDiscRing(
  center: PcbPointMm,
  radiusMm: number,
  segmentsHint?: number,
  circumscribed = false,
): ClipperRing {
  const r = Math.max(0, radiusMm);
  const guarded = Math.max(r, VIA_MAX_ERROR_MM);
  const ratio = Math.max(-1, Math.min(1, 1 - VIA_MAX_ERROR_MM / guarded));
  const minN = segmentsHint ?? Math.ceil(Math.PI / Math.acos(ratio));
  const n = Math.max(VIA_MIN_SEGMENTS, Math.min(VIA_MAX_SEGMENTS, minN));
  const sampled = circumscribed ? r / Math.cos(Math.PI / n) : r;
  const ring: ClipperRing = [];
  for (let i = 0; i < n; i += 1) {
    const t = (Math.PI * 2 * i) / n;
    ring.push([
      center.x + Math.cos(t) * sampled,
      center.y + Math.sin(t) * sampled,
    ]);
  }
  return ring;
}

/**
 * One inflated-stadium polygon per polyline segment. World mm coordinates.
 * The caller is responsible for unioning the result with other trace polygons
 * to flatten corner overlaps into a single outline.
 */
export function buildTraceMaskPolygons(
  trace: PcbTrace,
  clearanceMm: number,
  circumscribed = false,
): ClipperPolygon[] {
  if (trace.pointsNm.length < 2) return [];
  const radius = trace.widthMm / 2 + clearanceMm;
  if (radius <= 0) return [];
  const stadia: ClipperPolygon[] = [];
  for (let i = 1; i < trace.pointsNm.length; i += 1) {
    const prev = trace.pointsNm[i - 1]!;
    const curr = trace.pointsNm[i]!;
    const a: PcbPointMm = { x: prev.x * NM_TO_MM, y: prev.y * NM_TO_MM };
    const b: PcbPointMm = { x: curr.x * NM_TO_MM, y: curr.y * NM_TO_MM };
    const ring = buildTraceSegmentStadium(
      a,
      b,
      radius,
      TRACE_CAP_SEGMENTS,
      circumscribed,
    );
    if (ring) stadia.push([ring]);
  }
  return stadia;
}

/**
 * Does the via barrel cross `layer`? Uses the stackup-order index; tolerates
 * `fromLayer` and `toLayer` being in either order (KiCad never normalises
 * direction). v1 vias are always through (F.Cu↔B.Cu), so this always returns
 * true for the four copper layers — the helper is here for v2 blind/buried.
 */
export function viaCrossesLayer(via: PcbVia, layer: PcbCopperLayerId): boolean {
  const lo = Math.min(layerIndex(via.fromLayer), layerIndex(via.toLayer));
  const hi = Math.max(layerIndex(via.fromLayer), layerIndex(via.toLayer));
  return layerIndex(layer) >= lo && layerIndex(layer) <= hi;
}

/**
 * Same-net merge predicate. Two items merge silently into the pour when both
 * the pour and the item have a non-null net id and those ids match. A null on
 * either side is treated as "isolated, always knock out" — null === null does
 * NOT merge, matching KiCad's behaviour for objects with no net.
 */
export function isSameNetAsPour(
  itemNetId: string | null,
  pourNetId: string | null,
): boolean {
  return itemNetId !== null && pourNetId !== null && itemNetId === pourNetId;
}

/**
 * `spokeCount` thermal-relief spoke bars radiating from `centerMm`, each a
 * stadium of half-width `spokeWidthMm/2` reaching out to `outerRadiusMm` (chosen
 * to clear the pad + relief gap so the bar bridges pad copper to the pour). The
 * caller carves these out of the relief-gap knockout so the pour reconnects to
 * the pad through narrow necks (IPC-2221 thermal relief — limits heat-sinking
 * into a plane during soldering while keeping the electrical connection).
 */
export function buildThermalSpokes(
  centerMm: PcbPointMm,
  outerRadiusMm: number,
  spokeWidthMm: number,
  spokeCount: number,
  angleDeg: number,
): ClipperPolygon[] {
  if (spokeWidthMm <= 0 || spokeCount <= 0 || outerRadiusMm <= 0) return [];
  const half = spokeWidthMm / 2;
  const spokes: ClipperPolygon[] = [];
  for (let i = 0; i < spokeCount; i += 1) {
    const a = ((angleDeg + (360 / spokeCount) * i) * Math.PI) / 180;
    const tip: PcbPointMm = {
      x: centerMm.x + Math.cos(a) * outerRadiusMm,
      y: centerMm.y + Math.sin(a) * outerRadiusMm,
    };
    const ring = buildTraceSegmentStadium(centerMm, tip, half);
    if (ring) spokes.push([ring]);
  }
  return spokes;
}
