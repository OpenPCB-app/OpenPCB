import type { RatsnestSegment } from "../../../../../sdks/designer";
import {
  ratsnestFromConnectivity,
  ratsnestNetIds,
} from "../../pcb/ratsnest";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/**
 * Unconnected-net check. DRC DERIVES ITS OWN RATSNEST (contract 06 §1) from the
 * context's connectivity result and copper records rather than trusting the
 * caller-supplied `projection.ratsnest`: the report must be a pure function of
 * the projection, and the ratsnest is the MST over exactly the graph — pads,
 * free pads, traces, vias and the pour islands `pourResults()` already filled —
 * that every other check in this run reasons about. One model, one fill, so a
 * remaining airwire here can never describe a different board than the shorts
 * and opens reported next to it.
 *
 * One violation per net (NET_SHORT_CIRCUIT for diff-net overlap is emitted by
 * the clearance check). Contract:
 * docs/pcb-hardening/01-connectivity-contract.md.
 */
export function checkConnectivity(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const padNetIds = new Map(Object.entries(ctx.projection.padNets ?? {}));
  const ratsnest = ratsnestFromConnectivity({
    items: ctx.copperItems(),
    result: ctx.connectivity(),
    records: ctx.copperRecords,
    netNames: new Map(Object.entries(ctx.netNames)),
    netClasses: ctx.netClasses,
    ...(ctx.projection.board.perNetClassAssignments !== undefined
      ? {
          perNetClassAssignments:
            ctx.projection.board.perNetClassAssignments,
        }
      : {}),
    netIds: ratsnestNetIds({
      padNetIds,
      freePads: ctx.projection.freePads,
    }),
  });

  const byNet = new Map<string, RatsnestSegment[]>();
  for (const seg of ratsnest) {
    const list = byNet.get(seg.netId);
    if (list) list.push(seg);
    else byNet.set(seg.netId, [seg]);
  }
  for (const [netId, segs] of byNet) {
    const name = ctx.netNames[netId] ?? netId;
    const first = segs[0]!;
    out.push({
      code: "UNCONNECTED_NET",
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
