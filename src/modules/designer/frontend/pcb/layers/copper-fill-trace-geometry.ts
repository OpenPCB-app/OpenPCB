import polygonClipping from "polygon-clipping";
import type {
  PcbCopperLayerId,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";

export type ClipperPoint = [number, number];
export type ClipperRing = ClipperPoint[];
export type ClipperPolygon = ClipperRing[];
export type ClipperMultiPolygon = ClipperPolygon[];
export type PolygonUnion = (
  ...polygons: ClipperPolygon[]
) => ClipperMultiPolygon;

// Cap-segment count for trace stadium tips. Matches ARC_SEGMENTS used for pad
// corners (copper-fill-geometry.ts) so the two halo styles look identical.
const TRACE_CAP_SEGMENTS = 16;

// KiCad ARC_HIGH_DEF (~5 µm) chord-error budget when tessellating circular vias.
const VIA_MAX_ERROR_MM = 0.005;
const VIA_MIN_SEGMENTS = 16;
const VIA_MAX_SEGMENTS = 96;

const NM_TO_MM = 1 / 1_000_000;

// Stackup order F.Cu → In1.Cu → In2.Cu → B.Cu mirrors PCB_LAYER_RENDERING_SPEC.
const LAYER_INDEX: Record<PcbCopperLayerId, number> = {
  "F.Cu": 0,
  "In1.Cu": 1,
  "In2.Cu": 2,
  "B.Cu": 3,
};

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
): ClipperRing | null {
  if (radiusMm <= 0) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    // Degenerate segment → full disc with the same effective radius.
    return buildDiscRing(a, radiusMm, capSegments * 2);
  }
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
  for (let i = 1; i < capSegments; i += 1) {
    const t = angleB - (Math.PI * i) / capSegments;
    ring.push([b.x + Math.cos(t) * radiusMm, b.y + Math.sin(t) * radiusMm]);
  }
  // Right long edge B → A.
  ring.push([b.x - px, b.y - py]);
  ring.push([a.x - px, a.y - py]);
  // Semicircular cap at A: sweep from −perp clockwise to +perp around outside.
  const angleA = Math.atan2(-py, -px);
  for (let i = 1; i < capSegments; i += 1) {
    const t = angleA - (Math.PI * i) / capSegments;
    ring.push([a.x + Math.cos(t) * radiusMm, a.y + Math.sin(t) * radiusMm]);
  }
  return ring;
}

/**
 * Regular-polygon disc approximating a circle of `radiusMm` centred on
 * `center`. Segment count derived from KiCad's chord-error formula
 *   n = π / acos(1 − maxError / r)
 * clamped to [16, 96]. Caller may pass `segmentsHint` to override the formula
 * (used by zero-length stadium degeneration to inherit a denser cap count).
 */
export function buildDiscRing(
  center: PcbPointMm,
  radiusMm: number,
  segmentsHint?: number,
): ClipperRing {
  const r = Math.max(0, radiusMm);
  const guarded = Math.max(r, VIA_MAX_ERROR_MM);
  const ratio = Math.max(-1, Math.min(1, 1 - VIA_MAX_ERROR_MM / guarded));
  const minN = segmentsHint ?? Math.ceil(Math.PI / Math.acos(ratio));
  const n = Math.max(VIA_MIN_SEGMENTS, Math.min(VIA_MAX_SEGMENTS, minN));
  const ring: ClipperRing = [];
  for (let i = 0; i < n; i += 1) {
    const t = (Math.PI * 2 * i) / n;
    ring.push([center.x + Math.cos(t) * r, center.y + Math.sin(t) * r]);
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
    const ring = buildTraceSegmentStadium(a, b, radius);
    if (ring) stadia.push([ring]);
  }
  return stadia;
}

/**
 * Inflated disc polygon for a via barrel. The drill hole is intentionally
 * ignored: the pour mask must cover the full outer copper annulus so that the
 * via's own pad/ring mesh (drawn on top) paints back the copper area while
 * leaving only the clearance halo visible as board-bg.
 */
export function buildViaMaskPolygon(
  via: PcbVia,
  clearanceMm: number,
): ClipperPolygon | null {
  const radius = via.diameterMm / 2 + clearanceMm;
  if (radius <= 0) return null;
  return [buildDiscRing(via.centerMm, radius)];
}

/**
 * Does the via barrel cross `layer`? Uses the stackup-order index; tolerates
 * `fromLayer` and `toLayer` being in either order (KiCad never normalises
 * direction). v1 vias are always through (F.Cu↔B.Cu), so this always returns
 * true for the four copper layers — the helper is here for v2 blind/buried.
 */
export function viaCrossesLayer(via: PcbVia, layer: PcbCopperLayerId): boolean {
  const lo = Math.min(LAYER_INDEX[via.fromLayer], LAYER_INDEX[via.toLayer]);
  const hi = Math.max(LAYER_INDEX[via.fromLayer], LAYER_INDEX[via.toLayer]);
  return LAYER_INDEX[layer] >= lo && LAYER_INDEX[layer] <= hi;
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

// --- Robust boolean ops -----------------------------------------------------
// `polygon-clipping` is numerically fragile: on certain board geometry its
// sweep-line throws "Unable to complete output ring", which (uncaught) tears
// down the WebGL context. We (a) quantize inputs to a 0.1 µm grid to collapse
// the near-coincident vertices that trigger it, and (b) wrap each op so a
// failure degrades gracefully instead of crashing the renderer.

type ClipperGeom = ClipperPolygon | ClipperMultiPolygon;
type PolygonBinaryOp = (
  subject: ClipperGeom,
  ...clippers: ClipperGeom[]
) => ClipperMultiPolygon;

const CLIP_QUANT = 1e4; // mm → 0.1 µm grid

function roundDeep<T>(node: T): T {
  if (!Array.isArray(node)) return node;
  if (
    node.length === 2 &&
    typeof node[0] === "number" &&
    typeof node[1] === "number"
  ) {
    return [
      Math.round(node[0] * CLIP_QUANT) / CLIP_QUANT,
      Math.round(node[1] * CLIP_QUANT) / CLIP_QUANT,
    ] as unknown as T;
  }
  return node.map((child) => roundDeep(child)) as unknown as T;
}

function normalizeToMulti(geom: ClipperGeom): ClipperMultiPolygon {
  // MultiPolygon iff the leaf at depth-3 is a point ([number,number]).
  return Array.isArray(geom[0]?.[0]?.[0])
    ? (geom as ClipperMultiPolygon)
    : [geom as ClipperPolygon];
}

let warnedClipFailure = false;
function warnClipFailure(op: string, error: unknown): void {
  if (warnedClipFailure) return;
  warnedClipFailure = true;
  console.warn(
    `[copper-fill] polygon ${op} failed; using fallback geometry`,
    error,
  );
}

// polygon-clipping's published types don't expose a clean rest signature, so we
// re-type the ops to accept variadic clippers (matching their runtime shape).
const clipUnion = polygonClipping.union as unknown as (
  ...polygons: ClipperGeom[]
) => ClipperMultiPolygon;
const clipDifference = polygonClipping.difference as unknown as PolygonBinaryOp;
const clipIntersection =
  polygonClipping.intersection as unknown as PolygonBinaryOp;

/** Union of polygons. Falls back to the (un-unioned) inputs on failure — still
 *  a valid MultiPolygon for downstream difference (which re-unions clippers). */
export const polygonUnion: PolygonUnion = (...polygons) => {
  const rounded = polygons.map((p) => roundDeep(p));
  try {
    return clipUnion(...rounded);
  } catch (error) {
    warnClipFailure("union", error);
    return rounded as ClipperMultiPolygon;
  }
};

/** subject − clippers. Falls back to the subject (no subtraction) on failure. */
export const polygonDifference: PolygonBinaryOp = (subject, ...clippers) => {
  const s = roundDeep(subject);
  const c = clippers.map((x) => roundDeep(x));
  try {
    return clipDifference(s, ...c);
  } catch (error) {
    warnClipFailure("difference", error);
    return normalizeToMulti(s);
  }
};

/** subject ∩ clippers. Falls back to empty (treat as "no overlap") on failure. */
export const polygonIntersection: PolygonBinaryOp = (subject, ...clippers) => {
  const s = roundDeep(subject);
  const c = clippers.map((x) => roundDeep(x));
  try {
    return clipIntersection(s, ...c);
  } catch (error) {
    warnClipFailure("intersection", error);
    return [];
  }
};
