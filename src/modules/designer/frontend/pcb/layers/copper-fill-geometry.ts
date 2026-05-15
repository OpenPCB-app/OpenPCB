import polygonClipping from "polygon-clipping";
import * as THREE from "three";
import type {
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import { flipLayerSide } from "../../../../../shared/frontend/canvas/scene/layer-side";
import { padAperturePath } from "../../../../../shared/frontend/canvas/scene/pad-aperture-geometry";
import type { FootprintRenderSourcePad } from "../../../../../shared/rendering";
import {
  buildTraceMaskPolygons,
  buildViaMaskPolygon,
  isSameNetAsPour,
  polygonUnion,
  viaCrossesLayer,
} from "./copper-fill-trace-geometry";

const ALL_COPPER_LAYERS: ReadonlySet<PcbCopperLayerId> = new Set([
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
]);

/**
 * Copper layer(s) a pad's metal actually occupies, given the placement side.
 * - `*.Cu` or drilled pad → all copper layers (through-hole).
 * - Explicit `F.Cu`/`B.Cu`/`In*.Cu` SMD pad → that layer, flipped if the
 *   placement is on B.Cu (mirrors `FootprintRenderLayer`'s render-side remap).
 * - Missing/unknown `pad.layer` → trust `placement.layer` (SMD assumption).
 */
function resolvePadCopperLayers(
  pad: FootprintRenderSourcePad,
  placement: PcbPlacedPart,
): ReadonlySet<PcbCopperLayerId> {
  if (pad.layer === "*.Cu") return ALL_COPPER_LAYERS;
  if (pad.drillDiameterMm && pad.drillDiameterMm > 0) return ALL_COPPER_LAYERS;

  if (
    pad.layer === "F.Cu" ||
    pad.layer === "B.Cu" ||
    pad.layer === "In1.Cu" ||
    pad.layer === "In2.Cu"
  ) {
    const effective: PcbCopperLayerId =
      placement.layer === "B.Cu"
        ? (flipLayerSide(pad.layer) as PcbCopperLayerId)
        : pad.layer;
    return new Set([effective]);
  }

  const fallback: PcbCopperLayerId =
    placement.layer === "B.Cu" ? "B.Cu" : "F.Cu";
  return new Set([fallback]);
}

const DEFAULT_COPPER_FILL_CLEARANCE_MM = 0.5;
const ARC_SEGMENTS = 16;
// Default minimum pour-island area below which a disconnected pour region is
// pruned (mirroring KiCad's `min_island_area`). 1.0 mm² catches inter-pad
// slivers and chevron tips while leaving large QFP-interior pour islands
// intact. Override via `minIslandAreaMm2` on the spec call.
const DEFAULT_MIN_POUR_ISLAND_AREA_MM2 = 1.0;

type ClipperPoint = [number, number];
type ClipperRing = ClipperPoint[];
type ClipperPolygon = ClipperRing[];
type ClipperMultiPolygon = ClipperPolygon[];
type PolygonUnion = (...polygons: ClipperPolygon[]) => ClipperMultiPolygon;
type PolygonDifference = (
  subject: ClipperPolygon | ClipperMultiPolygon,
  ...clippers: Array<ClipperPolygon | ClipperMultiPolygon>
) => ClipperMultiPolygon;
type PolygonIntersection = (
  subject: ClipperPolygon | ClipperMultiPolygon,
  ...clippers: Array<ClipperPolygon | ClipperMultiPolygon>
) => ClipperMultiPolygon;
const polygonDifference = polygonClipping.difference as PolygonDifference;
const polygonIntersection = polygonClipping.intersection as PolygonIntersection;

export interface CopperFillRectSpec {
  center: PcbPointMm;
  widthMm: number;
  heightMm: number;
}

export interface CopperFillMaskSpec {
  id: string;
  shape: THREE.Shape;
  positionMm: PcbPointMm;
  rotationDeg: number;
  scaleX: number;
}

export interface CopperFillGeometrySpec {
  fill: CopperFillRectSpec | null;
  masks: CopperFillMaskSpec[];
}

export function resolveCopperFillClearanceMm(
  clearance: PcbDesignRules["clearance"],
): number {
  return Math.max(
    DEFAULT_COPPER_FILL_CLEARANCE_MM,
    clearance.traceToTraceMm,
    clearance.traceToPadMm,
    clearance.padToPadMm,
    clearance.traceToViaMm,
  );
}

function rotatePoint(point: PcbPointMm, rotationDeg: number): PcbPointMm {
  const radians = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return {
    x: point.x * c - point.y * s,
    y: point.x * s + point.y * c,
  };
}

function padClearancePath(
  pad: FootprintRenderSourcePad,
  clearanceMm: number,
): THREE.Path {
  if (
    pad.shape === "rect" ||
    pad.shape === "trapezoid" ||
    pad.shape === "custom"
  ) {
    return roundedRectPath(
      pad.widthMm + clearanceMm * 2,
      pad.heightMm + clearanceMm * 2,
      clearanceMm,
    );
  }
  if (pad.shape === "roundrect") {
    const baseRadius =
      Math.min(pad.widthMm, pad.heightMm) * (pad.roundrectRatio ?? 0.25);
    return roundedRectPath(
      pad.widthMm + clearanceMm * 2,
      pad.heightMm + clearanceMm * 2,
      baseRadius + clearanceMm,
    );
  }
  return padAperturePath(pad, clearanceMm);
}

function roundedRectPath(
  widthMm: number,
  heightMm: number,
  radiusMm: number,
): THREE.Path {
  const path = new THREE.Path();
  if (widthMm <= 0 || heightMm <= 0) return path;
  const hw = widthMm / 2;
  const hh = heightMm / 2;
  const r = Math.max(0, Math.min(radiusMm, hw, hh));
  if (r <= 0) {
    path.moveTo(-hw, -hh);
    path.lineTo(hw, -hh);
    path.lineTo(hw, hh);
    path.lineTo(-hw, hh);
    path.closePath();
    return path;
  }
  path.moveTo(hw, hh - r);
  addArc(path, hw - r, hh - r, r, 0, Math.PI / 2);
  path.lineTo(-hw + r, hh);
  addArc(path, -hw + r, hh - r, r, Math.PI / 2, Math.PI);
  path.lineTo(-hw, -hh + r);
  addArc(path, -hw + r, -hh + r, r, Math.PI, Math.PI * 1.5);
  path.lineTo(hw - r, -hh);
  addArc(path, hw - r, -hh + r, r, Math.PI * 1.5, Math.PI * 2);
  path.closePath();
  return path;
}

function addArc(
  path: THREE.Path,
  cx: number,
  cy: number,
  radiusMm: number,
  startAngle: number,
  endAngle: number,
): void {
  for (let i = 1; i <= ARC_SEGMENTS; i += 1) {
    const angle = startAngle + ((endAngle - startAngle) * i) / ARC_SEGMENTS;
    path.lineTo(
      cx + Math.cos(angle) * radiusMm,
      cy + Math.sin(angle) * radiusMm,
    );
  }
}

function padClearancePolygon(
  pad: FootprintRenderSourcePad,
  clearanceMm: number,
): ClipperPolygon | null {
  const ring = padClearancePath(pad, clearanceMm)
    .getPoints(0)
    .map((point): ClipperPoint => {
      const rotated = rotatePoint(point, pad.rotationDeg);
      return [rotated.x + pad.centerMm.x, rotated.y + pad.centerMm.y];
    });
  if (ring.length < 3) return null;
  return [ring];
}

function traceRing(target: THREE.Path | THREE.Shape, ring: ClipperRing): void {
  const first = ring[0]!;
  target.moveTo(first[0], first[1]);
  for (let i = 1; i < ring.length; i += 1) {
    const point = ring[i]!;
    target.lineTo(point[0], point[1]);
  }
  target.closePath();
}

function polygonToShape(polygon: ClipperPolygon): THREE.Shape {
  // Outer ring + any inner holes. Holes are areas of the pour that show
  // through the mask — e.g. the interior of a QFP body large enough to
  // survive the min-island-area prune. THREE.ShapeGeometry triangulates the
  // outer ring minus the holes via earcut, which matches the boolean topology
  // produced by polygon-clipping.
  const shape = new THREE.Shape();
  traceRing(shape, polygon[0]!);
  for (let i = 1; i < polygon.length; i += 1) {
    const holePath = new THREE.Path();
    traceRing(holePath, polygon[i]!);
    shape.holes.push(holePath);
  }
  return shape;
}

function signedArea(ring: ClipperRing): number {
  // Shoelace formula. Sign tells winding; we use absolute value at the call
  // site (we just want geometric area).
  let acc = 0;
  for (let i = 0, n = ring.length; i < n; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    acc += p[0] * q[1] - q[0] * p[1];
  }
  return acc * 0.5;
}

function polygonArea(polygon: ClipperPolygon): number {
  // |outer| − Σ|holes|. polygon-clipping guarantees holes are wound opposite
  // to the outer ring, but we take absolute values to stay robust against
  // either-orientation inputs.
  let total = Math.abs(signedArea(polygon[0]!));
  for (let i = 1; i < polygon.length; i += 1) {
    total -= Math.abs(signedArea(polygon[i]!));
  }
  return total;
}

function rectPolygonRing(
  center: PcbPointMm,
  widthMm: number,
  heightMm: number,
): ClipperRing {
  const hw = widthMm / 2;
  const hh = heightMm / 2;
  return [
    [center.x - hw, center.y - hh],
    [center.x + hw, center.y - hh],
    [center.x + hw, center.y + hh],
    [center.x - hw, center.y + hh],
  ];
}

function applyPlacementTransform(
  ring: ClipperRing,
  placement: PcbPlacedPart,
): ClipperRing {
  // Replicates the matrix `MaskGeometry` used to bake at render time:
  //   p → scale(scaleX, 1) → rotateZ(rotationDeg) → translate(positionMm)
  // We bake the transform into vertex coordinates so the post-process boolean
  // ops (which run in world space) see the true outline of each pad.
  const radians = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sx = placement.mirrored ? -1 : 1;
  const tx = placement.positionMm.x;
  const ty = placement.positionMm.y;
  return ring.map(([x, y]) => {
    const mx = sx * x;
    return [cos * mx - sin * y + tx, sin * mx + cos * y + ty] as ClipperPoint;
  });
}

function footprintPadSignature(
  pads: ReadonlyArray<FootprintRenderSourcePad>,
): string {
  return pads
    .map((pad) =>
      [
        pad.id,
        pad.shape,
        pad.centerMm.x,
        pad.centerMm.y,
        pad.widthMm,
        pad.heightMm,
        pad.rotationDeg,
        pad.roundrectRatio ?? "",
      ].join(":"),
    )
    .join("|");
}

interface SameNetPadCandidate {
  /** Bare pad outline (no clearance) in world coords; used for the safety test. */
  bareWorld: ClipperPolygon;
  /** Pad outline inflated by clearance, in world coords; the halo we'd emit if unsafe. */
  haloWorld: ClipperPolygon;
}

interface PadCollection {
  /** Polygons that always knock out the pour (different-net or unknown-net pads). */
  knockouts: ClipperPolygon[];
  /** Same-net pads. Final decision (merge vs halo) needs the diff-net union. */
  sameNetCandidates: SameNetPadCandidate[];
}

/**
 * Pad polygons in WORLD coordinates, partitioned by net relationship with the
 * pour. Per-pad processing replaces the old per-footprint cache so that some
 * pads of a multi-pad component can merge into pour while others halo.
 *
 *   - Different net (incl. null/unknown): emit clearance halo.
 *   - Same net as pour: defer to safety check (see buildCopperFillGeometrySpec).
 *
 * For shape caching we still key by `(clearanceMm, pad signature)` so identical
 * pads across many placements share polygon construction.
 */
function collectPadPolygons(
  layer: PcbCopperLayerId,
  placements: ReadonlyArray<PcbPlacedPart>,
  clearanceMm: number,
  pourNetId: string | null,
  padNetIds: ReadonlyMap<string, string>,
): PadCollection {
  const haloCache = new Map<string, ClipperPolygon | null>();
  const bareCache = new Map<string, ClipperPolygon | null>();
  const knockouts: ClipperPolygon[] = [];
  const sameNetCandidates: SameNetPadCandidate[] = [];

  for (const placement of placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    if (pads.length === 0) continue;

    // Pre-union the footprint's pad halos to detect enclosed interior. If
    // the union has any inner hole, the footprint has an IC-body cavity
    // (perimeter pad ring + central exposed pad on a QFP, BGA, etc.); we
    // emit the solid outer outline as a single per-footprint knockout and
    // skip per-pad processing entirely — same-net merge does not apply for
    // pads inside an IC body (the body mask must always cover them so no
    // pour leaks through). Footprints with no enclosed interior get the
    // standard per-pad path with same-net merge available.
    //
    // Only pads whose copper actually lands on `layer` participate (SMD pads
    // on the opposite side stay out of this fill; THT/`*.Cu` pads span all
    // copper layers).
    const allHalosLocal: ClipperPolygon[] = [];
    for (const pad of pads) {
      if (!resolvePadCopperLayers(pad, placement).has(layer)) continue;
      const sig = padSignature(pad);
      let halo = haloCache.get(`${clearanceMm}:${sig}`);
      if (halo === undefined) {
        halo = padClearancePolygon(pad, clearanceMm);
        haloCache.set(`${clearanceMm}:${sig}`, halo);
      }
      if (halo) allHalosLocal.push(halo);
    }
    if (allHalosLocal.length === 0) continue;
    const unionedLocal = polygonUnion(...allHalosLocal);
    const hasEnclosedInterior = unionedLocal.some((poly) => poly.length > 1);
    if (hasEnclosedInterior) {
      // Emit one solid silhouette per disjoint outer ring (drops holes).
      for (const poly of unionedLocal) {
        const outer = poly[0];
        if (outer) {
          knockouts.push([applyPlacementTransform(outer, placement)]);
        }
      }
      continue;
    }

    // Open footprint — per-pad knockouts / same-net merge candidates.
    for (const pad of pads) {
      if (!resolvePadCopperLayers(pad, placement).has(layer)) continue;
      const sig = padSignature(pad);
      const halo = haloCache.get(`${clearanceMm}:${sig}`) ?? null;
      if (!halo) continue;
      const haloOuter = halo[0];
      if (!haloOuter) continue;
      const haloWorld: ClipperPolygon = [
        applyPlacementTransform(haloOuter, placement),
      ];

      const padNetId = padNetIds.get(`${placement.id}|${pad.number}`) ?? null;
      const isSameNet =
        pourNetId !== null && padNetId !== null && padNetId === pourNetId;
      if (!isSameNet) {
        knockouts.push(haloWorld);
        continue;
      }

      // Same-net candidate — needs the bare outline too for the safety check.
      let bare = bareCache.get(sig);
      if (bare === undefined) {
        bare = padClearancePolygon(pad, 0);
        bareCache.set(sig, bare);
      }
      const bareOuter = bare?.[0];
      if (!bareOuter) {
        // Degenerate pad — fall back to halo so we don't leak pour.
        knockouts.push(haloWorld);
        continue;
      }
      const bareWorld: ClipperPolygon = [
        applyPlacementTransform(bareOuter, placement),
      ];
      sameNetCandidates.push({ bareWorld, haloWorld });
    }
  }

  return { knockouts, sameNetCandidates };
}

function padSignature(pad: FootprintRenderSourcePad): string {
  return [
    pad.id,
    pad.shape,
    pad.centerMm.x,
    pad.centerMm.y,
    pad.widthMm,
    pad.heightMm,
    pad.rotationDeg,
    pad.roundrectRatio ?? "",
  ].join(":");
}

function collectTracePolygons(
  traces: ReadonlyArray<PcbTrace>,
  layer: PcbCopperLayerId,
  pourNetId: string | null,
  clearanceMm: number,
): ClipperPolygon[] {
  if (clearanceMm < 0 || traces.length === 0) return [];
  const out: ClipperPolygon[] = [];
  for (const trace of traces) {
    if (trace.layer !== layer) continue;
    if (isSameNetAsPour(trace.netId, pourNetId)) continue;
    const stadia = buildTraceMaskPolygons(trace, clearanceMm);
    for (const stadium of stadia) out.push(stadium);
  }
  return out;
}

function collectViaPolygons(
  vias: ReadonlyArray<PcbVia>,
  layer: PcbCopperLayerId,
  pourNetId: string | null,
  clearanceMm: number,
): ClipperPolygon[] {
  if (clearanceMm < 0 || vias.length === 0) return [];
  const out: ClipperPolygon[] = [];
  for (const via of vias) {
    if (!viaCrossesLayer(via, layer)) continue;
    if (isSameNetAsPour(via.netId, pourNetId)) continue;
    const disc = buildViaMaskPolygon(via, clearanceMm);
    if (disc) out.push(disc);
  }
  return out;
}

/**
 * Build pour geometry for one copper layer: shrunk fill rect plus a set of
 * board-bg-colored mask polygons that paint over the pour to carve out
 * clearance halos around pads, traces and vias AND to remove isolated pour
 * islands smaller than `minIslandAreaMm2`.
 *
 * Mirrors KiCad `ZONE_FILLER` for the v1 scope:
 *   1. Shrink fill rectangle to `outline ⊖ copperToBoardEdgeMm`.
 *   2. Collect knockout polygons in WORLD coords:
 *        a. Different-net pads → clearance halos.
 *        b. Same-net pads → deferred; processed in step 4.
 *        c. Different-net traces and vias on this layer → clearance halos.
 *   3. Union the different-net knockouts → `diffNetUnion`.
 *   4. For each same-net pad: if its BARE outline (no clearance) intersects
 *      `diffNetUnion`, the pad sits within `clearanceMm` of a different-net
 *      feature. Merging would violate minimum clearance, so we keep the halo
 *      (per user requirement: tight IC pad rows must not merge unsafely; user
 *      can manually route a connection if needed). Otherwise, drop the halo
 *      so pour copper flows up to the pad edge.
 *   5. `pourVisible = pourRect − finalKnockoutUnion`. Each disjoint polygon
 *      is one island of red copper.
 *   6. Drop islands smaller than `minIslandAreaMm2` (KiCad's `min_island_area`
 *      equivalent — catches inter-pad slivers and chevron-interior strips).
 *   7. Final mask = `pourRect − keptIslands`. Emit as one shape per disjoint
 *      mask polygon, with holes preserved (each hole is a pour island that
 *      survives the area filter).
 *
 * v2 backlog: arc traces, footprint graphics, thermal spokes, min-thickness
 * sliver prune, per-item clearance hierarchy, expand `padNetIds` to a full
 * schematic→pad correlation (current source is the ratsnest, so pads with all
 * connections routed away may miss the merge).
 */
export function buildCopperFillGeometrySpec(params: {
  layer: PcbCopperLayerId;
  outline: PcbBoardOutline;
  placements: ReadonlyArray<PcbPlacedPart>;
  traces: ReadonlyArray<PcbTrace>;
  vias: ReadonlyArray<PcbVia>;
  pourNetId: string | null;
  /**
   * Maps `${placementId}|${padNumber}` → netId for every pad whose net is
   * known. Pads missing from the map are treated as unknown net (always halo).
   */
  padNetIds: ReadonlyMap<string, string>;
  clearanceMm: number;
  copperToBoardEdgeMm: number;
  /**
   * Minimum area (mm²) of a disconnected pour island. Below this, the island
   * is converted back to a mask so it disappears visually. Default 1.0 mm².
   */
  minIslandAreaMm2?: number;
}): CopperFillGeometrySpec {
  const edge = Math.max(0, params.copperToBoardEdgeMm);
  const fillWidth = params.outline.widthMm - edge * 2;
  const fillHeight = params.outline.heightMm - edge * 2;
  const fill =
    fillWidth > 0 && fillHeight > 0
      ? {
          center: params.outline.centerMm,
          widthMm: fillWidth,
          heightMm: fillHeight,
        }
      : null;
  if (!fill) return { fill: null, masks: [] };

  const clearance = Math.max(0, params.clearanceMm);
  const minIslandArea = Math.max(
    0,
    params.minIslandAreaMm2 ?? DEFAULT_MIN_POUR_ISLAND_AREA_MM2,
  );

  const padCollection = collectPadPolygons(
    params.layer,
    params.placements,
    clearance,
    params.pourNetId,
    params.padNetIds,
  );
  const traceKnockouts = collectTracePolygons(
    params.traces,
    params.layer,
    params.pourNetId,
    clearance,
  );
  const viaKnockouts = collectViaPolygons(
    params.vias,
    params.layer,
    params.pourNetId,
    clearance,
  );

  // Different-net knockouts: locked in. Same-net pads are checked against
  // their union to decide merge vs halo per KiCad-style safety rule.
  const diffNetKnockouts: ClipperPolygon[] = [
    ...padCollection.knockouts,
    ...traceKnockouts,
    ...viaKnockouts,
  ];
  const diffNetUnion: ClipperMultiPolygon =
    diffNetKnockouts.length > 0 ? polygonUnion(...diffNetKnockouts) : [];

  const unsafeMergeHalos: ClipperPolygon[] = [];
  for (const candidate of padCollection.sameNetCandidates) {
    if (
      diffNetUnion.length > 0 &&
      polygonIntersection(candidate.bareWorld, diffNetUnion).length > 0
    ) {
      // Pad sits within `clearance` of a different-net feature; merging would
      // violate minimum clearance. Keep the halo instead.
      unsafeMergeHalos.push(candidate.haloWorld);
    }
  }

  const knockouts: ClipperPolygon[] = [
    ...diffNetKnockouts,
    ...unsafeMergeHalos,
  ];

  const pourRectPoly: ClipperPolygon = [
    rectPolygonRing(fill.center, fill.widthMm, fill.heightMm),
  ];

  if (knockouts.length === 0) {
    // No knockouts → entire pour is one island. If it survives the area
    // filter, no mask is needed (pour shows full). If not, the whole fill is
    // pruned away (rare edge case for tiny boards).
    return polygonArea(pourRectPoly) >= minIslandArea
      ? { fill, masks: [] }
      : {
          fill,
          masks: maskSpecsFromPolygons(
            [pourRectPoly],
            `pour-mask:${params.layer}`,
          ),
        };
  }

  const knockoutUnion = polygonUnion(...knockouts);
  const pourVisible = polygonDifference(pourRectPoly, knockoutUnion);
  const keptIslands = pourVisible.filter(
    (poly) => polygonArea(poly) >= minIslandArea,
  );

  // Common case: nothing pruned → reuse knockoutUnion directly (one fewer
  // boolean op). Algebraically equivalent to `pourRect − keptIslands`.
  if (keptIslands.length === pourVisible.length) {
    return {
      fill,
      masks: maskSpecsFromPolygons(knockoutUnion, `pour-mask:${params.layer}`),
    };
  }

  // Some islands pruned. Re-derive the mask as pourRect − keptIslands so the
  // pruned islands get covered by board-bg paint.
  const finalMaskMP =
    keptIslands.length === 0
      ? [pourRectPoly]
      : polygonDifference(pourRectPoly, keptIslands);
  return {
    fill,
    masks: maskSpecsFromPolygons(finalMaskMP, `pour-mask:${params.layer}`),
  };
}

function maskSpecsFromPolygons(
  polygons: ClipperMultiPolygon,
  idPrefix: string,
): CopperFillMaskSpec[] {
  return polygons.map((poly, index) => ({
    id: `${idPrefix}:${index}`,
    shape: polygonToShape(poly),
    positionMm: { x: 0, y: 0 },
    rotationDeg: 0,
    scaleX: 1,
  }));
}
