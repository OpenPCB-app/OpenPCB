import type { RatsnestSegment } from "../../../../../sdks/designer";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/**
 * Unconnected-net check, derived from the projection's ratsnest. The ratsnest
 * is the MST of each net's *unrouted* components, computed from the shared
 * copper-connectivity kernel (footprint pads, free pads, traces, vias and pour
 * islands), so any remaining airwire means the net is not fully routed. One
 * warning per net (NET_SHORT_CIRCUIT for diff-net overlap is emitted by the
 * clearance check). Contract: docs/pcb-hardening/01-connectivity-contract.md.
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
