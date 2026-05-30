import type { RatsnestSegment } from "../../../../../sdks/designer";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/**
 * Unconnected-net check, derived from the projection's ratsnest. The ratsnest
 * is the MST of each net's *unrouted* components (union-find over pads ↔ trace
 * endpoints ↔ vias), so any remaining airwire means the net is not fully
 * routed. One warning per net (NET_SHORT_CIRCUIT for diff-net overlap is
 * emitted by the clearance check).
 *
 * Limitation (shared with the ratsnest): footprint pads only; free pads and
 * mid-trace T-junctions are not yet part of the connectivity graph.
 */
export function checkConnectivity(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const byNet = new Map<string, RatsnestSegment[]>();
  for (const seg of ctx.ratsnest) {
    const list = byNet.get(seg.netId);
    if (list) list.push(seg);
    else byNet.set(seg.netId, [seg]);
  }
  for (const [netId, segs] of byNet) {
    const name = ctx.netNames[netId] ?? netId;
    const first = segs[0]!;
    out.push({
      code: "UNCONNECTED_NET",
      ruleClass: "connectivity",
      severity: "warning",
      message: `Net "${name}" is not fully routed (${segs.length} airwire${segs.length > 1 ? "s" : ""} remaining)`,
      anchors: [{ kind: "net", netId }],
      locationMm: {
        x: (first.fromMm.x + first.toMm.x) / 2,
        y: (first.fromMm.y + first.toMm.y) / 2,
      },
    });
  }
  return out;
}
