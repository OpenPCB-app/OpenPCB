import { polylineLength } from "../../pcb-geometry/pcb-trace-geometry";
import { canonicalTraces } from "../pair-gap";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/**
 * Length-match rules (PcbBoardSettings.lengthMatchGroups): every routed
 * member net must sit inside the group's target ± tolerance window.
 *
 * v1 semantics:
 * - Per-net routed length = plain sum of its trace polylines across all
 *   layers; via barrel length is not modeled.
 * - Unrouted members (zero length) are skipped — connectivity checks own
 *   missing copper; a length rule only judges what exists.
 * - `longest` targets track the longest routed member, so only shorter nets
 *   can violate. `absolute` targets flag both directions.
 * - A net violating in several groups yields ONE violation per group: the
 *   group is a second anchor, so the ids stay distinct (contract 06 §6).
 */
export function checkLength(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const groups = ctx.projection.board.lengthMatchGroups ?? [];
  if (groups.length === 0) return out;

  // Float sums are order-dependent (0.1 + 0.1 + 0.3 ≠ 0.3 + 0.1 + 0.1 at the
  // last bit), so accumulate in canonical trace order, never array order
  // (contract 06 §7, Astra S7 #6).
  const lengthByNet = new Map<string, number>();
  for (const t of canonicalTraces(ctx.traces)) {
    if (t.netId === null) continue;
    lengthByNet.set(
      t.netId,
      (lengthByNet.get(t.netId) ?? 0) + polylineLength(t.pointsMm),
    );
  }

  for (const group of groups) {
    const routed = group.netIds
      .map((netId) => ({ netId, lengthMm: lengthByNet.get(netId) ?? 0 }))
      .filter((m) => m.lengthMm > 0);
    if (routed.length === 0) continue;
    if (group.target.kind === "longest" && routed.length < 2) continue;
    const targetMm =
      group.target.kind === "absolute"
        ? group.target.mm
        : Math.max(...routed.map((m) => m.lengthMm));
    for (const member of routed) {
      const deltaMm = member.lengthMm - targetMm;
      const tooShort = deltaMm < -group.toleranceMm;
      const tooLong =
        group.target.kind === "absolute" && deltaMm > group.toleranceMm;
      if (!tooShort && !tooLong) continue;
      const netName = ctx.netNames[member.netId] ?? member.netId;
      out.push({
        code: "NET_LENGTH_OUT_OF_RANGE",
        message:
          `Net ${netName} routed ${member.lengthMm.toFixed(2)} mm — ` +
          `${tooShort ? "short of" : "over"} the '${group.name}' target ` +
          `${targetMm.toFixed(2)} mm by ${Math.abs(deltaMm).toFixed(2)} mm ` +
          `(tolerance ±${group.toleranceMm.toFixed(2)} mm)`,
        anchors: [
          { kind: "net", netId: member.netId },
          { kind: "lengthGroup", groupId: group.id },
        ],
        measuredMm: member.lengthMm,
        requiredMm: targetMm,
      });
    }
  }
  return out;
}
