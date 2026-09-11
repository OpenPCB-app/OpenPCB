/**
 * `COURTYARD_OVERLAP` / `COURTYARD_INVALID` (DFM contract 11 §2.2).
 *
 * Two placements whose courtyards overlap cannot both be assembled where they
 * stand — the courtyard is the manufacturer's declared footprint envelope, not
 * a clearance. So the verdict is a boolean about AREA, not a distance: the
 * check intersects the two per-face regions in the copper kernel and reports
 * when the result is more than a degenerate sliver. Touching courtyards and
 * shared edges pass, which is what a board laid out on a courtyard grid does.
 *
 * The region comes from `ctx.placementCourtyard` and is never re-derived here:
 * it is the NonZero union of depth-oriented rings, so a donut keeps its hole
 * and a U-shaped connector keeps its cut-out (§2.1). The convex hull
 * `placementExtent` returns would fill both.
 *
 * Nothing fails open. A footprint whose graphics will not chain is judged on
 * the SUPERSET hull and additionally reported as `COURTYARD_INVALID`; a kernel
 * refusal on a pair reports `COURTYARD_INVALID` for BOTH placements rather
 * than dropping the pair.
 */
import type { PcbCopperLayerId, PcbPointMm } from "../../../sdks/designer";
import {
  boundsMeet,
  boundsOfPoints,
  type RingBounds,
} from "../../pcb-geometry/region-rings";
import { DEGENERATE_AREA_MM2 } from "../../pcb-geometry/ring-utils";
import { GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import type { CourtyardFace } from "../../pcb-geometry/courtyard-rings";
import {
  CopperKernelError,
  area,
  intersection,
  polyToPathsD,
  splitIslands,
  type CopperIsland,
} from "../../rendering/copper-fill/copper-geometry-kernel";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/**
 * Courtyard excess applied to a footprint's own bounds when it declares no
 * courtyard at all (mm) — the IPC-7351B level B value
 * (`docs/designer/pcb-standards.md` §2.1). `designRules.dfm.courtyardFallbackMm`
 * overrides it; the context resolves that, this is the absent-key reading.
 */
export const DEFAULT_COURTYARD_FALLBACK_MM = 0.25;

/** Both faces, in the order the check walks them. */
const FACES: readonly CourtyardFace[] = ["top", "bottom"];

/**
 * The face encoded as the outer copper layer id (contract §7). A convention for
 * the marker layer, not a claim that copper is involved — `emitMask` names a
 * mask face the same way.
 */
function faceLayer(face: CourtyardFace): PcbCopperLayerId {
  return face === "top" ? "F.Cu" : "B.Cu";
}

/** One placement's region on one face, plus what the pair loop needs. */
interface FaceRegion {
  placementId: string;
  reference: string;
  rings: readonly PcbPointMm[][];
  bounds: RingBounds;
}

/** `PcbPointMm` rings → the kernel's flat path set (NonZero, already oriented). */
function toPaths(rings: readonly PcbPointMm[][]) {
  return polyToPathsD(
    rings.map((ring) => ring.map((p): [number, number] => [p.x, p.y])),
  );
}

/**
 * Area-weighted centroid of one island (outer minus holes). Clipper's PolyTree
 * gives holes the opposite winding, so the signed shoelace sums subtract them
 * without a separate hole pass.
 */
function islandCentroid(island: CopperIsland): PcbPointMm | null {
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (const ring of island.paths) {
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      const cross = p.x * q.y - q.x * p.y;
      a2 += cross;
      cx += (p.x + q.x) * cross;
      cy += (p.y + q.y) * cross;
    }
  }
  if (!Number.isFinite(a2) || Math.abs(a2) < 1e-12) return null;
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/**
 * The marker: the centroid of the LARGEST overlap component, ties broken by the
 * smaller `(x, y)` centroid. A total order (Astra run 1 #22) — two lobes of
 * equal area would otherwise pick whichever the kernel emitted first, and the
 * violation id hashes the location.
 */
function overlapLocation(islands: readonly CopperIsland[]): PcbPointMm | null {
  let best: { areaMm2: number; at: PcbPointMm } | null = null;
  for (const island of islands) {
    const at = islandCentroid(island);
    if (!at) continue;
    if (
      !best ||
      island.areaMm2 > best.areaMm2 ||
      (island.areaMm2 === best.areaMm2 &&
        (at.x < best.at.x || (at.x === best.at.x && at.y < best.at.y)))
    ) {
      best = { areaMm2: island.areaMm2, at };
    }
  }
  return best?.at ?? null;
}

function invalidDraft(
  placementId: string,
  reference: string,
  reason: string,
): DrcViolationDraft {
  return {
    code: "COURTYARD_INVALID",
    message: `Courtyard of ${reference} ${reason}`,
    anchors: [{ kind: "placement", placementId }],
  };
}

export function checkCourtyard(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  // Ascending placement id: the pair order, the operand order and the anchor
  // order all follow it, so no input permutation can move a verdict (§7).
  const ids = ctx.placements.map((p) => p.id).sort();

  const byFace: Record<CourtyardFace, FaceRegion[]> = { top: [], bottom: [] };
  for (const placementId of ids) {
    const regions = ctx.placementCourtyard(placementId);
    const reference = ctx.placementReference(placementId);
    if (regions.malformed) {
      out.push(
        invalidDraft(
          placementId,
          reference,
          "could not be assembled into closed loops; the part is judged on its bounding hull instead",
        ),
      );
    }
    for (const face of FACES) {
      const rings = regions[face];
      if (rings.length === 0) continue;
      byFace[face].push({
        placementId,
        reference,
        rings,
        bounds: boundsOfPoints(rings.flat()),
      });
    }
  }

  for (const face of FACES) {
    const items = byFace[face];
    const layer = faceLayer(face);
    for (let i = 0; i < items.length; i += 1) {
      const a = items[i]!;
      for (let j = i + 1; j < items.length; j += 1) {
        const b = items[j]!;
        if (!boundsMeet(a.bounds, b.bounds, GEOM_EPS_MM)) continue;
        judgePair(a, b, layer, out);
      }
    }
  }
  return out;
}

function judgePair(
  a: FaceRegion,
  b: FaceRegion,
  layer: PcbCopperLayerId,
  out: DrcViolationDraft[],
): void {
  let islands: CopperIsland[];
  let overlapMm2: number;
  try {
    const inter = intersection(toPaths(a.rings), toPaths(b.rings));
    if (inter.length === 0) return;
    overlapMm2 = area(inter);
    // Below the degenerate-area floor the "overlap" is a shared edge or a
    // rounding sliver, which is exactly how courtyards are meant to abut.
    if (!(overlapMm2 > DEGENERATE_AREA_MM2)) return;
    islands = splitIslands(inter);
  } catch (error) {
    if (!(error instanceof CopperKernelError)) throw error;
    // Never a silent pass (§2.2): the pair was not evaluated, and both parts
    // have to be told so.
    for (const side of [a, b]) {
      out.push(
        invalidDraft(
          side.placementId,
          side.reference,
          `could not be evaluated against ${side === a ? b.reference : a.reference} (${error.op} failed)`,
        ),
      );
    }
    return;
  }
  const locationMm = overlapLocation(islands);
  // The intersection AREA is mm², not mm — putting it in `measuredMm` would
  // make it comparable with a `requiredMm` clearance it is not (§2.2).
  out.push({
    code: "COURTYARD_OVERLAP",
    message: `Courtyards of ${a.reference} and ${b.reference} overlap on ${layer} by ${overlapMm2.toFixed(4)} mm²`,
    anchors: [
      { kind: "placement", placementId: a.placementId },
      { kind: "placement", placementId: b.placementId },
    ],
    layer,
    ...(locationMm ? { locationMm } : {}),
  });
}
