import type {
  PcbPlacedPart,
  PcbTrace,
  RatsnestSegment,
} from "../../../../sdks";
import { placementMirrorX } from "../../../../sdks/designer/pcb-helpers";

/**
 * Resolve `${placementId}|${padNumber}` → netId for footprint pads. Consumed by
 * the copper pour (same-net merge in `collectBareCopper`) and route-focus pad
 * dimming. Two sources, in precedence order:
 *
 *  1. Ratsnest airwire endpoints — covers every pad with ≥1 unrouted same-net
 *     link (carries `netId` directly, no coordinate math).
 *  2. Trace endpoints landing exactly on a pad world-centre — fills in pads
 *     whose airwires are fully routed away (so they're absent from the
 *     ratsnest).
 *
 * The pad world transform MUST match the render / pour transform: mirror X for
 * `mirrored` OR `B.Cu` placements (`placementMirrorX`). Using only
 * `placement.mirrored` left bottom-side pad centres un-mirrored, so trace
 * endpoints never matched them and fully-routed B.Cu pads lost their net (then
 * the pour mis-bucketed a same-net pad as different-net → spurious moat).
 */
export function buildPadNetIds(
  ratsnest: ReadonlyArray<RatsnestSegment>,
  placements: ReadonlyArray<PcbPlacedPart>,
  traces: ReadonlyArray<PcbTrace>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const seg of ratsnest) {
    map.set(`${seg.fromPlacementId}|${seg.fromPadNumber}`, seg.netId);
    map.set(`${seg.toPlacementId}|${seg.toPadNumber}`, seg.netId);
  }

  const padPosIndex = new Map<string, string>();
  for (const placement of placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    if (pads.length === 0) continue;
    const radians = (placement.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const sx = placementMirrorX(placement) ? -1 : 1;
    for (const pad of pads) {
      const mx = sx * pad.centerMm.x;
      const wx = cos * mx - sin * pad.centerMm.y + placement.positionMm.x;
      const wy = sin * mx + cos * pad.centerMm.y + placement.positionMm.y;
      // Quantise to nm to match trace endpoint coordinates exactly.
      const xnm = Math.round(wx * 1_000_000);
      const ynm = Math.round(wy * 1_000_000);
      padPosIndex.set(`${xnm}|${ynm}`, `${placement.id}|${pad.number}`);
    }
  }

  for (const trace of traces) {
    if (!trace.netId || trace.pointsNm.length < 2) continue;
    const head = trace.pointsNm[0]!;
    const tail = trace.pointsNm[trace.pointsNm.length - 1]!;
    for (const end of [head, tail]) {
      const padKey = padPosIndex.get(`${end.x}|${end.y}`);
      if (padKey) map.set(padKey, trace.netId);
    }
  }
  return map;
}
