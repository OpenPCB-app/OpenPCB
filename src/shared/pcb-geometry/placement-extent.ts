/**
 * The ONE resolution of "how much board area does this placement occupy" for
 * the keepout `footprints` restriction (zone/keepout contract §4, S4 §13.1).
 *
 * Three branches, each a declared SUPERSET of the physical part, tried in
 * decreasing order of fidelity:
 *
 *   1. the courtyard hull (`placementCourtyardWorldMm`) — the real answer when
 *      the footprint carries `F.CrtYd`/`B.CrtYd` geometry, either in the
 *      placement's render model or, with a raw lookup, in the stored KiCad
 *      footprint;
 *   2. the footprint-LOCAL `preview.bounds` rectangle (pads + graphics, labels
 *      excluded) transformed by exactly the pad transform — rotation, mirror,
 *      translate. This is what a KiCad-imported part falls back to: the import
 *      whitelist drops CrtYd, so branch 1 is empty without a raw lookup;
 *   3. the axis-aligned bounding box of the placement's pad rings.
 *
 * A pad-only hull (branch 3) is the LAST resort on purpose: it misses the body
 * of a part whose pads sit inside its outline (Astra finding 14), so it is only
 * reached when nothing describes the body at all. `null` means "no extent is
 * known" — the placement is then not evaluated against keepouts at all rather
 * than being judged on geometry that could be a subset of the real part.
 */
import type { PcbPlacedPart, PcbPointMm } from "../../sdks/designer";
import {
  placementMirrorX,
  transformPadCenterMm,
} from "./pad-geometry";
import { boundsOfPoints } from "./region-rings";
import {
  DEGENERATE_AREA_MM2,
  ringSignedArea,
} from "./ring-utils";
import {
  convexHull,
  placementCourtyardWorldMm,
  type RawFootprintLookup,
} from "./courtyard";

/** Rings below this are not an extent — a keepout verdict on them is noise. */
const MIN_RING_POINTS = 3;

interface LocalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function isUsableRing(ring: readonly PcbPointMm[]): boolean {
  if (ring.length < MIN_RING_POINTS) return false;
  for (const p of ring) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  return Math.abs(ringSignedArea(ring)) >= DEGENERATE_AREA_MM2;
}

function boundsCorners(b: LocalBounds): PcbPointMm[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

function finiteBounds(
  bounds: LocalBounds | null | undefined,
): LocalBounds | null {
  if (!bounds) return null;
  const { minX, minY, maxX, maxY } = bounds;
  if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) return null;
  if (maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * The footprint-local `preview.bounds` rectangle in world space. Transformed
 * point-by-point with the SAME transform `placementCourtyardWorldMm` applies to
 * courtyard points, then hulled — a rotated rectangle is still a rectangle, and
 * hulling after the mirror keeps the winding consistent (mirroring reverses it).
 */
function previewBoundsWorldMm(placement: PcbPlacedPart): PcbPointMm[] | null {
  const bounds = finiteBounds(
    placement.footprint?.preview?.bounds as LocalBounds | null | undefined,
  );
  if (!bounds) return null;
  const mirrored = placementMirrorX(placement);
  const world = boundsCorners(bounds).map((p) => {
    const t = transformPadCenterMm(p, placement.rotationDeg, mirrored);
    return { x: placement.positionMm.x + t.x, y: placement.positionMm.y + t.y };
  });
  const hull = convexHull(world);
  return isUsableRing(hull) ? hull : null;
}

/** Axis-aligned box around every pad ring the caller resolved (world space). */
function padRingsBoxMm(
  padRings: readonly (readonly PcbPointMm[])[],
): PcbPointMm[] | null {
  const points: PcbPointMm[] = [];
  for (const ring of padRings) {
    for (const p of ring) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) points.push(p);
    }
  }
  if (points.length === 0) return null;
  const box = boundsCorners(boundsOfPoints(points));
  return isUsableRing(box) ? box : null;
}

/**
 * World-space extent of a placement for the keepout `footprints` restriction,
 * or `null` when nothing describes the part's area. `padRings` are the world
 * rings of the placement's own pads (the DRC context already has them).
 */
export function placementKeepoutExtentMm(
  placement: PcbPlacedPart,
  padRings: readonly (readonly PcbPointMm[])[],
  lookupRaw?: RawFootprintLookup,
): PcbPointMm[] | null {
  // Superset flattening: a plain hull undershoots circles and arcs (§4).
  const courtyard = placementCourtyardWorldMm(placement, lookupRaw, {
    superset: true,
  });
  if (courtyard && isUsableRing(courtyard)) return withPads(courtyard, padRings);
  const bounds = previewBoundsWorldMm(placement);
  if (bounds) return withPads(bounds, padRings);
  return padRingsBoxMm(padRings);
}

/**
 * An authored courtyard (or stale bounds) can be SMALLER than the part's pads
 * — an inconsistent footprint, but the pads are physical copper and the extent
 * must contain them (Astra S4 #5). Hull the ring together with every pad ring;
 * a consistent footprint is unchanged (its pads are already inside).
 */
function withPads(
  ring: readonly PcbPointMm[],
  padRings: readonly (readonly PcbPointMm[])[],
): PcbPointMm[] {
  const points: PcbPointMm[] = [...ring];
  for (const pad of padRings) {
    for (const p of pad) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) points.push(p);
    }
  }
  if (points.length === ring.length) return [...ring];
  const hull = convexHull(points);
  return isUsableRing(hull) ? hull : [...ring];
}
