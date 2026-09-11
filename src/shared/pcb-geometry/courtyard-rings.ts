/**
 * THE per-side courtyard REGION of a placement (DFM contract 11 §2.1).
 *
 * `courtyard.ts` answers a different question — the convex HULL of the
 * courtyard points, which is what the cloud placer's integer-SAT oracle and the
 * keepout `footprints` extent want (a declared superset, convexified anyway).
 * A courtyard-overlap verdict cannot use it: hulling a U-shaped connector's
 * courtyard fills the U, and hulling a donut fills the hole, so two parts that
 * nest correctly would read as overlapping.
 *
 * So this module stitches the loose graphics into real rings — the same
 * `chainEdgesToLoops` assembler the DXF outline importer uses — keeps each
 * side separate, and classifies the rings by containment depth so the side's
 * region is the NonZero union of oriented rings (even depth = material CCW,
 * odd depth = hole CW). An even-odd union would CANCEL two overlapping
 * exterior rings (a body outline plus a mating-area outline) into a hole
 * between them (Astra run 1 #14).
 *
 * Nothing here is fail-open: geometry that will not chain is reported as
 * `malformed` and replaced by the S4 SUPERSET hull, which contains the true
 * courtyard, so an unstitchable footprint over-reports rather than escaping.
 */
import type { PcbPlacedPart, PcbPointMm } from "../../sdks/designer";
import {
  arcSegmentCount,
  ellipseChordRing,
} from "./arc-chords";
import {
  placementCourtyardWorldMm,
  type RawFootprintLookup,
} from "./courtyard";
import { placementMirrorX, transformPadCenterMm } from "./pad-geometry";
import { placementPads } from "./pad-geometry";
import { shapeRingAroundOrigin } from "./pad-outline";
import { rawPointMm, rawPolyPoints } from "./raw-graphics";
import { nearRing } from "./region-rings";
import { pointInPolygon } from "./pcb-clearance-geometry";
import { ensureCcwRing, ringSignedArea, DEGENERATE_AREA_MM2 } from "./ring-utils";
import { GEOM_EPS_MM } from "./tolerance";
import {
  chainEdgesToLoops,
  type EdgeSeg,
} from "../rendering/pcb/chain-edges";
import { loopToRing } from "../rendering/pcb/loop-ring";
import { placementSideLayer } from "../rendering/pad-copper-layers";
import type { PreviewGraphic } from "../rendering/types";

/** Which board face a ring set belongs to. */
export type CourtyardFace = "top" | "bottom";

export interface PlacementCourtyardRegions {
  /** Oriented rings whose NonZero union IS the top-face region (§2.1). */
  top: PcbPointMm[][];
  bottom: PcbPointMm[][];
  /**
   * `"courtyard"` — real `*.CrtYd` graphics (preview or raw); `"fallback"` —
   * the inflated bounds box; `null` — nothing describes the part at all, so it
   * is not evaluated (§10), exactly as a missing keepout extent is not.
   */
  source: "courtyard" | "fallback" | null;
  /** The graphics would not chain into closed loops; the rings are the hull. */
  malformed: boolean;
}

/**
 * Endpoint-merge tolerance (mm) for chaining and de-duplicating courtyard
 * edges — the DXF importer's `DXF_CHAIN_EPSILON_MM`, because the geometry has
 * the same provenance (an exported drawing, not a parametric shape).
 */
export const COURTYARD_CHAIN_EPSILON_MM = 0.01;

/** Minimum vertices of a ring that can bound an area. */
const MIN_RING_POINTS = 3;

/**
 * Cap on the courtyard edges one side may contribute. De-duplication is O(n²)
 * in the edge count; a real courtyard has tens of edges, and a corrupt library
 * row must not turn a DRC run into a hang. Past the cap the side is treated as
 * malformed, i.e. judged on the superset hull.
 */
const MAX_COURTYARD_EDGES = 2048;

type FootprintSide = "F" | "B";

/** Footprint-local courtyard geometry of ONE `*.CrtYd` layer. */
interface SideGeometry {
  edges: EdgeSeg[];
  /** Circles bypass chaining — each is already a closed ring (§2.1). */
  rings: PcbPointMm[][];
  /** At least one courtyard graphic was seen (even a degenerate one). */
  present: boolean;
  /** A graphic that could not be turned into edges at all. */
  malformed: boolean;
}

function emptySide(): SideGeometry {
  return { edges: [], rings: [], present: false, malformed: false };
}

function courtyardSide(layer: unknown): FootprintSide | null {
  if (layer === "F.CrtYd") return "F";
  if (layer === "B.CrtYd") return "B";
  return null;
}

function isPoint(p: unknown): p is PcbPointMm {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof (p as { x?: unknown }).x === "number" &&
    typeof (p as { y?: unknown }).y === "number" &&
    Number.isFinite((p as PcbPointMm).x) &&
    Number.isFinite((p as PcbPointMm).y)
  );
}

const TWO_PI = 2 * Math.PI;

function normAngle(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

/** Circle through three points, or null when they are (nearly) collinear. */
function circumcircle(
  a: PcbPointMm,
  b: PcbPointMm,
  c: PcbPointMm,
): { center: PcbPointMm; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - ux, a.y - uy);
  if (!Number.isFinite(r) || r <= 0) return null;
  return { center: { x: ux, y: uy }, r };
}

/**
 * A three-point arc as ONE chainable edge carrying its circle. The chainer
 * flips `cw` when it traverses the edge backwards, and `loopToRing` samples the
 * arc through the S2 kernel — so the courtyard's curvature survives assembly
 * instead of collapsing to the chord an endpoint-only model would keep.
 *
 * Three collinear points have no circle: the arc degrades to the polyline
 * through them, which is what every other consumer of a degenerate `arc3` does.
 */
function arcEdges(
  start: PcbPointMm,
  mid: PcbPointMm,
  end: PcbPointMm,
): EdgeSeg[] {
  const circle = circumcircle(start, mid, end);
  if (!circle) {
    return [
      { from: start, to: mid },
      { from: mid, to: end },
    ];
  }
  const { center } = circle;
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const am = Math.atan2(mid.y - center.y, mid.x - center.x);
  const ae = Math.atan2(end.y - center.y, end.x - center.x);
  const ccwToEnd = normAngle(ae - a0);
  const ccwToMid = normAngle(am - a0);
  // The sweep that passes through `mid`: counter-clockwise iff `mid` is reached
  // before `end` going counter-clockwise.
  const ccw = ccwToMid <= ccwToEnd;
  return [{ from: start, to: end, arc: { centerMm: center, cw: !ccw } }];
}

/** A circle graphic as one closed ring, unbiased (the vertices sit on it). */
function circleRing(center: PcbPointMm, radiusMm: number): PcbPointMm[] | null {
  if (!Number.isFinite(radiusMm) || radiusMm <= 0) return null;
  return ellipseChordRing(
    center,
    radiusMm,
    radiusMm,
    arcSegmentCount(radiusMm, TWO_PI, "inscribed"),
    "inscribed",
  );
}

/**
 * Drop consecutive coincident vertices, and for a CLOSED list the repeated
 * closing vertex as well.
 *
 * Both are ordinary in real data — `kicad-import` closes every polyline by
 * repeating `points[0]`, and an editor can leave a doubled vertex behind — and
 * both used to produce a zero-length edge, which `chainEdgesToLoops` logs as a
 * diagnostic. Treating that diagnostic as "malformed" condemned perfectly good
 * courtyards to the bounding hull (§2.1).
 */
function compactPoints(
  points: readonly PcbPointMm[],
  closed: boolean,
): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && coincident(prev, p)) continue;
    out.push(p);
  }
  if (closed) {
    while (out.length > 1 && coincident(out[0]!, out[out.length - 1]!)) {
      out.pop();
    }
  }
  return out;
}

/** One edge, unless it is degenerate — the chainer must never see one. */
function pushEdge(out: EdgeSeg[], from: PcbPointMm, to: PcbPointMm): void {
  if (coincident(from, to)) return;
  out.push({ from, to });
}

/** Closed vertex list → one edge per side, already compacted. */
function ringEdges(points: readonly PcbPointMm[]): EdgeSeg[] {
  const ring = compactPoints(points, true);
  if (ring.length < 2) return [];
  const out: EdgeSeg[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    pushEdge(out, ring[i]!, ring[(i + 1) % ring.length]!);
  }
  return out;
}

/** Open vertex list → one edge per gap, already compacted. */
function chainEdgesOf(points: readonly PcbPointMm[]): EdgeSeg[] {
  const pts = compactPoints(points, false);
  const out: EdgeSeg[] = [];
  for (let i = 1; i < pts.length; i += 1) pushEdge(out, pts[i - 1]!, pts[i]!);
  return out;
}

// =========================================================================
// Graphic → edges, for both provenances (§2.1: alternatives, never merged)
// =========================================================================

/** One render-model courtyard graphic. */
function pushPreviewGraphic(side: SideGeometry, graphic: PreviewGraphic): void {
  side.present = true;
  switch (graphic.kind) {
    case "line":
      if (isPoint(graphic.a) && isPoint(graphic.b)) {
        // A zero-length `fp_line` is stock-library noise, not a malformation.
        pushEdge(side.edges, graphic.a, graphic.b);
      } else side.malformed = true;
      return;
    case "rect": {
      const { x, y, width: w, height: h } = graphic;
      if ([x, y, w, h].every((v: unknown) => typeof v === "number")) {
        side.edges.push(
          ...ringEdges([
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
          ]),
        );
      } else side.malformed = true;
      return;
    }
    case "circle": {
      const ring = isPoint(graphic.center)
        ? circleRing(graphic.center, graphic.radiusMm)
        : null;
      if (ring) side.rings.push(ring);
      else side.malformed = true;
      return;
    }
    case "arc3":
      if (isPoint(graphic.start) && isPoint(graphic.mid) && isPoint(graphic.end)) {
        side.edges.push(...arcEdges(graphic.start, graphic.mid, graphic.end));
      } else side.malformed = true;
      return;
    case "polyline": {
      const pts = graphic.points.filter(isPoint);
      if (pts.length < 2) {
        side.malformed = true;
        return;
      }
      // A courtyard is a closed boundary; an OPEN polyline is chained with the
      // rest of the side's edges exactly as a run of lines would be. Either way
      // the vertex list is compacted first: a closed one from `kicad-import`
      // REPEATS its first point, which `ringEdges` would otherwise wrap into a
      // zero-length edge.
      side.edges.push(
        ...(graphic.closed ? ringEdges(pts) : chainEdgesOf(pts)),
      );
      return;
    }
    default:
      // `bezier` and anything the render model gains later: no exact edge
      // model, so the side cannot be stitched honestly.
      side.malformed = true;
      return;
  }
}

/**
 * One raw (KiCad-parsed) courtyard graphic. The raw row is persisted JSON with
 * no type at all — unlike the preview model above — so this is the one place
 * that reads untyped fields.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped persisted JSON */
function pushRawGraphic(side: SideGeometry, graphic: any): void {
  const data = (graphic.data ?? {}) as Record<string, unknown>;
  side.present = true;
  // The persisted row holds the PARSER's shape, not `{ x, y }` (see
  // `raw-graphics.ts`): reading `data.start.x` here matched nothing at all.
  const start = rawPointMm(data.start);
  const end = rawPointMm(data.end);
  switch (graphic.type) {
    case "line":
      if (start && end) pushEdge(side.edges, start, end);
      else side.malformed = true;
      return;
    case "rect":
      if (start && end) {
        side.edges.push(
          ...ringEdges([
            { x: start.x, y: start.y },
            { x: end.x, y: start.y },
            { x: end.x, y: end.y },
            { x: start.x, y: end.y },
          ]),
        );
      } else side.malformed = true;
      return;
    case "circle": {
      const center = rawPointMm(data.center);
      const ring =
        center && end
          ? circleRing(center, Math.hypot(end.x - center.x, end.y - center.y))
          : null;
      if (ring) side.rings.push(ring);
      else side.malformed = true;
      return;
    }
    case "arc": {
      const mid = rawPointMm(data.mid);
      if (start && mid && end) side.edges.push(...arcEdges(start, mid, end));
      else side.malformed = true;
      return;
    }
    case "poly": {
      // A KiCad `fp_poly` is always closed.
      const pts = rawPolyPoints(data);
      if (pts.length >= MIN_RING_POINTS) side.edges.push(...ringEdges(pts));
      else side.malformed = true;
      return;
    }
    default:
      side.malformed = true;
      return;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

type SidePair = Record<FootprintSide, SideGeometry>;

function collectPreview(placement: PcbPlacedPart): SidePair {
  const sides: SidePair = { F: emptySide(), B: emptySide() };
  const graphics: readonly PreviewGraphic[] =
    placement.footprint?.preview?.graphics ?? [];
  for (const graphic of graphics) {
    const side = courtyardSide(graphic.layer);
    if (side) pushPreviewGraphic(sides[side], graphic);
  }
  return sides;
}

function collectRaw(data: Record<string, unknown> | null | undefined): SidePair {
  const sides: SidePair = { F: emptySide(), B: emptySide() };
  const raw = (data as { raw?: { graphics?: unknown } } | null | undefined)?.raw;
  const graphics = raw?.graphics;
  if (!Array.isArray(graphics)) return sides;
  for (const graphic of graphics) {
    if (!graphic) continue;
    const side = courtyardSide(graphic.layer);
    if (side) pushRawGraphic(sides[side], graphic);
  }
  return sides;
}

// =========================================================================
// De-duplication (§2.1, Astra run 1 #16)
// =========================================================================

/** `chainEdgesToLoops` phrases a branch diagnostic as `branch at (x, y) — …`. */
function isBranch(diagnostic: string): boolean {
  return diagnostic.startsWith("branch");
}

function coincident(a: PcbPointMm, b: PcbPointMm): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= COURTYARD_CHAIN_EPSILON_MM;
}

/**
 * Two edges describe the same piece of boundary. Straight edges match on their
 * endpoint PAIR in either direction. Arcs must also agree on the centre AND on
 * the sweep — traversing an arc backwards flips its winding, so a reversed
 * duplicate disagrees on `cw`. Two OPPOSITE semicircles share both endpoints
 * and the centre and are both kept, which is what makes a circle drawn as two
 * arcs chain into a ring instead of collapsing to one arc.
 */
function duplicateEdge(a: EdgeSeg, b: EdgeSeg): boolean {
  if ((a.arc === undefined) !== (b.arc === undefined)) return false;
  const forward = coincident(a.from, b.from) && coincident(a.to, b.to);
  const reversed = coincident(a.from, b.to) && coincident(a.to, b.from);
  if (!forward && !reversed) return false;
  if (!a.arc || !b.arc) return true;
  if (!coincident(a.arc.centerMm, b.arc.centerMm)) return false;
  return forward ? a.arc.cw === b.arc.cw : a.arc.cw !== b.arc.cw;
}

function dedupeEdges(edges: readonly EdgeSeg[]): EdgeSeg[] {
  const out: EdgeSeg[] = [];
  for (const edge of edges) {
    if (out.some((kept) => duplicateEdge(kept, edge))) continue;
    out.push(edge);
  }
  return out;
}

// =========================================================================
// Ring set → oriented ring set (§2.1)
// =========================================================================

function usableRing(ring: readonly PcbPointMm[]): boolean {
  if (ring.length < MIN_RING_POINTS) return false;
  for (const p of ring) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  return Math.abs(ringSignedArea(ring)) >= DEGENERATE_AREA_MM2;
}

/**
 * How many of `others` strictly contain `ring`. A ring's own vertices can sit
 * exactly on a coincident neighbour's boundary, so the probe is the first
 * vertex that is NOT on the other ring — two identical rings then nest in
 * neither direction, which is the honest reading of duplicated geometry.
 */
function containmentDepth(
  ring: readonly PcbPointMm[],
  others: ReadonlyArray<readonly PcbPointMm[]>,
): number {
  let depth = 0;
  for (const other of others) {
    if (other === ring) continue;
    for (const v of ring) {
      if (nearRing(other, v, GEOM_EPS_MM)) continue;
      if (pointInPolygon(v, other)) depth += 1;
      break;
    }
  }
  return depth;
}

/**
 * Even depth = material (CCW), odd depth = a hole (CW), so the NonZero union of
 * the result is the side's filled region: overlapping exteriors merge, a donut
 * keeps its hole, and a ring inside a hole is solid again.
 */
function orientByDepth(rings: ReadonlyArray<PcbPointMm[]>): PcbPointMm[][] {
  return rings.map((ring) => {
    const ccw = ensureCcwRing(ring);
    const material = containmentDepth(ring, rings) % 2 === 0;
    return material ? [...ccw] : [...ccw].reverse();
  });
}

// =========================================================================
// Fallback (§2.1)
// =========================================================================

interface LocalBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function finiteBox(box: LocalBox | null | undefined): LocalBox | null {
  if (!box) return null;
  const { minX, minY, maxX, maxY } = box;
  if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) return null;
  if (maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/** Footprint-local bounding box of the placement's own pad rings. */
function padBox(placement: PcbPlacedPart): LocalBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pad of placementPads(placement)) {
    const ring = shapeRingAroundOrigin({
      shape: pad.shape,
      widthMm: pad.widthMm,
      heightMm: pad.heightMm,
      rotationDeg: pad.rotationDeg,
      ...(pad.roundrectRatio !== undefined
        ? { roundrectRatio: pad.roundrectRatio }
        : {}),
    });
    for (const v of ring) {
      const x = v.x + pad.centerMm.x;
      const y = v.y + pad.centerMm.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return finiteBox({ minX, minY, maxX, maxY });
}

/** The box inflated on every side, as its four corners (footprint-local). */
function inflatedCorners(box: LocalBox, byMm: number): PcbPointMm[] {
  const d = Number.isFinite(byMm) && byMm > 0 ? byMm : 0;
  return [
    { x: box.minX - d, y: box.minY - d },
    { x: box.maxX + d, y: box.minY - d },
    { x: box.maxX + d, y: box.maxY + d },
    { x: box.minX - d, y: box.maxY + d },
  ];
}

// =========================================================================
// Entry point
// =========================================================================

/**
 * The courtyard region of one placement, per board FACE (DFM contract 11 §2.1).
 *
 * `fallbackMm` is `designRules.dfm.courtyardFallbackMm` — the excess applied to
 * the footprint's bounds when it declares no courtyard at all.
 */
export function placementCourtyardRegionsMm(
  placement: PcbPlacedPart,
  lookupRaw?: RawFootprintLookup,
  fallbackMm = 0,
): PlacementCourtyardRegions {
  let sides = collectPreview(placement);
  // The two provenances are ALTERNATIVES (§2.1): the KiCad import drops CrtYd
  // before persistence, so a footprint has courtyard graphics in the preview or
  // in the raw row, never a meaningful mixture of both.
  if (!sides.F.present && !sides.B.present && lookupRaw) {
    const footprintId = placement.footprint?.footprintId;
    if (footprintId) sides = collectRaw(lookupRaw(footprintId));
  }

  if (!sides.F.present && !sides.B.present) {
    return fallbackRegions(placement, fallbackMm);
  }

  const mirrorX = placementMirrorX(placement);
  const sideFlip = placement.layer === "B.Cu";
  const toWorld = (p: PcbPointMm): PcbPointMm => {
    const t = transformPadCenterMm(p, placement.rotationDeg, mirrorX);
    return { x: placement.positionMm.x + t.x, y: placement.positionMm.y + t.y };
  };

  // The S4 superset hull, built at most once: it CONTAINS the true courtyard
  // (circles and arcs circumscribed), so a side that will not chain over-reports
  // instead of vanishing.
  let hull: PcbPointMm[] | null | undefined;
  const supersetHull = (): PcbPointMm[] | null => {
    if (hull === undefined) {
      hull = placementCourtyardWorldMm(placement, lookupRaw, { superset: true });
    }
    return hull;
  };

  const byFace: Record<CourtyardFace, PcbPointMm[][]> = { top: [], bottom: [] };
  let malformed = false;

  for (const key of ["F", "B"] as const) {
    const side = sides[key];
    if (!side.present) continue;
    const face: CourtyardFace =
      key === "F" ? (sideFlip ? "bottom" : "top") : sideFlip ? "top" : "bottom";

    let sideMalformed = side.malformed;
    const rings: PcbPointMm[][] = [];
    for (const ring of side.rings) rings.push(ring.map(toWorld));

    if (side.edges.length > MAX_COURTYARD_EDGES) {
      sideMalformed = true;
    } else if (side.edges.length > 0) {
      const chain = chainEdgesToLoops(
        dedupeEdges(side.edges),
        COURTYARD_CHAIN_EPSILON_MM,
      );
      // A BRANCH is malformed even though the chainer takes an edge and carries
      // on (§2.1): the loop it closed is one of several readings of the soup,
      // and the others may bound more area. NOT every diagnostic — the chainer
      // also logs a dropped zero-length edge, which is ordinary data (a doubled
      // vertex, a closed polyline's repeated first point) and is compacted away
      // above, so a stray one must not condemn the footprint to its hull.
      if (chain.openChainCount > 0 || chain.diagnostics.some(isBranch)) {
        sideMalformed = true;
      }
      for (const loop of chain.loops) {
        const ring = loopToRing(loop);
        if (usableRing(ring)) rings.push(ring.map(toWorld));
      }
    }

    if (sideMalformed) {
      malformed = true;
      const fallbackHull = supersetHull();
      if (fallbackHull && usableRing(fallbackHull)) {
        byFace[face].push(...orientByDepth([fallbackHull]));
        continue;
      }
    }
    byFace[face].push(...orientByDepth(rings.filter(usableRing)));
  }

  if (byFace.top.length === 0 && byFace.bottom.length === 0) {
    // Courtyard graphics existed but described no area at all — the honest
    // answer is the same as no courtyard: fall back rather than skip, so the
    // part is still judged against its neighbours.
    const fallback = fallbackRegions(placement, fallbackMm);
    return { ...fallback, malformed: malformed || fallback.malformed };
  }
  // Depth is per FACE, and each face was oriented against its own rings only —
  // re-orient the assembled face so two sides' rings cannot nest across faces.
  return {
    top: orientByDepth(byFace.top),
    bottom: orientByDepth(byFace.bottom),
    source: "courtyard",
    malformed,
  };
}

/**
 * No courtyard on either path: the footprint's own bounds (or, failing that,
 * its pad rings' box) inflated by `fallbackMm` on every side and transformed as
 * a rotated rectangle, on the placement's OWN face only — a back-side part's
 * fallback courtyard is on the bottom, never on both.
 */
function fallbackRegions(
  placement: PcbPlacedPart,
  fallbackMm: number,
): PlacementCourtyardRegions {
  const preview = placement.footprint?.preview;
  const box =
    finiteBox(preview?.bounds as LocalBox | null | undefined) ??
    padBox(placement);
  if (!box) return { top: [], bottom: [], source: null, malformed: false };
  const mirrorX = placementMirrorX(placement);
  const ring = inflatedCorners(box, fallbackMm).map((p) => {
    const t = transformPadCenterMm(p, placement.rotationDeg, mirrorX);
    return { x: placement.positionMm.x + t.x, y: placement.positionMm.y + t.y };
  });
  if (!usableRing(ring)) {
    return { top: [], bottom: [], source: null, malformed: false };
  }
  const face: CourtyardFace =
    placementSideLayer(placement) === "B.Cu" ? "bottom" : "top";
  const oriented = orientByDepth([ring]);
  return {
    top: face === "top" ? oriented : [],
    bottom: face === "bottom" ? oriented : [],
    source: "fallback",
    malformed: false,
  };
}
