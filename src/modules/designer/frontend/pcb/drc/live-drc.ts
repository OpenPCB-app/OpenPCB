import type {
  PcbCopperLayerId,
  PcbPlacedPart,
  PcbTrace,
} from "../../../../../sdks";
import { placementMirrorX } from "../../../../../sdks/designer/pcb-helpers";
import type { RuleResolver } from "../../../../../shared/drc/rule-resolver";
import type { EffectiveKeepout } from "../../../../../shared/pcb-areas/copper-zones";
import { keepoutAffects } from "../../../../../shared/pcb-areas/keepout-predicates";
import {
  polylineToAabbDistance,
  segmentClosestPoints,
} from "../../../../../shared/pcb-geometry/pcb-trace-geometry";
import {
  boundsOfPoints,
  splitSegmentAtRings,
  type RingBounds,
} from "../../../../../shared/pcb-geometry/region-rings";
import {
  clearanceViolated,
  SHORT_EPS_MM,
} from "../../../../../shared/pcb-geometry/tolerance";
import { placementSideLayer } from "../../../../../shared/rendering/pad-copper-layers";

type Point = { x: number; y: number };

interface PolylineSegment {
  a: Point;
  b: Point;
}

export interface DrcViolation {
  /** Index of the offending segment within the input polyline. */
  segmentIndex: number;
  /**
   * Kind of breach. `trace-keepout` is a RULE-AREA breach, not a clearance
   * one: a keepout has clearance 0 (zone/keepout contract §4), so the segment
   * either overlaps the keepout's open interior or it does not.
   * `trace-short` is the short tier (rule-semantics contract §9, Astra run 1
   * #12): different KNOWN nets closer than `SHORT_EPS_MM` are a dead short
   * whatever the configured clearance resolves to, so the gate refuses them
   * even when the resolved requirement is 0.
   */
  type: "trace-trace" | "trace-pad" | "trace-keepout" | "trace-short";
  /** Identifier of the offending neighbor (trace id, `${placementId}:${pad}`, or keepout id). */
  offendingId: string;
  /**
   * Edge-to-edge gap in mm — the copper-to-copper distance, i.e. the centreline
   * distance minus both half-widths, exactly the number batch DRC reports as
   * `measuredMm`. Negative when the copper overlaps. Always 0 for
   * `trace-keepout`.
   */
  distanceMm: number;
  /**
   * Required edge-to-edge clearance in mm, from the ONE rule resolver
   * (rule-semantics contract §4). 0 for `trace-keepout`; for `trace-short` it
   * is the requirement that held at the closest approach.
   */
  requiredMm: number;
}

const NM_TO_MM = 1 / 1_000_000;

/**
 * Placeholder evaluation point for the no-area-rules fast path. Legal only
 * there: with no area polygons registered every point's mask is 0, so the
 * resolver's answer cannot depend on where it is asked.
 */
const ORIGIN: Point = { x: 0, y: 0 };

function nmToMm(p: { x: number; y: number }): Point {
  return { x: p.x * NM_TO_MM, y: p.y * NM_TO_MM };
}

function transformPadCenter(
  localMm: Point,
  rotationDeg: number,
  mirrored: boolean,
): Point {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  const mx = mirrored ? -localMm.x : localMm.x;
  const my = localMm.y;
  switch (r) {
    case 90:
      return { x: -my, y: mx };
    case 180:
      return { x: -mx, y: -my };
    case 270:
      return { x: my, y: -mx };
    default:
      return { x: mx, y: my };
  }
}

interface PadGeom {
  id: string; // `${placementId}:${padNumber}`
  netId: string | null;
  /** Area-scope evaluation point of the pad — its centre (contract §4.4). */
  center: Point;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  layer: PcbCopperLayerId;
}

function computePadGeoms(
  placements: ReadonlyArray<PcbPlacedPart>,
  padNetMap: Map<string, string>,
): PadGeom[] {
  const out: PadGeom[] = [];
  for (const placement of placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    for (const pad of pads) {
      const offset = transformPadCenter(
        pad.centerMm,
        placement.rotationDeg,
        placementMirrorX(placement),
      );
      const cx = placement.positionMm.x + offset.x;
      const cy = placement.positionMm.y + offset.y;
      const halfW = pad.widthMm / 2;
      const halfH = pad.heightMm / 2;
      out.push({
        id: `${placement.id}:${pad.number}`,
        netId: padNetMap.get(`${placement.id}|${pad.number}`) ?? null,
        center: { x: cx, y: cy },
        bounds: {
          minX: cx - halfW,
          minY: cy - halfH,
          maxX: cx + halfW,
          maxY: cy + halfH,
        },
        // For now treat all pads as on F.Cu and B.Cu (through-hole / SMD on either layer).
        // For v1 we check the pad against any active-layer trace; v1.1 will refine this.
        layer: placementSideLayer(placement),
      });
    }
  }
  return out;
}

export interface RunDrcInput {
  /** Pending trace polyline (in nm). Source of segments to check. */
  traceNm: ReadonlyArray<{ x: number; y: number }>;
  /** Half-width (mm) of the pending trace itself for clearance edge math. */
  traceWidthMm: number;
  /** Net id of the pending trace (if known); same-net neighbors are skipped. */
  netId: string | null;
  /** Active copper layer. Only neighbors on the same layer are checked. */
  layer: PcbCopperLayerId;
  /** Existing committed traces on the board (any layer). */
  traces: ReadonlyArray<PcbTrace>;
  /** Existing placements (and thus pads). */
  placements: ReadonlyArray<PcbPlacedPart>;
  /** Pad → net id map (from ratsnest correlation). */
  padNetMap: Map<string, string>;
  /**
   * The ONE rule resolver of this projection (`createRuleResolver`), built once
   * by the caller and shared with batch DRC and the route obstacles. The
   * pending trace's net class is resolved from `netId` INSIDE it — the
   * session's `netClassId` is a creation-time width hint and no legality
   * consumer reads it (rule-semantics contract §3).
   */
  resolver: RuleResolver;
  /**
   * Effective keepouts of the same projection (`collectKeepouts`). Each
   * pending segment is tested against every one with `restrictions.tracks`
   * using the SAME `keepoutAffects` predicate batch DRC runs (zone/keepout
   * contract §13.4), so a legal route beside a concave keepout is never
   * falsely refused.
   */
  keepouts?: readonly EffectiveKeepout[];
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function differentKnownNet(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

/**
 * The breach reported for one (pending segment, neighbour) pair: the witness
 * with the largest deficit, exactly as batch summarises a pair (§4.4).
 */
interface Breach {
  gap: number;
  required: number;
}

/**
 * Run live DRC for the pending trace polyline against existing traces & pads.
 * Returns a flat list of violations keyed by segment index.
 *
 * Clearance comes from the SAME `RuleResolver` batch DRC uses, so for the two
 * pair kinds the gate checks its verdicts equal batch's (rule-semantics
 * contract §9). Per (pending segment, neighbour) pair:
 *
 *   gap      = centreline distance − (pendingHalf + neighbourHalf)
 *   required = resolver.clearance(kind, layer, pendingItem, neighbourItem).mm
 *   breach  ⇔ clearanceViolated(gap, required)
 *   short   ⇔ different KNOWN nets and gap ≤ SHORT_EPS_MM  (refused whatever
 *             the rule resolves to — a 0 mm rule must not hide a dead short)
 *
 * When a scoped `area` rule can reach the geometry the requirement is not
 * constant along a segment, so both sides are split at the area rings and the
 * pair is judged sub-segment by sub-segment (§4.4, Astra run 1 #1/#11);
 * otherwise the mask is 0 everywhere and one resolution per (pending net,
 * neighbour net) pair is exact — today's per-pointer-move cost.
 */
export function runLiveDrc(input: RunDrcInput): DrcViolation[] {
  const violations: DrcViolation[] = [];
  if (input.traceNm.length < 2) return violations;
  const traceMm = input.traceNm.map(nmToMm);
  const resolver = input.resolver;

  const pendingHalf = input.traceWidthMm / 2;

  // No area rules ⇒ every mask is 0 ⇒ the requirement depends only on the pair
  // of nets. One resolution per neighbour net, cached for the whole call.
  const constantMasks = !resolver.hasAreaRules;
  const flatRequired = new Map<string, number>();
  const requiredFlat = (
    pairKind: "traceToTrace" | "traceToPad",
    otherNetId: string | null,
  ): number => {
    // Length-prefixed, like the resolver's own memo key: net ids are free text.
    const key = `${pairKind}|${otherNetId === null ? "-" : `${otherNetId.length}:${otherNetId}`}`;
    const cached = flatRequired.get(key);
    if (cached !== undefined) return cached;
    const mm = resolver.clearance(
      pairKind,
      input.layer,
      { netId: input.netId, pointMm: ORIGIN },
      { netId: otherNetId, pointMm: ORIGIN },
    ).mm;
    flatRequired.set(key, mm);
    return mm;
  };
  /**
   * Regions of constant area-scope membership along one segment. The
   * `hasAreaRules` guard comes FIRST so the common board — no area rules at
   * all — never builds a bounds object on this per-pointer-move path.
   */
  const splitAtAreas = (a: Point, b: Point): PolylineSegment[] => {
    if (!resolver.hasAreaRules) return [{ a, b }];
    const bounds: RingBounds = boundsOfPoints([a, b]);
    return resolver.boundsMeetAnyArea(bounds)
      ? splitSegmentAtRings(a, b, resolver.areaRings)
      : [{ a, b }];
  };

  // Pad geometry is identical for every pending segment — build once, not
  // inside the per-segment loop.
  const padGeoms = computePadGeoms(input.placements, input.padNetMap);

  // Keepout broad-phase, once per call: the ring's bounds inflated by the
  // pending half-width. The exact predicate re-canonicalises the ring on every
  // call (it is total over raw input), so on this per-pointer-move path only
  // segments whose stadium box meets the keepout box reach it.
  const keepoutBoxes = (input.keepouts ?? [])
    .filter((k) => k.restrictions.tracks && k.layers.includes(input.layer))
    .map((keepout) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of keepout.pointsMm) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { keepout, minX, minY, maxX, maxY };
    });

  // Check pending segments vs existing traces (same layer, different net or unknown).
  for (let i = 1; i < traceMm.length; i += 1) {
    const seg: PolylineSegment = {
      a: traceMm[i - 1]!,
      b: traceMm[i]!,
    };
    if (seg.a.x === seg.b.x && seg.a.y === seg.b.y) continue;
    // Regions of constant area-scope membership along this pending segment.
    const pendingSubs = splitAtAreas(seg.a, seg.b);

    for (const other of input.traces) {
      if (other.layer !== input.layer) continue;
      if (
        other.netId !== null &&
        input.netId !== null &&
        other.netId === input.netId
      ) {
        continue; // same net is always OK
      }
      const otherHalf = other.widthMm / 2;
      const half = pendingHalf + otherHalf;
      let minGap = Infinity;
      let minRequired = 0;
      let breach: Breach | null = null;
      let worstDeficit = -Infinity;
      for (let j = 1; j < other.pointsNm.length; j += 1) {
        const oa = nmToMm(other.pointsNm[j - 1]!);
        const ob = nmToMm(other.pointsNm[j]!);
        for (const v of splitAtAreas(oa, ob)) {
          for (const u of pendingSubs) {
            const cp = segmentClosestPoints(u.a, u.b, v.a, v.b);
            const gap = cp.distance - half;
            const required = constantMasks
              ? requiredFlat("traceToTrace", other.netId)
              : resolver.clearance(
                  "traceToTrace",
                  input.layer,
                  { netId: input.netId, pointMm: midpoint(u.a, u.b) },
                  { netId: other.netId, pointMm: midpoint(v.a, v.b) },
                ).mm;
            if (gap < minGap) {
              minGap = gap;
              minRequired = required;
            }
            if (!clearanceViolated(gap, required)) continue;
            const deficit = required - gap;
            if (deficit > worstDeficit) {
              worstDeficit = deficit;
              breach = { gap, required };
            }
          }
        }
      }
      // A short outranks the clearance tier: different-net copper that touches
      // is a dead short whatever the rule resolved to (§9, Astra run 1 #12).
      if (
        differentKnownNet(input.netId, other.netId) &&
        minGap <= SHORT_EPS_MM
      ) {
        violations.push({
          segmentIndex: i - 1,
          type: "trace-short",
          offendingId: other.id,
          distanceMm: minGap,
          requiredMm: minRequired,
        });
      } else if (breach) {
        violations.push({
          segmentIndex: i - 1,
          type: "trace-trace",
          offendingId: other.id,
          distanceMm: breach.gap,
          requiredMm: breach.required,
        });
      }
    }

    // Check pending segments vs existing pads (same layer, different net).
    // The pad keeps its AABB model and its centre as the evaluation point
    // (S8 owns pad-geometry parity with batch).
    for (const pad of padGeoms) {
      if (pad.layer !== input.layer) continue;
      if (
        pad.netId !== null &&
        input.netId !== null &&
        pad.netId === input.netId
      ) {
        continue;
      }
      let minGap = Infinity;
      let minRequired = 0;
      let breach: Breach | null = null;
      let worstDeficit = -Infinity;
      for (const u of pendingSubs) {
        const gap =
          polylineToAabbDistance([u.a, u.b], pad.bounds) - pendingHalf;
        const required = constantMasks
          ? requiredFlat("traceToPad", pad.netId)
          : resolver.clearance(
              "traceToPad",
              input.layer,
              { netId: input.netId, pointMm: midpoint(u.a, u.b) },
              { netId: pad.netId, pointMm: pad.center },
            ).mm;
        if (gap < minGap) {
          minGap = gap;
          minRequired = required;
        }
        if (!clearanceViolated(gap, required)) continue;
        const deficit = required - gap;
        if (deficit > worstDeficit) {
          worstDeficit = deficit;
          breach = { gap, required };
        }
      }
      if (differentKnownNet(input.netId, pad.netId) && minGap <= SHORT_EPS_MM) {
        violations.push({
          segmentIndex: i - 1,
          type: "trace-short",
          offendingId: pad.id,
          distanceMm: minGap,
          requiredMm: minRequired,
        });
      } else if (breach) {
        violations.push({
          segmentIndex: i - 1,
          type: "trace-pad",
          offendingId: pad.id,
          distanceMm: breach.gap,
          requiredMm: breach.required,
        });
      }
    }

    // Check pending segments against rule areas (exact predicate, clearance 0).
    for (const box of keepoutBoxes) {
      const segMinX = Math.min(seg.a.x, seg.b.x) - pendingHalf;
      const segMaxX = Math.max(seg.a.x, seg.b.x) + pendingHalf;
      const segMinY = Math.min(seg.a.y, seg.b.y) - pendingHalf;
      const segMaxY = Math.max(seg.a.y, seg.b.y) + pendingHalf;
      if (
        segMaxX < box.minX ||
        segMinX > box.maxX ||
        segMaxY < box.minY ||
        segMinY > box.maxY
      ) {
        continue;
      }
      const keepout = box.keepout;
      const affected = keepoutAffects(keepout, {
        kind: "trace",
        layer: input.layer,
        pointsMm: [seg.a, seg.b],
        widthMm: input.traceWidthMm,
      });
      if (!affected) continue;
      violations.push({
        segmentIndex: i - 1,
        type: "trace-keepout",
        offendingId: keepout.id,
        distanceMm: 0,
        requiredMm: 0,
      });
    }
  }

  return violations;
}
