import type {
  PcbCopperLayerId,
  PcbDesignRules,
  PcbNetClass,
  PcbPlacedPart,
  PcbTrace,
} from "../../../../../sdks";
import { placementMirrorX } from "../../../../../sdks/designer/pcb-helpers";
import {
  polylineToAabbDistance,
  segmentToSegmentDistance,
} from "../../../../../shared/pcb-geometry/pcb-trace-geometry";

type Point = { x: number; y: number };

interface PolylineSegment {
  a: Point;
  b: Point;
}

export interface DrcViolation {
  /** Index of the offending segment within the input polyline. */
  segmentIndex: number;
  /** Kind of clearance breach. */
  type: "trace-trace" | "trace-pad";
  /** Identifier of the offending neighbor (trace id or `${placementId}:${pad}`). */
  offendingId: string;
  /** Actual clearance distance in mm. */
  distanceMm: number;
  /** Required clearance from net-class / design rules in mm. */
  requiredMm: number;
}

const NM_TO_MM = 1 / 1_000_000;

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
        bounds: {
          minX: cx - halfW,
          minY: cy - halfH,
          maxX: cx + halfW,
          maxY: cy + halfH,
        },
        // For now treat all pads as on F.Cu and B.Cu (through-hole / SMD on either layer).
        // For v1 we check the pad against any active-layer trace; v1.1 will refine this.
        layer: placement.layer === "B.Cu" ? "B.Cu" : "F.Cu",
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
  /** Net classes (the pending trace's class drives clearance). */
  netClasses: ReadonlyArray<PcbNetClass>;
  /** Net class id of the pending trace. */
  netClassId: string;
  /** Board design rules (used as fallback when net class lacks a value). */
  designRules: PcbDesignRules;
}

/**
 * Run live DRC for the pending trace polyline against existing traces & pads.
 * Returns a flat list of violations keyed by segment index.
 *
 * Clearance model (v1):
 *   required = max(netClass.clearanceMm, designRules.clearance.traceTo*) -
 *              (pendingHalfWidth + neighborHalfWidth)
 *
 * If the actual edge-to-edge distance < required, a violation is emitted.
 */
export function runLiveDrc(input: RunDrcInput): DrcViolation[] {
  const violations: DrcViolation[] = [];
  if (input.traceNm.length < 2) return violations;
  const traceMm = input.traceNm.map(nmToMm);

  const cls = input.netClasses.find((c) => c.id === input.netClassId);
  const traceClearance = Math.max(
    cls?.clearanceMm ?? 0,
    input.designRules.clearance.traceToTraceMm,
  );
  const padClearance = Math.max(
    cls?.clearanceMm ?? 0,
    input.designRules.clearance.traceToPadMm,
  );

  const pendingHalf = input.traceWidthMm / 2;

  // Check pending segments vs existing traces (same layer, different net or unknown).
  for (let i = 1; i < traceMm.length; i += 1) {
    const seg: PolylineSegment = {
      a: traceMm[i - 1]!,
      b: traceMm[i]!,
    };
    if (seg.a.x === seg.b.x && seg.a.y === seg.b.y) continue;

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
      const required = traceClearance + pendingHalf + otherHalf;
      for (let j = 1; j < other.pointsNm.length; j += 1) {
        const o: PolylineSegment = {
          a: nmToMm(other.pointsNm[j - 1]!),
          b: nmToMm(other.pointsNm[j]!),
        };
        const edge = segmentToSegmentDistance(seg.a, seg.b, o.a, o.b);
        if (edge < required) {
          violations.push({
            segmentIndex: i - 1,
            type: "trace-trace",
            offendingId: other.id,
            distanceMm: edge,
            requiredMm: required,
          });
          break; // one violation per existing trace per segment is enough
        }
      }
    }

    // Check pending segments vs existing pads (same layer, different net).
    const padGeoms = computePadGeoms(input.placements, input.padNetMap);
    for (const pad of padGeoms) {
      if (pad.layer !== input.layer) continue;
      if (
        pad.netId !== null &&
        input.netId !== null &&
        pad.netId === input.netId
      ) {
        continue;
      }
      const required = padClearance + pendingHalf;
      const edge = polylineToAabbDistance([seg.a, seg.b], pad.bounds);
      if (edge < required) {
        violations.push({
          segmentIndex: i - 1,
          type: "trace-pad",
          offendingId: pad.id,
          distanceMm: edge,
          requiredMm: required,
        });
      }
    }
  }

  return violations;
}
