import type { NetPath } from "../../pcb-connectivity/net-path";
import { resolveLengthTarget } from "../si/length-target";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/**
 * Length-match rules (`PcbBoardSettings.lengthMatchGroups`): every member net
 * with a ROUTED LENGTH must sit inside the group's target ± tolerance window.
 *
 * Since S14 the length of a net is `ctx.netPaths()`'s — the minimal subtree of
 * the bridge-only forest spanning the net's terminals (SI contract 14 §2), not
 * the sum of its trace polylines. What that buys, stated as the rules this
 * check now obeys:
 *
 * - Dangling stubs, hanging rings and partial duplicates are BRANCHES: copper
 *   the net owns and the route does not run through. They no longer inflate a
 *   length (`TRACK_DANGLING` / `TRACE_OVERLAP` own them).
 * - A through via traversed outer-to-outer contributes the board thickness;
 *   the trace copper inside a terminal or a barrel disc is not routed length.
 * - A net whose copper offers NO single route — a loop, a pour bypass, an
 *   undefined via traversal, a contact the model could not locate — is
 *   reported as `NET_LENGTH_UNDEFINED` instead of
 *   being measured by an arbitrary sum, so the rule is never silently inert
 *   (contract 14 §3). `open` and `terminals` stay silent: `UNCONNECTED_NET`
 *   and the absence of pins are not this rule's facts.
 * - A net violating in several groups yields ONE violation per group: the
 *   group is a second anchor, so the ids stay distinct (contract 06 §6).
 */
export function checkLength(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const groups = ctx.projection.board.lengthMatchGroups ?? [];
  if (groups.length === 0) return out;

  const netPaths = ctx.netPaths();
  const pathCache = new Map<string, NetPath>();
  const pathOf = (netId: string): NetPath => {
    const hit = pathCache.get(netId);
    if (hit) return hit;
    const path = netPaths.netPath(netId);
    pathCache.set(netId, path);
    return path;
  };

  for (const group of groups) {
    // Canonical member order (contract 06 §7): the group's own list, each net
    // once. The target resolution walks the same list, so the float sum that
    // picks `longest` cannot follow the projection's array order.
    const members: string[] = [];
    const seen = new Set<string>();
    for (const netId of group.netIds) {
      if (seen.has(netId)) continue;
      seen.add(netId);
      members.push(netId);
    }

    const lengthByNet = new Map<string, number>();
    for (const netId of members) {
      const path = pathOf(netId);
      if (path.kind === "defined") lengthByNet.set(netId, path.lengthMm);
    }

    for (const netId of members) {
      const path = pathOf(netId);
      if (path.kind !== "undefined") continue;
      if (path.reason === "open" || path.reason === "terminals") continue;
      const netName = ctx.netNames[netId] ?? netId;
      out.push({
        code: "NET_LENGTH_UNDEFINED",
        message:
          `Net ${netName} has no single routed length — ` +
          `${undefinedReasonText(path.reason)}; the '${group.name}' ` +
          `length target cannot be judged`,
        anchors: [
          { kind: "net", netId },
          { kind: "lengthGroup", groupId: group.id },
        ],
      });
    }

    const target = resolveLengthTarget(group, lengthByNet);
    if (target === null) continue;
    const targetMm = target.targetMm;
    for (const netId of members) {
      const lengthMm = lengthByNet.get(netId);
      if (lengthMm === undefined) continue;
      const deltaMm = lengthMm - targetMm;
      const tooShort = deltaMm < -group.toleranceMm;
      const tooLong =
        group.target.kind === "absolute" && deltaMm > group.toleranceMm;
      if (!tooShort && !tooLong) continue;
      const netName = ctx.netNames[netId] ?? netId;
      out.push({
        code: "NET_LENGTH_OUT_OF_RANGE",
        message:
          `Net ${netName} routed ${lengthMm.toFixed(2)} mm — ` +
          `${tooShort ? "short of" : "over"} the '${group.name}' target ` +
          `${targetMm.toFixed(2)} mm by ${Math.abs(deltaMm).toFixed(2)} mm ` +
          `(tolerance ±${group.toleranceMm.toFixed(2)} mm)`,
        anchors: [
          { kind: "net", netId },
          { kind: "lengthGroup", groupId: group.id },
        ],
        measuredMm: lengthMm,
        requiredMm: targetMm,
      });
    }
  }
  return out;
}

/**
 * Why the path model refused a single length (contract 14 §2.7), plus the
 * SI check's own `multi-terminal` reason for a `tree` skew (§4.2). Shared so
 * both emit sites of `NET_LENGTH_UNDEFINED` say the same words.
 *
 * Takes a plain string, and falls through to the reason itself: a reason the
 * path model gains later must reach the report as text, never be dropped by a
 * check that does not recognise it yet. The emit sites decide what to REPORT
 * the same way — everything but `open` and `terminals` is reported.
 */
export function undefinedReasonText(reason: string): string {
  switch (reason) {
    case "loop":
      return "its copper offers more than one route between the terminals (loop)";
    case "pour":
      return "a copper pour bypasses the route (pour)";
    case "via":
      return "it traverses a via whose length is undefined (via)";
    case "unresolved":
      return "a contact on its copper could not be located (unresolved)";
    case "multi-terminal":
      return "it has more than two terminals, so endpoint skew is undefined (multi-terminal)";
    default:
      return `its path is undefined (${reason})`;
  }
}
