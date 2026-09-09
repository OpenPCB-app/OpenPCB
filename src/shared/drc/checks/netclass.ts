import type { PcbNetClass } from "../../../sdks/designer";
import { netNameMatchesClassPattern } from "../../pcb-areas/net-class-resolver";
import { below, type DrcContext, type LegalityContext } from "../drc-context";
import type { ItemSet } from "./clearance-judge";
import type { DrcViolationDraft } from "../types";

/**
 * Net-class dimension enforcement (audit §2 gap): a net class carries
 * `traceWidthMm`/`viaDiameterMm`/`viaDrillMm` that were creation-time defaults
 * only — never checked. This flags traces/vias narrower than their net's
 * class, resolved LIVE from the net (audit B3-2), never the stored id.
 *
 * Enforced ONLY for nets the user deliberately put in a class — an explicit
 * `perNetClassAssignments` entry or a name match (GND/POWER). Nets that fall
 * to the array-order default class are NOT enforced, because a class's nominal
 * width isn't a minimum for an unclassified net (that would flag every default
 * trace, since default trace width sits below the default class width).
 *
 * Severity is `warning`: the class width is a recommended default a user may
 * deliberately narrow, not a hard fab floor.
 */
export function netClassItems(
  ctx: LegalityContext,
  items: ItemSet,
  opts: { out: DrcViolationDraft[] },
): void {
  const out = opts.out;
  const board = ctx.board;
  const classById = new Map(board.netClasses.map((c) => [c.id, c]));
  const cache = new Map<string, PcbNetClass | null>();
  const assignments = board.perNetClassAssignments ?? {};

  const classOf = (netId: string | null): PcbNetClass | null => {
    if (!netId) return null;
    const cached = cache.get(netId);
    if (cached !== undefined) return cached;
    const name = ctx.netNames[netId] ?? "";
    // One resolution of net → class for the whole run (contract §3): the
    // resolver's, never a second copy of the chain.
    const id = ctx.resolver.netClassIdOf(netId);
    // Intent gate: only enforce when the class came from an explicit
    // assignment or a name match — never the array-order fallback.
    const explicit =
      (assignments[netId] !== undefined &&
        board.netClasses.some((c) => c.id === assignments[netId])) ||
      netNameMatchesClassPattern(name, board.netClasses);
    const cls = explicit ? (classById.get(id) ?? null) : null;
    cache.set(netId, cls);
    return cls;
  };

  for (const t of items.traces) {
    const cls = classOf(t.netId);
    if (cls && below(t.widthMm, cls.traceWidthMm)) {
      out.push({
        code: "NETCLASS_TRACE_WIDTH",
        message: `Trace ${t.widthMm.toFixed(3)} mm is narrower than net class "${cls.name}" width ${cls.traceWidthMm.toFixed(3)} mm`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
        measuredMm: t.widthMm,
        requiredMm: cls.traceWidthMm,
      });
    }
  }

  for (const vg of items.vias) {
    const cls = classOf(vg.netId);
    if (!cls) continue;
    if (below(vg.via.diameterMm, cls.viaDiameterMm)) {
      out.push({
        code: "NETCLASS_VIA_DIAMETER",
        message: `Via diameter ${vg.via.diameterMm.toFixed(3)} mm is smaller than net class "${cls.name}" ${cls.viaDiameterMm.toFixed(3)} mm`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
        measuredMm: vg.via.diameterMm,
        requiredMm: cls.viaDiameterMm,
      });
    }
    if (below(vg.via.drillMm, cls.viaDrillMm)) {
      out.push({
        code: "NETCLASS_VIA_DRILL",
        message: `Via drill ${vg.via.drillMm.toFixed(3)} mm is smaller than net class "${cls.name}" ${cls.viaDrillMm.toFixed(3)} mm`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
        measuredMm: vg.via.drillMm,
        requiredMm: cls.viaDrillMm,
      });
    }
  }
}

export function checkNetClass(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  netClassItems(ctx, ctx, { out });
  return out;
}
